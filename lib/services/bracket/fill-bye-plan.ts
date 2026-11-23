import { BracketsManager } from 'brackets-manager';
import type { InputStage, StageSettings, StageType } from 'brackets-model';
import { Status } from 'brackets-model';
import { MemoryBracketStorage } from './memory-bracket-storage';
import { isByeMatch } from '@/lib/brackets/match-state';

/**
 * Filling a Round 1 bye: the bracket is rebuilt in memory with the new participant in
 * the bye's slot, every recorded result is replayed onto it, and the rows that differ
 * from the stored bracket are the ones to write. Nothing here touches the database.
 */

export type PlanOpponent = {
  id?: number | null;
  position?: number;
  score?: number;
  result?: string;
  forfeit?: boolean;
} | null;

export interface PlanMatch {
  id: number;
  group_id: number;
  round_id: number;
  number: number;
  status: number;
  opponent1: PlanOpponent;
  opponent2: PlanOpponent;
}

export interface BracketSnapshot {
  stage: { type: string; settings: Record<string, unknown> | null };
  groups: Array<{ id: number; number: number }>;
  rounds: Array<{ id: number; group_id: number; number: number }>;
  matches: PlanMatch[];
  participantIds: number[];
}

export interface MatchRewrite {
  matchId: number;
  status: number;
  opponent1: PlanOpponent;
  opponent2: PlanOpponent;
  /** Was a hidden bye match, is now a real one. */
  becameVisible: boolean;
}

export type FillByePlanError =
  | 'not_an_open_bye'
  | 'bye_closed'
  | 'unsupported_bracket'
  | 'edited_by_hand';

export class FillByePlanFailure extends Error {
  constructor(readonly code: FillByePlanError, message: string) {
    super(message);
  }
}

const WINNERS_GROUP = 1;

export { isByeMatch };

function key(groupNumber: number, roundNumber: number, matchNumber: number): string {
  return `${groupNumber}:${roundNumber}:${matchNumber}`;
}

function matchKeys(snapshot: Pick<BracketSnapshot, 'groups' | 'rounds'>) {
  const groupNumber = new Map(snapshot.groups.map((g) => [g.id, g.number]));
  const roundNumber = new Map(snapshot.rounds.map((r) => [r.id, r.number]));
  return (match: Pick<PlanMatch, 'group_id' | 'round_id' | 'number'>) =>
    key(groupNumber.get(match.group_id) ?? -1, roundNumber.get(match.round_id) ?? -1, match.number);
}

function firstRoundMatches(snapshot: BracketSnapshot): PlanMatch[] {
  const wb = snapshot.groups.find((g) => g.number === WINNERS_GROUP);
  const r1 = snapshot.rounds.find((r) => r.group_id === wb?.id && r.number === 1);
  return snapshot.matches.filter((m) => m.round_id === r1?.id).sort((a, b) => a.number - b.number);
}

/** Round 1 matches where one slot is a bye and the other holds a participant. */
export function openByeMatches(snapshot: BracketSnapshot): Array<{ match: PlanMatch; participantId: number }> {
  return firstRoundMatches(snapshot).flatMap((match) => {
    const team = match.opponent1 ?? match.opponent2;
    if (!isByeMatch(match) || match.opponent1 === match.opponent2 || team?.id == null) return [];
    return [{ match, participantId: team.id }];
  });
}

/**
 * The stage's seeding as brackets-manager saw it after balancing byes: entry i is the
 * participant at position i + 1, null for a bye. With inner_outer ordering a Round 1
 * pair's positions add up to size + 1, which gives a bye's position.
 */
function storedSeeding(snapshot: BracketSnapshot, size: number): Array<number | null> {
  const seeding: Array<number | null> = Array.from({ length: size }, () => null);
  for (const match of firstRoundMatches(snapshot)) {
    for (const slot of [match.opponent1, match.opponent2]) {
      if (slot?.id == null) continue;
      if (slot.position == null || slot.position < 1 || slot.position > size) {
        throw new FillByePlanFailure('unsupported_bracket', 'A first-round slot has no seed position');
      }
      seeding[slot.position - 1] = slot.id;
    }
  }
  return seeding;
}

