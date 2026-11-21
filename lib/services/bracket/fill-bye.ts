import 'server-only';
import { Status } from 'brackets-model';
import type { Group, Match, Round, Stage } from 'brackets-model';
import { requireEventAdmin } from '@/lib/services/event';
import { computePfaScores } from '@/lib/services/event-player';
import { usesPools } from '@/lib/services/team/composition';
import { autoAssignLanesTx } from '@/lib/services/lane';
import { refreshEntrySnapshots } from '@/lib/services/handicap/snapshot';
import { lockEvent, lockMatches, withTransaction, type Executor, type Tx } from '@/lib/db/tx';
import * as bracketDb from '@/lib/repositories/bracket-repository.db';
import * as eventDb from '@/lib/repositories/event-repository.db';
import * as eventPlayerDb from '@/lib/repositories/event-player-repository.db';
import * as teamDb from '@/lib/repositories/team-repository.db';
import { getFrameCountsForMatches } from '@/lib/repositories/frame-repository.db';
import { getLanesForEvent, lockEventLanes, releaseMatchLanes } from '@/lib/repositories/lane-repository.db';
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import type { PaymentType } from '@/lib/types/player';
import type { BracketResetContext } from '@/lib/repositories/bracket-repository.db';
import { buildProgressionSourceMap } from './bracket-service';
import {
  FillByePlanFailure,
  isByeMatch,
  openByeMatches,
  planFillBye,
  playedRewrites,
  type BracketSnapshot,
  type MatchRewrite,
  type PlanMatch,
} from './fill-bye-plan';

/** Any participant id not in the bracket works for planning; the real one is written later. */
const PLANNING_PARTICIPANT_ID = -1;

export interface ByeClosingMatch {
  matchId: number;
  /** 'starts': this match changes with the fill and can start now; 'finishes': its result fills one of them. */
  kind: 'starts' | 'finishes';
  status: number;
  laneLabel: string | null;
  framesPlayed: number;
  participantIds: Array<number | null>;
}

export interface OpenBye {
  byeMatchId: number;
  /** The team that has the bye. */
  participantId: number;
  teamId: string | null;
  seed: number | null;
  open: boolean;
  /** Why a closed bye can't be filled. */
  closedReason: string | null;
  /** What closes this bye next (null once closed). */
  closesWhen: ByeClosingMatch | null;
  held: boolean;
  /** Matches held for this bye (the matches a fill would change). */
  holdMatchIds: number[];
}

export interface OpenByesSummary {
  byes: OpenBye[];
  /** The lowest seed's open bye: where the next seed would naturally have gone. */
  defaultByeMatchId: number | null;
  frameCount: number;
}

function snapshotOf(context: BracketResetContext, participantIds: number[]): BracketSnapshot {
  return {
    stage: { type: context.stage.type, settings: (context.stage.settings ?? {}) as Record<string, unknown> },
    groups: context.groups,
    rounds: context.rounds,
    matches: context.matches as unknown as PlanMatch[],
    participantIds,
  };
}

function closedMessage(error: unknown): string {
  if (error instanceof FillByePlanFailure) return error.message;
  throw error;
}

