import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

function buildBrandFilter(isAdmin: boolean, userBrandIds: number[], brand_id?: string) {
  const bid = brand_id ? Number(brand_id) : null;
  if (isAdmin) return bid ? { brand_id: bid } : {};
  return { brand_id: bid && userBrandIds.includes(bid) ? bid : { in: userBrandIds } };
}

app.get('/kol-gmv', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const q = c.req.query();
    const { status, placement_type, q: search, product_id, campaign_id, payment_type, price_min, price_max, person_in_charge_id, brand_id } = q;

    const isAdmin = user.role === 'admin';
    const brandFilter = buildBrandFilter(isAdmin, user.brandIds, brand_id);

    const where = {
      ...brandFilter,
      ...(status && status !== 'all' ? { status } : {}),
      ...(placement_type && placement_type !== 'all' ? { placement_type } : {}),
      ...(payment_type && payment_type !== 'all' ? { payment_type } : {}),
      ...(search ? { kols: { kol_platforms: { some: { handle: { contains: search, mode: 'insensitive' as const } } } } } : {}),
      ...(product_id ? { product_id: Number(product_id) } : {}),
      ...(campaign_id === 'none' ? { campaign_id: null } : campaign_id ? { campaign_id: Number(campaign_id) } : {}),
      ...(price_min || price_max ? {
        final_price: {
          ...(price_min ? { gte: price_min } : {}),
          ...(price_max ? { lte: price_max } : {}),
        },
      } : {}),
      ...(person_in_charge_id ? { person_in_charge_id: Number(person_in_charge_id) } : {}),
    };

    const matched = await prisma.placements.findMany({ where, select: { id: true } });
    if (matched.length === 0) return c.json([]);

    const ids = matched.map(p => p.id);

    const rows = await prisma.$queryRaw<{
      kol_id: number;
      handle: string;
      gen_name: string | null;
      profile_url: string | null;
      placement_count: number;
      total_gmv: number;
      shopee_gmv: number;
      lazada_gmv: number;
      website_gmv: number;
      tiktok_gmv: number;
      total_orders: number;
    }[]>`
      SELECT
        k.id::int                 AS kol_id,
        kp.handle,
        k.gen_name,
        kp.profile_url,
        COUNT(DISTINCT p.id)::float                                                                  AS placement_count,
        COALESCE(SUM(pm.gmv::numeric), 0)::float                                                    AS total_gmv,
        COALESCE(SUM(CASE WHEN pm.channel = 'shopee'  THEN pm.gmv::numeric ELSE 0 END), 0)::float  AS shopee_gmv,
        COALESCE(SUM(CASE WHEN pm.channel = 'lazada'  THEN pm.gmv::numeric ELSE 0 END), 0)::float  AS lazada_gmv,
        COALESCE(SUM(CASE WHEN pm.channel = 'website' THEN pm.gmv::numeric ELSE 0 END), 0)::float  AS website_gmv,
        COALESCE(SUM(CASE WHEN pm.channel = 'tiktok'  THEN pm.gmv::numeric ELSE 0 END), 0)::float  AS tiktok_gmv,
        COALESCE(SUM(pm.orders), 0)::float                                                          AS total_orders
      FROM placements p
      JOIN kols k ON p.kol_id = k.id
      JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
      LEFT JOIN placement_metrics pm ON pm.placement_id = p.id AND pm.gmv IS NOT NULL
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY k.id, kp.handle, k.gen_name, kp.profile_url
      HAVING COALESCE(SUM(pm.gmv::numeric), 0) > 0
      ORDER BY total_gmv DESC
    `;

    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load KOL GMV' }, 500);
  }
});

app.get('/:id/metrics', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (user.role !== 'admin') {
      const existing = await prisma.placements.findUnique({ where: { id }, select: { brand_id: true } });
      if (!existing) return c.json({ error: 'Placement not found' }, 404);
      if (!user.brandIds.includes(existing.brand_id)) {
        return c.json({ error: 'No access to this placement' }, 403);
      }
    }
    const metrics = await prisma.placement_metrics.findMany({
      where: { placement_id: id },
      orderBy: { channel: 'asc' },
    });
    return c.json(metrics);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load metrics' }, 500);
  }
});

