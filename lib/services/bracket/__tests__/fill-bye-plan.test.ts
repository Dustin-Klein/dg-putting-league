import { BracketsManager } from 'brackets-manager';
import { Status } from 'brackets-model';
import { MemoryBracketStorage } from '../memory-bracket-storage';
import {
  FillByePlanFailure,
  isByeMatch,
  openByeMatches,
  planFillBye,
  playedRewrites,
  type BracketSnapshot,
  type PlanMatch,
} from '../fill-bye-plan';

type Format = 'double_elimination' | 'single_elimination';

/** A bracket generated the way createBracketTx does it, in memory. */
async function createBracket(teamCount: number, format: Format) {
  const storage = new MemoryBracketStorage();
  const manager = new BracketsManager(storage);
  let size = 2;
  while (size < teamCount) size *= 2;
  const seeding: Array<string | null> = Array.from({ length: teamCount }, (_, i) => `Team ${i + 1}`);
  while (seeding.length < size) seeding.push(null);
  await manager.create.stage(
    format === 'single_elimination'
      ? {
          tournamentId: 0,
          name: 'SE',
          type: 'single_elimination',
          seeding,
          settings: { seedOrdering: ['inner_outer'], balanceByes: true, consolationFinal: true },
        }
      : {
          tournamentId: 0,
          name: 'DE',
          type: 'double_elimination',
          seeding,
          settings: { grandFinal: 'double', seedOrdering: ['inner_outer'], balanceByes: true },
        }
  );
  for (const match of storage.dump('match')) {
    if (match.status < Status.Ready && match.opponent1?.id != null && match.opponent2?.id != null) {
      await storage.update('match', match.id, { ...match, status: Status.Ready });
    }
  }
  return { storage, manager };
}

function snapshotOf(storage: MemoryBracketStorage): BracketSnapshot {
  const [stage] = storage.dump('stage');
  return {
    stage: { type: stage.type, settings: stage.settings as Record<string, unknown> },
    groups: storage.dump('group').map((g) => ({ id: Number(g.id), number: g.number })),
    rounds: storage.dump('round').map((r) => ({ id: Number(r.id), group_id: Number(r.group_id), number: r.number })),
    matches: storage.dump('match') as unknown as PlanMatch[],
    participantIds: storage.dump('participant').map((p) => Number(p.id)),
  };
}

function participantSeed(storage: MemoryBracketStorage, id: number): number {
  const participant = storage.dump('participant').find((p) => Number(p.id) === id);
  return Number(participant?.name.replace('Team ', ''));
}

/** Play every Ready match in id order (lower seed wins) until `limit` results are in. */
async function play(storage: MemoryBracketStorage, manager: BracketsManager, limit = Infinity) {
  let played = 0;
  while (played < limit) {
    const ready = storage
      .dump('match')
      .filter((m) => m.status === Status.Ready && m.opponent1?.id != null && m.opponent2?.id != null)
      .sort((a, b) => Number(a.id) - Number(b.id))[0];
    if (!ready) return played;
    const seed1 = participantSeed(storage, Number(ready.opponent1!.id));
    const seed2 = participantSeed(storage, Number(ready.opponent2!.id));
    const oneWins = seed1 < seed2;
    await manager.update.match({
      id: ready.id,
      opponent1: { score: oneWins ? 30 : 20, result: oneWins ? 'win' : 'loss' },
      opponent2: { score: oneWins ? 20 : 30, result: oneWins ? 'loss' : 'win' },
    });
    played += 1;
  }
  return played;
}

/** Real (non-bye, non-reset) matches. */
function realMatches(storage: MemoryBracketStorage): number {
  return (storage.dump('match') as unknown as PlanMatch[]).filter((m) => !isByeMatch(m)).length;
}

/** Fill the bye of the lowest seed whose bye is still open, as the service defaults to. */
async function fillLowestSeedBye(storage: MemoryBracketStorage) {
  const snapshot = snapshotOf(storage);
  const byes = openByeMatches(snapshot).sort(
    (a, b) => participantSeed(storage, b.participantId) - participantSeed(storage, a.participantId)
  );
  const newId = await storage.insert('participant', {
    tournament_id: 0,
    name: `Team ${snapshot.participantIds.length + 1}`,
  });
  let lowest: (typeof byes)[number] | undefined;
  let rewrites: Awaited<ReturnType<typeof planFillBye>> = [];
  for (const bye of byes) {
    try {
      rewrites = await planFillBye(snapshot, Number(bye.match.id), newId);
    } catch (error) {
      if ((error as FillByePlanFailure).code === 'bye_closed') continue;
      throw error;
    }
    if (playedRewrites(snapshot, rewrites, new Map()).length === 0) {
      lowest = bye;
      break;
    }
  }
  if (!lowest) throw new Error('No open bye');
  for (const rewrite of rewrites) {
    const stored = storage.dump('match').find((m) => Number(m.id) === rewrite.matchId)!;
    await storage.update('match', rewrite.matchId, {
      ...stored,
      status: rewrite.status,
      opponent1: rewrite.opponent1 as never,
      opponent2: rewrite.opponent2 as never,
    });
  }
  return { rewrites, byeMatchId: Number(lowest.match.id), byeTeam: lowest.participantId, newId };
}