async function describeByes(ex: Executor, eventId: string, context: BracketResetContext): Promise<OpenByesSummary> {
  const participants = await bracketDb.getParticipantsForEvent(ex, eventId);
  const snapshot = snapshotOf(context, participants.map((p) => p.id));
  const [frames, teams, lanes] = await Promise.all([
    getFrameCountsForMatches(ex, context.matches.map((m) => m.id)),
    teamDb.getTeamsForSeeding(ex, eventId),
    getLanesForEvent(ex, eventId),
  ]);
  const frameCounts = new Map(Object.entries(frames).map(([id, n]) => [Number(id), n]));
  const teamOf = new Map(participants.map((p) => [p.id, teams.find((t) => t.id === p.team_id) ?? null]));
  const laneLabel = new Map(lanes.map((lane) => [lane.id, lane.label]));
  const matchById = new Map(context.matches.map((m) => [m.id, m]));
  const sources = await buildProgressionSourceMap({
    stage: context.stage as unknown as Stage,
    groups: context.groups as unknown as Group[],
    rounds: context.rounds as unknown as Round[],
    matches: context.matches as unknown as Match[],
  });

  const closing = (matchId: number, kind: ByeClosingMatch['kind']): ByeClosingMatch => {
    const match = matchById.get(matchId)!;
    return {
      matchId,
      kind,
      status: match.status,
      laneLabel: match.lane_id ? laneLabel.get(match.lane_id) ?? null : null,
      framesPlayed: frameCounts.get(matchId) ?? 0,
      participantIds: [match.opponent1?.id ?? null, match.opponent2?.id ?? null],
    };
  };
  const urgency = (c: ByeClosingMatch) =>
    (c.kind === 'starts' ? 100 : 0) + (c.status === Status.Running ? 20 : 0) + (c.laneLabel ? 10 : 0) + c.framesPlayed;

  const byes: OpenBye[] = [];
  for (const { match, participantId } of openByeMatches(snapshot)) {
    const team = teamOf.get(participantId) ?? null;
    let rewrites: MatchRewrite[] = [];
    let closedReason: string | null = null;
    try {
      rewrites = await planFillBye(snapshot, match.id, PLANNING_PARTICIPANT_ID);
      if (playedRewrites(snapshot, rewrites, frameCounts).length > 0) {
        closedReason = 'Matches this bye changes have already started';
      }
    } catch (error) {
      closedReason = closedMessage(error);
    }

    const changed = rewrites.map((r) => matchById.get(r.matchId)!).filter((m) => m && !isByeMatch(m));
    const candidates: ByeClosingMatch[] = [];
    if (!closedReason) {
      for (const m of changed) {
        const known = [m.opponent1?.id, m.opponent2?.id].filter((id) => id != null).length;
        if (known === 2) candidates.push(closing(m.id, 'starts'));
        for (const slot of ['opponent1', 'opponent2'] as const) {
          if (m[slot]?.id != null) continue;
          const source = sources[m.id]?.[slot];
          const feeder = source ? matchById.get(source.sourceMatchId) : undefined;
          if (feeder && !isByeMatch(feeder) && feeder.status < Status.Completed) {
            candidates.push(closing(feeder.id, 'finishes'));
          }
        }
      }
    }
    candidates.sort((a, b) => urgency(b) - urgency(a) || a.matchId - b.matchId);
    const holdMatchIds = changed.map((m) => m.id);
    byes.push({
      byeMatchId: match.id,
      participantId,
      teamId: team?.id ?? null,
      seed: team?.seed ?? null,
      open: closedReason === null,
      closedReason,
      closesWhen: closedReason ? null : candidates[0] ?? null,
      held: changed.some((m) => m.held_at != null),
      holdMatchIds,
    });
  }
  byes.sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
  const lowestOpen = [...byes].reverse().find((bye) => bye.open);
  return { byes, defaultByeMatchId: lowestOpen?.byeMatchId ?? null, frameCount: 0 };
}

async function requireBracketContext(ex: Executor, eventId: string): Promise<BracketResetContext> {
  const context = await bracketDb.getBracketResetContext(ex, eventId);
  if (!context) throw new NotFoundError('Bracket not found for this event');
  return context;
}

/** The event's Round 1 byes, whether each can still be filled, and what closes it. */
export async function getOpenByes(eventId: string): Promise<OpenByesSummary> {
  const { pg } = await requireEventAdmin(eventId);
  return getOpenByesDb(pg, eventId);
}

export async function getOpenByesDb(pg: Executor, eventId: string): Promise<OpenByesSummary> {
  const event = await eventDb.getEventById(pg, eventId);
  if (!event) throw new NotFoundError('Event not found');
  if (event.status !== 'bracket') return { byes: [], defaultByeMatchId: null, frameCount: event.bracket_frame_count };
  const summary = await describeByes(pg, eventId, await requireBracketContext(pg, eventId));
  return { ...summary, frameCount: event.bracket_frame_count };
}

