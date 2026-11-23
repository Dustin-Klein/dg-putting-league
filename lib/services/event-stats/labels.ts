/** "27 ft", "24.5 ft". */
export function formatDistanceLabel(distanceFt: number): string {
  const text = Number.isInteger(distanceFt) ? String(distanceFt) : distanceFt.toFixed(1).replace(/\.0$/, '');
  return `${text} ft`;
}

export function sideLabel(names: readonly string[]): string {
  return names.length > 0 ? names.join(' & ') : 'TBD';
}
