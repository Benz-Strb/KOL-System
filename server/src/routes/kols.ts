import { Hono } from 'hono';
import { Prisma, type PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// ─── shared: re-fetch a kol's full platform list + the flattened primary-
// platform convenience fields after any kol_platforms mutation, so the
// frontend can apply one consistent response shape everywhere instead of
// re-deriving "which one is primary" itself ────────────────────────────
async function platformsBundle(prisma: PrismaClient, kolId: number) {
  const rows = await prisma.kol_platforms.findMany({
    where: { kol_id: kolId },
    select: {
      id: true, handle: true, follower_count: true, profile_url: true, avatar_url: true, is_primary: true,
      platforms: { select: { id: true, name: true } },
    },
    orderBy: { is_primary: 'desc' },
  });
  const primary = rows.find(p => p.is_primary) ?? rows[0];
  return {
    platforms: rows.map(p => ({
      id: p.id,
      platform_id: p.platforms?.id ?? null,
      platform_name: p.platforms?.name ?? null,
      handle: p.handle,
      follower_count: p.follower_count,
      profile_url: p.profile_url,
      avatar_url: p.avatar_url,
      is_primary: p.is_primary,
    })),
    handle: primary?.handle ?? '',
    follower_count: primary?.follower_count ?? null,
    avatar_url: primary?.avatar_url ?? null,
    profile_url: primary?.profile_url ?? null,
    platform: primary?.platforms ?? null,
  };
}

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
            id: true,
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
            id: p.id,
            platform_id: p.platforms!.id,
            platform_name: p.platforms!.name,
            handle: p.handle,
            follower_count: p.follower_count,
            profile_url: p.profile_url,
            avatar_url: p.avatar_url,
            is_primary: p.is_primary,
          })),
        placement_count: k.placements.length,
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
// Matches against ANY of the kol's platform handles (not just the primary
// one) so typing a KOL's TikTok handle finds them even if their primary
// platform is Instagram — then returns every platform account they have,
// not just the primary, so the picker can show/let the user choose among
// them instead of being silently locked to whichever one is primary.
app.get('/search', async c => {
  try {
    const prisma = c.get('prisma');
    const query = c.req.query('q')?.trim() ?? '';
    const idRows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT k.id
      FROM kols k
      JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
      ${query ? Prisma.sql`
        WHERE kp.handle ILIKE ${'%' + query + '%'} OR k.gen_name ILIKE ${'%' + query + '%'}
           OR EXISTS (SELECT 1 FROM kol_platforms kp2 WHERE kp2.kol_id = k.id AND kp2.handle ILIKE ${'%' + query + '%'})
      ` : Prisma.empty}
      ORDER BY kp.handle ASC
      LIMIT 10
    `;
    const ids = idRows.map(r => r.id);
    if (ids.length === 0) return c.json([]);

    const kols = await prisma.kols.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        gen_name: true,
        kol_platforms: {
          select: {
            id: true, handle: true, follower_count: true, profile_url: true, avatar_url: true, is_primary: true,
            platforms: { select: { id: true, name: true } },
          },
          orderBy: { is_primary: 'desc' },
        },
      },
    });
    const byId = new Map(kols.map(k => [k.id, k]));
    const ordered = ids.map(id => byId.get(id)).filter((k): k is NonNullable<typeof k> => k != null);

    return c.json(ordered.map(k => {
      const primary = k.kol_platforms.find(p => p.is_primary) ?? k.kol_platforms[0];
      return {
        id: k.id,
        handle: primary?.handle ?? '',
        gen_name: k.gen_name,
        follower_count: primary?.follower_count ?? null,
        platforms: k.kol_platforms
          .filter(p => p.platforms)
          .map(p => ({
            id: p.id,
            platform_id: p.platforms!.id,
            platform_name: p.platforms!.name,
            handle: p.handle,
            follower_count: p.follower_count,
            profile_url: p.profile_url,
            avatar_url: p.avatar_url,
            is_primary: p.is_primary,
          })),
      };
    }));
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

// ─── POST /:id/platforms — add a platform account to an existing KOL ─────
// New platforms never silently steal primary — the kol already has one from
// creation, so this always starts as is_primary=false.
app.post('/:id/platforms', async c => {
  try {
    const prisma = c.get('prisma');
    const kolId = Number(c.req.param('id'));
    const { platform_id, handle, follower_count } = await c.req.json();
    if (!handle?.trim()) return c.json({ error: 'handle required' }, 400);

    const normalized = handle.trim().toLowerCase().replace(/\s+/g, '');
    const existing = await prisma.kol_platforms.findUnique({ where: { handle_normalized: normalized }, select: { kol_id: true, handle: true } });
    if (existing) return c.json({ error: 'Handle/platform นี้มีอยู่แล้ว', kol: { id: existing.kol_id, handle: existing.handle } }, 409);

    await prisma.kol_platforms.create({
      data: {
        kol_id: kolId,
        handle: handle.trim(),
        handle_normalized: normalized,
        platform_id: platform_id ? Number(platform_id) : null,
        follower_count: follower_count ? Number(follower_count) : null,
        is_primary: false,
      },
    });
    return c.json(await platformsBundle(prisma, kolId), 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to add platform' }, 500);
  }
});

// ─── PATCH /platforms/:platformId — edit a platform account ──────────────
// platform_id (which platform this account is FOR) is intentionally not
// editable here — if it's wrong, delete and re-add. is_primary:true clears
// the kol's old primary first, in its own statement, before setting the new
// one true — getting that order backwards trips idx_kol_platforms_primary_per_kol
// (a partial unique index allowing only one is_primary=true row per kol_id).
app.patch('/platforms/:platformId', async c => {
  try {
    const prisma = c.get('prisma');
    const platformId = Number(c.req.param('platformId'));
    const existing = await prisma.kol_platforms.findUnique({ where: { id: platformId }, select: { kol_id: true } });
    if (!existing) return c.json({ error: 'ไม่พบ platform นี้' }, 404);

    const { handle, follower_count, profile_url, is_primary } = await c.req.json();
    if (handle !== undefined && !handle.trim()) return c.json({ error: 'handle required' }, 400);

    if (handle !== undefined) {
      const normalized = handle.trim().toLowerCase().replace(/\s+/g, '');
      const dup = await prisma.kol_platforms.findUnique({ where: { handle_normalized: normalized }, select: { id: true } });
      if (dup && dup.id !== platformId) return c.json({ error: 'Handle/platform นี้มีอยู่แล้ว' }, 409);
    }

    if (is_primary === true) {
      await prisma.kol_platforms.updateMany({ where: { kol_id: existing.kol_id }, data: { is_primary: false } });
    }
    await prisma.kol_platforms.update({
      where: { id: platformId },
      data: {
        ...(handle !== undefined && { handle: handle.trim(), handle_normalized: handle.trim().toLowerCase().replace(/\s+/g, '') }),
        ...(follower_count !== undefined && { follower_count: follower_count === '' || follower_count == null ? null : Number(follower_count) }),
        ...(profile_url !== undefined && { profile_url: profile_url?.trim() || null }),
        ...(is_primary === true && { is_primary: true }),
      },
    });
    return c.json(await platformsBundle(prisma, existing.kol_id));
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to update platform' }, 500);
  }
});

// ─── DELETE /platforms/:platformId — remove a platform account ───────────
// Blocked if it's the kol's only platform. If it's the current primary and
// others remain, auto-promote the highest-follower one first (same tie-break
// rule used by the cross-platform merge script) so the kol is never left
// without a primary.
app.delete('/platforms/:platformId', async c => {
  try {
    const prisma = c.get('prisma');
    const platformId = Number(c.req.param('platformId'));
    const target = await prisma.kol_platforms.findUnique({ where: { id: platformId }, select: { kol_id: true, is_primary: true } });
    if (!target) return c.json({ error: 'ไม่พบ platform นี้' }, 404);

    const siblings = await prisma.kol_platforms.findMany({
      where: { kol_id: target.kol_id, id: { not: platformId } },
      select: { id: true, follower_count: true },
      orderBy: { follower_count: 'desc' },
    });
    if (siblings.length === 0) return c.json({ error: 'ต้องมีอย่างน้อย 1 platform ต่อ KOL — ลบตัวนี้ไม่ได้' }, 400);

    if (target.is_primary) {
      await prisma.kol_platforms.update({ where: { id: siblings[0].id }, data: { is_primary: true } });
    }
    await prisma.kol_platforms.delete({ where: { id: platformId } });
    return c.json(await platformsBundle(prisma, target.kol_id));
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to delete platform' }, 500);
  }
});

// ─── GET /:id/hire-history — brand-scoped placement cost timeline ────────────
// Returns planned + posted placements (no cancelled) for this KOL with pricing
// details. Non-admin users only see their own brands' data — matching the rule
// "ไม่เห็น placement detail (ราคา/PIC) ของ brand อื่น" in §8.
app.get('/:id/hire-history', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const isAdmin = user.role === 'admin';
    const kolId = Number(c.req.param('id'));

    const items = await prisma.placements.findMany({
      where: {
        kol_id: kolId,
        status: { not: 'cancelled' },
        ...(!isAdmin && { brand_id: { in: user.brandIds } }),
      },
      select: {
        id: true,
        status: true,
        payment_type: true,
        final_price: true,
        pay_amount: true,
        publication_date: true,
        placement_type: true,
        platforms: { select: { id: true, name: true } },
        brands: { select: { id: true, name: true, logo_url: true } },
        campaigns: { select: { code: true, label: true, start_date: true } },
        products: { select: { model_code: true } },
        stores: { select: { name: true, branch: true } },
      },
      orderBy: [
        { campaigns: { start_date: 'desc' } },
        { publication_date: 'desc' },
        { created_at: 'desc' },
      ],
    });
    return c.json(items.map(item => ({
      ...item,
      final_price: item.final_price?.toString() ?? null,
      pay_amount: item.pay_amount?.toString() ?? null,
    })));
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load hire history' }, 500);
  }
});

// ─── GET /:id/posts — every placement this kol has an actual post link for ─
// Not brand-scoped, same as the rest of this directory (campaigns/products
// shown to every role regardless of brand per CLAUDE.md §8) — a post_url is
// a public link, not pricing/PIC detail.
app.get('/:id/posts', async c => {
  try {
    const prisma = c.get('prisma');
    const posts = await prisma.placements.findMany({
      where: { kol_id: Number(c.req.param('id')), post_url: { not: null } },
      select: {
        id: true,
        post_url: true,
        publication_date: true,
        status: true,
        platforms: { select: { name: true } },
        brands: { select: { id: true, name: true, logo_url: true } },
        campaigns: { select: { code: true, label: true } },
        products: { select: { model_code: true } },
        stores: { select: { name: true, branch: true } },
      },
      orderBy: [{ publication_date: 'desc' }, { created_at: 'desc' }],
    });
    return c.json(posts);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load posts' }, 500);
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

// ─── PATCH /:id — update KOL (person-level) profile fields ────────────────
// follower_count moved fully to the Platform tab (PATCH /platforms/:platformId)
// now that a kol can have several platforms — editing it here would be
// ambiguous about which platform it applies to, so this endpoint no longer
// accepts it.
app.patch('/:id', async c => {
  try {
    const prisma = c.get('prisma');
    const kolId = Number(c.req.param('id'));
    const { custom_tags, main_selling_points, contact_info } = await c.req.json();

    const kol = await prisma.kols.update({
      where: { id: kolId },
      data: {
        ...(custom_tags !== undefined && { custom_tags }),
        ...(main_selling_points !== undefined && { main_selling_points: main_selling_points?.trim() || null }),
        ...(contact_info !== undefined && { contact_info: contact_info ?? null }),
      },
      select: { id: true, custom_tags: true, audience_tags: true, main_selling_points: true, contact_info: true },
    });
    return c.json(kol);
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

    const kol = await prisma.$transaction(async tx => {
      const kol = await tx.kols.create({
        data: {
          gen_name: gen_name?.trim() || null,
          content_category_id: content_category_id ? Number(content_category_id) : null,
        },
      });
      await tx.kol_platforms.create({
        data: {
          kol_id: kol.id,
          handle: handle.trim(),
          handle_normalized: normalized,
          platform_id: platform_id ? Number(platform_id) : null,
          follower_count: follower_count ? Number(follower_count) : null,
          is_primary: true,
        },
      });
      return kol;
    });

    const bundle = await platformsBundle(prisma, kol.id);
    return c.json({
      id: kol.id,
      handle: bundle.handle,
      gen_name: kol.gen_name,
      follower_count: bundle.follower_count,
      platforms: bundle.platforms,
    }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create kol' }, 500);
  }
});

export default app;
