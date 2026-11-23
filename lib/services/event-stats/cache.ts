/**
 * A small per-instance TTL cache that coalesces concurrent loads of one key, so a room
 * of spectators refreshing together costs one query per instance per TTL. Failed loads
 * are not cached.
 */
export class CoalescingCache<T> {
  private entries = new Map<string, { expires: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const time = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > time) return hit.value;

    const value = load();
    this.entries.set(key, { expires: time + this.ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    this.evict(time);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }

  private evict(time: number): void {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (entry.expires <= time || this.entries.size > this.maxEntries) this.entries.delete(key);
      if (this.entries.size <= this.maxEntries) break;
    }
  }
}
