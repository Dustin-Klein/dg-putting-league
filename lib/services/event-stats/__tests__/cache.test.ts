import { CoalescingCache } from '../cache';

describe('CoalescingCache', () => {
  it('coalesces concurrent loads and serves within the TTL', async () => {
    let time = 0;
    const cache = new CoalescingCache<number>(10_000, 10, () => time);
    const load = jest.fn(async () => 1);
    const [a, b] = await Promise.all([cache.get('e', load), cache.get('e', load)]);
    expect([a, b]).toEqual([1, 1]);
    time = 9_999;
    await cache.get('e', load);
    expect(load).toHaveBeenCalledTimes(1);
    time = 10_000;
    await cache.get('e', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load', async () => {
    const cache = new CoalescingCache<number>(10_000);
    await expect(cache.get('e', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(cache.get('e', async () => 2)).resolves.toBe(2);
  });

  it('keeps at most maxEntries keys', async () => {
    const cache = new CoalescingCache<number>(10_000, 2);
    const load = jest.fn(async () => 1);
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('c', load);
    await cache.get('c', load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