app.get('/:id', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);

    const raw = await prisma.placements.findUnique({
      where: { id },
      include: {
        kols: {
          select: {
            id: true, gen_name: true, content_categories: { select: { name: true } },
            kol_platforms: { where: { is_primary: true }, select: { handle: true, profile_url: true, follower_count: true, avatar_url: true } },
          },
        },
        platforms: { select: { name: true } },
        products: { select: { model_code: true } },
        stores: { select: { name: true, branch: true } },
        campaigns: { select: { code: true, label: true } },
        brands: { select: { id: true, name: true, logo_url: true } },
        users_placements_person_in_charge_idTousers: { select: { full_name: true } },
      },
    });

    if (!raw) return c.json({ error: 'Placement not found' }, 404);
    if (user.role !== 'admin' && !user.brandIds.includes(raw.brand_id)) {
      return c.json({ error: 'No access to this placement' }, 403);
    }

    const primary = raw.kols?.kol_platforms[0];
    const row = {
      ...raw,
      kols: raw.kols ? {
        id: raw.kols.id,
        handle: primary?.handle ?? '',
        gen_name: raw.kols.gen_name,
        profile_url: primary?.profile_url ?? null,
        follower_count: primary?.follower_count ?? null,
        avatar_url: primary?.avatar_url ?? null,
        content_categories: raw.kols.content_categories,
      } : null,
    };
    return c.json(row);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load placement' }, 500);
  }
});

app.get('/', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const q = c.req.query();
    const { status, placement_type, q: search, product_id, campaign_id, payment_type, price_min, price_max, person_in_charge_id, brand_id, no_date, page = '1', limit = '20' } = q;

    const isAdmin = user.role === 'admin';
    const brandFilter = buildBrandFilter(isAdmin, user.brandIds, brand_id);

    const where = {
      ...brandFilter,
      ...(status && status !== 'all' ? { status } : {}),
      ...(placement_type && placement_type !== 'all' ? { placement_type } : {}),
      ...(payment_type && payment_type !== 'all' ? { payment_type } : {}),
      ...(search ? { kols: { kol_platforms: { some: { handle: { contains: search, mode: 'insensitive' as const } } } } } : {}),
      ...(product_id ? { product_id: Number(product_id) } : {}),
      ...(campaign_id === 'none' ? { campaign_id: null } : campaign_id ? { campaign_id: Number(campaign_id) } : {}),
      ...(price_min || price_max ? {
        final_price: {
          ...(price_min ? { gte: price_min } : {}),
          ...(price_max ? { lte: price_max } : {}),
        },
      } : {}),
      ...(person_in_charge_id ? { person_in_charge_id: Number(person_in_charge_id) } : {}),
      ...(no_date === '1' ? { AND: [{ target_pub_date: null }, { publication_date: null }] } : {}),
    };

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [total, rawRows] = await Promise.all([
      prisma.placements.count({ where }),
      prisma.placements.findMany({
        where,
        include: {
          kols: {
            select: {
              id: true, gen_name: true, content_categories: { select: { name: true } },
              kol_platforms: { where: { is_primary: true }, select: { handle: true, profile_url: true, follower_count: true, avatar_url: true } },
            },
          },
          platforms: { select: { name: true } },
          products: { select: { model_code: true } },
          stores: { select: { name: true, branch: true } },
          campaigns: { select: { code: true, label: true } },
          brands: { select: { id: true, name: true, logo_url: true } },
          users_placements_person_in_charge_idTousers: { select: { full_name: true } },
        },
        orderBy: { created_at: 'desc' },
        take,
        skip,
      }),
    ]);

    // kols.handle/profile_url/follower_count/avatar_url moved to kol_platforms —
    // flatten the primary platform row back into `kols` so the response shape
    // (and the frontend reading it) stays unchanged.
    const rows = rawRows.map(r => {
      const primary = r.kols?.kol_platforms[0];
      return {
        ...r,
        kols: r.kols ? {
          id: r.kols.id,
          handle: primary?.handle ?? '',
          gen_name: r.kols.gen_name,
          profile_url: primary?.profile_url ?? null,
          follower_count: primary?.follower_count ?? null,
          avatar_url: primary?.avatar_url ?? null,
          content_categories: r.kols.content_categories,
        } : null,
      };
    });

    return c.json({ total, page: Number(page), limit: take, rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load placements' }, 500);
  }
});

