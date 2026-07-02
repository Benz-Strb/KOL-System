import { Hono } from 'hono';
import { Prisma, type PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { requireAuth, requireRole, type AuthUser } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

function buildDashboardBrandFilter(role: string, brandIds: number[], brand_id?: string) {
  const bid = brand_id ? Number(brand_id) : null;
  const seesAll = role === 'admin';
  if (seesAll) return bid ? { brand_id: bid } : {};
  return { brand_id: bid && brandIds.includes(bid) ? bid : { in: brandIds } };
}

const EMPTY_RESPONSE = {
  summary: {
    total_placements: 0,
    total_kol_count: 0,
    posted_count: 0,
    planned_count: 0,
    cancelled_count: 0,
    total_spend: 0,
    total_ads_cost: 0,
    total_gmv: 0,
    total_orders: 0,
    total_visits: 0,
    total_atc: 0,
    roi: null as number | null,
  },
  channelBreakdown: [] as {
    channel: string; gmv: number; orders: number; visits: number; atc: number;
    byCampaign: { campaign_id: number | null; code: string | null; label: string | null; gmv: number }[];
  }[],
  monthlyTrend: [] as MonthlyTrendRow[],
  categoryBreakdown: [] as CategoryRow[],
  topKolsByGmv: [] as KolRankRow[],
  topKolsByRoi: [] as KolRankRow[],
  kolValueList: [] as KolRankRow[],
  campaignTrend: [] as {
    campaign_id: number | null;
    code: string | null;
    label: string | null;
    start_date: string | null;
    placement_count: number;
    gmv: number;
    spend: number;
    orders: number;
    visits: number;
  }[],
  paymentTypeBreakdown: [] as PaymentTypeRow[],
  tierBreakdown: [] as TierRow[],
  platformBreakdown: [] as PlatformRow[],
  kolPaymentBreakdown: [] as { kol_id: number; payment_type: string; placement_count: number; total_gmv: number; total_spend: number }[],
  placementDetail: [] as PlacementDetailRow[],
};

type PaymentTypeRow = {
  payment_type: string;
  placement_count: number;
  total_gmv: number;
  avg_gmv: number;
  total_spend: number;
  total_orders: number;
};

type TierRow = {
  tier_id: number;
  tier_name: string;
  kol_count: number;
  placement_count: number;
  total_gmv: number;
  avg_gmv_per_kol: number;
  total_orders: number;
  total_spend: number;
};

type PlatformRow = {
  platform_id: number;
  platform_name: string;
  placement_count: number;
  kol_count: number;
  total_gmv: number;
  total_orders: number;
  total_spend: number;
  total_ads_cost: number;
};

// monthly GMV/orders/placement trend (A) — the only "over time" view; campaign
// bars are a noisy proxy with 36 campaigns
type MonthlyTrendRow = {
  month: string;        // 'YYYY-MM'
  placement_count: number;
  gmv: number;
  orders: number;
  spend: number;
};

// GMV grouped by the KOL's content category (C) — category was filter-only before
type CategoryRow = {
  category_id: number;
  category_name: string;
  kol_count: number;
  placement_count: number;
  gmv: number;
  orders: number;
  spend: number;
  ads_cost: number;
  visits: number;
};

type PlacementDetailRow = {
  id: number;
  brand_name: string | null;
  campaign_code: string | null;
  handle: string | null;
  gen_name: string | null;
  platform_name: string | null;
  follower_count: number | null;
  tier_name: string | null;
  category_name: string | null;
  model_code: string | null;
  store_name: string | null;
  store_branch: string | null;
  placement_type: string;
  payment_type: string;
  final_price: number | null;
  pay_amount: number | null;
  ads_cost: number | null;
  target_pub_date: string | null;
  publication_date: string | null;
  status: string;
  gmv: number;
  orders: number;
  visits: number;
  atc: number;
  person_in_charge: string | null;
  post_url: string | null;
};

// Marketing dashboard (privacy-scoped: no per-KOL data) — KPI summary +
// GMV-contribution donuts. Shares query patterns with buildDashboardOverview /
// buildProductDashboard but exposes only aggregates.
type MarketingSummary = {
  total_gmv: number; kol_cost: number; ads_cost: number; total_cost: number;
  visits_shopee: number; visits_lazada: number; total_visits: number;
};
type GmvSlice = { platform_id?: number; category_id?: number | null; canonical_id?: number;
  platform_name?: string; category_name?: string | null; model_code?: string | null; gmv: number };

const EMPTY_MARKETING = {
  summary: { total_gmv: 0, kol_cost: 0, ads_cost: 0, total_cost: 0, visits_shopee: 0, visits_lazada: 0, total_visits: 0 },
  byProductCategory: [] as { category_id: number | null; category_name: string | null; gmv: number; total_cost: number; visits: number }[],
  byProductSku: [] as { canonical_id: number; model_code: string | null; gmv: number; total_cost: number }[],
};

// barter-vs-paid is most useful in this fixed order; alphabetical (from a
// plain GROUP BY) would read barter/free/paid which isn't how anyone thinks
// about it
const PAYMENT_TYPE_ORDER: Record<string, number> = { paid: 0, barter: 1, free: 2 };

type KolRankRow = {
  kol_id: number;
  handle: string;
  gen_name: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  follower_count: number | null;
  kol_tier_id: number | null;
  tier_name: string | null;
  placement_count: number;
  total_gmv: number;
  total_spend: number;
  total_orders: number;
  roi: number | null;
  byChannel: { channel: string; gmv: number }[];
};

type ProductRankRow = {
  canonical_id: number;
  model_code: string;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
  placement_count: number;
  total_gmv: number;
  total_orders: number;
  total_spend: number;
  total_ads_cost: number;
  total_visits: number;
};

type ProductKolRow = {
  kol_id: number;
  handle: string | null;
  gen_name: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  follower_count: number | null;
  platform_name: string | null;
  placement_count: number;
  total_gmv: number;
  total_orders: number;
};

// Shared by GET / (JSON) and GET /export (.xlsx) — same data, two renderings.
async function buildDashboardOverview(prisma: PrismaClient, user: AuthUser, query: {
  brand_id?: string; campaign_id?: string; category_id?: string; date_from?: string; date_to?: string;
}) {
  {
    const { brand_id, campaign_id, category_id, date_from, date_to } = query;

    const brandFilter = buildDashboardBrandFilter(user.role, user.brandIds, brand_id);

    const where = {
      ...brandFilter,
      ...(campaign_id === 'none' ? { campaign_id: null } : campaign_id ? { campaign_id: Number(campaign_id) } : {}),
      ...(category_id ? { kols: { content_category_id: Number(category_id) } } : {}),
      ...(date_from || date_to ? {
        publication_date: {
          ...(date_from ? { gte: new Date(date_from) } : {}),
          ...(date_to ? { lte: new Date(date_to) } : {}),
        },
      } : {}),
    };

    const matched = await prisma.placements.findMany({
      where,
      select: { id: true, final_price: true, pay_amount: true, ads_cost: true, status: true, kol_id: true },
    });

    if (matched.length === 0) {
      return EMPTY_RESPONSE;
    }

    const ids = matched.map(p => p.id);

    let totalSpend = 0;
    let totalAdsCost = 0;
    let postedCount = 0;
    let plannedCount = 0;
    let cancelledCount = 0;
    const kolIds = new Set<number>();
    for (const p of matched) {
      totalSpend += Number(p.pay_amount ?? p.final_price ?? 0);
      totalAdsCost += Number(p.ads_cost ?? 0);
      if (p.status === 'posted') postedCount++;
      else if (p.status === 'planned') plannedCount++;
      else if (p.status === 'cancelled') cancelledCount++;
      if (p.kol_id != null) kolIds.add(p.kol_id);
    }
    const totalKolCount = kolIds.size;

    const [gmvRow] = await prisma.$queryRaw<{ total_gmv: number; total_orders: number; total_visits: number; total_atc: number }[]>`
      SELECT
        COALESCE(SUM(gmv::numeric), 0)::float AS total_gmv,
        COALESCE(SUM(orders), 0)::int          AS total_orders,
        COALESCE(SUM(visits), 0)::int          AS total_visits,
        COALESCE(SUM(atc), 0)::int             AS total_atc
      FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)})
    `;

    const channelBreakdown = await prisma.$queryRaw<{ channel: string; gmv: number; orders: number; visits: number; atc: number }[]>`
      SELECT
        channel,
        COALESCE(SUM(gmv::numeric), 0)::float AS gmv,
        COALESCE(SUM(orders), 0)::int          AS orders,
        COALESCE(SUM(visits), 0)::int          AS visits,
        COALESCE(SUM(atc), 0)::int             AS atc
      FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)})
      GROUP BY channel
      ORDER BY gmv DESC
    `;

    const channelCampaignBreakdown = await prisma.$queryRaw<{
      channel: string;
      campaign_id: number | null;
      code: string | null;
      label: string | null;
      gmv: number;
    }[]>`
      SELECT
        pm.channel,
        c.id                                      AS campaign_id,
        c.code,
        c.label,
        COALESCE(SUM(pm.gmv::numeric), 0)::float  AS gmv
      FROM placement_metrics pm
      JOIN placements p ON p.id = pm.placement_id
      LEFT JOIN campaigns c ON p.campaign_id = c.id
      WHERE pm.placement_id IN (${Prisma.join(ids)})
      GROUP BY pm.channel, c.id, c.code, c.label
      ORDER BY pm.channel, gmv DESC
    `;

    const byCampaignMap = new Map<string, { campaign_id: number | null; code: string | null; label: string | null; gmv: number }[]>();
    for (const row of channelCampaignBreakdown) {
      const arr = byCampaignMap.get(row.channel) ?? [];
      arr.push({ campaign_id: row.campaign_id, code: row.code, label: row.label, gmv: row.gmv });
      byCampaignMap.set(row.channel, arr);
    }
    const channelBreakdownWithCampaigns = channelBreakdown.map(ch => ({
      ...ch,
      byCampaign: byCampaignMap.get(ch.channel) ?? [],
    }));

    // per-KOL aggregate (spend computed from placements directly to avoid
    // double-counting against the one-to-many placement_metrics join)
    const kolAgg = await prisma.$queryRaw<{
      kol_id: number;
      handle: string;
      gen_name: string | null;
      profile_url: string | null;
      avatar_url: string | null;
      follower_count: number | null;
      kol_tier_id: number | null;
      tier_name: string | null;
      placement_count: number;
      total_gmv: number;
      total_spend: number;
      total_orders: number;
    }[]>`
      WITH placement_spend AS (
        SELECT id, kol_id, COALESCE(pay_amount, final_price, 0)::numeric AS spend
        FROM placements
        WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        k.id::int                                AS kol_id,
        kp.handle,
        k.gen_name,
        kp.profile_url,
        kp.avatar_url,
        kp.follower_count,
        kp.kol_tier_id,
        kt.name                                  AS tier_name,
        COUNT(DISTINCT ps.id)::int                AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float           AS total_gmv,
        COALESCE(SUM(ps.spend), 0)::float         AS total_spend,
        COALESCE(SUM(ma.orders), 0)::int          AS total_orders
      FROM placement_spend ps
      JOIN kols k ON ps.kol_id = k.id
      JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
      LEFT JOIN kol_tiers kt ON kt.id = kp.kol_tier_id
      LEFT JOIN metric_agg ma ON ma.placement_id = ps.id
      GROUP BY k.id, kp.handle, k.gen_name, kp.profile_url, kp.avatar_url, kp.follower_count, kp.kol_tier_id, kt.name
    `;

    // barter vs paid (vs free) — average GMV per post by payment type
    const paymentTypeAgg = await prisma.$queryRaw<{ payment_type: string; placement_count: number; total_gmv: number; total_spend: number; total_orders: number }[]>`
      WITH metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        p.payment_type,
        COUNT(DISTINCT p.id)::int                                        AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float                                  AS total_gmv,
        COALESCE(SUM(COALESCE(p.pay_amount, p.final_price, 0)), 0)::float AS total_spend,
        COALESCE(SUM(ma.orders), 0)::int                                 AS total_orders
      FROM placements p
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY p.payment_type
    `;
    const paymentTypeBreakdown: PaymentTypeRow[] = paymentTypeAgg
      .map(r => ({
        payment_type: r.payment_type,
        placement_count: r.placement_count,
        total_gmv: r.total_gmv,
        avg_gmv: r.placement_count > 0 ? r.total_gmv / r.placement_count : 0,
        total_spend: r.total_spend,
        total_orders: r.total_orders,
      }))
      .sort((a, b) => (PAYMENT_TYPE_ORDER[a.payment_type] ?? 99) - (PAYMENT_TYPE_ORDER[b.payment_type] ?? 99));

    // follower-tier comparison — average GMV per KOL, grouped by the same
    // tier the DB trigger already assigns from follower_count (kol_tiers)
    const tierMap = new Map<number, TierRow>();
    for (const r of kolAgg) {
      if (r.kol_tier_id == null) continue;
      const entry = tierMap.get(r.kol_tier_id) ?? {
        tier_id: r.kol_tier_id,
        tier_name: r.tier_name ?? String(r.kol_tier_id),
        kol_count: 0,
        placement_count: 0,
        total_gmv: 0,
        avg_gmv_per_kol: 0,
        total_orders: 0,
        total_spend: 0,
      };
      entry.kol_count += 1;
      entry.placement_count += r.placement_count;
      entry.total_gmv += r.total_gmv;
      entry.total_orders += r.total_orders;
      entry.total_spend += r.total_spend;
      tierMap.set(r.kol_tier_id, entry);
    }
    const tierBreakdown: TierRow[] = [...tierMap.values()]
      .map(t => ({ ...t, avg_gmv_per_kol: t.kol_count > 0 ? t.total_gmv / t.kol_count : 0 }))
      .sort((a, b) => a.tier_id - b.tier_id);

    // hiring distribution by KOL platform (Facebook/Instagram/TikTok/YouTube etc.)
    // — groups by placements.platform_id (the channel the KOL posts on), not
    // placement_metrics.channel (the sales channel that tracks actual GMV)
    const platformAgg = await prisma.$queryRaw<{ platform_id: number; platform_name: string; placement_count: number; kol_count: number; total_gmv: number; total_orders: number; total_spend: number; total_ads_cost: number }[]>`
      WITH placement_spend AS (
        SELECT id,
               COALESCE(pay_amount, final_price, 0)::numeric AS spend,
               COALESCE(ads_cost, 0)::numeric                AS ads_cost
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        pt.id::int                                  AS platform_id,
        pt.name                                     AS platform_name,
        COUNT(DISTINCT p.id)::int                   AS placement_count,
        COUNT(DISTINCT p.kol_id)::int               AS kol_count,
        COALESCE(SUM(ma.gmv), 0)::float             AS total_gmv,
        COALESCE(SUM(ma.orders), 0)::int            AS total_orders,
        COALESCE(SUM(ps.spend), 0)::float           AS total_spend,
        COALESCE(SUM(ps.ads_cost), 0)::float        AS total_ads_cost
      FROM placements p
      JOIN platforms pt ON pt.id = p.platform_id
      LEFT JOIN placement_spend ps ON ps.id = p.id
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY pt.id, pt.name
      ORDER BY placement_count DESC
    `;
    const platformBreakdown: PlatformRow[] = platformAgg;

    // per-KOL GMV split by sales channel (shopee/lazada/website/tiktok/youtube/lamon8)
    // — same `channel` concept as the channelBreakdown donut above, just scoped per KOL
    const kolChannelBreakdown = await prisma.$queryRaw<{
      kol_id: number;
      channel: string;
      gmv: number;
    }[]>`
      SELECT
        p.kol_id::int                             AS kol_id,
        pm.channel,
        COALESCE(SUM(pm.gmv::numeric), 0)::float  AS gmv
      FROM placements p
      JOIN placement_metrics pm ON pm.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)}) AND p.kol_id IS NOT NULL
      GROUP BY p.kol_id, pm.channel
    `;

    const byChannelMap = new Map<number, { channel: string; gmv: number }[]>();
    for (const row of kolChannelBreakdown) {
      const arr = byChannelMap.get(row.kol_id) ?? [];
      arr.push({ channel: row.channel, gmv: row.gmv });
      byChannelMap.set(row.kol_id, arr);
    }
    for (const arr of byChannelMap.values()) arr.sort((a, b) => b.gmv - a.gmv);

    const kolRows: KolRankRow[] = kolAgg.map(r => ({
      ...r,
      roi: r.total_spend > 0 ? r.total_gmv / r.total_spend : null,
      byChannel: byChannelMap.get(r.kol_id) ?? [],
    }));

    // per-KOL per-payment-type GMV — used by the comparison tool tab
    const kolPaymentBreakdown = await prisma.$queryRaw<{
      kol_id: number;
      payment_type: string;
      placement_count: number;
      total_gmv: number;
      total_spend: number;
    }[]>`
      WITH metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        p.kol_id::int                                                    AS kol_id,
        p.payment_type,
        COUNT(DISTINCT p.id)::int                                        AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float                                  AS total_gmv,
        COALESCE(SUM(COALESCE(p.pay_amount, p.final_price, 0)), 0)::float AS total_spend
      FROM placements p
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)}) AND p.kol_id IS NOT NULL
      GROUP BY p.kol_id, p.payment_type
      ORDER BY total_gmv DESC
    `;

    const topKolsByGmv = [...kolRows].sort((a, b) => b.total_gmv - a.total_gmv).slice(0, 10);
    const topKolsByRoi = kolRows
      .filter(k => k.roi != null)
      .sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))
      .slice(0, 10);

    const campaignTrend = await prisma.$queryRaw<{
      campaign_id: number | null;
      code: string | null;
      label: string | null;
      start_date: string | null;
      placement_count: number;
      gmv: number;
      spend: number;
      orders: number;
      visits: number;
    }[]>`
      SELECT
        c.id                                                       AS campaign_id,
        c.code,
        c.label,
        c.start_date,
        COUNT(DISTINCT p.id)::int                                  AS placement_count,
        COALESCE(SUM(pm.gmv::numeric), 0)::float                   AS gmv,
        COALESCE(SUM(COALESCE(p.pay_amount, p.final_price, 0)), 0)::float AS spend,
        COALESCE(SUM(pm.orders), 0)::int                           AS orders,
        COALESCE(SUM(pm.visits), 0)::int                           AS visits
      FROM placements p
      LEFT JOIN campaigns c ON p.campaign_id = c.id
      LEFT JOIN (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders, SUM(visits) AS visits
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      ) pm ON pm.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY c.id, c.code, c.label, c.start_date
      ORDER BY c.start_date ASC NULLS LAST
    `;

    // monthly trend (A) — group by publication_date month; placements without a
    // publication_date are dropped (no time bucket to put them in)
    const monthlyTrend = await prisma.$queryRaw<MonthlyTrendRow[]>`
      WITH placement_spend AS (
        SELECT id, COALESCE(pay_amount, final_price, 0)::numeric AS spend
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        to_char(p.publication_date, 'YYYY-MM')  AS month,
        COUNT(DISTINCT p.id)::int               AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float         AS gmv,
        COALESCE(SUM(ma.orders), 0)::int        AS orders,
        COALESCE(SUM(ps.spend), 0)::float       AS spend
      FROM placements p
      LEFT JOIN placement_spend ps ON ps.id = p.id
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)}) AND p.publication_date IS NOT NULL
      GROUP BY month
      ORDER BY month ASC
    `;

    // GMV by content category (C) — categories live on the KOL, not the placement
    const categoryBreakdown = await prisma.$queryRaw<CategoryRow[]>`
      WITH placement_spend AS (
        SELECT id,
               COALESCE(pay_amount, final_price, 0)::numeric AS spend,
               COALESCE(ads_cost, 0)::numeric                AS ads_cost
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders, SUM(visits) AS visits
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        cc.id::int                              AS category_id,
        cc.name                                 AS category_name,
        COUNT(DISTINCT p.kol_id)::int           AS kol_count,
        COUNT(DISTINCT p.id)::int               AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float         AS gmv,
        COALESCE(SUM(ma.orders), 0)::int        AS orders,
        COALESCE(SUM(ps.spend), 0)::float       AS spend,
        COALESCE(SUM(ps.ads_cost), 0)::float    AS ads_cost,
        COALESCE(SUM(ma.visits), 0)::int        AS visits
      FROM placements p
      JOIN kols k ON k.id = p.kol_id
      JOIN content_categories cc ON cc.id = k.content_category_id
      LEFT JOIN placement_spend ps ON ps.id = p.id
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY cc.id, cc.name
      ORDER BY gmv DESC
    `;

    const totalSpendWithAds = totalSpend + totalAdsCost;

    // placement-level detail for raw-data export sheet (§3.1)
    const placementDetail = await prisma.$queryRaw<PlacementDetailRow[]>`
      WITH metric_agg AS (
        SELECT placement_id,
               SUM(gmv::numeric)  AS gmv,
               SUM(orders)        AS orders,
               SUM(visits)        AS visits,
               SUM(atc)           AS atc
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        p.id,
        b.name                        AS brand_name,
        c.code                        AS campaign_code,
        kp.handle,
        k.gen_name,
        pt.name                       AS platform_name,
        kp.follower_count,
        kt.name                       AS tier_name,
        cc.name                       AS category_name,
        pr.model_code,
        s.name                        AS store_name,
        s.branch                      AS store_branch,
        p.placement_type,
        p.payment_type,
        p.final_price::float          AS final_price,
        p.pay_amount::float           AS pay_amount,
        p.ads_cost::float             AS ads_cost,
        p.target_pub_date::text       AS target_pub_date,
        p.publication_date::text      AS publication_date,
        p.status,
        COALESCE(ma.gmv, 0)::float    AS gmv,
        COALESCE(ma.orders, 0)::int   AS orders,
        COALESCE(ma.visits, 0)::int   AS visits,
        COALESCE(ma.atc, 0)::int      AS atc,
        u.full_name                   AS person_in_charge,
        p.post_url
      FROM placements p
      LEFT JOIN brands b             ON b.id = p.brand_id
      LEFT JOIN campaigns c          ON c.id = p.campaign_id
      LEFT JOIN kols k               ON k.id = p.kol_id
      LEFT JOIN kol_platforms kp     ON kp.kol_id = k.id AND kp.is_primary = true
      LEFT JOIN kol_tiers kt         ON kt.id = kp.kol_tier_id
      LEFT JOIN content_categories cc ON cc.id = k.content_category_id
      LEFT JOIN platforms pt         ON pt.id = p.platform_id
      LEFT JOIN products pr          ON pr.id = p.product_id
      LEFT JOIN stores s             ON s.id = p.store_id
      LEFT JOIN users u              ON u.id = p.person_in_charge_id
      LEFT JOIN metric_agg ma        ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      ORDER BY p.publication_date DESC NULLS LAST, p.id DESC
    `;

    return {
      summary: {
        total_placements: matched.length,
        total_kol_count: totalKolCount,
        posted_count: postedCount,
        planned_count: plannedCount,
        cancelled_count: cancelledCount,
        total_spend: totalSpend,
        total_ads_cost: totalAdsCost,
        total_gmv: gmvRow.total_gmv,
        total_orders: gmvRow.total_orders,
        total_visits: gmvRow.total_visits,
        total_atc: gmvRow.total_atc,
        roi: totalSpendWithAds > 0 ? gmvRow.total_gmv / totalSpendWithAds : null,
      },
      channelBreakdown: channelBreakdownWithCampaigns,
      monthlyTrend,
      categoryBreakdown,
      topKolsByGmv,
      topKolsByRoi,
      kolValueList: kolRows,
      campaignTrend,
      paymentTypeBreakdown,
      tierBreakdown,
      platformBreakdown,
      kolPaymentBreakdown,
      placementDetail,
    };
  }
}

