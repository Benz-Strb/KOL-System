import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// ─── GET / — KOL Directory ────────────────────────────────
// handle/follower_count/platform_id now live on kol_platforms (a kol/person
// can have several). Listing + filtering + sorting still behaves like "1 row
// per kol" by always reading through the primary (is_primary=true) platform —
// resolve the page of ids with raw SQL first (Prisma can't ORDER BY a scalar
// field on a specific row of a to-many relation), then fetch full nested data
// via Prisma and re-apply that order. Same id-then-hydrate pattern already
// used for kol-gmv/dashboard ranking queries elsewhere in this codebase.
app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const q = c.req.query('q')?.trim();
    const platform_id = c.req.query('platform_id');
    const category_id = c.req.query('category_id');
    const page = c.req.query('page') ?? '1';
    const TAKE = 20;
    const skip = (Number(page) - 1) * TAKE;

    const whereSql = Prisma.sql`
      WHERE 1=1
      ${q ? Prisma.sql`AND (kp.handle ILIKE ${'%' + q + '%'} OR k.gen_name ILIKE ${'%' + q + '%'})` : Prisma.empty}
      ${platform_id ? Prisma.sql`AND kp.platform_id = ${Number(platform_id)}` : Prisma.empty}
      ${category_id ? Prisma.sql`AND k.content_category_id = ${Number(category_id)}` : Prisma.empty}
    `;

    const [countRows, idRows] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total
        FROM kols k
        JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
        ${whereSql}
      `,
      prisma.$queryRaw<{ id: number }[]>`
        SELECT k.id
        FROM kols k
        JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
        ${whereSql}
        ORDER BY kp.follower_count DESC NULLS LAST, kp.handle ASC
        LIMIT ${TAKE} OFFSET ${skip}
      `,
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const orderedIds = idRows.map(r => r.id);

    const kolsUnordered = orderedIds.length === 0 ? [] : await prisma.kols.findMany({
      where: { id: { in: orderedIds } },
      select: {
        id: true,
        gen_name: true,
        contact_info: true,
        custom_tags: true,
        audience_tags: true,
        main_selling_points: true,
        content_categories: { select: { name: true } },
        kol_platforms: {
          select: {
            handle: true,
            follower_count: true,
            profile_url: true,
            avatar_url: true,
            is_primary: true,
            platforms: { select: { id: true, name: true } },
          },
          orderBy: { is_primary: 'desc' },
        },
        placements: {
          where: { status: { not: 'cancelled' } },
          select: {
            campaigns: { select: { code: true, label: true } },
            products: { select: { model_code: true } },
            brands: { select: { id: true, name: true, logo_url: true } },
          },
        },
      },
    });
    const byId = new Map(kolsUnordered.map(k => [k.id, k]));
    const kols = orderedIds.map(id => byId.get(id)).filter((k): k is NonNullable<typeof k> => k != null);

    const parseCode = (code: string) => { const [m, d] = code.split('.').map(Number); return [m || 0, d || 0]; };
    const sortCampaigns = (campaigns: { code: string; label: string | null }[]) =>
      [...campaigns].sort((a, b) => {
        const [am, ad] = parseCode(a.code);
        const [bm, bd] = parseCode(b.code);
        return am !== bm ? am - bm : ad - bd;
      });

    const rows = kols.map(k => {
      // group placements by brand, then by product within each brand, so the
      // card's brand hover-detail can show "this product, reviewed in these
      // campaigns" — placements without a product (e.g. some offline ones)
      // are skipped since there's nothing to list them under
      const brandMap = new Map<number, {
        brand_id: number; brand_name: string; logo_url: string | null;
        products: Map<string, Map<string, { code: string; label: string | null }>>;
      }>();
      for (const p of k.placements) {
        if (!p.brands || !p.products) continue;
        const brandEntry = brandMap.get(p.brands.id) ?? {
          brand_id: p.brands.id, brand_name: p.brands.name, logo_url: p.brands.logo_url,
          products: new Map<string, Map<string, { code: string; label: string | null }>>(),
        };
        const productEntry = brandEntry.products.get(p.products.model_code) ?? new Map();
        if (p.campaigns) productEntry.set(p.campaigns.code, p.campaigns);
        brandEntry.products.set(p.products.model_code, productEntry);
        brandMap.set(p.brands.id, brandEntry);
      }

      const primary = k.kol_platforms.find(p => p.is_primary) ?? k.kol_platforms[0];
      return {
        id: k.id,
        handle: primary?.handle ?? '',
        gen_name: k.gen_name,
        follower_count: primary?.follower_count ?? null,
        profile_url: primary?.profile_url ?? null,
        avatar_url: primary?.avatar_url ?? null,
        contact_info: k.contact_info as Record<string, string> | null,
        custom_tags: k.custom_tags,
        audience_tags: k.audience_tags,
        main_selling_points: k.main_selling_points,
        platform: primary?.platforms ?? null,
        // every platform account this kol has — lets the UI show/link to all
        // of them, not just the primary one (kept above for backward compat)
        platforms: k.kol_platforms
          .filter(p => p.platforms)
          .map(p => ({
            platform_id: p.platforms!.id,
            platform_name: p.platforms!.name,
            handle: p.handle,
            follower_count: p.follower_count,
            profile_url: p.profile_url,
            avatar_url: p.avatar_url,
            is_primary: p.is_primary,
          })),
        category: k.content_categories?.name ?? null,
        brands: [...brandMap.values()]
          .map(b => ({
            brand_id: b.brand_id,
            brand_name: b.brand_name,
            logo_url: b.logo_url,
            products: [...b.products.entries()]
              .map(([model_code, campaigns]) => ({ model_code, campaigns: sortCampaigns([...campaigns.values()]) }))
              .sort((a, b2) => a.model_code.localeCompare(b2.model_code)),
          }))
          .sort((a, b) => a.brand_name.localeCompare(b.brand_name)),
      };
    });

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
    const rows = await prisma.$queryRaw<{
      id: number; handle: string; gen_name: string | null; follower_count: number | null;
      platform_id: number | null; platform_name: string | null;
    }[]>`
      SELECT k.id, kp.handle, k.gen_name, kp.follower_count, kp.platform_id, p.name AS platform_name
      FROM kols k
      JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
      LEFT JOIN platforms p ON p.id = kp.platform_id
      ${query ? Prisma.sql`WHERE kp.handle ILIKE ${'%' + query + '%'} OR k.gen_name ILIKE ${'%' + query + '%'}` : Prisma.empty}
      ORDER BY kp.handle ASC
      LIMIT 10
    `;
    return c.json(rows.map(r => ({
      id: r.id,
      handle: r.handle,
      gen_name: r.gen_name,
      follower_count: r.follower_count,
      platforms: r.platform_id != null ? { id: r.platform_id, name: r.platform_name } : null,
    })));
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
// follower_count now lives on kol_platforms — redirect that one field to the
// primary platform row (updateMany, not update: (kol_id, is_primary) isn't a
// modeled unique key, just a partial unique index Prisma doesn't expose).
app.patch('/:id', async c => {
  try {
    const prisma = c.get('prisma');
    const kolId = Number(c.req.param('id'));
    const { custom_tags, main_selling_points, contact_info, follower_count } = await c.req.json();

    const kol = await prisma.kols.update({
      where: { id: kolId },
      data: {
        ...(custom_tags !== undefined && { custom_tags }),
        ...(main_selling_points !== undefined && { main_selling_points: main_selling_points?.trim() || null }),
        ...(contact_info !== undefined && { contact_info: contact_info ?? null }),
      },
      select: { id: true, custom_tags: true, audience_tags: true, main_selling_points: true, contact_info: true },
    });

    if (follower_count !== undefined) {
      await prisma.kol_platforms.updateMany({
        where: { kol_id: kolId, is_primary: true },
        data: { follower_count: follower_count === '' || follower_count == null ? null : Number(follower_count) },
      });
    }
    const primary = await prisma.kol_platforms.findFirst({ where: { kol_id: kolId, is_primary: true }, select: { handle: true, follower_count: true } });

    return c.json({ ...kol, handle: primary?.handle ?? '', follower_count: primary?.follower_count ?? null });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to update kol' }, 500);
  }
});

// ─── POST / — create KOL ──────────────────────────────────
// Creates the person (kols) + their first platform account (kol_platforms,
// is_primary=true) together. handle_normalized uniqueness now lives on
// kol_platforms, so this is a fresh kol_platforms row, not a fresh kols row.
app.post('/', async c => {
  try {
    const prisma = c.get('prisma');
    const { handle, gen_name, platform_id, content_category_id, follower_count } = await c.req.json();
    if (!handle?.trim()) return c.json({ error: 'handle required' }, 400);

    const normalized = handle.trim().toLowerCase().replace(/\s+/g, '');

    const existing = await prisma.kol_platforms.findUnique({ where: { handle_normalized: normalized }, select: { kol_id: true, handle: true, follower_count: true } });
    if (existing) return c.json({ error: 'KOL นี้มีอยู่แล้ว', kol: { id: existing.kol_id, handle: existing.handle, follower_count: existing.follower_count } }, 409);

    const { kol, platform } = await prisma.$transaction(async tx => {
      const kol = await tx.kols.create({
        data: {
          gen_name: gen_name?.trim() || null,
          content_category_id: content_category_id ? Number(content_category_id) : null,
        },
      });
      const platform = await tx.kol_platforms.create({
        data: {
          kol_id: kol.id,
          handle: handle.trim(),
          handle_normalized: normalized,
          platform_id: platform_id ? Number(platform_id) : null,
          follower_count: follower_count ? Number(follower_count) : null,
          is_primary: true,
        },
        select: { handle: true, follower_count: true, platforms: { select: { id: true, name: true } } },
      });
      return { kol, platform };
    });

    return c.json({
      id: kol.id,
      handle: platform.handle,
      gen_name: kol.gen_name,
      follower_count: platform.follower_count,
      platforms: platform.platforms,
    }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create kol' }, 500);
  }
});

export default app;
