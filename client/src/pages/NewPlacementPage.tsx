import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronLeft, Globe, Store, User, Package, Tag, CreditCard, FileText, AlertCircle, X, FileSpreadsheet } from 'lucide-react';
import {
  getDropdowns, getProducts, getShops, getShopBranches, createPlacement, createStoreBranch,
  type Dropdowns, type Product, type Shop, type StoreBranch, type KolResult,
} from '../api/index.js';
import { useAuth } from '../context/AuthContext.js';
import KolPicker from '../components/KolPicker.js';
import Select from '../components/Select.js';
import PlatformLogo from '../components/PlatformLogo.js';
import Modal from '../components/Modal.js';
import Toast from '../components/Toast.js';
import AddModelModal from '../components/AddModelModal.js';

type PaymentType = 'paid' | 'free' | 'barter';
const PAYMENT_TYPES: PaymentType[] = ['paid', 'free', 'barter'];

interface FormState {
  placement_type: 'online' | 'offline_shop';
  brand_id: string;
  platform_id: string; campaign_id: string; product_id: string;
  shop_name: string; store_id: string;
  payment_type: PaymentType;
  final_price: string; ads_cost: string; follower_at_time: string;
  target_pub_date: string; notes: string;
  ad_content_name: string; utm_campaign_name: string;
  shopee_utm: string; lazada_utm: string; website_utm: string;
}

const initForm: FormState = {
  placement_type: 'online',
  brand_id: '',
  platform_id: '', campaign_id: '', product_id: '',
  shop_name: '', store_id: '',
  payment_type: 'paid',
  final_price: '', ads_cost: '', follower_at_time: '',
  target_pub_date: '', notes: '',
  ad_content_name: '', utm_campaign_name: '',
  shopee_utm: '', lazada_utm: '', website_utm: '',
};

const inputCls = [
  'w-full px-3 py-2 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent',
  'hover:border-accent/30',
].join(' ');

const labelCls = 'block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase';

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="text-muted">{icon}</div>
      <h2 className="text-sm font-semibold text-ink tracking-tight">{title}</h2>
    </div>
  );
}