app.get('/', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const result = await buildDashboardOverview(prisma, user, {
      brand_id: c.req.query('brand_id'),
      campaign_id: c.req.query('campaign_id'),
      category_id: c.req.query('category_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load dashboard overview' }, 500);
  }
});

const EXPORT_CHANNEL_LABEL: Record<string, string> = {
  shopee: 'Shopee', lazada: 'Lazada', website: 'Website', tiktok: 'TikTok', youtube: 'YouTube', lamon8: 'Lemon8',
};
const EXPORT_PAYMENT_LABEL: Record<string, string> = { paid: 'จ่ายเงิน', barter: 'Barter', free: 'Free' };

// ─── Export helpers ──────────────────────────────────────────────────────────

const CHANNEL_EXPORT_COLS = ['shopee', 'lazada', 'website', 'tiktok', 'youtube', 'lamon8'] as const;

// ─── Trilingual i18n for server-side .xlsx exports ───────────────────────────

type DashExportLang = 'th' | 'en' | 'zh';
type SumFmt = 'thb' | 'int' | 'roi' | 'str';

interface DashI18N {
  tsLocale: string;
  metaTitle: string; metaDate: string; metaBrand: string; metaCampaign: string;
  metaCategory: string; metaDateRange: string; metaColItem: string; metaColValue: string;
  allBrands: string; noCampaign: string; all: string; dateTo: string; noCampaignValue: string;
  s1: string; s2: string; s3: string; s4: string; s5: string;
  s6: string; s7: string; s8: string; s9: string; s10: string;
  sum: [string, SumFmt][];
  h2: string[]; h3: string[]; h4: string[]; h5: string[];
  h6: string[]; h7: string[]; h8: string[]; h9: string[]; h10: string[];
  payPaid: string;
}