function sameSlot(a: PlanOpponent, b: PlanOpponent): boolean {
  if (a === null || b === null) return a === b;
  return (
    (a.id ?? null) === (b.id ?? null) &&
    (a.result ?? null) === (b.result ?? null) &&
    Boolean(a.forfeit) === Boolean(b.forfeit) &&
    (a.position == null || b.position == null || a.position === b.position)
  );
}

function sameRow(a: PlanMatch, b: PlanMatch): boolean {
  return sameSlot(a.opponent1, b.opponent1) && sameSlot(a.opponent2, b.opponent2);
}

/** Recorded results to replay, in an order where every match's inputs come first. */
function recordedResults(snapshot: BracketSnapshot): PlanMatch[] {
  return [...snapshot.matches]
    .filter((m) => m.status >= Status.Completed && (m.opponent1?.result != null || m.opponent2?.result != null))
    .filter((m) => !isByeMatch(m))
    .sort((a, b) => a.id - b.id);
}

/**
 * Generate the stage from `seeding` and replay the snapshot's results. Returns the
 * generated matches by (group, round, number).
 */
async function generate(
  snapshot: BracketSnapshot,
  seeding: Array<number | null>,
  replayFailure: FillByePlanFailure
): Promise<Map<string, PlanMatch>> {
  const settings = (snapshot.stage.settings ?? {}) as StageSettings;
  const storage = new MemoryBracketStorage();
  const ids = seeding.filter((id): id is number => id !== null);
  storage.seed('participant', ids.map((id) => ({ id, tournament_id: 0, name: String(id) })));
  const manager = new BracketsManager(storage);
  await manager.create.stage({
    tournamentId: 0,
    name: 'rebuild',
    type: snapshot.stage.type as StageType,
    seedingIds: seeding,
    settings: { ...settings, balanceByes: false },
  } as InputStage);

  const generatedKey = matchKeys({ groups: storage.dump('group') as never, rounds: storage.dump('round') as never });
  const byKey = new Map<string, PlanMatch>();
  for (const match of storage.dump('match') as unknown as PlanMatch[]) {
    byKey.set(generatedKey(match), match);
  }

  const storedKey = matchKeys(snapshot);
  for (const recorded of recordedResults(snapshot)) {
    const target = byKey.get(storedKey(recorded));
    if (!target) {
      throw new FillByePlanFailure('unsupported_bracket', 'The bracket structure could not be rebuilt');
    }
    const replayed = (slot: PlanOpponent) => ({
      ...(slot?.score !== undefined ? { score: slot.score } : {}),
      ...(slot?.result ? { result: slot.result as 'win' | 'loss' | 'draw' } : {}),
      ...(slot?.forfeit ? { forfeit: true } : {}),
    });
    try {
      await manager.update.match({
        id: target.id,
        opponent1: replayed(recorded.opponent1),
        opponent2: replayed(recorded.opponent2),
      });
    } catch {
      throw replayFailure;
    }
  }

  byKey.clear();
  for (const match of storage.dump('match') as unknown as PlanMatch[]) {
    // Every match whose two slots hold a participant is Ready (as createBracketTx does).
    if (match.status < Status.Ready && match.opponent1?.id != null && match.opponent2?.id != null) {
      match.status = Status.Ready;
    }
    byKey.set(generatedKey(match), match);
  }
  return byKey;
}

/**
 * The bracket rows that change when `participantId` takes the bye in Round 1 match
 * `byeMatchId`. Throws FillByePlanFailure when the bracket can't be rebuilt faithfully
 * (e.g. a team was moved by hand), so nothing is written from a guess.
 */
