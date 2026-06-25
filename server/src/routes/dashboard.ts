import { Hono } from 'hono';
import { Prisma, type PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { requireAuth, requireRole, type AuthUser } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth, requireRole('admin', 'manager'));

function buildDashboardBrandFilter(role: string, brandIds: number[], brand_id?: string) {
  const bid = brand_id ? Number(brand_id) : null;
  const seesAll = role === 'admin';
  if (seesAll) return bid ? { brand_id: bid } : {};
  return { brand_id: bid && brandIds.includes(bid) ? bid : { in: brandIds } };
}

const EMPTY_RESPONSE = {
  summary: {
    total_placements: 0,
    posted_count: 0,
    planned_count: 0,
    cancelled_count: 0,
    total_spend: 0,
    total_ads_cost: 0,
    total_gmv: 0,
    total_orders: 0,
    roi: null as number | null,
  },
  channelBreakdown: [] as {
    channel: string; gmv: number; orders: number; visits: number;
    byCampaign: { campaign_id: number | null; code: string | null; label: string | null; gmv: number }[];
  }[],
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
  }[],
  paymentTypeBreakdown: [] as PaymentTypeRow[],
  tierBreakdown: [] as TierRow[],
};

type PaymentTypeRow = {
  payment_type: string;
  placement_count: number;
  total_gmv: number;
  avg_gmv: number;
};

type TierRow = {
  tier_id: number;
  tier_name: string;
  kol_count: number;
  placement_count: number;
  total_gmv: number;
  avg_gmv_per_kol: number;
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
      select: { id: true, final_price: true, pay_amount: true, ads_cost: true, status: true },
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
    for (const p of matched) {
      totalSpend += Number(p.pay_amount ?? p.final_price ?? 0);
      totalAdsCost += Number(p.ads_cost ?? 0);
      if (p.status === 'posted') postedCount++;
      else if (p.status === 'planned') plannedCount++;
      else if (p.status === 'cancelled') cancelledCount++;
    }

    const [gmvRow] = await prisma.$queryRaw<{ total_gmv: number; total_orders: number }[]>`
      SELECT
        COALESCE(SUM(gmv::numeric), 0)::float AS total_gmv,
        COALESCE(SUM(orders), 0)::int          AS total_orders
      FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)})
    `;

    const channelBreakdown = await prisma.$queryRaw<{ channel: string; gmv: number; orders: number; visits: number }[]>`
      SELECT
        channel,
        COALESCE(SUM(gmv::numeric), 0)::float AS gmv,
        COALESCE(SUM(orders), 0)::int          AS orders,
        COALESCE(SUM(visits), 0)::int          AS visits
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
    const paymentTypeAgg = await prisma.$queryRaw<{ payment_type: string; placement_count: number; total_gmv: number }[]>`
      WITH metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        p.payment_type,
        COUNT(DISTINCT p.id)::int          AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float    AS total_gmv
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
      };
      entry.kol_count += 1;
      entry.placement_count += r.placement_count;
      entry.total_gmv += r.total_gmv;
      tierMap.set(r.kol_tier_id, entry);
    }
    const tierBreakdown: TierRow[] = [...tierMap.values()]
      .map(t => ({ ...t, avg_gmv_per_kol: t.kol_count > 0 ? t.total_gmv / t.kol_count : 0 }))
      .sort((a, b) => a.tier_id - b.tier_id);

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
    }[]>`
      SELECT
        c.id                                                       AS campaign_id,
        c.code,
        c.label,
        c.start_date,
        COUNT(DISTINCT p.id)::int                                  AS placement_count,
        COALESCE(SUM(pm.gmv::numeric), 0)::float                   AS gmv,
        COALESCE(SUM(COALESCE(p.pay_amount, p.final_price, 0)), 0)::float AS spend
      FROM placements p
      LEFT JOIN campaigns c ON p.campaign_id = c.id
      LEFT JOIN (
        SELECT placement_id, SUM(gmv::numeric) AS gmv
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      ) pm ON pm.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY c.id, c.code, c.label, c.start_date
      ORDER BY c.start_date ASC NULLS LAST
    `;

    const totalSpendWithAds = totalSpend + totalAdsCost;

    return {
      summary: {
        total_placements: matched.length,
        posted_count: postedCount,
        planned_count: plannedCount,
        cancelled_count: cancelledCount,
        total_spend: totalSpend,
        total_ads_cost: totalAdsCost,
        total_gmv: gmvRow.total_gmv,
        total_orders: gmvRow.total_orders,
        roi: totalSpendWithAds > 0 ? gmvRow.total_gmv / totalSpendWithAds : null,
      },
      channelBreakdown: channelBreakdownWithCampaigns,
      topKolsByGmv,
      topKolsByRoi,
      kolValueList: kolRows,
      campaignTrend,
      paymentTypeBreakdown,
      tierBreakdown,
    };
  }
}