interface ProdI18N {
  tsLocale: string;
  metaTitle: string; metaDate: string; metaBrand: string; metaCampaign: string;
  metaCategory: string; metaDateRange: string; metaColItem: string; metaColValue: string;
  allBrands: string; noCampaign: string; all: string; dateTo: string; noCategory: string;
  s1: string; s2: string; s3: string;
  sum: [string, SumFmt][];
  h2: string[]; h3: string[];
}

const DASH_EXPORT_I18N: Record<DashExportLang, DashI18N> = {
  th: {
    tsLocale: 'th-TH',
    metaTitle: 'รายงาน Dashboard — KOL Performance',
    metaDate: 'วันที่ export', metaBrand: 'แบรนด์', metaCampaign: 'แคมเปญ',
    metaCategory: 'หมวดคอนเทนต์', metaDateRange: 'ช่วงวันที่',
    metaColItem: 'รายการ', metaColValue: 'ค่า',
    allBrands: 'ทุกแบรนด์', noCampaign: 'ทั้งหมด', all: 'ทั้งหมด', dateTo: 'ถึง', noCampaignValue: 'ไม่มีแคมเปญ',
    s1: 'สรุป', s2: 'แยกตามช่องทาง', s3: 'Trend รายเดือน', s4: 'แยกตามหมวดคอนเทนต์',
    s5: 'Ranking KOL (GMV)', s6: 'Trend ต่อแคมเปญ', s7: 'Barter vs จ่ายเงิน',
    s8: 'เทียบตาม Tier', s9: 'แยกตาม Platform', s10: 'ข้อมูลดิบ (Placement)',
    sum: [
      ['Placement ทั้งหมด', 'int'], ['โพสต์แล้ว', 'int'], ['วางแผนไว้', 'int'], ['ยกเลิก', 'int'],
      ['% โพสต์แล้ว', 'str'], ['จำนวน KOL ที่จ้าง', 'int'],
      ['ค่าใช้จ่าย KOL (บาท)', 'thb'], ['Ads Cost (บาท)', 'thb'], ['GMV รวม (บาท)', 'thb'],
      ['Orders รวม', 'int'], ['Visits รวม', 'int'], ['ATC รวม', 'int'],
      ['Conversion rate (Orders/Visits)', 'str'], ['ATC rate (ATC/Visits)', 'str'],
      ['AOV — GMV/Orders (บาท)', 'thb'], ['GMV เฉลี่ยต่อ Placement (บาท)', 'thb'],
      ['ROI (รวม Ads Cost)', 'roi'], ['ROI (ไม่รวม Ads Cost)', 'roi'],
    ],
    h2: ['ช่องทาง', 'GMV (บาท)', '% GMV', 'Orders', 'Visits', 'ATC', 'AOV (บาท)', 'Conversion (%)', 'ATC rate (%)'],
    h3: ['เดือน', 'Placement', 'GMV (บาท)', 'Orders', 'Spend (บาท)', 'ROI', 'AOV (บาท)', 'GMV/Placement (บาท)', 'GMV สะสม (บาท)'],
    h4: ['หมวดคอนเทนต์', 'จำนวน KOL', 'Placement', 'GMV (บาท)', '% GMV', 'Orders', 'Spend (บาท)', 'ROI', 'AOV (บาท)', 'avg GMV/KOL (บาท)'],
    h5: ['อันดับ', 'Handle', 'ชื่อ', 'Tier', 'Follower', 'Placement', 'GMV รวม (บาท)', 'GMV Shopee', 'GMV Lazada', 'GMV Website', 'GMV TikTok', 'GMV YouTube', 'GMV Lemon8', 'ค่าใช้จ่าย (บาท)', 'Orders', 'AOV (บาท)', 'GMV/Placement (บาท)', 'ROI', 'Profile URL'],
    h6: ['แคมเปญ', 'วันเริ่ม', 'Placement', 'GMV (บาท)', 'Spend (บาท)', 'Orders', 'ROI', 'AOV (บาท)', 'GMV/Placement (บาท)'],
    h7: ['ประเภทการจ่ายเงิน', 'Placement', 'GMV รวม (บาท)', '% GMV', 'GMV เฉลี่ย/โพสต์ (บาท)', 'Spend (บาท)', 'Orders', 'ROI'],
    h8: ['Tier', 'จำนวน KOL', 'Placement', 'GMV รวม (บาท)', 'GMV เฉลี่ย/KOL (บาท)', 'Orders', 'Spend (บาท)', 'ROI', 'avg Placement/KOL'],
    h9: ['Platform', 'Placement', '% Placement', 'จำนวน KOL', 'GMV รวม (บาท)', 'Orders', 'Spend (บาท)', 'AOV (บาท)', 'avg GMV/KOL (บาท)'],
    h10: ['ID', 'แบรนด์', 'แคมเปญ', 'Handle', 'ชื่อ KOL', 'Platform', 'Follower', 'Tier', 'หมวดคอนเทนต์', 'สินค้า', 'ห้าง', 'สาขา', 'ประเภท Placement', 'Payment type', 'ราคา (บาท)', 'จ่ายจริง (บาท)', 'Ads cost (บาท)', 'กำหนดโพสต์', 'วันโพสต์จริง', 'Status', 'GMV (บาท)', 'Orders', 'Visits', 'ATC', 'ROI', 'ผู้รับผิดชอบ', 'Post URL'],
    payPaid: 'จ่ายเงิน',
  },
  en: {
    tsLocale: 'en-US',
    metaTitle: 'Dashboard Report — KOL Performance',
    metaDate: 'Export date', metaBrand: 'Brand', metaCampaign: 'Campaign',
    metaCategory: 'Content category', metaDateRange: 'Date range',
    metaColItem: 'Item', metaColValue: 'Value',
    allBrands: 'All brands', noCampaign: 'All', all: 'All', dateTo: 'to', noCampaignValue: 'No campaign',
    s1: 'Summary', s2: 'By Channel', s3: 'Monthly Trend', s4: 'By Content Category',
    s5: 'KOL Ranking (GMV)', s6: 'Campaign Trend', s7: 'Barter vs Paid',
    s8: 'By Follower Tier', s9: 'By Platform', s10: 'Raw Data (Placement)',
    sum: [
      ['Total Placements', 'int'], ['Posted', 'int'], ['Planned', 'int'], ['Cancelled', 'int'],
      ['% Posted', 'str'], ['KOLs Hired', 'int'],
      ['KOL Spend (THB)', 'thb'], ['Ads Cost (THB)', 'thb'], ['Total GMV (THB)', 'thb'],
      ['Total Orders', 'int'], ['Total Visits', 'int'], ['Total ATC', 'int'],
      ['Conversion Rate (Orders/Visits)', 'str'], ['ATC Rate (ATC/Visits)', 'str'],
      ['AOV — GMV/Orders (THB)', 'thb'], ['Avg GMV per Placement (THB)', 'thb'],
      ['ROI (incl. Ads Cost)', 'roi'], ['ROI (excl. Ads Cost)', 'roi'],
    ],
    h2: ['Channel', 'GMV (THB)', '% GMV', 'Orders', 'Visits', 'ATC', 'AOV (THB)', 'Conversion (%)', 'ATC Rate (%)'],
    h3: ['Month', 'Placement', 'GMV (THB)', 'Orders', 'Spend (THB)', 'ROI', 'AOV (THB)', 'GMV/Placement (THB)', 'Cumulative GMV (THB)'],
    h4: ['Content Category', 'KOL Count', 'Placement', 'GMV (THB)', '% GMV', 'Orders', 'Spend (THB)', 'ROI', 'AOV (THB)', 'Avg GMV/KOL (THB)'],
    h5: ['Rank', 'Handle', 'Name', 'Tier', 'Follower', 'Placement', 'Total GMV (THB)', 'GMV Shopee', 'GMV Lazada', 'GMV Website', 'GMV TikTok', 'GMV YouTube', 'GMV Lemon8', 'Spend (THB)', 'Orders', 'AOV (THB)', 'GMV/Placement (THB)', 'ROI', 'Profile URL'],
    h6: ['Campaign', 'Start Date', 'Placement', 'GMV (THB)', 'Spend (THB)', 'Orders', 'ROI', 'AOV (THB)', 'GMV/Placement (THB)'],
    h7: ['Payment Type', 'Placement', 'Total GMV (THB)', '% GMV', 'Avg GMV/Post (THB)', 'Spend (THB)', 'Orders', 'ROI'],
    h8: ['Tier', 'KOL Count', 'Placement', 'Total GMV (THB)', 'Avg GMV/KOL (THB)', 'Orders', 'Spend (THB)', 'ROI', 'Avg Placement/KOL'],
    h9: ['Platform', 'Placement', '% Placement', 'KOL Count', 'Total GMV (THB)', 'Orders', 'Spend (THB)', 'AOV (THB)', 'Avg GMV/KOL (THB)'],
    h10: ['ID', 'Brand', 'Campaign', 'Handle', 'KOL Name', 'Platform', 'Follower', 'Tier', 'Content Category', 'Product', 'Store', 'Branch', 'Placement Type', 'Payment Type', 'Price (THB)', 'Actual Pay (THB)', 'Ads Cost (THB)', 'Planned Date', 'Posted Date', 'Status', 'GMV (THB)', 'Orders', 'Visits', 'ATC', 'ROI', 'Person in Charge', 'Post URL'],
    payPaid: 'Paid',
  },
  zh: {
    tsLocale: 'zh-CN',
    metaTitle: 'Dashboard 报告 — KOL 成效',
    metaDate: '导出日期', metaBrand: '品牌', metaCampaign: 'Campaign',
    metaCategory: '内容分类', metaDateRange: '日期范围',
    metaColItem: '项目', metaColValue: '值',
    allBrands: '所有品牌', noCampaign: '全部', all: '全部', dateTo: '至', noCampaignValue: '无 Campaign',
    s1: '摘要', s2: '按渠道', s3: '月度趋势', s4: '按内容分类',
    s5: 'KOL 排名 (GMV)', s6: 'Campaign 趋势', s7: 'Barter vs Paid',
    s8: '按 Follower Tier', s9: '按 Platform', s10: '原始数据 (Placement)',
    sum: [
      ['Placement 总数', 'int'], ['已发布', 'int'], ['已计划', 'int'], ['已取消', 'int'],
      ['% 已发布', 'str'], ['KOL 数量', 'int'],
      ['KOL 费用 (泰铢)', 'thb'], ['广告费用 (泰铢)', 'thb'], ['GMV 总计 (泰铢)', 'thb'],
      ['Orders 总计', 'int'], ['Visits 总计', 'int'], ['ATC 总计', 'int'],
      ['转化率 (Orders/Visits)', 'str'], ['ATC 率 (ATC/Visits)', 'str'],
      ['AOV — GMV/Orders (泰铢)', 'thb'], ['平均 GMV/Placement (泰铢)', 'thb'],
      ['ROI (含广告费)', 'roi'], ['ROI (不含广告费)', 'roi'],
    ],
    h2: ['渠道', 'GMV (泰铢)', '% GMV', 'Orders', 'Visits', 'ATC', 'AOV (泰铢)', '转化率 (%)', 'ATC 率 (%)'],
    h3: ['月份', 'Placement', 'GMV (泰铢)', 'Orders', 'Spend (泰铢)', 'ROI', 'AOV (泰铢)', 'GMV/Placement (泰铢)', '累计 GMV (泰铢)'],
    h4: ['内容分类', 'KOL 数', 'Placement', 'GMV (泰铢)', '% GMV', 'Orders', 'Spend (泰铢)', 'ROI', 'AOV (泰铢)', '均 GMV/KOL (泰铢)'],
    h5: ['排名', 'Handle', '姓名', 'Tier', 'Follower', 'Placement', 'GMV 总计 (泰铢)', 'GMV Shopee', 'GMV Lazada', 'GMV Website', 'GMV TikTok', 'GMV YouTube', 'GMV Lemon8', 'Spend (泰铢)', 'Orders', 'AOV (泰铢)', 'GMV/Placement (泰铢)', 'ROI', 'Profile URL'],
    h6: ['Campaign', '开始日期', 'Placement', 'GMV (泰铢)', 'Spend (泰铢)', 'Orders', 'ROI', 'AOV (泰铢)', 'GMV/Placement (泰铢)'],
    h7: ['付款类型', 'Placement', 'GMV 总计 (泰铢)', '% GMV', '均 GMV/发帖 (泰铢)', 'Spend (泰铢)', 'Orders', 'ROI'],
    h8: ['Tier', 'KOL 数', 'Placement', 'GMV 总计 (泰铢)', '均 GMV/KOL (泰铢)', 'Orders', 'Spend (泰铢)', 'ROI', '均 Placement/KOL'],
    h9: ['Platform', 'Placement', '% Placement', 'KOL 数', 'GMV 总计 (泰铢)', 'Orders', 'Spend (泰铢)', 'AOV (泰铢)', '均 GMV/KOL (泰铢)'],
    h10: ['ID', '品牌', 'Campaign', 'Handle', 'KOL 姓名', 'Platform', 'Follower', 'Tier', '内容分类', '产品', '商场', '分店', 'Placement 类型', '付款类型', '价格 (泰铢)', '实付金额 (泰铢)', '广告费 (泰铢)', '计划日期', '发布日期', 'Status', 'GMV (泰铢)', 'Orders', 'Visits', 'ATC', 'ROI', '负责人', 'Post URL'],
    payPaid: 'Paid',
  },
};

