// Shared http(s)-only URL scheme validator — same logic as the client's
// isSafeHttpUrl() in client/src/components/MetricsViewModal.tsx (commit 900c91e).
// Used to guard UTM link fields against non-http(s) schemes (e.g. javascript:) before
// they get stored and later rendered/clicked elsewhere in the app.
export function isSafeUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