/**
 * Hold (or release) the matches a fill of this bye would change, so none of them gets a
 * lane while the organizer finds the missed player. A held match already on a lane, not
 * yet started, gives the lane back.
 */
export async function setByeHold(eventId: string, byeMatchId: number, hold: boolean): Promise<OpenByesSummary> {
  const { pg, user } = await requireEventAdmin(eventId);
  await setByeHoldDb(pg, eventId, byeMatchId, hold);
  logger.info('Bye hold changed', { userId: user.id, action: 'bye_hold', eventId, byeMatchId, hold, outcome: 'success' });
  return getOpenByesDb(pg, eventId);
}

export function setByeHoldDb(ex: Executor, eventId: string, byeMatchId: number, hold: boolean): Promise<void> {
  return withTransaction(ex, async (tx) => {
    await lockEvent(tx, eventId);
    await requireBracketPlay(tx, eventId);
    await lockMatches(tx, await bracketDb.getMatchIdsForEvent(tx, eventId), eventId);
    const summary = await describeByes(tx, eventId, await requireBracketContext(tx, eventId));
    const bye = summary.byes.find((b) => b.byeMatchId === byeMatchId);
    if (!bye) throw new NotFoundError('That bye was not found');
    if (hold && !bye.open) throw new ConflictError(bye.closedReason ?? 'That bye is closed');
    await bracketDb.setMatchesHeld(tx, eventId, bye.holdMatchIds, hold);
    await lockEventLanes(tx, eventId);
    if (hold) await releaseMatchLanes(tx, eventId, bye.holdMatchIds);
    await autoAssignLanesTx(tx, eventId);
  });
}

async function requireBracketPlay(tx: Tx, eventId: string) {
  const config = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'update' });
  if (!config) throw new NotFoundError('Event not found');
  if (config.status !== 'bracket') throw new BadRequestError('Event is not in bracket play');
  return config;
}

export interface FillByeInput {
  byeMatchId: number;
  /** players.id of the new team's members, in slot order (team size of them). */
  playerIds: string[];
  payments: Array<PaymentType | null>;
}

export interface FillByeResult {
  teamId: string;
  seed: number;
  matchIds: number[];
}

/**
 * Enter a new team (usually a missed player and the floater) into a Round 1 bye during
 * bracket play: the team with the bye plays them instead of waiting. Allowed only while
 * no match the fill changes has started. Matches keep their ids and announced numbers;
 * the ones that stop being byes are numbered after every other match.
 */
export async function fillBye(eventId: string, input: FillByeInput): Promise<FillByeResult> {
  const { pg, user } = await requireEventAdmin(eventId);
  const result = await fillByeDb(pg, eventId, input);
  logger.info('Bye filled', {
    userId: user.id,
    action: 'fill_bye',
    eventId,
    byeMatchId: input.byeMatchId,
    teamId: result.teamId,
    seed: result.seed,
    rewrittenMatchIds: result.matchIds,
    outcome: 'success',
  });
  return result;
}