const PROD_EXPORT_I18N: Record<DashExportLang, ProdI18N> = {
  th: {
    tsLocale: 'th-TH',
    metaTitle: 'รายงาน Dashboard — Product Performance',
    metaDate: 'วันที่ export', metaBrand: 'แบรนด์', metaCampaign: 'แคมเปญ',
    metaCategory: 'หมวดคอนเทนต์', metaDateRange: 'ช่วงวันที่',
    metaColItem: 'รายการ', metaColValue: 'ค่า',
    allBrands: 'ทุกแบรนด์', noCampaign: 'ทั้งหมด', all: 'ทั้งหมด', dateTo: 'ถึง', noCategory: 'ไม่มีหมวดหมู่',
    s1: 'สรุปสินค้า', s2: 'Ranking สินค้า', s3: 'แยกตามหมวดหมู่สินค้า',
    sum: [
      ['จำนวนสินค้า', 'int'], ['Placement ทั้งหมด', 'int'], ['GMV รวม (บาท)', 'thb'],
      ['Orders รวม', 'int'], ['Spend (บาท)', 'thb'], ['ROI', 'roi'],
      ['AOV — GMV/Orders (บาท)', 'thb'], ['GMV เฉลี่ยต่อสินค้า (บาท)', 'thb'],
    ],
    h2: ['อันดับ', 'รุ่นสินค้า', 'หมวดหมู่', 'Placement', 'GMV (บาท)', '% GMV', 'Orders', 'Spend (บาท)', 'ROI', 'AOV (บาท)', 'GMV/Placement (บาท)'],
    h3: ['หมวดหมู่', 'จำนวนสินค้า', 'Placement', 'GMV (บาท)', '% GMV', 'Orders', 'Spend (บาท)', 'ROI', 'AOV (บาท)'],
  },
  en: {
    tsLocale: 'en-US',
    metaTitle: 'Dashboard Report — Product Performance',
    metaDate: 'Export date', metaBrand: 'Brand', metaCampaign: 'Campaign',
    metaCategory: 'Content category', metaDateRange: 'Date range',
    metaColItem: 'Item', metaColValue: 'Value',
    allBrands: 'All brands', noCampaign: 'All', all: 'All', dateTo: 'to', noCategory: 'No category',
    s1: 'Product Summary', s2: 'Product Ranking', s3: 'By Product Category',
    sum: [
      ['Product Count', 'int'], ['Total Placements', 'int'], ['Total GMV (THB)', 'thb'],
      ['Total Orders', 'int'], ['Spend (THB)', 'thb'], ['ROI', 'roi'],
      ['AOV — GMV/Orders (THB)', 'thb'], ['Avg GMV per Product (THB)', 'thb'],
    ],
    h2: ['Rank', 'Product', 'Category', 'Placement', 'GMV (THB)', '% GMV', 'Orders', 'Spend (THB)', 'ROI', 'AOV (THB)', 'GMV/Placement (THB)'],
    h3: ['Category', 'Product Count', 'Placement', 'GMV (THB)', '% GMV', 'Orders', 'Spend (THB)', 'ROI', 'AOV (THB)'],
  },
  zh: {
    tsLocale: 'zh-CN',
    metaTitle: 'Dashboard 报告 — 产品成效',
    metaDate: '导出日期', metaBrand: '品牌', metaCampaign: 'Campaign',
    metaCategory: '内容分类', metaDateRange: '日期范围',
    metaColItem: '项目', metaColValue: '值',
    allBrands: '所有品牌', noCampaign: '全部', all: '全部', dateTo: '至', noCategory: '无分类',
    s1: '产品摘要', s2: '产品排名', s3: '按产品分类',
    sum: [
      ['产品数量', 'int'], ['Placement 总数', 'int'], ['GMV 总计 (泰铢)', 'thb'],
      ['Orders 总计', 'int'], ['Spend (泰铢)', 'thb'], ['ROI', 'roi'],
      ['AOV — GMV/Orders (泰铢)', 'thb'], ['平均 GMV/产品 (泰铢)', 'thb'],
    ],
    h2: ['排名', '产品型号', '分类', 'Placement', 'GMV (泰铢)', '% GMV', 'Orders', 'Spend (泰铢)', 'ROI', 'AOV (泰铢)', 'GMV/Placement (泰铢)'],
    h3: ['分类', '产品数量', 'Placement', 'GMV (泰铢)', '% GMV', 'Orders', 'Spend (泰铢)', 'ROI', 'AOV (泰铢)'],
  },
};

function dashT(lang?: string | null): DashI18N {
  return DASH_EXPORT_I18N[lang === 'en' || lang === 'zh' ? lang : 'th'];
}

function prodT(lang?: string | null): ProdI18N {
  return PROD_EXPORT_I18N[lang === 'en' || lang === 'zh' ? lang : 'th'];
}

function colLetter(n: number): string {
  let result = '';
  while (n > 0) { n--; result = String.fromCharCode(65 + (n % 26)) + result; n = Math.floor(n / 26); }
  return result;
}

interface SheetStyleOpts {
  moneyCols?: number[];
  intCols?: number[];
  pctCols?: number[];
  roiCols?: number[];
  totalsCols?: number[];
  dataBarCols?: number[];
  roiColorCols?: number[];
}

