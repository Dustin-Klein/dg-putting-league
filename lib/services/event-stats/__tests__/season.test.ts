import { buildSeasonContext } from '../season';

const row = (over: Partial<Parameters<typeof buildSeasonContext>[0][number]>) => ({
  player_id: 'p1', zone: null, distance_ft: 25, nominal_ft: null, reliable: true, frames: 10, made: 20, points: 22, ...over,
});

describe('season context', () => {
  it('compares non-handicap events at the same actual distance', () => {
    const ctx = buildSeasonContext(
      [row({}), row({ distance_ft: 20, frames: 50, made: 150, points: 200 })],
      [],
      [{ playerId: 'p1', zone: null, distanceFt: 25 }],
      { handicap: false, framesPerMatch: 7 }
    );
    expect(ctx.players.get('p1')!.line).toEqual({ label: '25 ft', frames: 10, make_rate: 20 / 30, points_per_match: (22 / 10) * 7 });
  });

  it('compares handicap events by zone, leaving out frames more than 2 ft from the zone distance', () => {
    const ctx = buildSeasonContext(
      [
        row({ zone: 2, distance_ft: 27, nominal_ft: 27 }),
        row({ zone: 2, distance_ft: 29, nominal_ft: 27 }),
        row({ zone: 2, distance_ft: 32, nominal_ft: 27, frames: 100 }),
        row({ zone: 1, distance_ft: 21, nominal_ft: 21, frames: 100 }),
      ],
      [],
      [{ playerId: 'p1', zone: 2, distanceFt: 27 }],
      { handicap: true, framesPerMatch: 5 }
    );
    expect(ctx.players.get('p1')!.line.label).toBe('Zone 2 (27 ft)');
    expect(ctx.players.get('p1')!.counts.frames).toBe(20);
  });

  it('skips unreliable events for make % but keeps their points, and shows — below 10 frames', () => {
    const ctx = buildSeasonContext(
      [row({ reliable: false, frames: 20, made: 60, points: 40 }), row({ frames: 5, made: 10, points: 10 })],
      [{ reliable: true, frames: 30, made: 60, points: 66, frames_per_match: 5 }],
      [{ playerId: 'p1', zone: null, distanceFt: 25 }, { playerId: 'p2', zone: null, distanceFt: 25 }],
      { handicap: false, framesPerMatch: 5 }
    );
    const p1 = ctx.players.get('p1')!.line;
    expect(p1.make_rate).toBeNull();
    expect(p1.points_per_match).toBeCloseTo((50 / 25) * 5);
    expect(ctx.players.get('p2')!.line).toMatchObject({ frames: 0, make_rate: null, points_per_match: null });
    expect(ctx.field).toEqual({ label: 'All distances', frames: 30, make_rate: 60 / 90, points_per_match: 11 });
  });
});
