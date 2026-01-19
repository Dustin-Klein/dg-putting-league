import { formatPlacement } from '../format-utils';

describe('formatPlacement', () => {
  it('should return "-" for null', () => {
    expect(formatPlacement(null)).toBe('-');
  });

  it('should format 1 as 1st', () => {
    expect(formatPlacement(1)).toBe('1st');
  });

  it('should format 2 as 2nd', () => {
    expect(formatPlacement(2)).toBe('2nd');
  });

  it('should format 3 as 3rd', () => {
    expect(formatPlacement(3)).toBe('3rd');
  });

  it('should format 4 as 4th', () => {
    expect(formatPlacement(4)).toBe('4th');
  });

  it('should format 11 as 11th', () => {
    expect(formatPlacement(11)).toBe('11th');
  });

  it('should format 12 as 12th', () => {
    expect(formatPlacement(12)).toBe('12th');
  });

  it('should format 13 as 13th', () => {
    expect(formatPlacement(13)).toBe('13th');
  });

  it('should format 21 as 21st', () => {
    expect(formatPlacement(21)).toBe('21st');
  });

  it('should format 22 as 22nd', () => {
    expect(formatPlacement(22)).toBe('22nd');
  });

  it('should format 23 as 23rd', () => {
    expect(formatPlacement(23)).toBe('23rd');
  });

  it('should format 101 as 101st', () => {
    expect(formatPlacement(101)).toBe('101st');
  });

  it('should format 111 as 111th', () => {
    expect(formatPlacement(111)).toBe('111th');
  });
});