function styleSheet(ws: ExcelJS.Worksheet, opts: SheetStyleOpts = {}): void {
  const {
    moneyCols = [], intCols = [], pctCols = [], roiCols = [],
    totalsCols = [], dataBarCols = [], roiColorCols = [],
  } = opts;

  const lastDataRow = ws.rowCount;
  const lastCol = ws.columnCount;

  // Style header (row 1)
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 20;

  // Freeze row 1
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // AutoFilter on header row
  if (lastCol > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastCol } };
  }

  // Number formats
  for (const c of moneyCols) ws.getColumn(c).numFmt = '#,##0.00';
  for (const c of intCols) ws.getColumn(c).numFmt = '#,##0';
  for (const c of pctCols) ws.getColumn(c).numFmt = '0.0%';
  for (const c of roiCols) ws.getColumn(c).numFmt = '0.00';

  // Conditional formatting (before totals so range is only data rows)
  // ExcelJS expects flat structure: cfvo/color at rule level, not nested inside dataBar/colorScale
  if (lastDataRow > 1) {
    for (const c of dataBarCols) {
      const letter = colLetter(c);
      try {
        ws.addConditionalFormatting({
          ref: `${letter}2:${letter}${lastDataRow}`,
          rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF638EC6' } } as unknown as ExcelJS.ConditionalFormattingRule],
        });
      } catch { /* fallback: no cf */ }
    }
    for (const c of roiColorCols) {
      const letter = colLetter(c);
      try {
        ws.addConditionalFormatting({
          ref: `${letter}2:${letter}${lastDataRow}`,
          rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }], color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }] } as unknown as ExcelJS.ConditionalFormattingRule],
        });
      } catch { /* fallback: no cf */ }
    }
  }

  // Totals row
  if (totalsCols.length > 0 && lastDataRow > 1) {
    const totalsRow = ws.addRow([]);
    totalsRow.getCell(1).value = 'รวม';
    totalsRow.font = { bold: true };
    for (const c of totalsCols) {
      const letter = colLetter(c);
      totalsRow.getCell(c).value = { formula: `SUM(${letter}2:${letter}${lastDataRow})`, result: 0 };
      totalsRow.getCell(c).border = { top: { style: 'thin', color: { argb: 'FF000000' } } };
    }
    totalsRow.getCell(1).border = { top: { style: 'thin', color: { argb: 'FF000000' } } };
  }
}

// ─── GET /export — same data as GET /, rendered as a multi-sheet .xlsx ──
// so the download always matches whatever filters are currently on screen.
app.get('/export', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const brand_id = c.req.query('brand_id');
    const campaign_id = c.req.query('campaign_id');
    const category_id = c.req.query('category_id');
    const date_from = c.req.query('date_from');
    const date_to = c.req.query('date_to');
    const T = dashT(c.req.query('lang'));

    const data = await buildDashboardOverview(prisma, user, { brand_id, campaign_id, category_id, date_from, date_to });

    // Resolve filter names for meta block
    const brandName = brand_id
      ? ((await prisma.brands.findUnique({ where: { id: Number(brand_id) }, select: { name: true } }))?.name ?? brand_id)
      : T.allBrands;
    const campaignCode = campaign_id && campaign_id !== 'none'
      ? ((await prisma.campaigns.findUnique({ where: { id: Number(campaign_id) }, select: { code: true } }))?.code ?? campaign_id)
      : campaign_id === 'none' ? T.noCampaignValue : T.noCampaign;
    const categoryName = category_id
      ? ((await prisma.content_categories.findUnique({ where: { id: Number(category_id) }, select: { name: true } }))?.name ?? category_id)
      : T.all;
    const dateRange = date_from || date_to ? `${date_from ?? ''} ${T.dateTo} ${date_to ?? ''}` : T.all;
    const exportedAt = new Date().toLocaleString(T.tsLocale, { timeZone: 'Asia/Bangkok', hour12: false });

    const wb = new ExcelJS.Workbook();
    const s = data.summary;
    const totalGmv = s.total_gmv;

    // ── ชีต 1: สรุป ──────────────────────────────────────────────────────────
    const summaryWs = wb.addWorksheet(T.s1);
    summaryWs.columns = [{ width: 32 }, { width: 22 }];
    // Meta block (rows 1-6)
    const metaRows: [string, string | null][] = [
      [T.metaTitle, null],
      [T.metaDate, exportedAt],
      [T.metaBrand, brandName],
      [T.metaCampaign, campaignCode],
      [T.metaCategory, categoryName],
      [T.metaDateRange, dateRange],
    ];
    for (const [label, val] of metaRows) {
      const row = summaryWs.addRow(val !== null ? [label, val] : [label]);
      row.getCell(1).font = { bold: true, color: { argb: 'FF1D4ED8' } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      if (val !== null) row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    }
    summaryWs.addRow([]); // blank separator
    // Header + data rows
    const summaryHeader = summaryWs.addRow([T.metaColItem, T.metaColValue]);
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    summaryHeader.height = 20;

    const kolCount = data.kolValueList.length;
    const roiNoAds = s.total_spend > 0 ? s.total_gmv / s.total_spend : null;
    const convRate = s.total_visits > 0 ? s.total_orders / s.total_visits : null;
    const atcRate = s.total_visits > 0 ? s.total_atc / s.total_visits : null;
    const aov = s.total_orders > 0 ? s.total_gmv / s.total_orders : null;
    const avgGmvPerPlacement = s.total_placements > 0 ? s.total_gmv / s.total_placements : null;
    const pctPosted = s.total_placements > 0 ? s.posted_count / s.total_placements : null;

    const sumValues: (number | string | null)[] = [
      s.total_placements, s.posted_count, s.planned_count, s.cancelled_count,
      pctPosted !== null ? `${(pctPosted * 100).toFixed(1)}%` : '-',
      kolCount, s.total_spend, s.total_ads_cost, s.total_gmv,
      s.total_orders, s.total_visits, s.total_atc,
      convRate !== null ? `${(convRate * 100).toFixed(2)}%` : '-',
      atcRate !== null ? `${(atcRate * 100).toFixed(2)}%` : '-',
      aov !== null ? aov : '-', avgGmvPerPlacement !== null ? avgGmvPerPlacement : '-',
      s.roi !== null ? s.roi : '-', roiNoAds !== null ? roiNoAds : '-',
    ];
    for (let si = 0; si < T.sum.length; si++) {
      const [label, fmt] = T.sum[si];
      const val = sumValues[si];
      const row = summaryWs.addRow([label, val]);
      if (typeof val === 'number') {
        row.getCell(2).numFmt = fmt === 'thb' ? '#,##0.00' : fmt === 'roi' ? '0.00' : '#,##0';
      }
    }

    // ── ชีต 2: แยกตามช่องทาง ────────────────────────────────────────────────
    const channelWs = wb.addWorksheet(T.s2);
    channelWs.addRow(T.h2);
    for (const ch of data.channelBreakdown) {
      const pctGmv = totalGmv > 0 ? ch.gmv / totalGmv : 0;
      const chAov = ch.orders > 0 ? ch.gmv / ch.orders : 0;
      const chConv = ch.visits > 0 ? (ch.orders / ch.visits) * 100 : 0;
      const chAtc = ch.visits > 0 ? (ch.atc / ch.visits) * 100 : 0;
      channelWs.addRow([EXPORT_CHANNEL_LABEL[ch.channel] ?? ch.channel, ch.gmv, pctGmv, ch.orders, ch.visits, ch.atc, chAov, chConv, chAtc]);
    }
    channelWs.columns = [{ width: 18 }, { width: 16 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 14 }];
    styleSheet(channelWs, { moneyCols: [2, 7], pctCols: [3], intCols: [4, 5, 6], roiCols: [8, 9], totalsCols: [2, 4, 5, 6], dataBarCols: [2] });

    // ── ชีต 3: Trend รายเดือน ───────────────────────────────────────────────
    const monthlyWs = wb.addWorksheet(T.s3);
    monthlyWs.addRow(T.h3);
    let cumGmv = 0;
    for (const m of data.monthlyTrend) {
      cumGmv += m.gmv;
      const roi = m.spend > 0 ? m.gmv / m.spend : null;
      const mAov = m.orders > 0 ? m.gmv / m.orders : null;
      const gmvPerPlacement = m.placement_count > 0 ? m.gmv / m.placement_count : null;
      monthlyWs.addRow([m.month, m.placement_count, m.gmv, m.orders, m.spend, roi ?? '', mAov ?? '', gmvPerPlacement ?? '', cumGmv]);
    }
    monthlyWs.columns = [{ width: 12 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 20 }, { width: 20 }];
    styleSheet(monthlyWs, { moneyCols: [3, 5, 7, 8, 9], intCols: [2, 4], roiCols: [6], totalsCols: [2, 3, 4, 5], dataBarCols: [3], roiColorCols: [6] });

    // ── ชีต 4: แยกตามหมวดคอนเทนต์ ─────────────────────────────────────────
    const categoryWs = wb.addWorksheet(T.s4);
    categoryWs.addRow(T.h4);
    for (const cat of data.categoryBreakdown) {
      const pctShare = totalGmv > 0 ? cat.gmv / totalGmv : 0;
      const roi = cat.spend > 0 ? cat.gmv / cat.spend : null;
      const catAov = cat.orders > 0 ? cat.gmv / cat.orders : null;
      const avgGmvPerKol = cat.kol_count > 0 ? cat.gmv / cat.kol_count : null;
      categoryWs.addRow([cat.category_name, cat.kol_count, cat.placement_count, cat.gmv, pctShare, cat.orders, cat.spend, roi ?? '', catAov ?? '', avgGmvPerKol ?? '']);
    }
    categoryWs.columns = [{ width: 22 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 10 }, { width: 12 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 20 }];
    styleSheet(categoryWs, { intCols: [2, 3, 6], moneyCols: [4, 7, 9, 10], pctCols: [5], roiCols: [8], totalsCols: [2, 3, 4, 6, 7], dataBarCols: [4], roiColorCols: [8] });

    // ── ชีต 5: Ranking KOL (GMV) — ทุกคนที่มี GMV > 0 ─────────────────────
    const kolWs = wb.addWorksheet(T.s5);
    kolWs.addRow(T.h5);
    const kolsForExport = [...data.kolValueList]
      .filter(k => k.total_gmv > 0)
      .sort((a, b) => b.total_gmv - a.total_gmv);
    kolsForExport.forEach((k, i) => {
      const kAov = k.total_orders > 0 ? k.total_gmv / k.total_orders : '';
      const kGmvPerPlacement = k.placement_count > 0 ? k.total_gmv / k.placement_count : '';
      kolWs.addRow([
        i + 1, k.handle, k.gen_name ?? '', k.tier_name ?? '', k.follower_count ?? '', k.placement_count,
        k.total_gmv,
        ...CHANNEL_EXPORT_COLS.map(ch => k.byChannel.find(x => x.channel === ch)?.gmv ?? 0),
        k.total_spend, k.total_orders, kAov, kGmvPerPlacement, k.roi ?? '',
        k.profile_url ?? '',
      ]);
    });
    kolWs.columns = [
      { width: 8 }, { width: 24 }, { width: 24 }, { width: 14 }, { width: 12 }, { width: 10 },
      { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
      { width: 16 }, { width: 10 }, { width: 16 }, { width: 20 }, { width: 10 },
      { width: 36 },
    ];
    styleSheet(kolWs, {
      intCols: [5, 6, 15], moneyCols: [7, 8, 9, 10, 11, 12, 13, 14, 16, 17], roiCols: [18],
      totalsCols: [7, 8, 9, 10, 11, 12, 13, 14, 15],
      dataBarCols: [7], roiColorCols: [18],
    });

    // ── ชีต 6: Trend ต่อแคมเปญ ──────────────────────────────────────────────
    const campaignWs = wb.addWorksheet(T.s6);
    campaignWs.addRow(T.h6);
    for (const c2 of data.campaignTrend) {
      const roi = c2.spend > 0 ? c2.gmv / c2.spend : null;
      const cAov = c2.orders > 0 ? c2.gmv / c2.orders : null;
      const cGpp = c2.placement_count > 0 ? c2.gmv / c2.placement_count : null;
      campaignWs.addRow([c2.code ?? T.noCampaignValue, c2.start_date ?? '', c2.placement_count, c2.gmv, c2.spend, c2.orders, roi ?? '', cAov ?? '', cGpp ?? '']);
    }
    campaignWs.columns = [{ width: 16 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 10 }, { width: 16 }, { width: 20 }];
    styleSheet(campaignWs, { intCols: [3, 6], moneyCols: [4, 5, 8, 9], roiCols: [7], totalsCols: [3, 4, 5, 6], dataBarCols: [4], roiColorCols: [7] });

    // ── ชีต 7: Barter vs จ่ายเงิน ──────────────────────────────────────────
    const paymentWs = wb.addWorksheet(T.s7);
    paymentWs.addRow(T.h7);
    const paymentLabel: Record<string, string> = { paid: T.payPaid, barter: 'Barter', free: 'Free' };
    for (const r of data.paymentTypeBreakdown) {
      const pShare = totalGmv > 0 ? r.total_gmv / totalGmv : 0;
      const roi = r.total_spend > 0 ? r.total_gmv / r.total_spend : null;
      paymentWs.addRow([paymentLabel[r.payment_type] ?? r.payment_type, r.placement_count, r.total_gmv, pShare, r.avg_gmv, r.total_spend, r.total_orders, roi ?? '']);
    }
    paymentWs.columns = [{ width: 20 }, { width: 12 }, { width: 18 }, { width: 10 }, { width: 22 }, { width: 16 }, { width: 12 }, { width: 10 }];
    styleSheet(paymentWs, { intCols: [2, 7], moneyCols: [3, 5, 6], pctCols: [4], roiCols: [8], totalsCols: [2, 3, 6, 7] });

    // ── ชีต 8: เทียบตาม Tier ────────────────────────────────────────────────
    const tierWs = wb.addWorksheet(T.s8);
    tierWs.addRow(T.h8);
    for (const r of data.tierBreakdown) {
      const roi = r.total_spend > 0 ? r.total_gmv / r.total_spend : null;
      const avgPlacement = r.kol_count > 0 ? r.placement_count / r.kol_count : null;
      tierWs.addRow([r.tier_name, r.kol_count, r.placement_count, r.total_gmv, r.avg_gmv_per_kol, r.total_orders, r.total_spend, roi ?? '', avgPlacement ?? '']);
    }
    tierWs.columns = [{ width: 16 }, { width: 12 }, { width: 12 }, { width: 18 }, { width: 22 }, { width: 12 }, { width: 16 }, { width: 10 }, { width: 18 }];
    styleSheet(tierWs, { intCols: [2, 3, 6], moneyCols: [4, 5, 7], roiCols: [8, 9], totalsCols: [2, 3, 4, 6, 7], dataBarCols: [4] });

    // ── ชีต 9: แยกตาม Platform ──────────────────────────────────────────────
    const platformWs = wb.addWorksheet(T.s9);
    const totalPlatformPlacements = data.platformBreakdown.reduce((s, r) => s + r.placement_count, 0);
    platformWs.addRow(T.h9);
    for (const r of data.platformBreakdown) {
      const pct = totalPlatformPlacements > 0 ? r.placement_count / totalPlatformPlacements : 0;
      const pAov = r.total_orders > 0 ? r.total_gmv / r.total_orders : 0;
      const avgKolGmv = r.kol_count > 0 ? r.total_gmv / r.kol_count : 0;
      platformWs.addRow([r.platform_name, r.placement_count, pct, r.kol_count, r.total_gmv, r.total_orders, r.total_spend, pAov, avgKolGmv]);
    }
    platformWs.columns = [{ width: 18 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 20 }];
    styleSheet(platformWs, { intCols: [2, 4, 6], pctCols: [3], moneyCols: [5, 7, 8, 9], totalsCols: [2, 4, 5, 6, 7], dataBarCols: [5] });

    // ── ชีต 10: ข้อมูลดิบ (Placement) ──────────────────────────────────────
    const rawWs = wb.addWorksheet(T.s10);
    rawWs.addRow(T.h10);
    for (const p of data.placementDetail) {
      const roi = (p.pay_amount ?? p.final_price ?? 0) > 0 ? p.gmv / (p.pay_amount ?? p.final_price ?? 1) : null;
      rawWs.addRow([
        p.id, p.brand_name ?? '', p.campaign_code ?? '', p.handle ?? '', p.gen_name ?? '',
        p.platform_name ?? '', p.follower_count ?? '', p.tier_name ?? '',
        p.category_name ?? '', p.model_code ?? '', p.store_name ?? '', p.store_branch ?? '',
        p.placement_type, p.payment_type,
        p.final_price ?? '', p.pay_amount ?? '', p.ads_cost ?? '',
        p.target_pub_date ?? '', p.publication_date ?? '', p.status,
        p.gmv, p.orders, p.visits, p.atc, roi ?? '',
        p.person_in_charge ?? '', p.post_url ?? '',
      ]);
    }
    rawWs.columns = [
      { width: 8 }, { width: 14 }, { width: 12 }, { width: 22 }, { width: 22 }, { width: 14 }, { width: 12 }, { width: 14 },
      { width: 18 }, { width: 20 }, { width: 16 }, { width: 14 }, { width: 18 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 },
      { width: 16 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 22 }, { width: 36 },
    ];
    styleSheet(rawWs, {
      intCols: [7, 22, 23, 24], moneyCols: [15, 16, 17, 21], roiCols: [25],
      totalsCols: [15, 16, 17, 21, 22, 23, 24],
      dataBarCols: [21], roiColorCols: [25],
    });

    const buf = await wb.xlsx.writeBuffer();
    const bytes = Uint8Array.from(buf as unknown as Uint8Array);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="dashboard_export_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to export dashboard' }, 500);
  }
});

