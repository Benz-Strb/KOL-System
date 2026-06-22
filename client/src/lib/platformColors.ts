export const PLATFORM_COLOR: Record<string, string> = {
  tiktok:    'bg-neutral-800',
  youtube:   'bg-red-500',
  instagram: 'bg-pink-400',
  facebook:  'bg-blue-500',
  lamon8:    'bg-yellow-300',
  shopee:    'bg-orange-400',
  lazada:    'bg-purple-500',
  twitter:   'bg-sky-400',
  x:         'bg-neutral-800',
};

export function getPlatformColor(name?: string | null) {
  return name ? (PLATFORM_COLOR[name.toLowerCase()] ?? 'bg-hairline') : 'bg-hairline';
}
