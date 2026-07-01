// In-memory stale-while-revalidate cache, keyed by endpoint+filters.
// Lets a page show its last-known data instantly when revisited (e.g.
// switching tabs back and forth) instead of flashing a loading skeleton,
// while still refetching in the background to keep data fresh.
type Entry<T> = { value: T; ts: number };

const MAX_ENTRIES = 100;

const store = new Map<string, Entry<unknown>>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

// True if `key` has a cached entry younger than `maxAgeMs` — callers use
// this to skip the background refetch entirely when data is still fresh.
export function isFresh(key: string, maxAgeMs = 15_000): boolean {
  const entry = store.get(key);
  return !!entry && Date.now() - entry.ts < maxAgeMs;
}

export function setCached<T>(key: string, value: T): void {
  store.delete(key); // re-insert so this key becomes the newest for eviction ordering
  store.set(key, { value, ts: Date.now() });
  if (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
}

// Drop every entry whose key starts with `prefix` — used after a mutation
// (e.g. rescheduling a placement) so the next visit refetches fresh data
// instead of showing the pre-mutation snapshot for any filter combination.
export function invalidateCachePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
