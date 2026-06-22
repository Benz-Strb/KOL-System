import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

const router = Router();

// ─── GET / — KOL Directory ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { q, platform_id, category_id, page = '1' } = req.query as Record<string, string>;
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

    const parseCode = (c: string) => { const [m, d] = c.split('.').map(Number); return [m || 0, d || 0]; };

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

    res.json({ total, page: Number(page), limit: TAKE, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load kols' });
  }
});

// ─── GET /search ──────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query as { q?: string };
    const query = q?.trim() ?? '';
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
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to search kols' });
  }
});

// ─── PATCH /terms/:termId — update commercial term ────────
// Must come BEFORE /:id to avoid "terms" matching as an id
router.patch('/terms/:termId', async (req, res) => {
  try {
    const termId = Number(req.params.termId);

    if (req.user!.role !== 'admin') {
      const existing = await prisma.kol_commercial_terms.findUnique({ where: { id: termId }, select: { brand_id: true } });
      if (!existing) { res.status(404).json({ error: 'ไม่พบเงื่อนไขนี้' }); return; }
      if (existing.brand_id != null && !req.user!.brandIds.includes(existing.brand_id)) {
        res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงเงื่อนไขของแบรนด์นี้' }); return;
      }
    }

    const { pricing_type, single_post_price, package_price, multi_platform_price, is_barter, notes } = req.body;
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
    res.json(term);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to update term' });
  }
});

// ─── DELETE /terms/:termId — delete commercial term ───────
router.delete('/terms/:termId', async (req, res) => {
  try {
    const termId = Number(req.params.termId);

    if (req.user!.role !== 'admin') {
      const existing = await prisma.kol_commercial_terms.findUnique({ where: { id: termId }, select: { brand_id: true } });
      if (!existing) { res.status(404).json({ error: 'ไม่พบเงื่อนไขนี้' }); return; }
      if (existing.brand_id != null && !req.user!.brandIds.includes(existing.brand_id)) {
        res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงเงื่อนไขของแบรนด์นี้' }); return;
      }
    }

    await prisma.kol_commercial_terms.delete({ where: { id: termId } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to delete term' });
  }
});

// ─── GET /:id/terms — list commercial terms for a KOL ─────
router.get('/:id/terms', async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'admin';
    const terms = await prisma.kol_commercial_terms.findMany({
      where: {
        kol_id: Number(req.params.id),
        ...(isAdmin ? {} : { OR: [{ brand_id: null }, { brand_id: { in: req.user!.brandIds } }] }),
      },
      include: { brands: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
    });
    res.json(terms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load terms' });
  }
});

// ─── POST /:id/terms — create commercial term ─────────────
router.post('/:id/terms', async (req, res) => {
  try {
    const { brand_id, pricing_type, single_post_price, package_price, multi_platform_price, is_barter, notes } = req.body;
    if (!pricing_type) return res.status(400).json({ error: 'pricing_type required' });

    const bid = brand_id ? Number(brand_id) : null;
    if (req.user!.role !== 'admin' && bid != null && !req.user!.brandIds.includes(bid)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์สร้างเงื่อนไขให้แบรนด์นี้' });
    }

    const term = await prisma.kol_commercial_terms.create({
      data: {
        kol_id: Number(req.params.id),
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
    res.status(201).json(term);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to create term' });
  }
});

// ─── PATCH /:id — update KOL profile fields ───────────────
router.patch('/:id', async (req, res) => {
  try {
    const { custom_tags, main_selling_points, contact_info, follower_count } = req.body;
    const kol = await prisma.kols.update({
      where: { id: Number(req.params.id) },
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
    res.json(kol);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to update kol' });
  }
});

// ─── POST / — create KOL ──────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { handle, gen_name, platform_id, content_category_id, follower_count } = req.body;
    if (!handle?.trim()) return res.status(400).json({ error: 'handle required' });

    const normalized = handle.trim().toLowerCase().replace(/\s+/g, '');

    const existing = await prisma.kols.findUnique({ where: { handle_normalized: normalized } });
    if (existing) return res.status(409).json({ error: 'KOL นี้มีอยู่แล้ว', kol: existing });

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
    res.status(201).json(kol);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to create kol' });
  }
});

export default router;
