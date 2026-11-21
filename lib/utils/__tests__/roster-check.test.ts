import type { EventPlayer } from '@/lib/types/player';
import {
  NEW_ENTRY_WINDOW_MS,
  formatMinutesAgo,
  paymentSplit,
  playersNotShown,
  rosterLayout,
  rosterRows,
  zoneCounts,
} from '../roster-check';

const NOW = Date.parse('2026-11-20T19:00:00Z');

function entry(id: string, name: string, extra: Partial<EventPlayer> = {}, playerNumber = 1): EventPlayer {
  return {
    id,
    event_id: 'e1',
    player_id: `p-${id}`,
    payment_type: 'cash',
    zone: 1,
    putt_distance_ft: 21,
    created_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
    player: { id: `p-${id}`, full_name: name, created_at: '2026-01-01T00:00:00Z', player_number: playerNumber },
    ...extra,
  };
}

describe('rosterRows', () => {
  it('sorts by name ignoring case and accents', () => {
    const rows = rosterRows([entry('1', 'zoe Park'), entry('2', 'Álvaro Diaz'), entry('3', 'Bea Cole')], NOW);
    expect(rows.map((r) => r.name)).toEqual(['Álvaro Diaz', 'Bea Cole', 'zoe Park']);
  });

  it('adds the player number only when two names collide', () => {
    const rows = rosterRows([entry('1', 'Sam Lee', {}, 12), entry('2', 'Sam Lee', {}, 40), entry('3', 'Ari Cole')], NOW);
    expect(rows.map((r) => r.name)).toEqual(['Ari Cole', 'Sam Lee #12', 'Sam Lee #40']);
  });

  it('tags entries added within the last five minutes as new', () => {
    const recent = entry('1', 'New Person', { created_at: new Date(NOW - NEW_ENTRY_WINDOW_MS + 1000).toISOString() });
    const rows = rosterRows([recent, entry('2', 'Old Person')], NOW);
    expect(rows.find((r) => r.name === 'New Person')?.isNew).toBe(true);
    expect(rows.find((r) => r.name === 'Old Person')?.isNew).toBe(false);
  });

  it('carries no distance for an entry without a zone', () => {
    const [row] = rosterRows([entry('1', 'No Zone', { zone: null, putt_distance_ft: 25 })], NOW);
    expect(row).toMatchObject({ zone: null, distanceFt: null });
  });
});

describe('rosterLayout', () => {
  const rows = (n: number) => rosterRows(Array.from({ length: n }, (_, i) => entry(String(i), `Player ${i}`)), NOW);

  it('fills four columns top to bottom and shrinks the font as the roster grows', () => {
    expect(rosterLayout(rows(32))).toMatchObject({ rows: 8, fontPx: 34 });
    expect(rosterLayout(rows(48))).toMatchObject({ rows: 12, fontPx: 26 });
    expect(rosterLayout(rows(64)).pages).toHaveLength(1);
  });

  it('pages a roster that does not fit one screen', () => {
    const layout = rosterLayout(rows(70));
    expect(layout.pages.map((p) => p.length)).toEqual([64, 6]);
    expect(layout.rows).toBe(16);
  });
});

describe('paymentSplit', () => {
  it('counts cash and electronic and totals the cash box', () => {
    const players = [
      entry('1', 'A', { payment_type: 'cash' }),
      entry('2', 'B', { payment_type: 'cash' }),
      entry('3', 'C', { payment_type: 'electronic' }),
      entry('4', 'D', { payment_type: null }),
    ];
    expect(paymentSplit(players, 10)).toEqual({ cash: 2, electronic: 1, unpaid: 1, cashTotal: 20 });
    expect(paymentSplit(players, null).cashTotal).toBeNull();
  });
});

describe('zoneCounts and playersNotShown', () => {
  it('counts players per zone in zone order', () => {
    expect(zoneCounts([{ zone: 3 }, { zone: 1 }, { zone: 3 }, { zone: null }])).toEqual([
      { zone: 1, count: 1 },
      { zone: 3, count: 2 },
    ]);
  });

  it('lists players registered after the roster was shown', () => {
    const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(playersNotShown(players, { at: NOW, eventPlayerIds: ['a', 'b'] })).toEqual([{ id: 'c' }]);
    expect(playersNotShown(players, null)).toHaveLength(3);
  });

  it('formats minutes ago', () => {
    expect(formatMinutesAgo(NOW - 10_000, NOW)).toBe('just now');
    expect(formatMinutesAgo(NOW - 12 * 60_000, NOW)).toBe('12 min ago');
  });
});
