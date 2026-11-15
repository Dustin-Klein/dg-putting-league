import {
  combinePeriodStats,
  combineSeedHistory,
  eligibilityProgress,
  makePct,
  type EntryCounts,
  type SeedEntryCounts,
} from '../stats';

function entry(overrides: Partial<EntryCounts> & { event_id: string }): EntryCounts {
  return {
    event_date: '2026-10-01',
    event_created_at: '2026-09-01T00:00:00.000Z',
    frames: 0,
    frame_putts_made: 0,
    qualification_frames: 0,
    qualification_putts_made: 0,
    matches: 0,
    ...overrides,
  };
}

const whole = { count_qualification_putts: true, window_putts: null };

describe('combinePeriodStats', () => {
  it('counts 3 putts per frame row and sums putts made', () => {
    const stats = combinePeriodStats([
      entry({ event_id: 'a', frames: 10, frame_putts_made: 20, matches: 2 }),
      entry({ event_id: 'b', frames: 5, frame_putts_made: 12, matches: 1 }),
    ], whole);
    expect(stats).toEqual({ putts_made: 32, putts_attempted: 45, make_pct: 71.11, matches: 3, events: 2 });
  });

  it('counts qualification putts only when the league does, and never as matches', () => {
    const entries = [entry({ event_id: 'a', frames: 5, frame_putts_made: 10, qualification_frames: 5, qualification_putts_made: 15, matches: 1 })];
    expect(combinePeriodStats(entries, whole)).toMatchObject({ putts_made: 25, putts_attempted: 30, matches: 1 });
    expect(combinePeriodStats(entries, { ...whole, count_qualification_putts: false }))
      .toMatchObject({ putts_made: 10, putts_attempted: 15, matches: 1 });
  });

  it('has no make % without putts', () => {
    expect(combinePeriodStats([], whole)).toEqual({ putts_made: 0, putts_attempted: 0, make_pct: null, matches: 0, events: 0 });
  });

  it('takes whole events newest first up to the rolling window', () => {
    const entries = [
      entry({ event_id: 'old', event_date: '2026-09-01', frames: 20, frame_putts_made: 60 }),
      entry({ event_id: 'mid', event_date: '2026-09-15', frames: 20, frame_putts_made: 30 }),
      entry({ event_id: 'new', event_date: '2026-10-01', frames: 20, frame_putts_made: 30 }),
    ];
    // 60 putts per event; a 100-putt window takes the newest event, then the one that
    // crosses the boundary in full, and stops.
    expect(combinePeriodStats(entries, { ...whole, window_putts: 100 }))
      .toEqual({ putts_made: 60, putts_attempted: 120, make_pct: 50, matches: 0, events: 2 });
    expect(combinePeriodStats(entries, whole)).toMatchObject({ putts_attempted: 180, events: 3 });
  });

  it('orders two events on one date by creation', () => {
    const entries = [
      entry({ event_id: 'first', event_created_at: '2026-10-01T18:00:00.000Z', frames: 20, frame_putts_made: 60 }),
      entry({ event_id: 'second', event_created_at: '2026-10-01T21:00:00.000Z', frames: 20, frame_putts_made: 0 }),
    ];
    expect(combinePeriodStats(entries, { ...whole, window_putts: 30 })).toMatchObject({ putts_made: 0, events: 1 });
  });
});

describe('eligibilityProgress', () => {
  const stats = { putts_made: 30, putts_attempted: 34, make_pct: 88.24, matches: 2, events: 1 };

  it('reports what is left for each live criterion', () => {
    expect(eligibilityProgress(stats, { min_putts: 50, min_matches: 3 }))
      .toEqual({ eligible: false, putts_remaining: 16, matches_remaining: 1 });
  });

  it('leaves a disabled criterion out', () => {
    expect(eligibilityProgress(stats, { min_putts: 60, min_matches: 0 }))
      .toEqual({ eligible: false, putts_remaining: 26, matches_remaining: null });
  });

  it('is eligible once either criterion is met', () => {
    expect(eligibilityProgress(stats, { min_putts: 30, min_matches: 3 }))
      .toMatchObject({ eligible: true, putts_remaining: 0 });
  });
});

describe('makePct', () => {
  it('rounds to two decimals', () => {
    expect(makePct(2, 3)).toBe(66.67);
    expect(makePct(0, 0)).toBeNull();
  });
});

describe('combineSeedHistory', () => {
  function seed(overrides: Partial<SeedEntryCounts> & { event_id: string }): SeedEntryCounts {
    return { frames: 0, frame_points: 0, qualification_frames: 0, qualification_points: 0, matches: 0, ...overrides };
  }

  it('scales points to a 5-frame match across events', () => {
    const stats = combineSeedHistory([
      seed({ event_id: 'a', frames: 10, frame_points: 18, matches: 2 }),
      seed({ event_id: 'b', frames: 5, frame_points: 9 }),
    ], { count_qualification_putts: true });
    expect(stats).toEqual({ frames: 15, points: 27, points_per_match: 9, matches: 2, events: 2 });
  });

  it('counts qualification frames only when the league does', () => {
    const entries = [
      seed({ event_id: 'a', frames: 5, frame_points: 10, qualification_frames: 5, qualification_points: 5 }),
      seed({ event_id: 'b', qualification_frames: 5, qualification_points: 20 }),
    ];
    expect(combineSeedHistory(entries, { count_qualification_putts: true }))
      .toMatchObject({ frames: 15, points: 35, points_per_match: 11.67, events: 2 });
    expect(combineSeedHistory(entries, { count_qualification_putts: false }))
      .toMatchObject({ frames: 5, points: 10, points_per_match: 10, events: 1 });
  });

  it('never reads stored putts', () => {
    const entry = { ...seed({ event_id: 'a', frames: 5, frame_points: 9 }), frame_putts_made: 15, qualification_putts_made: 15 };
    expect(combineSeedHistory([entry], { count_qualification_putts: true }).points_per_match).toBe(9);
  });

  it('is empty without frames', () => {
    expect(combineSeedHistory([], { count_qualification_putts: true }))
      .toEqual({ frames: 0, points: 0, points_per_match: 0, matches: 0, events: 0 });
  });
});
