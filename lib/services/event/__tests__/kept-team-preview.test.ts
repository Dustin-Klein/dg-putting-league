import { keptTeamPreview } from '../preview';
import type { PlayerScore } from '@/lib/services/event-player';

function score(id: string, pfaScore: number): PlayerScore {
  return { eventPlayerId: id, playerId: `p-${id}`, playerName: id.toUpperCase(), pfaScore, scoringMethod: 'pfa', defaultPool: 'B' };
}

const kept = [
  { members: [{ event_player_id: 'a1', slot: 1, pool: 'A' as const }, { event_player_id: 'b1', slot: 2, pool: 'B' as const }] },
  { members: [{ event_player_id: 'a2', slot: 1, pool: 'A' as const }, { event_player_id: 'b2', slot: 2, pool: 'B' as const }] },
];

describe('keptTeamPreview', () => {
  it('keeps announced teams and pairs only the newcomers, one per pool', () => {
    const preview = keptTeamPreview({
      scores: [score('a1', 10), score('b1', 4), score('a2', 9), score('b2', 3), score('missed', 5), score('floater', 8)],
      kept,
      teamSize: 2,
      pooled: true,
    });
    expect(preview.keptTeamCount).toBe(2);
    expect(preview.teamPairings).toHaveLength(3);
    const newTeam = preview.teamPairings.find((team) => preview.newTeamSeeds.includes(team.seed))!;
    expect(newTeam.members.map((m) => m.eventPlayerId)).toEqual(['floater', 'missed']);
    expect(preview.players.find((p) => p.eventPlayerId === 'floater')!.pool).toBe('A');
    expect(preview.players.find((p) => p.eventPlayerId === 'missed')!.pool).toBe('B');
    expect(preview.players.find((p) => p.eventPlayerId === 'b1')!.pool).toBe('B');
    // Seeds follow combined score over every team: the new team (13) slots in second.
    expect(preview.teamPairings.map((t) => t.combinedScore)).toEqual([14, 13, 12]);
    expect(preview.newTeamSeeds).toEqual([2]);
  });

  it('re-pairs the partner of a removed player with the newcomers', () => {
    const preview = keptTeamPreview({
      scores: [score('a1', 10), score('b1', 4), score('a2', 9), score('new', 2)],
      kept,
      teamSize: 2,
      pooled: true,
    });
    expect(preview.keptTeamCount).toBe(1);
    const newTeam = preview.teamPairings.find((team) => preview.newTeamSeeds.includes(team.seed))!;
    expect(newTeam.members.map((m) => m.eventPlayerId)).toEqual(['a2', 'new']);
  });

  it('chunks newcomers into teams for formats without pools', () => {
    const preview = keptTeamPreview({
      scores: [score('a1', 10), score('b1', 4), score('x', 1), score('y', 7)],
      kept: [{ members: [{ event_player_id: 'a1', slot: 1, pool: null }] }, { members: [{ event_player_id: 'b1', slot: 1, pool: null }] }],
      teamSize: 1,
      pooled: false,
    });
    expect(preview.keptTeamCount).toBe(2);
    expect(preview.teamPairings).toHaveLength(4);
    expect(preview.newTeamSeeds.sort()).toEqual([2, 4]);
    expect(preview.players.every((p) => p.pool === null)).toBe(true);
  });
});
