import { csvCell, toCsv } from '../csv';

describe('csv', () => {
  it.each(['=SUM(A1)', '+1', '-1+2', '@cmd', '\tx', '\rx'])('neutralizes formula-looking text %j', (value) => {
    expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=a,b')).toBe(`"'=a,b"`);
  });

  it('writes numbers as numbers and empties for null', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(66.67)).toBe('66.67');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 1], ['b', null]])).toBe('a,1\r\nb,\r\n');
  });
});
