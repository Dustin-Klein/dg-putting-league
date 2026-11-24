import { format } from 'date-fns';

/**
 * Converts a date string (YYYY-MM-DD) to a local Date object
 * Ensures consistent timezone handling across the application
 */
export const parseLocalDate = (dateStr: string): Date => {
  // Append time component to ensure local timezone handling
  return new Date(`${dateStr}T00:00:00`);
};

/**
 * Formats a date for display
 */
export const formatDisplayDate = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseLocalDate(date) : date;
  return format(dateObj, 'MMMM d, yyyy');
};

/**
 * Formats a date in short format (e.g., "Feb 19, 2025")
 */
export const formatShortDate = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseLocalDate(date) : date;
  return format(dateObj, 'MMM d, yyyy');
};

/**
 * Formats a date for database storage (YYYY-MM-DD)
 */
export const formatForDatabase = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

/**
 * Validates if a date is today or in the future (timezone-aware)
 */
export const isFutureOrToday = (date: Date): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
};

/** Month ("NOV"), day ("19") and year of a date-only string, for stacked date labels. */
export const formatDateParts = (date: string): { month: string; day: string; year: number } => {
  const dateObj = parseLocalDate(date);
  return { month: format(dateObj, 'MMM').toUpperCase(), day: format(dateObj, 'd'), year: dateObj.getFullYear() };
};

/** Month and day without the year (e.g., "Nov 19"). */
export const formatMonthDay = (date: string): string => format(parseLocalDate(date), 'MMM d');
