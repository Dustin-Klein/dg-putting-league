import { eligibilityText, formatPeriodStats, zoneChangeLabel } from '../handicap-format';

describe('handicap formatting', () => {
  it('formats a period', () => {
    expect(formatPeriodStats({ putts_made: 34, putts_attempted: 52, make_pct: 65.38, matches: 3, events: 2 }))
      .toBe('34/52 – 65.4% · 3 matches');
  });

  it('states what is left before a decision', () => {
    expect(eligibilityText({ eligible: false, putts_remaining: 16, matches_remaining: 1 }))
      .toBe('Eligible after 16 more putts or 1 more match');
    expect(eligibilityText({ eligible: false, putts_remaining: 9, matches_remaining: null }))
      .toBe('Eligible after 9 more putts');
    expect(eligibilityText({ eligible: true, putts_remaining: 0, matches_remaining: 0 })).toBeNull();
  });

  it('never says why an organizer moved someone', () => {
    expect(zoneChangeLabel('admin_demote', 2, 3)).toBe('Moved to Zone 2 by an organizer');
    expect(zoneChangeLabel('manual', 3, 2)).toBe('Moved up to Zone 3 by an organizer');
    expect(zoneChangeLabel('auto_promote', 3, 2)).toBe('Moved up to Zone 3');
    expect(zoneChangeLabel('initial', 2, null)).toBe('Started in Zone 2');
  });
});
