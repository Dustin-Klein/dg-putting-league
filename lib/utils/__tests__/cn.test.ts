import { cn } from '../utils';

describe('cn', () => {
  it('drops an earlier leading-* when a later class sets the font size', () => {
    expect(cn('text-sm leading-none', 'text-[15px]')).toBe('text-[15px]');
    expect(cn('text-lg leading-none font-bold', 'text-[22px]')).toBe('font-bold text-[22px]');
  });

  it('keeps a leading-* that comes after the font size', () => {
    expect(cn('text-lg font-bold', 'text-[26px] leading-none')).toBe('font-bold text-[26px] leading-none');
  });
});
