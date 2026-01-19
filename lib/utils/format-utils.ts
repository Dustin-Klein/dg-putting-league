/**
 * Formats a placement number with its ordinal suffix (e.g., 1st, 2nd, 21st).
 * @param place The placement number to format
 * @returns The formatted string or '-' if place is null
 */
export const formatPlacement = (place: number | null): string => {
  if (place === null) return '-';

  const j = place % 10;
  const k = place % 100;

  if (j === 1 && k !== 11) {
    return `${place}st`;
  }
  if (j === 2 && k !== 12) {
    return `${place}nd`;
  }
  if (j === 3 && k !== 13) {
    return `${place}rd`;
  }
  return `${place}th`;
};
