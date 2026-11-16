import {
  adminFeeLabel,
  defaultEventSetup,
  describeEventSetup,
  distanceLabel,
  eventDistanceLabel,
  eventFormatParts,
  formatMoney,
  generateAccessCode,
  setupFieldApplies,
  setupSummary,
  templateToSetupValues,
  toCreateEventBody,
  upcomingWeekdayDates,
  type EventSetupContext,
  type EventSetupValues,
} from '../event-setup';

const FLAT: EventSetupContext = { leagueHandicaps: false, zones: [] };
const ZONES: EventSetupContext = {
  leagueHandicaps: true,
  zones: [
    { zone: 3, distance_ft: 33 },
    { zone: 1, distance_ft: 21 },
    { zone: 2, distance_ft: 27 },
  ],
};

const setup = (overrides: Partial<EventSetupValues> = {}, ctx = FLAT): EventSetupValues => ({ ...defaultEventSetup(ctx), ...overrides });
const sentence = (values: EventSetupValues, ctx = FLAT, location: string | null = 'Brewhouse') =>
  describeEventSetup(values, ctx, location).map((part) => part.text).join('');
const edits = (values: EventSetupValues, ctx = FLAT) =>
  describeEventSetup(values, ctx, null).flatMap((part) => (part.edit ? [part.edit] : []));

describe('setupFieldApplies', () => {
  it('asks how teams form only when there is a choice', () => {
    expect(setupFieldApplies('team_assignment', setup({ team_size: 1 }))).toBe(false);
    expect(setupFieldApplies('team_assignment', setup({ team_size: 2 }))).toBe(true);
    expect(setupFieldApplies('team_assignment', setup({ team_size: 4 }))).toBe(true);
  });

  it('asks for qualification frames only with a qualification round', () => {
    expect(setupFieldApplies('qualification_frame_count', setup({ qualification_round_enabled: false }))).toBe(false);
    expect(setupFieldApplies('qualification_frame_count', setup({ qualification_round_enabled: true }))).toBe(true);
  });

  it('asks for a putt distance only when the event does not use handicaps', () => {
    expect(setupFieldApplies('putt_distance_ft', setup())).toBe(true);
    expect(setupFieldApplies('putt_distance_ft', setup({}, ZONES))).toBe(false);
    expect(setupFieldApplies('putt_distance_ft', setup({ handicap_enabled: false }, ZONES))).toBe(true);
  });
});

describe('labels', () => {
  it('formats money without needless cents', () => {
    expect(formatMoney(10)).toBe('$10');
    expect(formatMoney(10.5)).toBe('$10.50');
  });

  it('describes admin fees', () => {
    expect(adminFeeLabel({ admin_fees: null, admin_fee_per_player: null })).toBe('no admin fee');
    expect(adminFeeLabel({ admin_fees: 0, admin_fee_per_player: 0 })).toBe('no admin fee');
    expect(adminFeeLabel({ admin_fees: null, admin_fee_per_player: 1 })).toBe('$1 per player to admin');
    expect(adminFeeLabel({ admin_fees: 5, admin_fee_per_player: 1 })).toBe('$1 per player + $5 to admin');
  });

  it('summarizes each step, with zones in order for a handicap league', () => {
    const summary = setupSummary(
      setup({ qualification_round_enabled: true, entry_fee_per_player: 10, admin_fee_per_player: 1 }, ZONES),
      ZONES
    );
    expect(summary).toEqual({
      format: 'Doubles, one from each pool · 5-frame qualification',
      scoring: '5-frame matches · zones 21 / 27 / 33 ft · bracket reset',
      money: '$10 entry · $1 per player to admin',
    });
    expect(setupSummary(setup(), FLAT).money).toBe('No entry fee');
  });

  it('describes the distance from the event, noting a one-distance night in a handicap league', () => {
    expect(distanceLabel(setup({ putt_distance_ft: 20 }), FLAT)).toBe('20 ft');
    expect(distanceLabel(setup({ putt_distance_ft: 20, handicap_enabled: false }, ZONES), ZONES)).toBe('20 ft for everyone');
    expect(eventDistanceLabel({ handicap_enabled: true, putt_distance_ft: 15 })).toBe('By zone');
    expect(eventDistanceLabel({ handicap_enabled: false, putt_distance_ft: 20 })).toBe('20 ft');
  });
});

