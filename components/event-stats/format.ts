/** Display rounding for event stats; the DTO carries unrounded values. */

export const DASH = '—';

export function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? DASH : `${(rate * 100).toFixed(1)}%`;
}

export function formatOne(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : value.toFixed(1);
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : String(value);
}

export function formatFt(distance: number): string {
  const text = Number.isInteger(distance) ? String(distance) : distance.toFixed(1).replace(/\.0$/, '');
  return `${text} ft`;
}

export function teamLabel(members: readonly { name: string }[]): string {
  return members.length > 0 ? members.map((m) => m.name).join(' & ') : 'TBD';
}
