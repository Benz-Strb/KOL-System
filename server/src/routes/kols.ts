import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// ─── GET / — KOL Directory ────────────────────────────────
app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const q = c.req.query('q');
    const platform_id = c.req.query('platform_id');
    const category_id = c.req.query('category_id');
    const page = c.req.query('page') ?? '1';
    const TAKE = 25;
    const skip = (Number(page) - 1) * TAKE;

    const where: Prisma.kolsWhereInput = {};
    if (q?.trim()) {
      where.OR = [
        { handle: { contains: q.trim(), mode: 'insensitive' } },
        { gen_name: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }
    if (platform_id) where.platform_id = Number(platform_id);
    if (category_id) where.content_category_id = Number(category_id);

    const [total, kols] = await Promise.all([
      prisma.kols.count({ where }),
      prisma.kols.findMany({
        where,
        select: {
          id: true,
          handle: true,
          gen_name: true,
          follower_count: true,
          profile_url: true,
          avatar_url: true,
          contact_info: true,
          custom_tags: true,
          audience_tags: true,
          main_selling_points: true,
          platforms: { select: { id: true, name: true } },
          content_categories: { select: { name: true } },
          placements: {
            where: { status: { not: 'cancelled' } },
            select: {
              campaigns: { select: { code: true, label: true } },
              products: { select: { model_code: true } },
            },
          },
        },
        orderBy: [
          { follower_count: { sort: 'desc', nulls: 'last' } },
          { handle: 'asc' },
        ],
        take: TAKE,
        skip,
      }),
    ]);

    const parseCode = (code: string) => { const [m, d] = code.split('.').map(Number); return [m || 0, d || 0]; };

    const rows = kols.map(k => ({
      id: k.id,
      handle: k.handle,
      gen_name: k.gen_name,
      follower_count: k.follower_count,
      profile_url: k.profile_url,
      avatar_url: k.avatar_url,
      contact_info: k.contact_info as Record<string, string> | null,
      custom_tags: k.custom_tags,
      audience_tags: k.audience_tags,
      main_selling_points: k.main_selling_points,
      platform: k.platforms,
      category: k.content_categories?.name ?? null,
      campaigns: [...new Map(
        k.placements.filter(p => p.campaigns).map(p => [p.campaigns!.code, p.campaigns!])
      ).values()].sort((a, b) => {
        const [am, ad] = parseCode(a.code);
        const [bm, bd] = parseCode(b.code);
        return am !== bm ? am - bm : ad - bd;
      }),
      products: [...new Set(
        k.placements.filter(p => p.products).map(p => p.products!.model_code)
      )].sort(),
    }));

    return c.json({ total, page: Number(page), limit: TAKE, rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load kols' }, 500);
  }
});

// ─── GET /search ──────────────────────────────────────────
app.get('/search', async c => {
  try {
    const prisma = c.get('prisma');
    const query = c.req.query('q')?.trim() ?? '';
    const rows = await prisma.kols.findMany({
      where: query ? {
        OR: [
          { handle: { contains: query, mode: 'insensitive' } },
          { gen_name: { contains: query, mode: 'insensitive' } },
        ],
      } : undefined,
      select: {
        id: true,
        handle: true,
        gen_name: true,
        follower_count: true,
        platforms: { select: { id: true, name: true } },
      },
      orderBy: { handle: 'asc' },
      take: 10,
    });
    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to search kols' }, 500);
  }
});

// ─── PATCH /terms/:termId — update commercial term ────────
// Must come BEFORE /:id to avoid "terms" matching as an id
app.patch('/terms/:termId', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const termId = Number(c.req.param('termId'));

    if (user.role !== 'admin') {
      const existing = await prisma.kol_commercial_terms.findUnique({ where: { id: termId }, select: { brand_id: true } });
      if (!existing) return c.json({ error: 'ไม่พบเงื่อนไขนี้' }, 404);
      if (existing.brand_id != null && !user.brandIds.includes(existing.brand_id)) {
        return c.json({ error: 'ไม่มีสิทธิ์เข้าถึงเงื่อนไขของแบรนด์นี้' }, 403);
      }
    }

    const { pricing_type, single_post_price, package_price, multi_platform_price, is_barter, notes } = await c.req.json();
    const term = await prisma.kol_commercial_terms.update({
      where: { id: termId },
      data: {
        ...(pricing_type !== undefined && { pricing_type }),
        ...(single_post_price !== undefined && {
          single_post_price: single_post_price !== '' && single_post_price != null ? String(single_post_price) : null,
        }),
        ...(package_price !== undefined && {
          package_price: package_price !== '' && package_price != null ? String(package_price) : null,
        }),
        ...(multi_platform_price !== undefined && {
          multi_platform_price: multi_platform_price !== '' && multi_platform_price != null ? String(multi_platform_price) : null,
        }),
        ...(is_barter !== undefined && { is_barter: Boolean(is_barter) }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
      include: { brands: { select: { id: true, name: true } } },
    });
    return c.json(term);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to update term' }, 500);
  }
});

// ─── DELETE /terms/:termId — delete commercial term ───────
app.delete('/terms/:termId', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const termId = Number(c.req.param('termId'));

    if (user.role !== 'admin') {
      const existing = await prisma.kol_commercial_terms.findUnique({ where: { id: termId }, select: { brand_id: true } });
      if (!existing) return c.json({ error: 'ไม่พบเงื่อนไขนี้' }, 404);
      if (existing.brand_id != null && !user.brandIds.includes(existing.brand_id)) {
        return c.json({ error: 'ไม่มีสิทธิ์เข้าถึงเงื่อนไขของแบรนด์นี้' }, 403);
      }
    }

    await prisma.kol_commercial_terms.delete({ where: { id: termId } });
    return c.json({ ok: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to delete term' }, 500);
  }
});

// ─── GET /:id/terms — list commercial terms for a KOL ─────
app.get('/:id/terms', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const isAdmin = user.role === 'admin';
    const terms = await prisma.kol_commercial_terms.findMany({
      where: {
        kol_id: Number(c.req.param('id')),
        ...(isAdmin ? {} : { OR: [{ brand_id: null }, { brand_id: { in: user.brandIds } }] }),
      },
      include: { brands: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
    });
    return c.json(terms);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load terms' }, 500);
  }
});

