import { format, parseISO } from 'date-fns';

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