/** `fillBye` for a caller that has authorized as event admin. */
export function fillByeDb(ex: Executor, eventId: string, input: FillByeInput): Promise<FillByeResult> {
  return withTransaction(ex, async (tx) => {
    await lockEvent(tx, eventId);
    const config = await requireBracketPlay(tx, eventId);
    const event = await eventDb.getEventById(tx, eventId);
    if (!event) throw new NotFoundError('Event not found');

    if (input.playerIds.length !== config.team_size || new Set(input.playerIds).size !== input.playerIds.length) {
      throw new BadRequestError(`A new team needs ${config.team_size} different player${config.team_size === 1 ? '' : 's'}`);
    }
    if (input.payments.length !== input.playerIds.length) throw new BadRequestError('Give a payment for each player');
    for (const playerId of input.playerIds) {
      if (await eventPlayerDb.getEventPlayerByPlayerAndEvent(tx, eventId, playerId)) {
        throw new BadRequestError('A player on the new team is already in this event');
      }
    }

    // Every match, ascending: a scorer's first frame can't land between the check and the write.
    await lockMatches(tx, await bracketDb.getMatchIdsForEvent(tx, eventId), eventId);
    const context = await requireBracketContext(tx, eventId);

    const scores = await computePfaScores(tx, input.playerIds);
    const entrants = input.playerIds.map((playerId, i) => ({ playerId, payment: input.payments[i], ...scores.get(playerId)! }));
    // Pool-paired doubles: the higher score takes Pool A (slot 1), as every other team has one of each.
    const pooled = usesPools({ teamSize: config.team_size, teamAssignment: config.team_assignment });
    const ordered = pooled ? [...entrants].sort((a, b) => b.score - a.score) : entrants;

    const entryIds: string[] = [];
    for (const [i, entrant] of ordered.entries()) {
      entryIds.push(await eventPlayerDb.insertLateEventPlayer(tx, eventId, {
        player_id: entrant.playerId,
        putt_distance_ft: event.putt_distance_ft,
        pool: pooled ? (i === 0 ? 'A' : 'B') : null,
        pfa_score: entrant.score,
        scoring_method: entrant.scoringMethod,
        payment_type: entrant.payment,
      }));
    }
    const names = (await eventPlayerDb.getEventPlayersBulk(tx, eventId, entryIds))
      .sort((a, b) => entryIds.indexOf(a.id) - entryIds.indexOf(b.id))
      .map((entry) => entry.player.full_name);
    const seed = Math.max(0, ...(await teamDb.getTeamsForSeeding(tx, eventId)).map((t) => t.seed ?? 0)) + 1;
    const poolCombo = names.join(' & ');
    const [team] = await teamDb.insertTeamsWithMembers(tx, eventId, [{
      seed,
      pool_combo: poolCombo,
      members: entryIds.map((id, i) => ({ event_player_id: id, role: pooled ? (i === 0 ? 'A_pool' : 'B_pool') : null, slot: i + 1 })),
    }]);
    const participantId = await bracketDb.insertParticipant(tx, eventId, poolCombo, team.id);

    const participants = await bracketDb.getParticipantsForEvent(tx, eventId);
    const snapshot = snapshotOf(context, participants.map((p) => p.id).filter((id) => id !== participantId));
    let rewrites: MatchRewrite[];
    try {
      rewrites = await planFillBye(snapshot, input.byeMatchId, participantId);
    } catch (error) {
      if (error instanceof FillByePlanFailure) {
        throw error.code === 'not_an_open_bye' ? new BadRequestError(error.message) : new ConflictError(error.message);
      }
      throw error;
    }
    const frames = await getFrameCountsForMatches(tx, rewrites.map((r) => r.matchId));
    const played = playedRewrites(snapshot, rewrites, new Map(Object.entries(frames).map(([id, n]) => [Number(id), n])));
    if (played.length > 0) {
      throw new ConflictError('That bye just closed: a match it changes has started. Pick another bye.');
    }

    const matchIds = rewrites.map((r) => r.matchId);
    await lockEventLanes(tx, eventId);
    await releaseMatchLanes(tx, eventId, matchIds);
    await bracketDb.rewriteMatches(tx, eventId, rewrites.map((r) => ({
      id: r.matchId,
      status: r.status,
      opponent1: r.opponent1 as bracketDb.MatchOpponent,
      opponent2: r.opponent2 as bracketDb.MatchOpponent,
      lateEntry: r.becameVisible,
    })));
    await autoAssignLanesTx(tx, eventId);
    // Last: the new players' own zones, under the league handicap lock.
    await refreshEntrySnapshots(tx, eventId, { entryIds });
    return { teamId: team.id, seed, matchIds };
  });
}