// ─── GET /kol/:id — per-KOL campaign trend + delivery reliability ───
app.get('/kol/:id', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const kolId = Number(c.req.param('id'));
    const brand_id = c.req.query('brand_id');

    const kol = await prisma.kols.findUnique({
      where: { id: kolId },
      select: {
        id: true, gen_name: true,
        kol_platforms: {
          where: { is_primary: true },
          select: { handle: true, profile_url: true, avatar_url: true, follower_count: true, platforms: { select: { id: true, name: true } } },
        },
      },
    });
    if (!kol) {
      return c.json({ error: 'KOL not found' }, 404);
    }
    const kolPrimary = kol.kol_platforms[0];

    const brandFilter = buildDashboardBrandFilter(user.role, user.brandIds, brand_id);
    const placements = await prisma.placements.findMany({
      where: { kol_id: kolId, ...brandFilter },
      select: {
        id: true, status: true, final_price: true, pay_amount: true,
        campaigns: { select: { id: true, code: true, label: true, start_date: true } },
      },
    });

    let postedCount = 0, plannedCount = 0, cancelledCount = 0;
    for (const p of placements) {
      if (p.status === 'posted') postedCount++;
      else if (p.status === 'planned') plannedCount++;
      else if (p.status === 'cancelled') cancelledCount++;
    }
    const deliveryDenom = postedCount + cancelledCount;

    const ids = placements.map(p => p.id);
    const metricsMap = new Map<number, number>();
    if (ids.length > 0) {
      const metricsAgg = await prisma.$queryRaw<{ placement_id: number; gmv: number }[]>`
        SELECT placement_id, COALESCE(SUM(gmv::numeric), 0)::float AS gmv
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      `;
      for (const row of metricsAgg) metricsMap.set(row.placement_id, row.gmv);
    }

    type CampaignAgg = {
      campaign_id: number | null; code: string | null; label: string | null; start_date: string | null;
      placement_count: number; gmv: number; spend: number;
    };
    const byCampaign = new Map<string, CampaignAgg>();
    for (const p of placements) {
      const key = p.campaigns ? String(p.campaigns.id) : 'none';
      const entry: CampaignAgg = byCampaign.get(key) ?? {
        campaign_id: p.campaigns?.id ?? null,
        code: p.campaigns?.code ?? null,
        label: p.campaigns?.label ?? null,
        start_date: p.campaigns?.start_date ? p.campaigns.start_date.toISOString() : null,
        placement_count: 0, gmv: 0, spend: 0,
      };
      entry.placement_count += 1;
      entry.gmv += metricsMap.get(p.id) ?? 0;
      entry.spend += Number(p.pay_amount ?? p.final_price ?? 0);
      byCampaign.set(key, entry);
    }

    const trend = [...byCampaign.values()]
      .map(entry => ({ ...entry, roi: entry.spend > 0 ? entry.gmv / entry.spend : null }))
      .sort((a, b) => {
        if (!a.start_date && !b.start_date) return 0;
        if (!a.start_date) return 1;
        if (!b.start_date) return -1;
        return a.start_date.localeCompare(b.start_date);
      });

    const totalGmv = trend.reduce((sum, entry) => sum + entry.gmv, 0);
    const totalSpend = trend.reduce((sum, entry) => sum + entry.spend, 0);

    return c.json({
      kol: {
        id: kol.id, handle: kolPrimary?.handle ?? '', gen_name: kol.gen_name, profile_url: kolPrimary?.profile_url ?? null,
        avatar_url: kolPrimary?.avatar_url ?? null, follower_count: kolPrimary?.follower_count ?? null, platform: kolPrimary?.platforms ?? null,
      },
      reliability: {
        total_placements: placements.length,
        posted_count: postedCount,
        planned_count: plannedCount,
        cancelled_count: cancelledCount,
        delivery_rate: deliveryDenom > 0 ? postedCount / deliveryDenom : null,
      },
      totals: {
        total_gmv: totalGmv,
        total_spend: totalSpend,
        roi: totalSpend > 0 ? totalGmv / totalSpend : null,
      },
      trend,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load kol trend' }, 500);
  }
});

