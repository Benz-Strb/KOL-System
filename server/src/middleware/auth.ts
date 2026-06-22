import type { MiddlewareHandler } from 'hono';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import type { AppEnv } from '../types.js';

export interface AuthUser {
  id: number;
  supabaseId: string;
  full_name: string;
  email: string;
  role: string;
  brandIds: number[];
}

const AUTH_CACHE_TTL = 60_000; // 60s — well within Supabase JWT expiry (1h)
const authCache = new Map<string, { user: AuthUser; exp: number }>();

export function invalidateAuthCache(userId: number) {
  for (const [token, entry] of authCache) {
    if (entry.user.id === userId) authCache.delete(token);
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing token' }, 401);
  }

  const token = authHeader.slice(7);

  const cached = authCache.get(token);
  if (cached && cached.exp > Date.now()) {
    c.set('user', cached.user);
    await next();
    return;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin(c.env);
    const { data: { user: supaUser }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !supaUser?.email) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    const prisma = c.get('prisma');
    const dbUser = await prisma.users.findFirst({
      where: { email: supaUser.email, is_active: true },
      select: { id: true, full_name: true, email: true, role: true, user_brands: { select: { brand_id: true } } },
    });

    if (!dbUser || !dbUser.email) {
      return c.json({ error: 'User not found or inactive' }, 403);
    }

    const authUser: AuthUser = {
      id: dbUser.id,
      full_name: dbUser.full_name,
      email: dbUser.email,
      role: dbUser.role,
      supabaseId: supaUser.id,
      brandIds: dbUser.user_brands.map(ub => ub.brand_id),
    };

    authCache.set(token, { user: authUser, exp: Date.now() + AUTH_CACHE_TTL });
    c.set('user', authUser);
    await next();
  } catch (err) {
    console.error('[requireAuth] error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Internal server error' }, 500);
  }
};

export function requireRole(...roles: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  };
}