export default function NewPlacementPage() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [dropdowns, setDropdowns] = useState<Dropdowns | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [shops, setShops] = useState<Shop[]>([]);
  const [branches, setBranches] = useState<StoreBranch[]>([]);
  const [kol, setKol] = useState<KolResult | null>(null);
  const [form, setForm] = useState<FormState>(initForm);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [branchError, setBranchError] = useState('');
  const [branchLoading, setBranchLoading] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);

  useEffect(() => {
    Promise.all([getDropdowns(), getShops()]).then(([d, s]) => {
      setDropdowns(d); setShops(s);
      // Auto-select brand if user has exactly one
      if (d.brands.length === 1) {
        setForm(f => ({ ...f, brand_id: String(d.brands[0].id) }));
      }
    }).catch(() => setError(t('newPlacement.loadError')));
  }, [t]);

  // โหลดสินค้าตาม brand ที่เลือก — สินค้าของแบรนด์นี้เท่านั้น (กัน Model ของแบรนด์อื่นปนเข้ามา)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!form.brand_id) { setProducts([]); return; }
    setLoadingProducts(true);
    getProducts(form.brand_id)
      .then(setProducts)
      .finally(() => setLoadingProducts(false));
  }, [form.brand_id]);

  useEffect(() => {
    if (form.shop_name) {
      getShopBranches(form.shop_name).then(setBranches).catch(() => setBranches([]));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(f => ({ ...f, store_id: '' }));
    } else {
      setBranches([]);
    }
  }, [form.shop_name]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleAddBranch() {
    if (!newBranch.trim()) { setBranchError(t('newPlacement.branchNameRequired')); return; }
    setBranchError(''); setBranchLoading(true);
    try {
      const created = await createStoreBranch({ shop_name: form.shop_name, branch: newBranch.trim() });
      setBranches(prev => [...prev, created]);
      set('store_id', String(created.id));
      setNewBranch(''); setShowAddBranch(false);
      setToast(t('newPlacement.branchAdded', { branch: created.branch }));
    } catch (err: unknown) {
      setBranchError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBranchLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kol) { setError(t('newPlacement.kolRequired')); return; }
    if (form.placement_type === 'offline_shop' && !form.store_id) { setError(t('newPlacement.branchRequired')); return; }
    if (!form.brand_id) { setError(t('newPlacement.brandRequired')); return; }
    if (!form.target_pub_date) { setError(t('newPlacement.targetDateRequired')); return; }
    setError(''); setSubmitting(true);
    try {
      await createPlacement({
        brand_id: Number(form.brand_id),
        placement_type: form.placement_type,
        kol_id: kol.id,
        platform_id: form.platform_id || null,
        campaign_id: form.campaign_id || null,
        product_id: form.placement_type === 'online' ? (form.product_id || null) : null,
        store_id: form.placement_type === 'offline_shop' ? (form.store_id || null) : null,
        payment_type: form.payment_type,
        final_price: form.payment_type === 'paid' ? (form.final_price || null) : null,
        ads_cost: form.ads_cost || null,
        follower_at_time: form.follower_at_time || kol.follower_count || null,
        target_pub_date: form.target_pub_date || null,
        notes: form.notes || null,
        ...(form.placement_type === 'online' ? {
          ad_content_name: form.ad_content_name.trim() || null,
          utm_campaign_name: form.utm_campaign_name.trim() || null,
          shopee_utm: form.shopee_utm.trim() || null,
          lazada_utm: form.lazada_utm.trim() || null,
          website_utm: form.website_utm.trim() || null,
        } : {}),
      });
      setToast(t('newPlacement.saved'));
      setKol(null); setForm(initForm);
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!dropdowns) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] bg-canvas">
        {error
          ? <p className="text-red-500 text-sm">{error}</p>
          : <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />}
      </div>
    );
  }

  const isPaidType = form.payment_type === 'paid';

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link to="/placements" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink transition-colors mb-3">
          <ChevronLeft size={14} /> {t('newPlacement.back')}
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-ink tracking-tight">{t('newPlacement.title')}</h1>
            <p className="text-sm text-muted mt-0.5">{t('newPlacement.defaultStatus')}</p>
          </div>
          <Link to="/placements/import"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#217346] text-white text-xs font-medium rounded-full hover:bg-[#1a5c38] active:scale-95 transition-all whitespace-nowrap shadow-sm">
            <FileSpreadsheet size={13} />
            {t('newPlacement.importFromExcel')}
          </Link>
        </div>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
      {showAddModel && form.brand_id && dropdowns && (
        <AddModelModal
          onClose={() => setShowAddModel(false)}
          brandId={Number(form.brand_id)}
          productCategories={dropdowns.productCategories}
          isAdmin={appUser?.role === 'admin'}
          onCreated={product => {
            setProducts(prev => [...prev, product]);
            set('product_id', String(product.id));
            setToast(t('addModel.addModelSuccess'));
          }}
        />
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-sm flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 transition-colors">
            <X size={13} />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">

        {/* Brand — แสดงเฉพาะเมื่อ user มีหลาย brand */}
        {dropdowns.brands.length > 1 && (
          <div className="bg-surface border border-hairline rounded-xl p-5">
            <SectionHeader icon={<Tag size={15} />} title={t('newPlacement.brandSection')} />
            <Select
              options={dropdowns.brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))}
              value={form.brand_id}
              onChange={v => { set('brand_id', v); set('product_id', ''); }}
              placeholder={t('newPlacement.selectBrand')}
            />
          </div>
        )}

        {/* ประเภท */}
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <SectionHeader
            icon={form.placement_type === 'online' ? <Globe size={15} /> : <Store size={15} />}
            title={t('newPlacement.typeSection')}
          />
          <div className="flex gap-2">
            {(['online', 'offline_shop'] as const).map(pt => (
              <button key={pt} type="button"
                onClick={() => { set('placement_type', pt); set('product_id', ''); set('shop_name', ''); set('store_id', ''); }}
                className={`flex-1 py-2 rounded-full border text-sm font-medium transition-all active:scale-95 ${
                  form.placement_type === pt
                    ? 'bg-accent text-white border-accent'
                    : 'bg-transparent text-ink border-hairline hover:border-accent/40 hover:text-accent'
                }`}
              >
                {pt === 'online' ? 'Online' : t('newPlacement.offlineLabel')}
              </button>
            ))}
          </div>
        </div>

        {/* KOL */}
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <SectionHeader icon={<User size={15} />} title={t('newPlacement.kolSection')} />
          <div className="space-y-4">
            <div>
              <label className={labelCls}>KOL <span className="text-red-400 normal-case">*</span></label>
              <KolPicker
                value={kol}
                onChange={k => {
                  setKol(k);
                  if (k?.follower_count != null) set('follower_at_time', String(k.follower_count));
                  const primary = k?.platforms.find(p => p.is_primary) ?? k?.platforms[0];
                  if (primary) set('platform_id', String(primary.platform_id));
                }}
                platforms={dropdowns.platforms}
                onAdded={handle => setToast(t('newPlacement.kolAdded', { handle }))}
              />
            </div>
            {kol && kol.platforms.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted">{t('newPlacement.selectPlatformForPlacement')}</span>
                {kol.platforms.map(p => {
                  const active = form.platform_id === String(p.platform_id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        set('platform_id', String(p.platform_id));
                        set('follower_at_time', p.follower_count != null ? String(p.follower_count) : '');
                      }}
                      className={`flex items-center gap-1.5 text-xs pl-1.5 pr-2.5 py-1 rounded-full border transition-colors ${
                        active ? 'bg-accent text-white border-accent' : 'border-hairline text-muted hover:border-accent/40 hover:text-ink'
                      }`}
                    >
                      <PlatformLogo name={p.platform_name} size={16} />
                      {p.platform_name}{p.follower_count != null ? ` · ${p.follower_count.toLocaleString()}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Platform</label>
                <Select
                  options={dropdowns.platforms.map(p => ({ id: p.id, label: p.name }))}
                  value={form.platform_id}
                  onChange={v => set('platform_id', v)}
                  placeholder={t('newPlacement.selectPlatform')}
                />
              </div>
              <div>
                <label className={labelCls}>Follower</label>
                <input type="number" value={form.follower_at_time}
                  onChange={e => set('follower_at_time', e.target.value)}
                  placeholder={t('newPlacement.followerPlaceholder')} className={inputCls} />
              </div>
            </div>
          </div>
        </div>

        {/* สินค้า / ร้านค้า */}
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <SectionHeader
            icon={<Package size={15} />}
            title={form.placement_type === 'online' ? t('newPlacement.productSection') : t('newPlacement.storeSection')}
          />
          {form.placement_type === 'online' ? (
            <div>
              <label className={labelCls}>Model</label>
              <Select
                options={products.map(p => ({ id: p.id, label: p.model_code }))}
                value={form.product_id}
                onChange={v => set('product_id', v)}
                placeholder={loadingProducts ? t('common.loading') : t('newPlacement.selectProduct')}
                disabled={!form.brand_id || loadingProducts}
              />
              {form.brand_id && !loadingProducts && products.length === 0 && (
                <p className="text-xs text-amber-500 mt-1.5">
                  {t('newPlacement.noProductsWarning')}
                </p>
              )}
              {form.brand_id && (
                <button
                  type="button"
                  onClick={() => setShowAddModel(true)}
                  className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover mt-1.5 transition-colors"
                >
                  {t('addModel.addModelButton')}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{t('newPlacement.shop')}</label>
                <Select
                  options={shops.map(s => ({ id: s.name, label: s.name }))}
                  value={form.shop_name}
                  onChange={v => set('shop_name', v)}
                  placeholder={t('newPlacement.selectShop')}
                />
              </div>
              <div>
                <label className={labelCls}>{t('newPlacement.branch')} <span className="text-red-400 normal-case">*</span></label>
                <Select
                  options={branches.map(b => ({ id: b.id, label: b.branch ?? t('newPlacement.unspecifiedBranch') }))}
                  value={form.store_id}
                  onChange={v => set('store_id', v)}
                  placeholder={t('newPlacement.selectBranch')}
                  addLabel={t('newPlacement.addNewBranch')}
                  onAddClick={() => setShowAddBranch(true)}
                  disabled={!form.shop_name}
                />
                {showAddBranch && (
                  <Modal title={t('newPlacement.addNewBranchTitle', { shop: form.shop_name })}
                    onClose={() => { setShowAddBranch(false); setBranchError(''); setNewBranch(''); }}>
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>{t('newPlacement.branchName')} <span className="text-red-400 normal-case">*</span></label>
                        <input type="text" placeholder={t('newPlacement.branchNamePlaceholder')} value={newBranch}
                          onChange={e => setNewBranch(e.target.value)} className={inputCls} />
                      </div>
                      {branchError && <p className="text-red-500 text-sm">{branchError}</p>}
                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={handleAddBranch} disabled={branchLoading}
                          className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover active:scale-95 disabled:opacity-50 transition-all">
                          {branchLoading ? t('common.saving') : t('common.save')}
                        </button>
                        <button type="button" onClick={() => { setShowAddBranch(false); setBranchError(''); setNewBranch(''); }}
                          className="flex-1 py-2 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">{t('common.cancel')}</button>
                      </div>
                    </div>
                  </Modal>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Campaign + PIC */}
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <SectionHeader icon={<Tag size={15} />} title={t('newPlacement.campaignSection')} />
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Campaign</label>
                <Select
                  options={dropdowns.campaigns.map(c => ({ id: c.id, label: c.label ?? c.code }))}
                  value={form.campaign_id}
                  onChange={v => set('campaign_id', v)}
                  placeholder={t('newPlacement.selectCampaignOptional')}
                />
              </div>
              <div>
                <label className={labelCls}>Target Publication Date <span className="text-red-500 normal-case">*</span></label>
                <input type="date" required value={form.target_pub_date}
                  onChange={e => set('target_pub_date', e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
        </div>

        {/* ค่าตอบแทน */}
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <SectionHeader icon={<CreditCard size={15} />} title={t('newPlacement.paymentSection')} />
          <div className="space-y-4">
            <div className="flex gap-2">
              {PAYMENT_TYPES.map(val => (
                <button key={val} type="button" onClick={() => set('payment_type', val)}
                  className={`flex-1 py-2 rounded-full border text-sm font-medium transition-all active:scale-95 ${
                    form.payment_type === val
                      ? 'bg-accent text-white border-accent'
                      : 'bg-transparent text-ink border-hairline hover:border-accent/40 hover:text-accent'
                  }`}
                >
                  {t(`payment.${val}`)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Final Price ({t('common.currency')})</label>
                <input type="number" value={form.final_price}
                  onChange={e => set('final_price', e.target.value)}
                  disabled={!isPaidType} placeholder={isPaidType ? '0' : '—'}
                  className={`${inputCls} disabled:opacity-40 disabled:cursor-not-allowed`} />
              </div>
              <div>
                <label className={labelCls}>Ads Cost ({t('common.currency')})</label>
                <input type="number" value={form.ads_cost}
                  onChange={e => set('ads_cost', e.target.value)}
                  placeholder="0" className={inputCls} />
              </div>
            </div>
          </div>
        </div>

        {/* Tracking / UTM — online เท่านั้น */}
        {form.placement_type === 'online' && (
          <div className="bg-surface border border-hairline rounded-xl p-5">
            <SectionHeader icon={<Tag size={15} />} title="Tracking / UTM" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Ad Content Name</label>
                <input type="text" value={form.ad_content_name}
                  onChange={e => set('ad_content_name', e.target.value)}
                  placeholder="2026-115-RB-..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>UTM Campaign Name</label>
                <input type="text" value={form.utm_campaign_name}
                  onChange={e => set('utm_campaign_name', e.target.value)}
                  placeholder="2026-115-RB-F20" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Shopee UTM</label>
                <input type="url" value={form.shopee_utm}
                  onChange={e => set('shopee_utm', e.target.value)}
                  placeholder="https://..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Lazada UTM</label>
                <input type="url" value={form.lazada_utm}
                  onChange={e => set('lazada_utm', e.target.value)}
                  placeholder="https://..." className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Website UTM</label>
                <input type="url" value={form.website_utm}
                  onChange={e => set('website_utm', e.target.value)}
                  placeholder="https://..." className={inputCls} />
              </div>
            </div>
          </div>
        )}

        {/* หมายเหตุ */}
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <SectionHeader icon={<FileText size={15} />} title={t('newPlacement.notesSection')} />
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            rows={3} placeholder={t('newPlacement.notesPlaceholder')}
            className={`${inputCls} resize-none`} />
        </div>

        <button type="submit" disabled={submitting}
          className="w-full py-3 bg-accent text-white font-medium rounded-full hover:bg-accent-hover disabled:opacity-50 active:scale-[0.99] transition-all text-sm">
          {submitting ? t('common.saving') : t('newPlacement.submit')}
        </button>
      </form>
    </div>
  );
}

