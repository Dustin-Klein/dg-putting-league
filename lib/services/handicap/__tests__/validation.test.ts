import { DEFAULT_HANDICAP_SETTINGS, DEFAULT_ZONE_LADDER } from '@/lib/types/handicap';
import {
  eventZoneDistancesError,
  handicapSettingsError,
  zoneDistanceWarnings,
  zoneLadderError,
} from '../validation';

const ladder = DEFAULT_ZONE_LADDER.map((zone) => ({ ...zone }));

describe('zoneLadderError', () => {
  it('accepts the default 21/27/33 ladder in any order', () => {
    expect(zoneLadderError(ladder)).toBeNull();
    expect(zoneLadderError([...ladder].reverse())).toBeNull();
  });

  it('rejects gaps, decreasing distances and steps below the minimum', () => {
    expect(zoneLadderError([{ zone: 1, distance_ft: 21 }, { zone: 3, distance_ft: 33 }])).toMatch(/without gaps/);
    expect(zoneLadderError([{ zone: 1, distance_ft: 27 }, { zone: 2, distance_ft: 21 }])).toMatch(/increase/);
    expect(zoneLadderError([{ zone: 1, distance_ft: 21 }, { zone: 2, distance_ft: 23 }])).toMatch(/at least 3 ft/);
    expect(zoneLadderError([{ zone: 1, distance_ft: 21 }])).toMatch(/at least 2 zones/);
  });
});

describe('handicapSettingsError', () => {
  it('accepts the defaults', () => {
    expect(handicapSettingsError(DEFAULT_HANDICAP_SETTINGS, ladder)).toBeNull();
  });

  it('rejects both minimums at zero, an inverted band and a missing starting zone', () => {
    expect(handicapSettingsError({ ...DEFAULT_HANDICAP_SETTINGS, min_putts: 0, min_matches: 0 }, ladder)).toMatch(/minimum/);
    expect(handicapSettingsError({ ...DEFAULT_HANDICAP_SETTINGS, demote_below_pct: 75 }, ladder)).toMatch(/below the promotion/);
    expect(handicapSettingsError({ ...DEFAULT_HANDICAP_SETTINGS, default_zone: 4 }, ladder)).toMatch(/starting zone/);
  });

  it('allows one minimum at zero', () => {
    expect(handicapSettingsError({ ...DEFAULT_HANDICAP_SETTINGS, min_matches: 0, min_putts: 75 }, ladder)).toBeNull();
  });
});

describe('eventZoneDistancesError', () => {
  it('accepts a whole ladder moved in for a tight venue', () => {
    expect(eventZoneDistancesError([
      { zone: 1, distance_ft: 19 }, { zone: 2, distance_ft: 25 }, { zone: 3, distance_ft: 31 },
    ], ladder)).toBeNull();
  });

  it("must cover exactly the league's zones", () => {
    expect(eventZoneDistancesError([{ zone: 1, distance_ft: 21 }, { zone: 2, distance_ft: 27 }], ladder)).toMatch(/exactly/);
  });

  it('enforces the minimum step between zones', () => {
    expect(eventZoneDistancesError([
      { zone: 1, distance_ft: 25 }, { zone: 2, distance_ft: 27 }, { zone: 3, distance_ft: 33 },
    ], ladder)).toMatch(/at least 3 ft/);
  });
});

describe('zoneDistanceWarnings', () => {
  it('flags zones more than 2 ft from the league ladder', () => {
    expect(zoneDistanceWarnings([
      { zone: 1, distance_ft: 19 }, { zone: 2, distance_ft: 24 }, { zone: 3, distance_ft: 33 },
    ], ladder)).toEqual([2]);
  });
});