export async function planFillBye(
  snapshot: BracketSnapshot,
  byeMatchId: number,
  participantId: number
): Promise<MatchRewrite[]> {
  const settings = (snapshot.stage.settings ?? {}) as StageSettings & { size?: number };
  const size = Number(settings.size);
  const ordering = settings.seedOrdering?.[0];
  if (!Number.isInteger(size) || size < 2 || ordering !== 'inner_outer' || settings.skipFirstRound) {
    throw new FillByePlanFailure('unsupported_bracket', 'This bracket was not generated in a way a bye can be filled');
  }

  const bye = openByeMatches(snapshot).find((entry) => entry.match.id === byeMatchId);
  if (!bye) {
    throw new FillByePlanFailure('not_an_open_bye', 'That match is not a first-round bye');
  }
  if (snapshot.participantIds.includes(participantId)) {
    throw new FillByePlanFailure('not_an_open_bye', 'That team is already in the bracket');
  }

  const seeding = storedSeeding(snapshot, size);
  const teamPosition = (bye.match.opponent1 ?? bye.match.opponent2)!.position!;
  const byePosition = size + 1 - teamPosition;
  if (seeding[byePosition - 1] !== null) {
    throw new FillByePlanFailure('unsupported_bracket', 'The bye position is already taken');
  }

  const storedKey = matchKeys(snapshot);
  const baseline = await generate(
    snapshot,
    seeding,
    new FillByePlanFailure('edited_by_hand', 'A recorded result no longer fits the bracket')
  );
  for (const match of snapshot.matches) {
    const rebuilt = baseline.get(storedKey(match));
    if (!rebuilt) {
      throw new FillByePlanFailure('unsupported_bracket', 'The bracket structure could not be rebuilt');
    }
    if (!sameRow(match, rebuilt)) {
      throw new FillByePlanFailure(
        'edited_by_hand',
        'Teams were moved by hand in this bracket, so a bye can no longer be filled automatically'
      );
    }
  }
  if (baseline.size !== snapshot.matches.length) {
    throw new FillByePlanFailure('unsupported_bracket', 'The bracket structure could not be rebuilt');
  }

  const filledSeeding = [...seeding];
  filledSeeding[byePosition - 1] = participantId;
  // A result on the bye's path can't be replayed with the new team in it.
  const filled = await generate(
    snapshot,
    filledSeeding,
    new FillByePlanFailure('bye_closed', 'Matches this bye changes have already been played')
  );

  const rewrites: MatchRewrite[] = [];
  for (const match of snapshot.matches) {
    const next = filled.get(storedKey(match))!;
    if (sameRow(match, next)) continue;
    const wasBye = isByeMatch(match);
    const isBye = isByeMatch(next);
    if (!wasBye && isBye) {
      throw new FillByePlanFailure('unsupported_bracket', 'Filling this bye would hide a match');
    }
    rewrites.push({
      matchId: match.id,
      status: next.status,
      opponent1: next.opponent1,
      opponent2: next.opponent2,
      becameVisible: wasBye && !isBye,
    });
  }
  return rewrites.sort((a, b) => a.matchId - b.matchId);
}

/**
 * Rewritten matches that have been played or started, which close the bye. A bye
 * match brackets-manager completed on its own (a team skipping through) has no play.
 */
export function playedRewrites(
  snapshot: Pick<BracketSnapshot, 'matches'>,
  rewrites: readonly MatchRewrite[],
  frameCounts: ReadonlyMap<number, number>
): number[] {
  const byId = new Map(snapshot.matches.map((m) => [m.id, m]));
  return rewrites
    .map((rewrite) => rewrite.matchId)
    .filter((id) => {
      const match = byId.get(id);
      if (!match) return true;
      if ((frameCounts.get(id) ?? 0) > 0 || match.status === Status.Running) return true;
      return match.status >= Status.Completed && !isByeMatch(match);
    });
}
