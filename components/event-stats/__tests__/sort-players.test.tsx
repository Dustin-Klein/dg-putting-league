import type { PlayerRow } from '@/lib/types/event-stats';
import { sortPlayers } from '../sort-players';

function player(name: string, zone: number | null, makeRate: number | null, overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    entry_id: name,
    player_number: 1,
    name,
    zone,
    distance_ft: 25,
    team_id: null,
    line: { frames: 10, made: null, points: 0, threes: null, make_rate: makeRate, points_per_match: null },
    matches: 1,
    best_match: null,
    small_sample: false,
    zone_moved: false,
    season: null,
    ...overrides,
  };
}

const names = (rows: PlayerRow[]) => rows.map((p) => p.name);

describe('sortPlayers', () => {
  const players = [
    player('Ann', 1, 0.5),
    player('Bo', 3, null),
    player('Cy', 2, 0.9),
    player('Di', 3, 0.7),
  ];

  it('sorts zones ascending, then by name', () => {
    expect(names(sortPlayers(players, 'zone', 'asc', 'name'))).toEqual(['Ann', 'Cy', 'Bo', 'Di']);
  });

  it('sorts zones descending, keeping the within-zone order', () => {
    expect(names(sortPlayers(players, 'zone', 'desc', 'name'))).toEqual(['Bo', 'Di', 'Cy', 'Ann']);
    expect(names(sortPlayers(players, 'zone', 'desc', 'make'))).toEqual(['Di', 'Bo', 'Cy', 'Ann']);
  });

  it('keeps null metrics last in both directions', () => {
    expect(names(sortPlayers(players, 'make', 'desc', 'name'))).toEqual(['Cy', 'Di', 'Ann', 'Bo']);
    expect(names(sortPlayers(players, 'make', 'asc', 'name'))).toEqual(['Ann', 'Di', 'Cy', 'Bo']);
  });

  it('sorts by distance when there are no zones', () => {
    const flat = [player('Ann', null, 0.5, { distance_ft: 30 }), player('Bo', null, 0.5, { distance_ft: 20 })];
    expect(names(sortPlayers(flat, 'zone', 'asc', 'name'))).toEqual(['Bo', 'Ann']);
    expect(names(sortPlayers(flat, 'zone', 'desc', 'name'))).toEqual(['Ann', 'Bo']);
  });

  it('reverses name order', () => {
    expect(names(sortPlayers(players, 'name', 'desc', 'name'))).toEqual(['Di', 'Cy', 'Bo', 'Ann']);
  });
});