describe('planFillBye', () => {
  const cases: Array<[number, Format, number]> = [
    [9, 'double_elimination', 0],
    [9, 'double_elimination', 1],
    [12, 'double_elimination', 0],
    [12, 'double_elimination', 3],
    [14, 'double_elimination', 0],
    [14, 'double_elimination', 4],
    [15, 'double_elimination', 0],
    [15, 'double_elimination', 6],
    [9, 'single_elimination', 1],
    [12, 'single_elimination', 2],
    [14, 'single_elimination', 4],
    [15, 'single_elimination', 6],
  ];

  it.each(cases)('%i teams, %s, after %i results: fills the lowest seed\'s bye', async (teams, format, results) => {
    const { storage, manager } = await createBracket(teams, format);
    const realBefore = realMatches(storage);
    await play(storage, manager, results);
    const before = new Map(storage.dump('match').map((m) => [Number(m.id), structuredClone(m)]));

    const { rewrites, byeMatchId, byeTeam, newId } = await fillLowestSeedBye(storage);

    const filled = storage.dump('match').find((m) => Number(m.id) === byeMatchId)!;
    expect([filled.opponent1?.id, filled.opponent2?.id].sort()).toEqual([byeTeam, newId].sort());
    expect(filled.status).toBe(Status.Ready);
    // The new team adds one match per elimination it can suffer.
    expect(realMatches(storage)).toBe(realBefore + (format === 'double_elimination' ? 2 : 1));
    // Rows outside the rewrites are untouched, and no recorded result is rewritten.
    for (const match of storage.dump('match')) {
      if (rewrites.some((r) => r.matchId === Number(match.id))) {
        const was = before.get(Number(match.id))!;
        expect(was.status < Status.Running || (was.status === Status.Completed && isByeMatch(was as never))).toBe(true);
      } else {
        expect(match).toEqual(before.get(Number(match.id)));
      }
    }

    // The patched bracket plays to the end like any other.
    await play(storage, manager);
    const losses = new Map<number, number>();
    for (const match of storage.dump('match')) {
      for (const slot of [match.opponent1, match.opponent2]) {
        if (slot?.id != null && slot.result === 'loss') losses.set(Number(slot.id), (losses.get(Number(slot.id)) ?? 0) + 1);
      }
    }
    expect(losses.get(newId)).toBe(format === 'double_elimination' ? 2 : 1);
  });

  it('refuses a match that is not a first-round bye', async () => {
    const { storage } = await createBracket(12, 'double_elimination');
    const snapshot = snapshotOf(storage);
    const real = snapshot.matches.find((m) => !isByeMatch(m))!;
    await expect(planFillBye(snapshot, real.id, 999)).rejects.toMatchObject({ code: 'not_an_open_bye' });
  });

  it('refuses when a team was moved by hand', async () => {
    const { storage } = await createBracket(12, 'double_elimination');
    const snapshot = snapshotOf(storage);
    const [bye] = openByeMatches(snapshot);
    const secondRound = snapshot.matches.find(
      (m) => m.opponent1?.id === bye.participantId && m.id !== bye.match.id
    )!;
    secondRound.opponent2 = { id: 3 };
    await expect(planFillBye(snapshot, bye.match.id, 999)).rejects.toBeInstanceOf(FillByePlanFailure);
    await expect(planFillBye(snapshot, bye.match.id, 999)).rejects.toMatchObject({ code: 'edited_by_hand' });
  });

  it('closes a bye once a match it changes has been played', async () => {
    const { storage, manager } = await createBracket(12, 'double_elimination');
    await play(storage, manager, 8);
    const snapshot = snapshotOf(storage);
    for (const bye of openByeMatches(snapshot)) {
      const closed = await planFillBye(snapshot, bye.match.id, 999).then(
        (rewrites) => playedRewrites(snapshot, rewrites, new Map()).length > 0,
        (error: FillByePlanFailure) => error.code === 'bye_closed'
      );
      expect(closed).toBe(true);
    }
  });

  it('treats a rewritten match with frames as played', async () => {
    const { storage } = await createBracket(14, 'double_elimination');
    const snapshot = snapshotOf(storage);
    const [bye] = openByeMatches(snapshot);
    const rewrites = await planFillBye(snapshot, bye.match.id, 999);
    expect(playedRewrites(snapshot, rewrites, new Map())).toEqual([]);
    const target = rewrites[rewrites.length - 1].matchId;
    expect(playedRewrites(snapshot, rewrites, new Map([[target, 1]]))).toEqual([target]);
  });

  it('marks the matches that stop being byes', async () => {
    const { storage } = await createBracket(15, 'double_elimination');
    const { rewrites, byeMatchId } = await fillLowestSeedBye(storage);
    const visible = rewrites.filter((r) => r.becameVisible).map((r) => r.matchId);
    expect(visible).toContain(byeMatchId);
    expect(visible).toHaveLength(2);
  });
});
