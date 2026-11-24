import { currentNight, groupEventsIntoNights, nightState, seasonSummary, SEASON_STRIP_NIGHTS } from '../league-nights';

const event = (id: string, parent_event_id: string | null = null, event_date = '2026-10-08') => ({ id, parent_event_id, event_date });

describe('groupEventsIntoNights', () => {
  it('attaches linked events to their main event in list order', () => {
    const nights = groupEventsIntoNights([event('b'), event('b-sc', 'b'), event('a'), event('a-sc', 'a'), event('a-sc2', 'a')]);
    expect(nights.map((night) => [night.main.id, night.secondChances.map((child) => child.id)])).toEqual([
      ['b', ['b-sc']],
      ['a', ['a-sc', 'a-sc2']],
    ]);
  });

  it('keeps a linked event listed before its parent with that parent', () => {
    const nights = groupEventsIntoNights([event('sc', 'main'), event('main')]);
    expect(nights).toEqual([{ main: event('main'), secondChances: [event('sc', 'main')] }]);
  });

  it('makes a linked event whose parent is not listed its own night', () => {
    expect(groupEventsIntoNights([event('sc', 'hidden'), event('other')])).toEqual([
      { main: event('sc', 'hidden'), secondChances: [] },
      { main: event('other'), secondChances: [] },
    ]);
  });

  it('makes a linked event on another day its own night', () => {
    const later = event('sc', 'main', '2026-10-09');
    expect(groupEventsIntoNights([later, event('main')])).toEqual([
      { main: later, secondChances: [] },
      { main: event('main'), secondChances: [] },
    ]);
  });
});

type Status = 'created' | 'pre-bracket' | 'bracket' | 'completed';
const timed = (id: string, event_date: string, status: Status, parent_event_id: string | null = null) =>
  ({ id, event_date, status, parent_event_id });

describe('nightState', () => {
  it('is live when any event of the night is in bracket play', () => {
    expect(nightState({ main: timed('m', '2026-10-08', 'completed'), secondChances: [timed('s', '2026-10-08', 'bracket', 'm')] })).toBe('live');
  });

  it('is done once the main event is completed, else upcoming', () => {
    expect(nightState({ main: timed('m', '2026-10-08', 'completed'), secondChances: [] })).toBe('done');
    expect(nightState({ main: timed('m', '2026-10-08', 'pre-bracket'), secondChances: [] })).toBe('upcoming');
  });
});

describe('seasonSummary', () => {
  it('spans the first and latest event and lists nights oldest first, whatever the input order', () => {
    expect(seasonSummary([
      timed('a', '2026-09-08', 'completed'),
      timed('c', '2026-12-01', 'created'),
      timed('b', '2026-11-24', 'bracket'),
      timed('b-sc', '2026-11-24', 'bracket', 'b'),
    ])).toEqual({ first_event_date: '2026-09-08', latest_event_date: '2026-12-01', night_count: 3, nights: ['done', 'live', 'upcoming'] });
  });

  it('keeps only the latest nights in the strip but counts them all', () => {
    const events = Array.from({ length: SEASON_STRIP_NIGHTS + 3 }, (_, i) =>
      timed(`e${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`, 'completed'));
    const season = seasonSummary(events);
    expect(season.night_count).toBe(SEASON_STRIP_NIGHTS + 3);
    expect(season.nights).toHaveLength(SEASON_STRIP_NIGHTS);
    expect(season.first_event_date).toBe('2026-01-01');
  });

  it('is empty without events', () => {
    expect(seasonSummary([])).toEqual({ first_event_date: null, latest_event_date: null, night_count: 0, nights: [] });
  });
});

describe('currentNight', () => {
  const nights = (...events: ReturnType<typeof timed>[]) => groupEventsIntoNights(events);

  it('prefers the live night', () => {
    expect(currentNight(nights(timed('n', '2026-12-01', 'created'), timed('l', '2026-11-24', 'bracket')))).toMatchObject({
      kind: 'live', night: { main: { id: 'l' } },
    });
  });

  it('takes the soonest night not yet done', () => {
    expect(currentNight(nights(
      timed('later', '2026-12-10', 'created'),
      timed('soon', '2026-12-03', 'created'),
      timed('done', '2026-11-19', 'completed'),
    ))).toMatchObject({ kind: 'next', night: { main: { id: 'soon' } } });
  });

  it('falls back to the latest night, or none', () => {
    expect(currentNight(nights(timed('b', '2026-09-29', 'completed'), timed('a', '2026-09-22', 'completed')))).toMatchObject({
      kind: 'latest', night: { main: { id: 'b' } },
    });
    expect(currentNight([])).toBeNull();
  });
});