app.patch('/:id/performance', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const id = Number(c.req.param('id'));

    // Non-admin: check brand access before updating
    if (user.role !== 'admin') {
      const existing = await prisma.placements.findUnique({ where: { id }, select: { brand_id: true } });
      if (!existing) return c.json({ error: 'Placement not found' }, 404);
      if (!user.brandIds.includes(existing.brand_id)) {
        return c.json({ error: 'No access to this placement' }, 403);
      }
    }

    const { publication_date, post_url, pay_amount, metrics } = await c.req.json();

    await prisma.placements.update({
      where: { id },
      data: {
        status: 'posted',
        publication_date: publication_date ? new Date(publication_date) : null,
        post_url: post_url?.trim() || null,
        ...(pay_amount !== undefined && pay_amount !== '' && pay_amount !== null
          ? { pay_amount: String(pay_amount) }
          : {}),
      },
    });

    if (Array.isArray(metrics) && metrics.length > 0) {
      for (const m of metrics) {
        const { channel = 'shopee', measured_at, vdo_view, clicks, orders, gmv, atc, atc_value, visits, ads_spend, likes, comments, saves, shares, impressions } = m;

        // Calculate engagement_rate when we have enough data
        let engagement_rate: string | null = null;
        if (likes != null && comments != null && shares != null) {
          const numerator = Number(likes) + Number(comments) + Number(shares);
          const denominator = impressions != null ? Number(impressions) : (vdo_view != null ? Number(vdo_view) : null);
          if (denominator && denominator > 0) {
            engagement_rate = (numerator / denominator).toFixed(6);
          }
        }

        await prisma.placement_metrics.deleteMany({
          where: { placement_id: id, channel, period_days: 30 },
        });
        await prisma.placement_metrics.create({
          data: {
            placement_id: id,
            channel,
            period_days: 30,
            measured_at: measured_at ? new Date(measured_at) : null,
            visits: visits != null ? Number(visits) : null,
            atc: atc != null ? Number(atc) : null,
            atc_value: atc_value != null ? String(atc_value) : null,
            gmv: gmv != null ? String(gmv) : null,
            orders: orders != null ? Number(orders) : null,
            vdo_view: vdo_view != null ? Number(vdo_view) : null,
            clicks: clicks != null ? Number(clicks) : null,
            ads_spend: ads_spend != null ? String(ads_spend) : null,
            likes: likes != null ? Number(likes) : null,
            comments: comments != null ? Number(comments) : null,
            saves: saves != null ? Number(saves) : null,
            shares: shares != null ? Number(shares) : null,
            impressions: impressions != null ? Number(impressions) : null,
            engagement_rate,
            tracking_period: 'recent_30_days',
          },
        });
      }
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to update performance' }, 500);
  }
});

app.post('/', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const b = await c.req.json();

    if (!b.placement_type) return c.json({ error: 'placement_type required' }, 400);
    // target_pub_date is required for planned placements so the calendar/schedule has a date to anchor on
    if (!b.target_pub_date) return c.json({ error: 'target_pub_date required' }, 400);

    // Resolve brand_id: use body value or auto-select if user has exactly one brand
    const brand_id = b.brand_id ? Number(b.brand_id) : user.brandIds[0];
    if (!brand_id) return c.json({ error: 'brand_id required' }, 400);

    // Non-admin must own the brand
    if (user.role !== 'admin' && !user.brandIds.includes(brand_id)) {
      return c.json({ error: 'No access to this brand' }, 403);
    }

    const priceFields =
      b.payment_type === 'free' || b.payment_type === 'barter'
        ? { final_price: null, pay_amount: null }
        : {
            final_price: b.final_price !== '' && b.final_price != null ? String(b.final_price) : null,
            pay_amount: null,
          };

    const placement = await prisma.placements.create({
      data: {
        brand_id,
        placement_type: b.placement_type,
        kol_id: b.kol_id ? Number(b.kol_id) : null,
        platform_id: b.platform_id ? Number(b.platform_id) : null,
        product_id: b.placement_type === 'online' && b.product_id ? Number(b.product_id) : null,
        store_id: b.placement_type === 'offline_shop' && b.store_id ? Number(b.store_id) : null,
        campaign_id: b.campaign_id ? Number(b.campaign_id) : null,
        person_in_charge_id: user.id,
        created_by_id: user.id,
        payment_type: b.payment_type ?? 'paid',
        ...priceFields,
        ads_cost: b.ads_cost !== '' && b.ads_cost != null ? String(b.ads_cost) : null,
        follower_at_time: b.follower_at_time ? Number(b.follower_at_time) : null,
        target_pub_date: b.target_pub_date ? new Date(b.target_pub_date) : null,
        notes: b.notes?.trim() || null,
        status: 'planned',
      },
    });

    return c.json(placement, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to create placement' }, 500);
  }
});

// ─── Reposts ─────────────────────────────────────────────────────────────

app.get('/:id/reposts', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const placementId = Number(c.req.param('id'));

    if (user.role !== 'admin') {
      const p = await prisma.placements.findUnique({ where: { id: placementId }, select: { brand_id: true } });
      if (!p || !user.brandIds.includes(p.brand_id)) return c.json({ error: 'Not found' }, 404);
    }

    const reposts = await prisma.placement_reposts.findMany({
      where: { placement_id: placementId },
      orderBy: { round_number: 'asc' },
      include: { placement_metrics: { orderBy: { measured_at: 'desc' } } },
    });

    return c.json(reposts);
  } catch (err) { console.error(err); return c.json({ error: 'failed' }, 500); }
});

