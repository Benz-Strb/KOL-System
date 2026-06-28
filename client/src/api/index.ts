import i18n from '../i18n/index.js';

export type Platform = { id: number; name: string };
export type ContentCategory = { id: number; name: string };
export type ProductCategory = { id: number; name: string };
export type UserOption = { id: number; full_name: string; is_active: boolean };
export type Campaign = { id: number; code: string; label: string | null; year: number };
export type Product = { id: number; model_code: string };
export type Shop = { name: string; has_branches: boolean };
export type StoreBranch = { id: number; name: string; branch: string | null };
export type KolPlatformAccount = {
  id: number;
  platform_id: number;
  platform_name: string;
  handle: string;
  follower_count: number | null;
  profile_url: string | null;
  avatar_url: string | null;
  is_primary: boolean;
};

export type KolResult = {
  id: number;
  handle: string;
  gen_name: string | null;
  follower_count: number | null;
  platforms: KolPlatformAccount[];
};

export type Dropdowns = {
  platforms: Platform[];
  contentCategories: ContentCategory[];
  productCategories: ProductCategory[];
  users: UserOption[];
  campaigns: Campaign[];
  brands: Brand[];
};

export type Brand = { id: number; name: string; active?: boolean; logo_url: string | null };
export type AppUser = { id: number; supabaseId: string; full_name: string; email: string; role: string; brandIds: number[] };
export type AdminUser = { id: number; full_name: string; email: string | null; role: string; is_active: boolean; created_at: string; user_brands: { brands: { id: number; name: string } }[] };

// Empty by default so local dev keeps using Vite's '/api' proxy (see vite.config.ts) —
// set VITE_API_BASE_URL at build time once client/server are deployed on separate origins.
// Exported because AuthContext.tsx also calls /api/auth/me directly (outside this file's api() wrapper).
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

let _token: string | null = null;
export function setAuthToken(token: string | null) { _token = token; }

let _deactivatedHandler: (() => void) | null = null;
export function setDeactivatedHandler(fn: () => void) { _deactivatedHandler = fn; }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeader: Record<string, string> = _token ? { Authorization: `Bearer ${_token}` } : {};
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeader, ...(init?.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 403 && err.error === 'User not found or inactive') {
      _deactivatedHandler?.();
    }
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

let _dropdownsCache: Dropdowns | null = null;
let _productsCache: Product[] | null = null;
let _shopsCache: Shop[] | null = null;

export const getDropdowns = () =>
  _dropdownsCache ? Promise.resolve(_dropdownsCache)
    : api<Dropdowns>('/api/dropdowns').then(d => (_dropdownsCache = d));

export const getProducts = (brandId?: string | number) => {
  if (!brandId) {
    return _productsCache
      ? Promise.resolve(_productsCache)
      : api<Product[]>('/api/products').then(d => (_productsCache = d));
  }
  return api<Product[]>(`/api/products?brand_id=${brandId}`);
};

export const getShops = () =>
  _shopsCache ? Promise.resolve(_shopsCache)
    : api<Shop[]>('/api/shops').then(d => (_shopsCache = d));

export function clearDropdownCache() {
  _dropdownsCache = null;
  _productsCache = null;
  _shopsCache = null;
}
export const getShopBranches = (shop: string) =>
  api<StoreBranch[]>(`/api/shops/branches?shop=${encodeURIComponent(shop)}`);
