// สี avatar จาก seed string (handle/ชื่อ) — stable ต่อ entity เดียวกันเสมอ
export const AVATAR_COLORS = [
  ['bg-rose-500',    'text-white'],
  ['bg-orange-500',  'text-white'],
  ['bg-amber-500',   'text-white'],
  ['bg-emerald-500', 'text-white'],
  ['bg-teal-500',    'text-white'],
  ['bg-cyan-500',    'text-white'],
  ['bg-blue-500',    'text-white'],
  ['bg-indigo-500',  'text-white'],
  ['bg-violet-500',  'text-white'],
  ['bg-pink-500',    'text-white'],
] as const;

export function getAvatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
