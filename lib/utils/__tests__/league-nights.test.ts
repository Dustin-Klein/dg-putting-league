import { groupEventsIntoNights } from '../league-nights';

const event = (id: string, parent_event_id: string | null = null) => ({ id, parent_event_id });

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
});