describe('describeEventSetup', () => {
  it('reads as one plain description', () => {
    expect(sentence(setup({
      lane_count: 4,
      qualification_round_enabled: true,
      entry_fee_per_player: 10,
      admin_fee_per_player: 1,
    }, ZONES), ZONES)).toBe(
      'Doubles, one from each pool, seeded by a 5-frame qualification round. Bracket matches are 5 frames, ' +
      "double elimination with a bracket reset. Played on 4 lanes from each player's handicap zone (21 / 27 / 33 ft) " +
      'at Brewhouse. Entry is $10, $1 per player to admin.'
    );
  });

  it('leaves out what does not apply', () => {
    const singles = setup({ team_size: 1, lane_count: 1 });
    expect(edits(singles)).not.toContain('team_assignment');
    expect(sentence(singles)).toContain('Singles, seeded by past averages.');
    expect(sentence(singles)).toContain('Played on 1 lane from 15 ft');
    expect(sentence(setup({ handicap_enabled: false, putt_distance_ft: 20 }, ZONES), ZONES)).toContain('from 20 ft for everyone at');
    expect(edits(setup({}, ZONES), ZONES)).toContain('distance');
    expect(sentence(setup(), FLAT, '  ')).toContain('at no location set. No entry fee.');
    expect(edits(setup())).not.toContain('admin_fees');
  });
});

describe('eventFormatParts', () => {
  const event = {
    team_size: 2,
    team_assignment: 'random_pairing' as const,
    qualification_round_enabled: false,
    qualification_frame_count: 5,
    bracket_frame_count: 5,
    double_grand_final: false,
    bonus_point_enabled: false,
  };

  it('mentions only enabled features', () => {
    expect(eventFormatParts(event)).toEqual(['Doubles, one from each pool', '5-frame matches']);
    expect(eventFormatParts({ ...event, qualification_round_enabled: true, double_grand_final: true, bonus_point_enabled: true }))
      .toEqual(['Doubles, one from each pool', '5-frame qualification', '5-frame matches', 'bracket reset', 'bonus point for 3 of 3']);
  });
});

describe('templateToSetupValues', () => {
  it('copies only the settings, never date, place, code or payouts', () => {
    const template = {
      ...setup({ lane_count: 4, team_size: 3, team_assignment: 'manual', entry_fee_per_player: 10, admin_fees: 5 }),
      id: 'event-1',
      event_date: '2026-11-10',
      location: 'Brewhouse',
      access_code: 'OLD123',
      payout_structure: [{ place: 1, percentage: 100 }],
      status: 'completed',
    };
    expect(templateToSetupValues(template, FLAT)).toEqual(
      setup({ lane_count: 4, team_size: 3, team_assignment: 'manual', entry_fee_per_player: 10, admin_fees: 5 })
    );
  });

  it("repeats the template's handicap choice unless the league has since turned handicaps off", () => {
    expect(templateToSetupValues(setup({ handicap_enabled: false }, ZONES), ZONES).handicap_enabled).toBe(false);
    expect(templateToSetupValues(setup({}, ZONES), ZONES).handicap_enabled).toBe(true);
    expect(templateToSetupValues(setup({}, ZONES), FLAT).handicap_enabled).toBe(false);
  });
});

describe('upcomingWeekdayDates', () => {
  it('includes today when it is the weekday', () => {
    const tuesday = new Date(2026, 10, 17, 15, 30);
    expect(upcomingWeekdayDates(2, tuesday)).toEqual([new Date(2026, 10, 17), new Date(2026, 10, 24)]);
  });

  it('rolls over the end of the month', () => {
    const sunday = new Date(2026, 10, 29);
    expect(upcomingWeekdayDates(2, sunday)).toEqual([new Date(2026, 11, 1), new Date(2026, 11, 8)]);
  });
});

describe('toCreateEventBody', () => {
  const input = {
    ...setup({ entry_fee_per_player: 10 }),
    event_date: new Date(2026, 10, 17),
    location: '  Brewhouse ',
    access_code: 'K7QM4R',
  };

  it('matches the create-event API body', () => {
    expect(toCreateEventBody(input, FLAT, 'source-1')).toEqual({
      event_date: '2026-11-17',
      location: 'Brewhouse',
      lane_count: 1,
      putt_distance_ft: 15,
      access_code: 'K7QM4R',
      qualification_round_enabled: false,
      double_grand_final: true,
      bracket_frame_count: 5,
      qualification_frame_count: 5,
      entry_fee_per_player: 10,
      admin_fees: null,
      admin_fee_per_player: null,
      team_size: 2,
      team_assignment: 'random_pairing',
      copy_players_from_event_id: 'source-1',
    });
  });

  it('omits the copy source and blank locations', () => {
    const body = toCreateEventBody({ ...input, location: ' ' }, FLAT, null);
    expect(body.location).toBeNull();
    expect(body).not.toHaveProperty('copy_players_from_event_id');
    expect(body).not.toHaveProperty('handicap_enabled');
  });

  it('sends the handicap choice only in a handicap league', () => {
    expect(toCreateEventBody({ ...input, handicap_enabled: false }, ZONES)).toMatchObject({ handicap_enabled: false });
  });
});

it('generates codes without look-alike characters', () => {
  for (let i = 0; i < 50; i++) expect(generateAccessCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
});
