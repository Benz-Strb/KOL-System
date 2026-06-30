// อัปเดต UI ก่อน, ยิง request, ถ้า fail → rollback + เรียก onError
export async function optimistic<T>(opts: {
  apply: () => void;
  rollback: () => void;
  request: () => Promise<T>;
  onError?: (e: unknown) => void;
}): Promise<T | undefined> {
  opts.apply();
  try {
    return await opts.request();
  } catch (e) {
    opts.rollback();
    opts.onError?.(e);
    return undefined;
  }
}
