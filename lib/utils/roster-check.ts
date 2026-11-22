import type { EventPlayer } from '@/lib/types/player';

export const ROSTER_MAX_COLUMNS = 4;
/** Rows per column before the screen pages: 4 × 16 names fit a 1080p TV. */
export const ROSTER_MAX_ROWS = 16;
/** Up to this many per column before another column is added, so small rosters stay large. */
const ROSTER_ROWS_BEFORE_NEW_COLUMN = 10;

export interface RosterRow {
  eventPlayerId: string;
  name: string;
  zone: number | null;
  distanceFt: number | null;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * Every registered player, sorted by name. Two players with the same name get their
 * player number appended so each can find their own row.
 */
export function rosterRows(players: readonly EventPlayer[]): RosterRow[] {
  const nameCounts = new Map<string, number>();
  for (const player of players) {
    const key = player.player.full_name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  return players
    .map((player) => {
      const name = player.player.full_name.trim();
      const duplicate = (nameCounts.get(name.toLowerCase()) ?? 0) > 1 && player.player.player_number != null;
      return {
        eventPlayerId: player.id,
        name: duplicate ? `${name} #${player.player.player_number}` : name,
        zone: player.zone ?? null,
        distanceFt: player.zone != null ? player.putt_distance_ft ?? null : null,
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name) || a.eventPlayerId.localeCompare(b.eventPlayerId));
}

export interface RosterLayout {
  pages: RosterRow[][];
  columns: number;
  /** Rows per column on each page (column-major: read down, then across). */
  rows: number;
  /** Name font size in px: larger for short rosters, so names read from the back of the room. */
  fontPx: number;
  /** Tallest a row gets; rows shrink below this when the screen is short. */
  rowMaxPx: number;
}

export function rosterLayout(rows: readonly RosterRow[]): RosterLayout {
  const perPage = ROSTER_MAX_COLUMNS * ROSTER_MAX_ROWS;
  const pages: RosterRow[][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);
  const onPage = Math.min(rows.length, perPage);
  const columns = Math.min(ROSTER_MAX_COLUMNS, Math.max(2, Math.ceil(onPage / ROSTER_ROWS_BEFORE_NEW_COLUMN)));
  const rowsPerColumn = Math.max(1, Math.ceil(onPage / columns));
  const fontPx = rowsPerColumn <= 8 ? 34 : rowsPerColumn <= 10 ? 30 : rowsPerColumn <= 12 ? 26 : rowsPerColumn <= 14 ? 23 : 20;
  return { pages, columns, rows: rowsPerColumn, fontPx, rowMaxPx: Math.round(fontPx * 1.3 + 24) };
}

export function zoneCounts(players: readonly Pick<EventPlayer, 'zone'>[]): Array<{ zone: number; count: number }> {
  const counts = new Map<number, number>();
  for (const player of players) {
    if (player.zone != null) counts.set(player.zone, (counts.get(player.zone) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([zone, count]) => ({ zone, count }));
}

export interface PaymentSplit {
  cash: number;
  electronic: number;
  waived: number;
  unpaid: number;
  /** Cash expected in the box: cash entries × entry fee. Null when the event has no fee. */
  cashTotal: number | null;
}

export function paymentSplit(
  players: readonly Pick<EventPlayer, 'payment_type'>[],
  entryFee: number | null
): PaymentSplit {
  const cash = players.filter((p) => p.payment_type === 'cash').length;
  const electronic = players.filter((p) => p.payment_type === 'electronic').length;
  const waived = players.filter((p) => p.payment_type === 'waived').length;
  return {
    cash,
    electronic,
    waived,
    unpaid: players.length - cash - electronic - waived,
    cashTotal: entryFee != null ? cash * Number(entryFee) : null,
  };
}

/**
 * When the roster was last on the screen (this device only) and who was on it. A hint
 * for the start-bracket check, so it lives in sessionStorage, not on the server.
 */
export interface RosterShown {
  at: number;
  eventPlayerIds: string[];
}

function shownKey(eventId: string) {
  return `roster-shown:${eventId}`;
}

export function recordRosterShown(eventId: string, eventPlayerIds: string[], at = Date.now()): void {
  try {
    sessionStorage.setItem(shownKey(eventId), JSON.stringify({ at, eventPlayerIds } satisfies RosterShown));
  } catch {
    // Storage disabled: the start-bracket check just says the roster wasn't shown.
  }
}

export function readRosterShown(eventId: string): RosterShown | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(shownKey(eventId)) ?? 'null');
    if (typeof stored?.at !== 'number' || !Array.isArray(stored?.eventPlayerIds)) return null;
    return stored as RosterShown;
  } catch {
    return null;
  }
}

/** Players registered since the roster was last shown (all of them if it never was). */
export function playersNotShown<T extends Pick<EventPlayer, 'id'>>(players: readonly T[], shown: RosterShown | null): T[] {
  const seen = new Set(shown?.eventPlayerIds ?? []);
  return players.filter((player) => !seen.has(player.id));
}

export function formatMinutesAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes === 0) return 'just now';
  if (minutes === 1) return '1 min ago';
  return `${minutes} min ago`;
}

export interface KeptTeamsStatus {
  /** Kept teams whose members are all still registered. */
  keptCount: number;
  /** Players who will be paired among themselves: newcomers, and partners of anyone who left. */
  needTeam: EventPlayer[];
}

/** Mirrors keptTeamPreview: a kept team survives only if every member is still registered. */
export function keptTeamsStatus(players: readonly EventPlayer[], keptTeams: readonly string[][]): KeptTeamsStatus {
  const registered = new Set(players.map((player) => player.id));
  const intact = keptTeams.filter((team) => team.length > 0 && team.every((id) => registered.has(id)));
  const onKeptTeam = new Set(intact.flat());
  return { keptCount: intact.length, needTeam: players.filter((player) => !onKeptTeam.has(player.id)) };
}
