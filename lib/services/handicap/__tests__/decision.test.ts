import { appliesAutomatically, decideZoneChange } from '../decision';
import type { PeriodStats } from '@/lib/types/handicap';

const settings = { min_putts: 50, min_matches: 3, promote_above_pct: 75, demote_below_pct: 50 };

function stats(overrides: Partial<PeriodStats>): PeriodStats {
  return { putts_made: 0, putts_attempted: 60, make_pct: 60, matches: 0, events: 1, ...overrides };
}

describe('decideZoneChange', () => {
  it.each([
    ['above the promote threshold', 75.01, 2, 'promote'],
    ['exactly at the promote threshold', 75, 2, 'stay'],
    ['inside the band', 60, 2, 'stay'],
    ['exactly at the demote threshold', 50, 2, 'stay'],
    ['below the demote threshold', 49.99, 2, 'demote'],
    ['zone 1 below the threshold (floor)', 10, 1, 'stay'],
    ['the top zone above the threshold (ceiling)', 95, 3, 'stay'],
    ['zone 1 above the threshold', 90, 1, 'promote'],
    ['the top zone below the threshold', 20, 3, 'demote'],
  ])('%s → %s', (_label, pct, zone, expected) => {
    const decision = decideZoneChange(stats({ make_pct: pct as number }), settings, zone as number, 3);
    expect(decision.action).toBe(expected);
    expect(decision.eligible).toBe(true);
  });

  it('is eligible by putts alone', () => {
    const decision = decideZoneChange(stats({ putts_attempted: 50, matches: 0, make_pct: 90 }), settings, 2, 3);
    expect(decision).toMatchObject({ action: 'promote', eligible: true });
  });

  it('is eligible by matches alone', () => {
    const decision = decideZoneChange(stats({ putts_attempted: 45, matches: 3, make_pct: 90 }), settings, 2, 3);
    expect(decision).toMatchObject({ action: 'promote', eligible: true });
  });

  it('stays without enough evidence either way', () => {
    const decision = decideZoneChange(stats({ putts_attempted: 49, matches: 2, make_pct: 100 }), settings, 2, 3);
    expect(decision).toMatchObject({ action: 'stay', eligible: false });
  });

  it('treats a zero minimum as disabled, not satisfied', () => {
    const onePutt = stats({ putts_attempted: 3, matches: 0, make_pct: 100 });
    expect(decideZoneChange(onePutt, { ...settings, min_matches: 0 }, 2, 3)).toMatchObject({ action: 'stay', eligible: false });
    expect(decideZoneChange(onePutt, { ...settings, min_putts: 0 }, 2, 3)).toMatchObject({ action: 'stay', eligible: false });
    const oneMatch = stats({ putts_attempted: 15, matches: 1, make_pct: 100 });
    expect(decideZoneChange(oneMatch, { ...settings, min_putts: 0, min_matches: 1 }, 2, 3)).toMatchObject({ action: 'promote' });
  });

  it('stays when nothing was attempted', () => {
    const decision = decideZoneChange(stats({ putts_attempted: 0, matches: 3, make_pct: null }), settings, 2, 3);
    expect(decision).toMatchObject({ action: 'stay', eligible: true });
  });
});

describe('appliesAutomatically', () => {
  it('applies promotions, and demotions only when the league opts in', () => {
    expect(appliesAutomatically('promote', { auto_demote_enabled: false })).toBe(true);
    expect(appliesAutomatically('demote', { auto_demote_enabled: false })).toBe(false);
    expect(appliesAutomatically('demote', { auto_demote_enabled: true })).toBe(true);
    expect(appliesAutomatically('stay', { auto_demote_enabled: true })).toBe(false);
  });
});
