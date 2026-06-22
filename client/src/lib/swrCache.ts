// In-memory stale-while-revalidate cache, keyed by endpoint+filters.
// Lets a page show its last-known data instantly when revisited (e.g.
// switching tabs back and forth) instead of flashing a loading skeleton,
// while still refetching in the background to keep data fresh.
const store = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, value);
}