app.post('/:id/reposts', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const placementId = Number(c.req.param('id'));

    if (user.role !== 'admin') {
      const p = await prisma.placements.findUnique({ where: { id: placementId }, select: { brand_id: true } });
      if (!p || !user.brandIds.includes(p.brand_id)) return c.json({ error: 'Not found' }, 404);
    }

    const { posted_by, post_url, posted_at } = await c.req.json() as {
      posted_by: 'brand' | 'kol'; post_url?: string; posted_at?: string;
    };
    if (!posted_by || !['brand', 'kol'].includes(posted_by))
      return c.json({ error: 'posted_by must be brand or kol' }, 400);

    const last = await prisma.placement_reposts.findFirst({
      where: { placement_id: placementId }, orderBy: { round_number: 'desc' }, select: { round_number: true },
    });
    const round_number = (last?.round_number ?? 0) + 1;

    const repost = await prisma.placement_reposts.create({
      data: {
        placement_id: placementId, round_number, posted_by,
        post_url: post_url?.trim() || null,
        posted_at: posted_at ? new Date(posted_at) : null,
      },
    });
    return c.json(repost, 201);
  } catch (err) { console.error(err); return c.json({ error: 'failed' }, 500); }
});

app.patch('/:id/reposts/:repostId', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const placementId = Number(c.req.param('id'));
    const repostId = Number(c.req.param('repostId'));

    if (user.role !== 'admin') {
      const p = await prisma.placements.findUnique({ where: { id: placementId }, select: { brand_id: true } });
      if (!p || !user.brandIds.includes(p.brand_id)) return c.json({ error: 'Not found' }, 404);
    }

    const { posted_by, post_url, posted_at } = await c.req.json() as {
      posted_by?: 'brand' | 'kol'; post_url?: string; posted_at?: string | null;
    };

    const updated = await prisma.placement_reposts.update({
      where: { id: repostId, placement_id: placementId },
      data: {
        ...(posted_by ? { posted_by } : {}),
        ...(post_url !== undefined ? { post_url: post_url?.trim() || null } : {}),
        ...(posted_at !== undefined ? { posted_at: posted_at ? new Date(posted_at) : null } : {}),
      },
    });
    return c.json(updated);
  } catch (err) { console.error(err); return c.json({ error: 'failed' }, 500); }
});

app.delete('/:id/reposts/:repostId', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const placementId = Number(c.req.param('id'));
    const repostId = Number(c.req.param('repostId'));

    if (user.role !== 'admin') {
      const p = await prisma.placements.findUnique({ where: { id: placementId }, select: { brand_id: true } });
      if (!p || !user.brandIds.includes(p.brand_id)) return c.json({ error: 'Not found' }, 404);
    }

    await prisma.placement_reposts.delete({ where: { id: repostId, placement_id: placementId } });
    return c.json({ ok: true });
  } catch (err) { console.error(err); return c.json({ error: 'failed' }, 500); }
});

app.post('/:id/reposts/:repostId/metrics', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const placementId = Number(c.req.param('id'));
    const repostId = Number(c.req.param('repostId'));

    if (user.role !== 'admin') {
      const p = await prisma.placements.findUnique({ where: { id: placementId }, select: { brand_id: true } });
      if (!p || !user.brandIds.includes(p.brand_id)) return c.json({ error: 'Not found' }, 404);
    }

    const repost = await prisma.placement_reposts.findUnique({ where: { id: repostId, placement_id: placementId } });
    if (!repost) return c.json({ error: 'Repost not found' }, 404);

    const { channel, measured_at, vdo_view, likes, comments, saves, shares } = await c.req.json() as {
      channel: string; measured_at?: string;
      vdo_view?: number | null; likes?: number | null;
      comments?: number | null; saves?: number | null; shares?: number | null;
    };
    if (!channel) return c.json({ error: 'channel is required' }, 400);

    const today = new Date().toISOString().slice(0, 10);
    const measuredDate = new Date(measured_at ?? today);

    // replace existing metric for this repost+channel (no unique index on repost_id yet so use deleteMany+create)
    await prisma.placement_metrics.deleteMany({ where: { repost_id: repostId, channel } });
    const metric = await prisma.placement_metrics.create({
      data: {
        placement_id: placementId, repost_id: repostId,
        channel, period_days: 0, measured_at: measuredDate,
        is_automated: false,
        vdo_view: vdo_view ?? null, likes: likes ?? null,
        comments: comments ?? null, saves: saves ?? null, shares: shares ?? null,
      },
    });
    return c.json(metric, 201);
  } catch (err) { console.error(err); return c.json({ error: 'failed' }, 500); }
});

export default app;