app.get('/', async c => {
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

function styleExportHeaderRow(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

// ─── GET /export — same data as GET /, rendered as a multi-sheet .xlsx ──
// so the download always matches whatever filters are currently on screen.
app.get('/export', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const data = await buildDashboardOverview(prisma, user, {
      brand_id: c.req.query('brand_id'),
      campaign_id: c.req.query('campaign_id'),
      category_id: c.req.query('category_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    });

    const wb = new ExcelJS.Workbook();

    const summaryWs = wb.addWorksheet('สรุป');
    summaryWs.addRow(['รายการ', 'ค่า']);
    summaryWs.addRows([
      ['Placement ทั้งหมด', data.summary.total_placements],
      ['โพสต์แล้ว', data.summary.posted_count],
      ['วางแผนไว้', data.summary.planned_count],
      ['ยกเลิก', data.summary.cancelled_count],
      ['ค่าใช้จ่าย KOL (บาท)', data.summary.total_spend],
      ['Ads Cost (บาท)', data.summary.total_ads_cost],
      ['GMV รวม (บาท)', data.summary.total_gmv],
      ['Orders รวม', data.summary.total_orders],
      ['ROI รวม (รวม Ads Cost)', data.summary.roi],
    ]);
    summaryWs.columns = [{ width: 28 }, { width: 18 }];
    styleExportHeaderRow(summaryWs);

    const channelWs = wb.addWorksheet('แยกตามช่องทาง');
    channelWs.addRow(['ช่องทาง', 'GMV (บาท)', 'Orders', 'Visits']);
    for (const ch of data.channelBreakdown) {
      channelWs.addRow([EXPORT_CHANNEL_LABEL[ch.channel] ?? ch.channel, ch.gmv, ch.orders, ch.visits]);
    }
    channelWs.columns = [{ width: 18 }, { width: 16 }, { width: 12 }, { width: 12 }];
    channelWs.getColumn(2).numFmt = '#,##0.00';
    styleExportHeaderRow(channelWs);

    const kolWs = wb.addWorksheet('Ranking KOL (GMV)');
    kolWs.addRow(['อันดับ', 'Handle', 'ชื่อ', 'Follower', 'Placement', 'GMV (บาท)', 'ค่าใช้จ่าย (บาท)', 'Orders', 'ROI']);
    data.topKolsByGmv.forEach((k, i) => {
      kolWs.addRow([i + 1, k.handle, k.gen_name ?? '', k.follower_count ?? '', k.placement_count, k.total_gmv, k.total_spend, k.total_orders, k.roi ?? '']);
    });
    kolWs.columns = [{ width: 8 }, { width: 24 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 10 }, { width: 10 }];
    kolWs.getColumn(6).numFmt = '#,##0.00';
    kolWs.getColumn(7).numFmt = '#,##0.00';
    kolWs.getColumn(9).numFmt = '0.00';
    styleExportHeaderRow(kolWs);

    const campaignWs = wb.addWorksheet('Trend ต่อแคมเปญ');
    campaignWs.addRow(['แคมเปญ', 'Placement', 'GMV (บาท)', 'ค่าใช้จ่าย (บาท)']);
    for (const c2 of data.campaignTrend) {
      campaignWs.addRow([c2.code ?? 'ไม่มีแคมเปญ', c2.placement_count, c2.gmv, c2.spend]);
    }
    campaignWs.columns = [{ width: 16 }, { width: 12 }, { width: 16 }, { width: 16 }];
    campaignWs.getColumn(3).numFmt = '#,##0.00';
    campaignWs.getColumn(4).numFmt = '#,##0.00';
    styleExportHeaderRow(campaignWs);

    const paymentWs = wb.addWorksheet('Barter vs จ่ายเงิน');
    paymentWs.addRow(['ประเภทการจ่ายเงิน', 'Placement', 'GMV รวม (บาท)', 'GMV เฉลี่ยต่อโพสต์ (บาท)']);
    for (const r of data.paymentTypeBreakdown) {
      paymentWs.addRow([EXPORT_PAYMENT_LABEL[r.payment_type] ?? r.payment_type, r.placement_count, r.total_gmv, r.avg_gmv]);
    }
    paymentWs.columns = [{ width: 20 }, { width: 12 }, { width: 18 }, { width: 22 }];
    paymentWs.getColumn(3).numFmt = '#,##0.00';
    paymentWs.getColumn(4).numFmt = '#,##0.00';
    styleExportHeaderRow(paymentWs);

    const tierWs = wb.addWorksheet('เทียบตาม Tier');
    tierWs.addRow(['Tier', 'จำนวน KOL', 'Placement', 'GMV รวม (บาท)', 'GMV เฉลี่ยต่อ KOL (บาท)']);
    for (const r of data.tierBreakdown) {
      tierWs.addRow([r.tier_name, r.kol_count, r.placement_count, r.total_gmv, r.avg_gmv_per_kol]);
    }
    tierWs.columns = [{ width: 16 }, { width: 12 }, { width: 12 }, { width: 18 }, { width: 22 }];
    tierWs.getColumn(4).numFmt = '#,##0.00';
    tierWs.getColumn(5).numFmt = '#,##0.00';
    styleExportHeaderRow(tierWs);

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
app.get('/kol/:id', async c => {
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
        summary: { total_gmv: 0, total_orders: 0, total_placements: 0, product_count: 0 },
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
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
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
        COALESCE(SUM(ma.orders), 0)::int    AS total_orders
      FROM resolved r
      JOIN products c ON c.id = r.canonical_id
      LEFT JOIN product_categories pc ON pc.id = c.product_category_id
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
      }),
      { total_gmv: 0, total_orders: 0, total_placements: 0, product_count: 0 },
    );

    return { summary, ranking };
  }
}

app.get('/products', async c => {
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
app.get('/products/export', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const data = await buildProductDashboard(prisma, user, {
      brand_id: c.req.query('brand_id'),
      campaign_id: c.req.query('campaign_id'),
      category_id: c.req.query('category_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ranking สินค้า');
    ws.addRow(['อันดับ', 'รุ่นสินค้า', 'หมวดหมู่', 'Placement', 'GMV (บาท)', 'Orders']);
    data.ranking.forEach((r, i) => {
      ws.addRow([i + 1, r.model_code, r.category_name ?? '', r.placement_count, r.total_gmv, r.total_orders]);
    });
    ws.columns = [{ width: 8 }, { width: 24 }, { width: 20 }, { width: 12 }, { width: 16 }, { width: 10 }];
    ws.getColumn(5).numFmt = '#,##0.00';
    styleExportHeaderRow(ws);

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

export default app;