export const searchKols = (q: string) => api<KolResult[]>(`/api/kols/search?q=${encodeURIComponent(q)}`);
export const createKol = (body: {
  handle: string;
  gen_name?: string;
  platform_id?: number;
  content_category_id?: number;
  follower_count?: number;
}) => api<KolResult>('/api/kols', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const createStoreBranch = (body: { shop_name: string; branch: string }) =>
  api<StoreBranch>('/api/shops/branches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type PlacementRow = {
  id: number;
  status: string;
  placement_type: string;
  payment_type: string;
  final_price: string | null;
  pay_amount: string | null;
  ads_cost: string | null;
  follower_at_time: number | null;
  target_pub_date: string | null;
  publication_date: string | null;
  post_url: string | null;
  notes: string | null;
  created_at: string;
  kols: { id: number; handle: string; gen_name: string | null; profile_url: string | null; follower_count: number | null; avatar_url: string | null; content_categories: { name: string } | null } | null;
  platforms: { name: string } | null;
  products: { model_code: string } | null;
  stores: { name: string; branch: string | null } | null;
  campaigns: { code: string; label: string | null } | null;
  brands: { id: number; name: string; logo_url: string | null };
  users_placements_person_in_charge_idTousers: { full_name: string } | null;
};

export type PlacementsResponse = { total: number; page: number; limit: number; rows: PlacementRow[] };

export const getPlacements = (params: {
  status?: string; placement_type?: string; q?: string;
  product_id?: string; campaign_id?: string; payment_type?: string;
  price_min?: string; price_max?: string; person_in_charge_id?: string;
  brand_id?: string; page?: number;
}) => {
  const p = new URLSearchParams();
  if (params.status) p.set('status', params.status);
  if (params.placement_type) p.set('placement_type', params.placement_type);
  if (params.q) p.set('q', params.q);
  if (params.product_id) p.set('product_id', params.product_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.payment_type && params.payment_type !== 'all') p.set('payment_type', params.payment_type);
  if (params.price_min) p.set('price_min', params.price_min);
  if (params.price_max) p.set('price_max', params.price_max);
  if (params.person_in_charge_id) p.set('person_in_charge_id', params.person_in_charge_id);
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.page) p.set('page', String(params.page));
  return api<PlacementsResponse>(`/api/placements?${p}`);
};

export const createPlacement = (body: Record<string, unknown>) =>
  api('/api/placements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type PlacementMetric = {
  id: number;
  placement_id: number;
  channel: string;
  period_days: number;
  measured_at: string | null;
  visits: number | null;
  atc: number | null;
  atc_value: string | null;
  gmv: string | null;
  orders: number | null;
  vdo_view: number | null;
  clicks: number | null;
  ads_spend: string | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  impressions: number | null;
  engagement_rate: string | null;
  tracking_period: string | null;
  promotion_status: string | null;
  is_automated: boolean;
  created_at: string;
};

export type MetricEntry = {
  channel: string;
  measured_at?: string | null;
  visits?: number | null;
  atc?: number | null;
  atc_value?: string | null;
  vdo_view?: number | null;
  clicks?: number | null;
  ads_spend?: string | null;
  orders?: number | null;
  gmv?: string | null;
  likes?: number | null;
  comments?: number | null;
  saves?: number | null;
  shares?: number | null;
  impressions?: number | null;
};

export const getPlacementMetrics = (id: number) =>
  api<PlacementMetric[]>(`/api/placements/${id}/metrics`);

export type PlacementRepost = {
  id: number;
  placement_id: number;
  round_number: number;
  posted_by: 'brand' | 'kol';
  post_url: string | null;
  posted_at: string | null;
  created_at: string;
  placement_metrics: PlacementMetric[];
};

export const getReposts = (placementId: number) =>
  api<PlacementRepost[]>(`/api/placements/${placementId}/reposts`);

