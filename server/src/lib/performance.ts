import type { PrismaClient } from '@prisma/client';
import { isSafeUrl } from './isSafeUrl.js';

// Marketplace metrics (visits/atc/orders/gmv) only make sense for online placements —
// PATCH /:id/performance in placements.ts has always gated these the same way.
const MARKETPLACE_CHANNELS = ['shopee', 'lazada', 'website'];

export interface PerformanceMetricInput {
  channel?: string;
  measured_at?: string;
  vdo_view?: number | string | null;
  clicks?: number | string | null;
  orders?: number | string | null;
  gmv?: number | string | null;
  atc?: number | string | null;
  atc_value?: number | string | null;
  visits?: number | string | null;
  ads_spend?: number | string | null;
  likes?: number | string | null;
  comments?: number | string | null;
  saves?: number | string | null;
  shares?: number | string | null;
  impressions?: number | string | null;
}

export interface ApplyPerformancePayload {
  publication_date?: string | null;
  post_url?: string | null;
  pay_amount?: string | number | null;
  metrics?: PerformanceMetricInput[];
  ad_content_name?: string | null;
  utm_campaign_name?: string | null;
  shopee_utm?: string | null;
  lazada_utm?: string | null;
  website_utm?: string | null;
}

// Extracted verbatim from PATCH /:id/performance (placements.ts) so it can be
// called from placementsImport.ts's Phase 7 performance round-trip import
// without duplicating this logic — placements.ts still owns the route/auth
// checks and just calls this after parsing the request body.
export async function applyPerformance(
  prisma: PrismaClient,
  placementId: number,
  isOnline: boolean,
  payload: ApplyPerformancePayload,
): Promise<void> {
  const {
    publication_date, post_url, pay_amount, metrics,
    ad_content_name, utm_campaign_name, shopee_utm, lazada_utm, website_utm,
  } = payload;

  const trim = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  // Re-validate UTM URL scheme here too, not just at resolveRow()/validate-time —
  // this is the single write path shared by both PATCH /:id/performance and
  // /performance/commit, so this closes the gap for any caller that could
  // bypass/tamper with the preview step. Same error-message style as resolveRow().
  if (isOnline) {
    const checkUtm = (label: string, v: unknown) => {
      const trimmed = trim(v);
      if (trimmed && !isSafeUrl(trimmed)) {
        throw new Error(`${label} UTM "${trimmed}" ต้องเป็น URL ที่ขึ้นต้นด้วย http:// หรือ https://`);
      }
    };
    checkUtm('Shopee', shopee_utm);
    checkUtm('Lazada', lazada_utm);
    checkUtm('Website', website_utm);
  }

  await prisma.placements.update({
    where: { id: placementId },
    data: {
      status: 'posted',
      publication_date: publication_date ? new Date(publication_date) : null,
      post_url: post_url?.trim() || null,
      ...(pay_amount !== undefined && pay_amount !== '' && pay_amount !== null
        ? { pay_amount: String(pay_amount) }
        : {}),
      ...(isOnline ? {
        ...(ad_content_name   !== undefined ? { ad_content_name:   trim(ad_content_name) }   : {}),
        ...(utm_campaign_name !== undefined ? { utm_campaign_name: trim(utm_campaign_name) } : {}),
        ...(shopee_utm        !== undefined ? { shopee_utm:        trim(shopee_utm) }        : {}),
        ...(lazada_utm        !== undefined ? { lazada_utm:        trim(lazada_utm) }        : {}),
        ...(website_utm       !== undefined ? { website_utm:       trim(website_utm) }       : {}),
      } : {}),
    },
  });

  if (Array.isArray(metrics) && metrics.length > 0) {
    for (const m of metrics) {
      const { channel = 'shopee', measured_at, vdo_view, clicks, orders, gmv, atc, atc_value, visits, ads_spend, likes, comments, saves, shares, impressions } = m;

      // Marketplace metrics belong to online placements only — ignore if sent for offline
      if (!isOnline && MARKETPLACE_CHANNELS.includes(channel)) continue;

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
        where: { placement_id: placementId, channel, period_days: 30 },
      });
      await prisma.placement_metrics.create({
        data: {
          placement_id: placementId,
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
}
