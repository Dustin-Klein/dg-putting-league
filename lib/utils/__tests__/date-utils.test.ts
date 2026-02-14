import {
  parseLocalDate,
  formatDisplayDate,
  formatShortDate,
  formatForDatabase,
  isFutureOrToday,
} from '../date-utils';

describe('parseLocalDate', () => {
  it('should parse a YYYY-MM-DD string as local midnight', () => {
    const date = parseLocalDate('2026-01-15');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0); // January
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('should not shift the date near midnight boundaries', () => {
    // This is the core regression case: parsing "2026-01-01" without T00:00:00
    // can be interpreted as UTC, shifting the date back to Dec 31 in western timezones
    const date = parseLocalDate('2026-01-01');
    expect(date.getDate()).toBe(1);
    expect(date.getMonth()).toBe(0);
  });

  it('should preserve the date for end-of-month dates', () => {
    const date = parseLocalDate('2026-01-31');
    expect(date.getDate()).toBe(31);
    expect(date.getMonth()).toBe(0);
  });

  it('should preserve the date for Dec 31 (year boundary)', () => {
    const date = parseLocalDate('2025-12-31');
    expect(date.getDate()).toBe(31);
    expect(date.getMonth()).toBe(11);
    expect(date.getFullYear()).toBe(2025);
  });
});

describe('formatDisplayDate', () => {
  it('should format a date string without day shift', () => {
    expect(formatDisplayDate('2026-01-01')).toBe('January 1, 2026');
  });

  it('should format Dec 31 without shifting to next year', () => {
    expect(formatDisplayDate('2025-12-31')).toBe('December 31, 2025');
  });

  it('should format a Date object', () => {
    const date = new Date(2026, 5, 15); // June 15
    expect(formatDisplayDate(date)).toBe('June 15, 2026');
  });
});

describe('formatShortDate', () => {
  it('should format a date string without day shift', () => {
    expect(formatShortDate('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('should format Dec 31 without shifting to next year', () => {
    expect(formatShortDate('2025-12-31')).toBe('Dec 31, 2025');
  });

  it('should format a Date object', () => {
    const date = new Date(2026, 5, 15);
    expect(formatShortDate(date)).toBe('Jun 15, 2026');
  });
});

describe('formatForDatabase', () => {
  it('should format a local midnight date correctly', () => {
    const date = parseLocalDate('2026-01-15');
    expect(formatForDatabase(date)).toBe('2026-01-15');
  });

  it('should round-trip Jan 1 without date shift', () => {
    const date = parseLocalDate('2026-01-01');
    expect(formatForDatabase(date)).toBe('2026-01-01');
  });

  it('should round-trip Dec 31 without date shift', () => {
    const date = parseLocalDate('2025-12-31');
    expect(formatForDatabase(date)).toBe('2025-12-31');
  });
});

describe('isFutureOrToday', () => {
  it('should return true for today at midnight', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expect(isFutureOrToday(today)).toBe(true);
  });

  it('should return true for a future date', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(isFutureOrToday(future)).toBe(true);
  });

  it('should return false for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    expect(isFutureOrToday(yesterday)).toBe(false);
  });
});