export const createRepost = (placementId: number, body: { posted_by: 'brand' | 'kol'; post_url?: string; posted_at?: string }) =>
  api<PlacementRepost>(`/api/placements/${placementId}/reposts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const updateRepost = (placementId: number, repostId: number, body: { posted_by?: 'brand' | 'kol'; post_url?: string | null; posted_at?: string | null }) =>
  api<PlacementRepost>(`/api/placements/${placementId}/reposts/${repostId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const deleteRepost = (placementId: number, repostId: number) =>
  api<{ ok: boolean }>(`/api/placements/${placementId}/reposts/${repostId}`, { method: 'DELETE' });

export const saveRepostMetrics = (
  placementId: number, repostId: number,
  body: { channel: string; measured_at?: string; vdo_view?: number | null; likes?: number | null; comments?: number | null; saves?: number | null; shares?: number | null },
) => api<PlacementMetric>(`/api/placements/${placementId}/reposts/${repostId}/metrics`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type KolGmvRow = {
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
};

export const getKolGmv = (params: {
  status?: string; placement_type?: string; q?: string;
  product_id?: string; campaign_id?: string; payment_type?: string;
  price_min?: string; price_max?: string; person_in_charge_id?: string;
  brand_id?: string;
}) => {
  const p = new URLSearchParams();
  if (params.status) p.set('status', params.status);
  if (params.placement_type) p.set('placement_type', params.placement_type);
  if (params.q) p.set('q', params.q);
  if (params.product_id) p.set('product_id', params.product_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.payment_type && params.payment_type !== 'all') p.set('payment_type', params.payment_type);
  if (params.price_min) p.set('price_min', params.price_min);
  if (params.price_max) p.set('price_max', params.price_max);
  if (params.person_in_charge_id) p.set('person_in_charge_id', params.person_in_charge_id);
  if (params.brand_id) p.set('brand_id', params.brand_id);
  return api<KolGmvRow[]>(`/api/placements/kol-gmv?${p}`);
};

export const updatePerformance = (id: number, body: {
  publication_date?: string | null;
  post_url?: string | null;
  pay_amount?: string | number;
  metrics?: MetricEntry[];
}) => api<{ ok: boolean }>(`/api/placements/${id}/performance`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export type ContactInfo = { email?: string; whatsapp?: string; line?: string; other?: string };

export type KolBrandProductRow = { model_code: string; campaigns: { code: string; label: string | null }[] };
export type KolBrandRow = {
  brand_id: number;
  brand_name: string;
  logo_url: string | null;
  products: KolBrandProductRow[];
};

export type KolDirectoryRow = {
  id: number;
  handle: string;
  gen_name: string | null;
  follower_count: number | null;
  profile_url: string | null;
  avatar_url: string | null;
  contact_info: ContactInfo | null;
  custom_tags: string[];
  audience_tags: string[];
  main_selling_points: string | null;
  platform: { id: number; name: string } | null;
  platforms: KolPlatformAccount[];
  category: string | null;
  placement_count: number;
  brands: KolBrandRow[];
};

export type CommercialTerm = {
  id: number;
  kol_id: number;
  brand_id: number | null;
  pricing_type: string;
  single_post_price: string | null;
  package_price: string | null;
  multi_platform_price: string | null;
  is_barter: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  brands: { id: number; name: string } | null;
};

export type KolSample = {
  id: number;
  kol_id: number;
  placement_id: number | null;
  brand_id: number | null;
  product_id: number | null;
  sample_status: string;
  return_policy: string;
  shipped_at: string | null;
  signed_at: string | null;
  notes: string | null;
  created_at: string;
  kols: { id: number; handle: string; gen_name: string | null; avatar_url: string | null; platforms: { name: string } | null } | null;
  brands: { id: number; name: string } | null;
  products: { id: number; model_code: string } | null;
};

export const getKolDirectory = (params: { q?: string; platform_id?: string; category_id?: string; page?: number }) => {
  const p = new URLSearchParams();
  if (params.q) p.set('q', params.q);
  if (params.platform_id) p.set('platform_id', params.platform_id);
  if (params.category_id) p.set('category_id', params.category_id);
  if (params.page) p.set('page', String(params.page));
  return api<{ total: number; page: number; limit: number; rows: KolDirectoryRow[] }>(`/api/kols?${p}`);
};

// KOL profile update (person-level fields — follower_count lives on a
// specific platform now, see the platform functions below)
export const updateKol = (id: number, body: {
  custom_tags?: string[];
  main_selling_points?: string | null;
  contact_info?: ContactInfo | null;
}) => api<{ id: number; custom_tags: string[]; audience_tags: string[]; main_selling_points: string | null; contact_info: ContactInfo | null }>(
  `/api/kols/${id}`,
  { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
);

// A kol can have several platform accounts — these three mutate one row at
// a time and always get back the kol's full platform list + the flattened
// primary-platform convenience fields, so callers can apply the result with
// one onUpdated(bundle) without re-deriving "which one is primary" themselves.
export type KolPlatformsBundle = {
  platforms: KolPlatformAccount[];
  handle: string;
  follower_count: number | null;
  avatar_url: string | null;
  profile_url: string | null;
  platform: { id: number; name: string } | null;
};
export const addKolPlatform = (kolId: number, body: { platform_id?: number; handle: string; follower_count?: number }) =>
  api<KolPlatformsBundle>(`/api/kols/${kolId}/platforms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const updateKolPlatform = (platformId: number, body: { handle?: string; follower_count?: number | null; profile_url?: string | null; is_primary?: true }) =>
  api<KolPlatformsBundle>(`/api/kols/platforms/${platformId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const deleteKolPlatform = (platformId: number) =>
  api<KolPlatformsBundle>(`/api/kols/platforms/${platformId}`, { method: 'DELETE' });

// Posts — every placement this kol actually has a post link for
export type KolPost = {
  id: number;
  post_url: string;
  publication_date: string | null;
  status: string;
  platforms: { name: string } | null;
  brands: { id: number; name: string; logo_url: string | null };
  campaigns: { code: string; label: string | null } | null;
  products: { model_code: string } | null;
  stores: { name: string; branch: string | null } | null;
};
export const getKolPosts = (kolId: number) => api<KolPost[]>(`/api/kols/${kolId}/posts`);

// Hire History — brand-scoped placement cost timeline (planned + posted, no cancelled)
export type KolHireHistoryItem = {
  id: number;
  status: string;
  payment_type: string;
  final_price: string | null;
  pay_amount: string | null;
  publication_date: string | null;
  placement_type: string;
  platforms: { id: number; name: string } | null;
  brands: { id: number; name: string; logo_url: string | null };
  campaigns: { code: string; label: string | null; start_date: string | null } | null;
  products: { model_code: string } | null;
  stores: { name: string; branch: string | null } | null;
};
export const getKolHireHistory = (kolId: number) => api<KolHireHistoryItem[]>(`/api/kols/${kolId}/hire-history`);

// Commercial Terms
export const getKolTerms = (kolId: number) => api<CommercialTerm[]>(`/api/kols/${kolId}/terms`);
export const createKolTerm = (kolId: number, body: {
  brand_id?: number | null;
  pricing_type: string;
  single_post_price?: string;
  package_price?: string;
  multi_platform_price?: string;
  is_barter?: boolean;
  notes?: string;
}) => api<CommercialTerm>(`/api/kols/${kolId}/terms`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
export const updateKolTerm = (termId: number, body: Partial<{
  pricing_type: string;
  single_post_price: string;
  package_price: string;
  multi_platform_price: string;
  is_barter: boolean;
  notes: string;
}>) => api<CommercialTerm>(`/api/kols/terms/${termId}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
export const deleteKolTerm = (termId: number) =>
  api<{ ok: boolean }>(`/api/kols/terms/${termId}`, { method: 'DELETE' });

// Samples
export const getSamples = (params: { brand_id?: string; status?: string; page?: number }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.status) p.set('status', params.status);
  if (params.page) p.set('page', String(params.page));
  return api<{ total: number; page: number; limit: number; rows: KolSample[] }>(`/api/samples?${p}`);
};
export const createSample = (body: {
  kol_id: number;
  brand_id?: number | null;
  product_id?: number | null;
  placement_id?: number | null;
  sample_status?: string;
  return_policy?: string;
  notes?: string;
}) => api<KolSample>('/api/samples', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
export const updateSample = (id: number, body: {
  sample_status?: string;
  return_policy?: string;
  shipped_at?: string | null;
  signed_at?: string | null;
  notes?: string;
}) => api<KolSample>(`/api/samples/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
export const deleteSample = (id: number) =>
  api<{ ok: boolean }>(`/api/samples/${id}`, { method: 'DELETE' });

// Dashboard
export type DashboardSummary = {
  total_placements: number;
  posted_count: number;
  planned_count: number;
  cancelled_count: number;
  total_spend: number;
  total_ads_cost: number;
  total_gmv: number;
  total_orders: number;
  total_visits: number;
  total_atc: number;
  roi: number | null;
};
export type DashboardChannelCampaignRow = { campaign_id: number | null; code: string | null; label: string | null; gmv: number };
export type DashboardChannelRow = { channel: string; gmv: number; orders: number; visits: number; atc: number; byCampaign: DashboardChannelCampaignRow[] };
export type DashboardMonthlyRow = { month: string; placement_count: number; gmv: number; orders: number };
export type DashboardCategoryRow = { category_id: number; category_name: string; kol_count: number; placement_count: number; gmv: number; orders: number };
export type DashboardKolChannelRow = { channel: string; gmv: number };
export type DashboardKolRow = {
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
  byChannel: DashboardKolChannelRow[];
};
export type DashboardKolPaymentRow = { kol_id: number; payment_type: string; placement_count: number; total_gmv: number; total_spend: number };
export type DashboardCampaignTrendRow = {
  campaign_id: number | null;
  code: string | null;
  label: string | null;
  start_date: string | null;
  placement_count: number;
  gmv: number;
  spend: number;
};
export type DashboardPaymentTypeRow = { payment_type: string; placement_count: number; total_gmv: number; avg_gmv: number };
export type DashboardTierRow = { tier_id: number; tier_name: string; kol_count: number; placement_count: number; total_gmv: number; avg_gmv_per_kol: number };
export type DashboardPlatformRow = { platform_id: number; platform_name: string; placement_count: number; kol_count: number; total_gmv: number };
export type DashboardOverview = {
  summary: DashboardSummary;
  channelBreakdown: DashboardChannelRow[];
  monthlyTrend: DashboardMonthlyRow[];
  categoryBreakdown: DashboardCategoryRow[];
  topKolsByGmv: DashboardKolRow[];
  topKolsByRoi: DashboardKolRow[];
  kolValueList: DashboardKolRow[];
  campaignTrend: DashboardCampaignTrendRow[];
  paymentTypeBreakdown: DashboardPaymentTypeRow[];
  tierBreakdown: DashboardTierRow[];
  platformBreakdown: DashboardPlatformRow[];
  kolPaymentBreakdown: DashboardKolPaymentRow[];
};

export const getDashboardOverview = (params: { brand_id?: string; campaign_id?: string; category_id?: string; date_from?: string; date_to?: string }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.category_id) p.set('category_id', params.category_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return api<DashboardOverview>(`/api/dashboard?${p}`);
};

export type MarketingSummary = {
  total_gmv: number; kol_cost: number; ads_cost: number; total_cost: number;
  visits_shopee: number; visits_lazada: number; total_visits: number;
};
export type MarketingDashboard = {
  summary: MarketingSummary;
  byPlatform: { platform_id: number; platform_name: string; gmv: number }[];
  byProductCategory: { category_id: number | null; category_name: string | null; gmv: number }[];
  byProductSku: { canonical_id: number; model_code: string | null; gmv: number }[];
  byContentCategory: { category_id: number; category_name: string; gmv: number }[];
};

export const getMarketingDashboard = (params: { brand_id?: string; date_from?: string; date_to?: string }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return api<MarketingDashboard>(`/api/dashboard/marketing?${p}`);
};

// Shared by both dashboard export buttons — fetch with auth header (these
// are file downloads, not JSON, so they bypass the api() wrapper) then
// trigger a browser download via a synthetic <a download>, same pattern as
// downloadImportTemplate() below.
async function downloadFile(path: string, filename: string) {
  const authHeader: Record<string, string> = _token ? { Authorization: `Bearer ${_token}` } : {};
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeader });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: i18n.t('download.failed') }));
    throw new Error(err.error ?? i18n.t('download.failed'));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const exportDashboard = (params: { brand_id?: string; campaign_id?: string; category_id?: string; date_from?: string; date_to?: string }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.category_id) p.set('category_id', params.category_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return downloadFile(`/api/dashboard/export?${p}`, `dashboard_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export type KolTrendCampaignRow = {
  campaign_id: number | null;
  code: string | null;
  label: string | null;
  start_date: string | null;
  placement_count: number;
  gmv: number;
  spend: number;
  roi: number | null;
};
export type KolTrendOverview = {
  kol: {
    id: number;
    handle: string;
    gen_name: string | null;
    profile_url: string | null;
    avatar_url: string | null;
    follower_count: number | null;
    platform: { id: number; name: string } | null;
  };
  reliability: {
    total_placements: number;
    posted_count: number;
    planned_count: number;
    cancelled_count: number;
    delivery_rate: number | null;
  };
  totals: { total_gmv: number; total_spend: number; roi: number | null };
  trend: KolTrendCampaignRow[];
};

export const getKolTrend = (kolId: number, params: { brand_id?: string } = {}) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  return api<KolTrendOverview>(`/api/dashboard/kol/${kolId}?${p}`);
};

export type ProductRankRow = {
  canonical_id: number;
  model_code: string;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
  placement_count: number;
  total_gmv: number;
  total_orders: number;
};
export type ProductDashboardOverview = {
  summary: { total_gmv: number; total_orders: number; total_placements: number; product_count: number };
  ranking: ProductRankRow[];
};

export const getProductDashboard = (params: { brand_id?: string; campaign_id?: string; category_id?: string; date_from?: string; date_to?: string }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.category_id) p.set('category_id', params.category_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return api<ProductDashboardOverview>(`/api/dashboard/products?${p}`);
};

export const exportProductDashboard = (params: { brand_id?: string; campaign_id?: string; category_id?: string; date_from?: string; date_to?: string }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.category_id) p.set('category_id', params.category_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return downloadFile(`/api/dashboard/products/export?${p}`, `product_dashboard_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export type ProductKolRow = {
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
export type ProductTrendOverview = {
  product: { id: number; model_code: string; category_name: string | null; image_url: string | null };
  summary: { total_gmv: number; total_orders: number; total_placements: number; kol_count: number };
  kols: ProductKolRow[];
};

export const getProductTrend = (productId: number, params: { brand_id?: string; campaign_id?: string; date_from?: string; date_to?: string } = {}) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return api<ProductTrendOverview>(`/api/dashboard/products/${productId}?${p}`);
};

export type OffplatformSummary = { total_revenue: number; total_orders: number; total_visits: number };
export type OffplatformDailyRow = { date: string; channel: string; revenue: number; orders: number; visits: number };
export type OffplatformChannelRow = { channel: string; revenue: number; orders: number; visits: number };
export type OffplatformTraffic = {
  summary: OffplatformSummary;
  dailyTrend: OffplatformDailyRow[];
  channelBreakdown: OffplatformChannelRow[];
};

export const getOffplatformTraffic = (params: { brand_id?: string; date_from?: string; date_to?: string }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return api<OffplatformTraffic>(`/api/dashboard/offplatform?${p}`);
};

// Bulk import placements from Excel
export type ImportKind = 'online' | 'offline';

export type ImportRawRow = {
  brand: string; kolHandle: string; platform: string; follower: string;
  model: string; shopBranch: string; campaign: string; targetPubDate: string;
  paymentType: string; finalPrice: string; adsCost: string; notes: string;
};
export type ImportRowResult = { rowNumber: number; raw: ImportRawRow; errors: string[]; warnings: string[] };
export type ImportValidateResponse = { summary: { total: number; valid: number; withErrors: number }; rows: ImportRowResult[] };
export type ImportCommitResponse = { created: number; branchesCreated: number; failed: { rowNumber: number; error: string }[] };

export async function downloadImportTemplate(kind: ImportKind, brandId?: number) {
  const authHeader: Record<string, string> = _token ? { Authorization: `Bearer ${_token}` } : {};
  const qs = brandId != null ? `?brand_id=${brandId}` : '';
  const res = await fetch(`${API_BASE_URL}/api/placements/import/template/${kind}${qs}`, { headers: authHeader });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: i18n.t('download.templateFailed') }));
    throw new Error(err.error ?? i18n.t('download.templateFailed'));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `placement_import_template_${kind}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function validateImportFile(file: File, kind: ImportKind) {
  const fd = new FormData();
  fd.append('file', file);
  const authHeader: Record<string, string> = _token ? { Authorization: `Bearer ${_token}` } : {};
  const res = await fetch(`${API_BASE_URL}/api/placements/import/validate/${kind}`, { method: 'POST', headers: authHeader, body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<ImportValidateResponse>;
}

export const commitImport = (kind: ImportKind, rows: { rowNumber: number; raw: ImportRawRow }[]) =>
  api<ImportCommitResponse>('/api/placements/import/commit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, rows }),
  });

// Auth
export const getMe = () => api<AppUser>('/api/auth/me');

// Admin
export const getAdminUsers = () => api<AdminUser[]>('/api/admin/users');
export const getAdminBrands = () => api<Brand[]>('/api/admin/brands');
export const createAdminBrand = (name: string, logo_url?: string) =>
  api<Brand>('/api/admin/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, logo_url }) });
export const updateAdminBrand = (id: number, body: { name?: string; active?: boolean; logo_url?: string | null }) =>
  api<Brand>(`/api/admin/brands/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const createAdminUser = (body: { email: string; full_name: string; role: string; password: string; brand_ids?: number[] }) =>
  api<AdminUser>('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const updateAdminUser = (id: number, body: { role?: string; is_active?: boolean; brand_ids?: number[]; email?: string; full_name?: string }) =>
  api<AdminUser>(`/api/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const resetUserPassword = (id: number, password: string) =>
  api<{ ok: boolean }>(`/api/admin/users/${id}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
