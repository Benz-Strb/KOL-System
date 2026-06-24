export const PLATFORM_COLOR: Record<string, string> = {
  tiktok:           'bg-neutral-800',
  youtube:          'bg-red-500',
  instagram:        'bg-pink-400',
  facebook:         'bg-blue-500',
  'facebook groups': 'bg-blue-500',
  lamon8:           'bg-yellow-300',
  lemon8:           'bg-yellow-300',
  shopee:           'bg-orange-400',
  lazada:           'bg-purple-500',
  twitter:          'bg-sky-400',
  x:                'bg-neutral-800',
};

export function getPlatformColor(name?: string | null) {
  return name ? (PLATFORM_COLOR[name.toLowerCase()] ?? 'bg-hairline') : 'bg-hairline';
}

// Real platform logos (downloaded from Simple Icons, white fill so they sit
// on the colored badge background from getPlatformColor) — kept as static
// assets under public/platforms/ since the platform list is a small, fixed
// lookup (no admin UI to add new ones, unlike brands which DO get logo_url
// from the DB). Lemon8 has no Simple Icons entry — falls back to initials,
// same UX as BrandLogo's missing-logo fallback.
export const PLATFORM_LOGO: Record<string, string> = {
  tiktok:           '/platforms/tiktok.svg',
  youtube:          '/platforms/youtube.svg',
  instagram:        '/platforms/instagram.svg',
  facebook:         '/platforms/facebook.svg',
  'facebook groups': '/platforms/facebook.svg',
  twitter:          '/platforms/twitter.svg',
  x:                '/platforms/twitter.svg',
};

export function getPlatformLogo(name?: string | null) {
  return name ? (PLATFORM_LOGO[name.toLowerCase()] ?? null) : null;
}