// ─── POST /:id/terms — create commercial term ─────────────
app.post('/:id/terms', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const { brand_id, pricing_type, single_post_price, package_price, multi_platform_price, is_barter, notes } = await c.req.json();
    if (!pricing_type) return c.json({ error: 'pricing_type required' }, 400);

    const bid = brand_id ? Number(brand_id) : null;
    if (user.role !== 'admin' && bid != null && !user.brandIds.includes(bid)) {
      return c.json({ error: 'ไม่มีสิทธิ์สร้างเงื่อนไขให้แบรนด์นี้' }, 403);
    }

    const term = await prisma.kol_commercial_terms.create({
      data: {
        kol_id: Number(c.req.param('id')),
        brand_id: bid,
        pricing_type,
        single_post_price: single_post_price !== '' && single_post_price != null ? String(single_post_price) : null,
        package_price: package_price !== '' && package_price != null ? String(package_price) : null,
        multi_platform_price: multi_platform_price !== '' && multi_platform_price != null ? String(multi_platform_price) : null,
        is_barter: Boolean(is_barter),
        notes: notes?.trim() || null,
      },
      include: { brands: { select: { id: true, name: true } } },
    });
    return c.json(term, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create term' }, 500);
  }
});

// ─── PATCH /:id — update KOL profile fields ───────────────
app.patch('/:id', async c => {
  try {
    const prisma = c.get('prisma');
    const { custom_tags, main_selling_points, contact_info, follower_count } = await c.req.json();
    const kol = await prisma.kols.update({
      where: { id: Number(c.req.param('id')) },
      data: {
        ...(custom_tags !== undefined && { custom_tags }),
        ...(main_selling_points !== undefined && { main_selling_points: main_selling_points?.trim() || null }),
        ...(contact_info !== undefined && { contact_info: contact_info ?? null }),
        ...(follower_count !== undefined && {
          follower_count: follower_count === '' || follower_count == null ? null : Number(follower_count),
        }),
      },
      select: {
        id: true,
        handle: true,
        custom_tags: true,
        audience_tags: true,
        main_selling_points: true,
        contact_info: true,
        follower_count: true,
      },
    });
    return c.json(kol);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to update kol' }, 500);
  }
});

// ─── POST / — create KOL ──────────────────────────────────
app.post('/', async c => {
  try {
    const prisma = c.get('prisma');
    const { handle, gen_name, platform_id, content_category_id, follower_count } = await c.req.json();
    if (!handle?.trim()) return c.json({ error: 'handle required' }, 400);

    const normalized = handle.trim().toLowerCase().replace(/\s+/g, '');

    const existing = await prisma.kols.findUnique({ where: { handle_normalized: normalized } });
    if (existing) return c.json({ error: 'KOL นี้มีอยู่แล้ว', kol: existing }, 409);

    const kol = await prisma.kols.create({
      data: {
        handle: handle.trim(),
        handle_normalized: normalized,
        gen_name: gen_name?.trim() || null,
        platform_id: platform_id ? Number(platform_id) : null,
        content_category_id: content_category_id ? Number(content_category_id) : null,
        follower_count: follower_count ? Number(follower_count) : null,
      },
      select: {
        id: true,
        handle: true,
        gen_name: true,
        follower_count: true,
        platforms: { select: { id: true, name: true } },
      },
    });
    return c.json(kol, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create kol' }, 500);
  }
});

export default app;