// ─── GET /products — rank every product (canonical model) by GMV ───
// Shared by GET /products (JSON) and GET /products/export (.xlsx).
async function buildProductDashboard(prisma: PrismaClient, user: AuthUser, query: {
  brand_id?: string; campaign_id?: string; category_id?: string; date_from?: string; date_to?: string;
}) {
  {
    const { brand_id, campaign_id, category_id, date_from, date_to } = query;

    const brandFilter = buildDashboardBrandFilter(user.role, user.brandIds, brand_id);

    const where = {
      ...brandFilter,
      product_id: { not: null },
      ...(campaign_id === 'none' ? { campaign_id: null } : campaign_id ? { campaign_id: Number(campaign_id) } : {}),
      ...(date_from || date_to ? {
        publication_date: {
          ...(date_from ? { gte: new Date(date_from) } : {}),
          ...(date_to ? { lte: new Date(date_to) } : {}),
        },
      } : {}),
    };

    const matched = await prisma.placements.findMany({ where, select: { id: true } });

    if (matched.length === 0) {
      return {
        summary: { total_gmv: 0, total_orders: 0, total_placements: 0, product_count: 0, total_spend: 0, total_ads_cost: 0, total_visits: 0 },
        ranking: [] as ProductRankRow[],
      };
    }

    const ids = matched.map(p => p.id);
    const categoryFilter = category_id ? Number(category_id) : null;

    // resolve each placement's product to its canonical model (typo'd raw
    // rows point to a canonical_product_id — see CLAUDE.md §4 "product_resolved")
    // before grouping, so a model's sales aren't split across near-duplicate rows
    const ranking = await prisma.$queryRaw<ProductRankRow[]>`
      WITH resolved AS (
        SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
        FROM placements pl
        JOIN products pr ON pr.id = pl.product_id
        WHERE pl.id IN (${Prisma.join(ids)})
      ),
      placement_spend AS (
        SELECT id,
               COALESCE(pay_amount, final_price, 0)::numeric AS spend,
               COALESCE(ads_cost, 0)::numeric                AS ads_cost
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders, SUM(visits) AS visits
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        c.id::int                           AS canonical_id,
        c.model_code,
        c.product_category_id               AS category_id,
        pc.name                              AS category_name,
        c.image_url,
        COUNT(DISTINCT r.placement_id)::int AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float     AS total_gmv,
        COALESCE(SUM(ma.orders), 0)::int    AS total_orders,
        COALESCE(SUM(ps.spend), 0)::float   AS total_spend,
        COALESCE(SUM(ps.ads_cost), 0)::float AS total_ads_cost,
        COALESCE(SUM(ma.visits), 0)::int    AS total_visits
      FROM resolved r
      JOIN products c ON c.id = r.canonical_id
      LEFT JOIN product_categories pc ON pc.id = c.product_category_id
      LEFT JOIN placement_spend ps ON ps.id = r.placement_id
      LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
      WHERE ${categoryFilter}::int IS NULL OR c.product_category_id = ${categoryFilter}::int
      GROUP BY c.id, c.model_code, c.product_category_id, pc.name, c.image_url
      ORDER BY total_gmv DESC
    `;

    const summary = ranking.reduce(
      (acc, r) => ({
        total_gmv: acc.total_gmv + r.total_gmv,
        total_orders: acc.total_orders + r.total_orders,
        total_placements: acc.total_placements + r.placement_count,
        product_count: acc.product_count + 1,
        total_spend: acc.total_spend + r.total_spend,
        total_ads_cost: acc.total_ads_cost + r.total_ads_cost,
        total_visits: acc.total_visits + r.total_visits,
      }),
      { total_gmv: 0, total_orders: 0, total_placements: 0, product_count: 0, total_spend: 0, total_ads_cost: 0, total_visits: 0 },
    );

    return { summary, ranking };
  }
}

app.get('/products', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const result = await buildProductDashboard(prisma, user, {
      brand_id: c.req.query('brand_id'),
      campaign_id: c.req.query('campaign_id'),
      category_id: c.req.query('category_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load product dashboard' }, 500);
  }
});

// ─── GET /products/export — same data as GET /products, as a .xlsx ──────
app.get('/products/export', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const brand_id = c.req.query('brand_id');
    const campaign_id = c.req.query('campaign_id');
    const category_id = c.req.query('category_id');
    const date_from = c.req.query('date_from');
    const date_to = c.req.query('date_to');
    const TP = prodT(c.req.query('lang'));

    const data = await buildProductDashboard(prisma, user, { brand_id, campaign_id, category_id, date_from, date_to });
    const s = data.summary;

    // Resolve filter names for meta block
    const brandName = brand_id
      ? ((await prisma.brands.findUnique({ where: { id: Number(brand_id) }, select: { name: true } }))?.name ?? brand_id)
      : TP.allBrands;
    const campaignCode = campaign_id && campaign_id !== 'none'
      ? ((await prisma.campaigns.findUnique({ where: { id: Number(campaign_id) }, select: { code: true } }))?.code ?? campaign_id)
      : campaign_id === 'none' ? TP.noCampaign : TP.all;
    const categoryName = category_id
      ? ((await prisma.content_categories.findUnique({ where: { id: Number(category_id) }, select: { name: true } }))?.name ?? category_id)
      : TP.all;
    const dateRange = date_from || date_to ? `${date_from ?? ''} ${TP.dateTo} ${date_to ?? ''}` : TP.all;
    const exportedAt = new Date().toLocaleString(TP.tsLocale, { timeZone: 'Asia/Bangkok', hour12: false });

    const wb = new ExcelJS.Workbook();
    const totalProductGmv = s.total_gmv;

    // ── ชีต 1: สรุปสินค้า ─────────────────────────────────────────────────
    const summaryWs = wb.addWorksheet(TP.s1);
    summaryWs.columns = [{ width: 32 }, { width: 22 }];
    const metaRows: [string, string | null][] = [
      [TP.metaTitle, null],
      [TP.metaDate, exportedAt],
      [TP.metaBrand, brandName],
      [TP.metaCampaign, campaignCode],
      [TP.metaCategory, categoryName],
      [TP.metaDateRange, dateRange],
    ];
    for (const [label, val] of metaRows) {
      const row = summaryWs.addRow(val !== null ? [label, val] : [label]);
      row.getCell(1).font = { bold: true, color: { argb: 'FF1D4ED8' } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      if (val !== null) row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    }
    summaryWs.addRow([]);
    const summaryHeader = summaryWs.addRow([TP.metaColItem, TP.metaColValue]);
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    summaryHeader.height = 20;
    const roi = s.total_spend > 0 ? s.total_gmv / s.total_spend : null;
    const aov = s.total_orders > 0 ? s.total_gmv / s.total_orders : null;
    const avgGmvPerProduct = s.product_count > 0 ? s.total_gmv / s.product_count : null;
    const prodSumValues: (number | string | null)[] = [
      s.product_count, s.total_placements, s.total_gmv,
      s.total_orders, s.total_spend, roi ?? '-',
      aov ?? '-', avgGmvPerProduct ?? '-',
    ];
    for (let si = 0; si < TP.sum.length; si++) {
      const [label, fmt] = TP.sum[si];
      const val = prodSumValues[si];
      const row = summaryWs.addRow([label, val]);
      if (typeof val === 'number') {
        row.getCell(2).numFmt = fmt === 'thb' ? '#,##0.00' : fmt === 'roi' ? '0.00' : '#,##0';
      }
    }

    // ── ชีต 2: Ranking สินค้า ─────────────────────────────────────────────
    const rankWs = wb.addWorksheet(TP.s2);
    rankWs.addRow(TP.h2);
    data.ranking.forEach((r, i) => {
      const pShare = totalProductGmv > 0 ? r.total_gmv / totalProductGmv : 0;
      const pRoi = r.total_spend > 0 ? r.total_gmv / r.total_spend : null;
      const pAov = r.total_orders > 0 ? r.total_gmv / r.total_orders : null;
      const pGpp = r.placement_count > 0 ? r.total_gmv / r.placement_count : null;
      rankWs.addRow([i + 1, r.model_code, r.category_name ?? '', r.placement_count, r.total_gmv, pShare, r.total_orders, r.total_spend, pRoi ?? '', pAov ?? '', pGpp ?? '']);
    });
    rankWs.columns = [{ width: 8 }, { width: 28 }, { width: 20 }, { width: 12 }, { width: 16 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 22 }];
    styleSheet(rankWs, {
      intCols: [4, 7], moneyCols: [5, 8, 10, 11], pctCols: [6], roiCols: [9],
      totalsCols: [4, 5, 7, 8], dataBarCols: [5], roiColorCols: [9],
    });

    // ── ชีต 3: แยกตามหมวดหมู่สินค้า ─────────────────────────────────────
    const catMap = new Map<string, { kol: Set<number>; placements: number; gmv: number; orders: number; spend: number }>();
    // (need KOL data per product — use placement detail from main dashboard if available; here we aggregate from ranking only)
    for (const r of data.ranking) {
      const cat = r.category_name ?? TP.noCategory;
      const entry = catMap.get(cat) ?? { kol: new Set(), placements: 0, gmv: 0, orders: 0, spend: 0 };
      entry.placements += r.placement_count;
      entry.gmv += r.total_gmv;
      entry.orders += r.total_orders;
      entry.spend += r.total_spend;
      catMap.set(cat, entry);
    }
    const catWs = wb.addWorksheet(TP.s3);
    catWs.addRow(TP.h3);
    const catEntries = [...catMap.entries()].map(([cat, v]) => ({
      cat,
      productCount: data.ranking.filter(r => (r.category_name ?? TP.noCategory) === cat).length,
      ...v,
    })).sort((a, b) => b.gmv - a.gmv);
    for (const e of catEntries) {
      const pShare = totalProductGmv > 0 ? e.gmv / totalProductGmv : 0;
      const roi = e.spend > 0 ? e.gmv / e.spend : null;
      const aovCat = e.orders > 0 ? e.gmv / e.orders : null;
      catWs.addRow([e.cat, e.productCount, e.placements, e.gmv, pShare, e.orders, e.spend, roi ?? '', aovCat ?? '']);
    }
    catWs.columns = [{ width: 24 }, { width: 14 }, { width: 12 }, { width: 16 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 10 }, { width: 16 }];
    styleSheet(catWs, {
      intCols: [2, 3, 6], moneyCols: [4, 7, 9], pctCols: [5], roiCols: [8],
      totalsCols: [2, 3, 4, 6, 7], dataBarCols: [4],
    });

    const buf = await wb.xlsx.writeBuffer();
    const bytes = Uint8Array.from(buf as unknown as Uint8Array);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="product_dashboard_export_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to export product dashboard' }, 500);
  }
});

