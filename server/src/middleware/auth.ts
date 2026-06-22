import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

export interface AuthUser {
  id: number;
  supabaseId: string;
  full_name: string;
  email: string;
  role: string;
  brandIds: number[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- only way to augment Express's ambient Request type
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const AUTH_CACHE_TTL = 60_000; // 60s — well within Supabase JWT expiry (1h)
const authCache = new Map<string, { user: AuthUser; exp: number }>();

export function invalidateAuthCache(userId: number) {
  for (const [token, entry] of authCache) {
    if (entry.user.id === userId) authCache.delete(token);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  const token = authHeader.slice(7);

  const cached = authCache.get(token);
  if (cached && cached.exp > Date.now()) {
    req.user = cached.user;
    return next();
  }

  try {
    const { data: { user: supaUser }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !supaUser?.email) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const dbUser = await prisma.users.findFirst({
      where: { email: supaUser.email, is_active: true },
      select: { id: true, full_name: true, email: true, role: true, user_brands: { select: { brand_id: true } } },
    });

    if (!dbUser || !dbUser.email) {
      res.status(403).json({ error: 'User not found or inactive' });
      return;
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
    req.user = authUser;
    next();
  } catch (err) {
    console.error('[requireAuth] error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