// ─── GET /products/:id — KOLs who reviewed this product, ranked by GMV ───
app.get('/products/:id', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const canonicalId = Number(c.req.param('id'));
    const brand_id = c.req.query('brand_id');
    const campaign_id = c.req.query('campaign_id');
    const date_from = c.req.query('date_from');
    const date_to = c.req.query('date_to');

    const product = await prisma.products.findUnique({
      where: { id: canonicalId },
      select: { id: true, model_code: true, image_url: true, product_categories: { select: { name: true } } },
    });
    if (!product) return c.json({ error: 'product not found' }, 404);

    const productInfo = {
      id: product.id,
      model_code: product.model_code,
      category_name: product.product_categories?.name ?? null,
      image_url: product.image_url,
    };

    // a canonical model can have raw rows that point to it via
    // canonical_product_id (typo'd duplicates — see CLAUDE.md §4
    // "product_resolved") — gather them all so sales aren't missed
    const rawProducts = await prisma.products.findMany({
      where: { OR: [{ id: canonicalId }, { canonical_product_id: canonicalId }] },
      select: { id: true },
    });
    const rawProductIds = rawProducts.map(p => p.id);

    const brandFilter = buildDashboardBrandFilter(user.role, user.brandIds, brand_id);
    const where = {
      ...brandFilter,
      product_id: { in: rawProductIds },
      ...(campaign_id === 'none' ? { campaign_id: null } : campaign_id ? { campaign_id: Number(campaign_id) } : {}),
      ...(date_from || date_to ? {
        publication_date: {
          ...(date_from ? { gte: new Date(date_from) } : {}),
          ...(date_to ? { lte: new Date(date_to) } : {}),
        },
      } : {}),
    };
    const matched = await prisma.placements.findMany({ where, select: { id: true } });

    if (matched.length === 0) {
      return c.json({
        product: productInfo,
        summary: { total_gmv: 0, total_orders: 0, total_placements: 0, kol_count: 0 },
        kols: [] as ProductKolRow[],
      });
    }

    const ids = matched.map(p => p.id);
    const kols = await prisma.$queryRaw<ProductKolRow[]>`
      WITH metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        k.id::int                        AS kol_id,
        kp.handle,
        k.gen_name,
        kp.profile_url,
        kp.avatar_url,
        kp.follower_count,
        pf.name                          AS platform_name,
        COUNT(DISTINCT pl.id)::int       AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float  AS total_gmv,
        COALESCE(SUM(ma.orders), 0)::int AS total_orders
      FROM placements pl
      JOIN kols k ON k.id = pl.kol_id
      LEFT JOIN kol_platforms kp ON kp.kol_id = k.id AND kp.is_primary = true
      LEFT JOIN platforms pf ON pf.id = kp.platform_id
      LEFT JOIN metric_agg ma ON ma.placement_id = pl.id
      WHERE pl.id IN (${Prisma.join(ids)})
      GROUP BY k.id, kp.handle, k.gen_name, kp.profile_url, kp.avatar_url, kp.follower_count, pf.name
      ORDER BY total_gmv DESC
    `;

    const summary = kols.reduce(
      (acc, r) => ({
        total_gmv: acc.total_gmv + r.total_gmv,
        total_orders: acc.total_orders + r.total_orders,
        total_placements: acc.total_placements + r.placement_count,
        kol_count: acc.kol_count + 1,
      }),
      { total_gmv: 0, total_orders: 0, total_placements: 0, kol_count: 0 },
    );

    return c.json({ product: productInfo, summary, kols });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load product kol breakdown' }, 500);
  }
});

// brand_id (integer in our system) → brand_id strings in offplatform_traffic_daily
const OFFPLATFORM_BRAND_MAP: Record<number, string[]> = {
  1: ['dreame'],
  2: ['xiaomi_mg', 'youpin'],
};

function buildOffplatformBrandStrings(role: string, brandIds: number[], brand_id?: string): string[] | null {
  const bid = brand_id ? Number(brand_id) : null;
  if (role === 'admin') {
    if (!bid) return null; // null = no filter, show all brands
    return OFFPLATFORM_BRAND_MAP[bid] ?? [];
  }
  // manager: filter to their accessible brands
  const targetIds = bid && brandIds.includes(bid) ? [bid] : brandIds;
  return targetIds.flatMap(id => OFFPLATFORM_BRAND_MAP[id] ?? []);
}

// ─── GET /offplatform — off-platform traffic summary (Shopee Ads) ─────────────
app.get('/offplatform', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const brand_id = c.req.query('brand_id');
    const date_from = c.req.query('date_from');
    const date_to = c.req.query('date_to');

    const dateEnd = date_to ? new Date(date_to) : new Date();
    const dateStart = date_from
      ? new Date(date_from)
      : new Date(new Date(dateEnd).setDate(dateEnd.getDate() - 29));

    const dateStartStr = dateStart.toISOString().slice(0, 10);
    const dateEndStr = dateEnd.toISOString().slice(0, 10);

    const brandStrings = buildOffplatformBrandStrings(user.role, user.brandIds, brand_id);
    const brandSql = brandStrings === null
      ? Prisma.empty
      : brandStrings.length === 0
        ? Prisma.sql`AND 1 = 0`
        : Prisma.sql`AND brand_id IN (${Prisma.join(brandStrings)})`;

    const [summaryRow] = await prisma.$queryRaw<{ total_revenue: number; total_orders: number; total_visits: number }[]>(
      Prisma.sql`
        SELECT
          COALESCE(SUM(revenue_local), 0)::float AS total_revenue,
          COALESCE(SUM(orders), 0)::int          AS total_orders,
          COALESCE(SUM(visits), 0)::int          AS total_visits
        FROM offplatform_traffic_daily
        WHERE report_date BETWEEN ${dateStartStr}::date AND ${dateEndStr}::date
        ${brandSql}
      `
    );

    // normalize long channel names (e.g. "Facebook Collaborative Ads - Sales" → "Facebook")
    // so multiple sub-channels are grouped into one readable label
    const channelNorm = Prisma.sql`
      CASE
        WHEN channel ILIKE 'facebook%' THEN 'Facebook'
        WHEN channel ILIKE 'google%'   THEN 'Google'
        WHEN channel = 'N/a' OR channel IS NULL THEN 'Others'
        ELSE channel
      END
    `;

    const dailyTrend = await prisma.$queryRaw<{ date: string; channel: string; revenue: number; orders: number; visits: number }[]>(
      Prisma.sql`
        SELECT
          report_date::text                       AS date,
          ${channelNorm}                          AS channel,
          COALESCE(SUM(revenue_local), 0)::float  AS revenue,
          COALESCE(SUM(orders), 0)::int           AS orders,
          COALESCE(SUM(visits), 0)::int           AS visits
        FROM offplatform_traffic_daily
        WHERE report_date BETWEEN ${dateStartStr}::date AND ${dateEndStr}::date
        ${brandSql}
        GROUP BY report_date, ${channelNorm}
        ORDER BY report_date, revenue DESC
      `
    );

    const channelBreakdown = await prisma.$queryRaw<{ channel: string; revenue: number; orders: number; visits: number }[]>(
      Prisma.sql`
        SELECT
          ${channelNorm}                          AS channel,
          COALESCE(SUM(revenue_local), 0)::float  AS revenue,
          COALESCE(SUM(orders), 0)::int           AS orders,
          COALESCE(SUM(visits), 0)::int           AS visits
        FROM offplatform_traffic_daily
        WHERE report_date BETWEEN ${dateStartStr}::date AND ${dateEndStr}::date
        ${brandSql}
        GROUP BY ${channelNorm}
        HAVING SUM(revenue_local) > 0
        ORDER BY revenue DESC
      `
    );

    return c.json({ summary: summaryRow, dailyTrend, channelBreakdown });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load offplatform traffic' }, 500);
  }
});

const SKU_TOP_N = 8;

// Marketing dashboard aggregates — same brand-scoping as the manager dashboard
// but returns only KPI totals + GMV-contribution slices (no per-KOL rows).
async function buildMarketingDashboard(prisma: PrismaClient, user: AuthUser, query: {
  brand_id?: string; date_from?: string; date_to?: string;
}) {
  const { brand_id, date_from, date_to } = query;
  const brandFilter = buildDashboardBrandFilter(user.role, user.brandIds, brand_id);
  const where = {
    ...brandFilter,
    ...(date_from || date_to ? {
      publication_date: {
        ...(date_from ? { gte: new Date(date_from) } : {}),
        ...(date_to ? { lte: new Date(date_to) } : {}),
      },
    } : {}),
  };

  const matched = await prisma.placements.findMany({
    where, select: { id: true, pay_amount: true, final_price: true, ads_cost: true },
  });
  if (matched.length === 0) return EMPTY_MARKETING;

  const ids = matched.map(p => p.id);
  let kolCost = 0, adsCost = 0;
  for (const p of matched) {
    kolCost += Number(p.pay_amount ?? p.final_price ?? 0);
    adsCost += Number(p.ads_cost ?? 0);
  }

  // GMV total + visits per sales channel
  const channelRows = await prisma.$queryRaw<{ channel: string; gmv: number; visits: number }[]>`
    SELECT channel,
           COALESCE(SUM(gmv::numeric), 0)::float AS gmv,
           COALESCE(SUM(visits), 0)::int          AS visits
    FROM placement_metrics
    WHERE placement_id IN (${Prisma.join(ids)})
    GROUP BY channel
  `;
  let totalGmv = 0, totalVisits = 0, visitsShopee = 0, visitsLazada = 0;
  for (const r of channelRows) {
    totalGmv += r.gmv; totalVisits += r.visits;
    if (r.channel === 'shopee') visitsShopee = r.visits;
    if (r.channel === 'lazada') visitsLazada = r.visits;
  }

  // GMV by product category (canonical resolve — see buildProductDashboard)
  const byProductCategory = await prisma.$queryRaw<{ category_id: number | null; category_name: string | null; gmv: number; total_cost: number; visits: number }[]>`
    WITH resolved AS (
      SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
      FROM placements pl JOIN products pr ON pr.id = pl.product_id
      WHERE pl.id IN (${Prisma.join(ids)})
    ),
    placement_spend AS (
      SELECT id,
             (COALESCE(pay_amount, final_price, 0) + COALESCE(ads_cost, 0))::numeric AS total_cost
      FROM placements WHERE id IN (${Prisma.join(ids)})
    ),
    metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(visits) AS visits FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT pc.id::int AS category_id, pc.name AS category_name,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv,
           COALESCE(SUM(ps.total_cost), 0)::float AS total_cost,
           COALESCE(SUM(ma.visits), 0)::int AS visits
    FROM resolved r
    JOIN products c ON c.id = r.canonical_id
    LEFT JOIN product_categories pc ON pc.id = c.product_category_id
    LEFT JOIN placement_spend ps ON ps.id = r.placement_id
    LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
    GROUP BY pc.id, pc.name
    ORDER BY gmv DESC
  `;

  // GMV by product SKU (canonical), top 8 + others
  const skuRows = await prisma.$queryRaw<{ canonical_id: number; model_code: string; gmv: number; total_cost: number }[]>`
    WITH resolved AS (
      SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
      FROM placements pl JOIN products pr ON pr.id = pl.product_id
      WHERE pl.id IN (${Prisma.join(ids)})
    ),
    placement_spend AS (
      SELECT id,
             (COALESCE(pay_amount, final_price, 0) + COALESCE(ads_cost, 0))::numeric AS total_cost
      FROM placements WHERE id IN (${Prisma.join(ids)})
    ),
    metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT c.id::int AS canonical_id, c.model_code,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv,
           COALESCE(SUM(ps.total_cost), 0)::float AS total_cost
    FROM resolved r
    JOIN products c ON c.id = r.canonical_id
    LEFT JOIN placement_spend ps ON ps.id = r.placement_id
    LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
    GROUP BY c.id, c.model_code
    ORDER BY gmv DESC
  `;
  const top = skuRows.slice(0, SKU_TOP_N).map(r => ({ canonical_id: r.canonical_id, model_code: r.model_code, gmv: r.gmv, total_cost: r.total_cost }));
  const restGmv = skuRows.slice(SKU_TOP_N).reduce((s, r) => s + r.gmv, 0);
  const restCost = skuRows.slice(SKU_TOP_N).reduce((s, r) => s + r.total_cost, 0);
  const byProductSku = restGmv > 0
    ? [...top, { canonical_id: -1, model_code: null as string | null, gmv: restGmv, total_cost: restCost }]
    : top;

  return {
    summary: {
      total_gmv: totalGmv, kol_cost: kolCost, ads_cost: adsCost, total_cost: kolCost + adsCost,
      visits_shopee: visitsShopee, visits_lazada: visitsLazada, total_visits: totalVisits,
    },
    byProductCategory, byProductSku,
  };
}

app.get('/marketing', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const result = await buildMarketingDashboard(prisma, user, {
      brand_id: c.req.query('brand_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load marketing dashboard' }, 500);
  }
});

export default app;
