import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { PlacementRow } from '../api/index.js';
import { updatePerformance, getPlacementMetrics } from '../api/index.js';
import { useModalTransition } from '../hooks/useModalTransition.js';

type Props = { placement: PlacementRow; onClose: () => void; onSaved: () => void; };

const inputCls = [
  'w-full px-3 py-2 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent',
].join(' ');
const labelCls = 'block text-xs font-medium text-muted mb-1 tracking-wide uppercase';

type ManualMetric = { vdo_view: string; likes: string; comments: string; saves: string; shares: string };

export default function PerformanceModal({ placement, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);
  const platformName = placement.platforms?.name?.toLowerCase() ?? '';
  const isYoutube = platformName === 'youtube';
  const isLamon8 = /lemon8|lamon8/i.test(platformName);
  const showManualMetrics = isYoutube || isLamon8;
  const isOnline = placement.placement_type === 'online';

  const [form, setForm] = useState({
    publication_date: placement.publication_date?.slice(0, 10) ?? '',
    post_url: placement.post_url ?? '',
    pay_amount: String(placement.pay_amount ?? ''),
  });
  const [metric, setMetric] = useState<ManualMetric>({ vdo_view: '', likes: '', comments: '', saves: '', shares: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const setM = (k: keyof ManualMetric, v: string) => setMetric(m => ({ ...m, [k]: v }));

  const [utm, setUtm] = useState({
    ad_content_name: placement.ad_content_name ?? '',
    utm_campaign_name: placement.utm_campaign_name ?? '',
    shopee_utm: placement.shopee_utm ?? '',
    lazada_utm: placement.lazada_utm ?? '',
    website_utm: placement.website_utm ?? '',
  });
  const setU = (k: keyof typeof utm, v: string) => setUtm(u => ({ ...u, [k]: v }));

  type MpChannel = 'shopee' | 'lazada' | 'website';
  type MpFields = { visits: string; atc: string; atc_value: string; orders: string; gmv: string };
  const emptyMp: MpFields = { visits: '', atc: '', atc_value: '', orders: '', gmv: '' };
  const [mp, setMp] = useState<Record<MpChannel, MpFields>>({
    shopee: { ...emptyMp }, lazada: { ...emptyMp }, website: { ...emptyMp },
  });
  const setMpField = (ch: MpChannel, k: keyof MpFields, v: string) =>
    setMp(prev => ({ ...prev, [ch]: { ...prev[ch], [k]: v } }));

  // Prefill from existing metrics so editing a posted placement doesn't wipe data
  useEffect(() => {
    let alive = true;
    getPlacementMetrics(placement.id).then(rows => {
      if (!alive) return;
      const ch = isYoutube ? 'youtube' : 'lamon8';
      const m = rows.find(r => r.channel === ch);
      if (m) {
        setMetric({
          vdo_view: m.vdo_view != null ? String(m.vdo_view) : '',
          likes: m.likes != null ? String(m.likes) : '',
          comments: m.comments != null ? String(m.comments) : '',
          saves: m.saves != null ? String(m.saves) : '',
          shares: m.shares != null ? String(m.shares) : '',
        });
      }
      const next: Record<MpChannel, MpFields> = {
        shopee: { ...emptyMp }, lazada: { ...emptyMp }, website: { ...emptyMp },
      };
      (['shopee', 'lazada', 'website'] as MpChannel[]).forEach(mpCh => {
        const r = rows.find(x => x.channel === mpCh);
        if (r) next[mpCh] = {
          visits: r.visits != null ? String(r.visits) : '',
          atc: r.atc != null ? String(r.atc) : '',
          atc_value: r.atc_value != null ? String(r.atc_value) : '',
          orders: r.orders != null ? String(r.orders) : '',
          gmv: r.gmv != null ? String(r.gmv) : '',
        };
      });
      setMp(next);
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement.id, isYoutube]);

  const kolName = placement.kols?.handle ?? '—';
  const platformLabel = placement.platforms?.name ?? '—';
  const productOrStore = placement.placement_type === 'online'
    ? (placement.products?.model_code ?? '—')
    : placement.stores
      ? `${placement.stores.name}${placement.stores.branch ? ` · ${placement.stores.branch}` : ''}`
      : '—';
  const campaignLabel = placement.campaigns?.label ?? placement.campaigns?.code ?? '—';

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const channel = isYoutube ? 'youtube' : 'lamon8';
      const hasMetric = showManualMetrics && (metric.vdo_view || metric.likes || metric.comments || metric.saves || metric.shares);
      const measured_at = new Date().toISOString().slice(0, 10);

      const engagementEntry = hasMetric ? [{
        channel,
        measured_at,
        ...(isYoutube
          ? {
              vdo_view: metric.vdo_view ? Number(metric.vdo_view) : null,
              likes: metric.likes ? Number(metric.likes) : null,
              comments: metric.comments ? Number(metric.comments) : null,
              shares: metric.shares ? Number(metric.shares) : null,
            }
          : {
              likes: metric.likes ? Number(metric.likes) : null,
              comments: metric.comments ? Number(metric.comments) : null,
              saves: metric.saves ? Number(metric.saves) : null,
            }),
      }] : [];

      // Marketplace: send only channels with at least one value (empty channel = keep existing)
      const num = (v: string) => (v.trim() !== '' ? Number(v) : null);
      const str = (v: string) => (v.trim() !== '' ? v.trim() : null);
      const mpEntries = isOnline
        ? (['shopee', 'lazada', 'website'] as MpChannel[]).flatMap(ch => {
            const f = mp[ch];
            const hasAny = Object.values(f).some(v => v.trim() !== '');
            if (!hasAny) return [];
            return [{
              channel: ch,
              measured_at,
              visits: num(f.visits), atc: num(f.atc),
              ...(ch === 'shopee' ? { atc_value: str(f.atc_value) } : {}),
              orders: num(f.orders), gmv: str(f.gmv),
            }];
          })
        : [];

      const allMetrics = [...engagementEntry, ...mpEntries];

      await updatePerformance(placement.id, {
        publication_date: form.publication_date || null,
        post_url: form.post_url.trim() || null,
        ...(placement.payment_type === 'paid' && form.pay_amount !== ''
          ? { pay_amount: form.pay_amount }
          : {}),
        ...(isOnline ? {
          ad_content_name: utm.ad_content_name.trim() || null,
          utm_campaign_name: utm.utm_campaign_name.trim() || null,
          shopee_utm: utm.shopee_utm.trim() || null,
          lazada_utm: utm.lazada_utm.trim() || null,
          website_utm: utm.website_utm.trim() || null,
        } : {}),
        metrics: allMetrics.length > 0 ? allMetrics : undefined,
      });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div className={`bg-surface border border-hairline rounded-2xl shadow-2xl w-full max-w-lg transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h3 className="font-semibold text-ink tracking-tight">{t('performance.title')}</h3>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 pt-4 pb-6">
          <div className="bg-canvas border border-hairline rounded-xl px-3 py-2.5 mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="text-xs"><span className="text-muted">KOL </span><span className="text-ink font-medium">{kolName}</span></div>
            <div className="text-xs"><span className="text-muted">Platform </span><span className="text-ink">{platformLabel}</span></div>
            <div className="text-xs"><span className="text-muted">Model </span><span className="text-ink">{productOrStore}</span></div>
            <div className="text-xs"><span className="text-muted">Campaign </span><span className="text-ink">{campaignLabel}</span></div>
          </div>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-0.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Publication Date</label>
                <input type="date" value={form.publication_date}
                  onChange={e => set('publication_date', e.target.value)} className={inputCls} />
              </div>
              {placement.payment_type === 'paid' && (
                <div>
                  <label className={labelCls}>Pay Amount ({t('common.currency')})</label>
                  <input type="number" value={form.pay_amount}
                    onChange={e => set('pay_amount', e.target.value)}
                    placeholder={placement.final_price ? t('performance.agreedPrice', { price: Number(placement.final_price).toLocaleString() }) : ''}
                    className={inputCls} />
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Post Link</label>
              <input type="url" value={form.post_url}
                onChange={e => set('post_url', e.target.value)}
                placeholder="https://..." className={inputCls} />
            </div>

            {isOnline && (
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Marketplace Metrics</p>
                <div className="space-y-3">
                  {([
                    { ch: 'shopee' as const, label: 'Shopee', hasAtcValue: true },
                    { ch: 'lazada' as const, label: 'Lazada', hasAtcValue: false },
                    { ch: 'website' as const, label: 'Website', hasAtcValue: false },
                  ]).map(({ ch, label, hasAtcValue }) => (
                    <div key={ch} className="border border-hairline rounded-xl p-3">
                      <p className="text-xs font-semibold text-ink mb-2">{label}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className={labelCls}>Visits</label>
                          <input type="number" min="0" value={mp[ch].visits}
                            onChange={e => setMpField(ch, 'visits', e.target.value)} placeholder="0" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>ATC</label>
                          <input type="number" min="0" value={mp[ch].atc}
                            onChange={e => setMpField(ch, 'atc', e.target.value)} placeholder="0" className={inputCls} />
                        </div>
                        {hasAtcValue && (
                          <div>
                            <label className={labelCls}>ATC Value</label>
                            <input type="number" min="0" value={mp[ch].atc_value}
                              onChange={e => setMpField(ch, 'atc_value', e.target.value)} placeholder="0" className={inputCls} />
                          </div>
                        )}
                        <div>
                          <label className={labelCls}>Orders</label>
                          <input type="number" min="0" value={mp[ch].orders}
                            onChange={e => setMpField(ch, 'orders', e.target.value)} placeholder="0" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>GMV</label>
                          <input type="number" min="0" value={mp[ch].gmv}
                            onChange={e => setMpField(ch, 'gmv', e.target.value)} placeholder="0" className={inputCls} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isOnline && (
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Tracking / UTM</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Ad Content Name</label>
                    <input type="text" value={utm.ad_content_name}
                      onChange={e => setU('ad_content_name', e.target.value)} placeholder="2026-115-RB-..." className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>UTM Campaign Name</label>
                    <input type="text" value={utm.utm_campaign_name}
                      onChange={e => setU('utm_campaign_name', e.target.value)} placeholder="2026-115-RB-F20" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Shopee UTM</label>
                    <input type="url" value={utm.shopee_utm}
                      onChange={e => setU('shopee_utm', e.target.value)} placeholder="https://..." className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Lazada UTM</label>
                    <input type="url" value={utm.lazada_utm}
                      onChange={e => setU('lazada_utm', e.target.value)} placeholder="https://..." className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Website UTM</label>
                    <input type="url" value={utm.website_utm}
                      onChange={e => setU('website_utm', e.target.value)} placeholder="https://..." className={inputCls} />
                  </div>
                </div>
              </div>
            )}

            {showManualMetrics && (
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                  {isYoutube ? 'YouTube Stats' : 'Lemon8 Stats'} {t('performance.optional')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {isYoutube && (
                    <>
                      <div>
                        <label className={labelCls}>Views</label>
                        <input type="number" min="0" value={metric.vdo_view}
                          onChange={e => setM('vdo_view', e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Likes</label>
                        <input type="number" min="0" value={metric.likes}
                          onChange={e => setM('likes', e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Comments</label>
                        <input type="number" min="0" value={metric.comments}
                          onChange={e => setM('comments', e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Shares</label>
                        <input type="number" min="0" value={metric.shares}
                          onChange={e => setM('shares', e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                    </>
                  )}
                  {isLamon8 && (
                    <>
                      <div>
                        <label className={labelCls}>Likes</label>
                        <input type="number" min="0" value={metric.likes}
                          onChange={e => setM('likes', e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Comments</label>
                        <input type="number" min="0" value={metric.comments}
                          onChange={e => setM('comments', e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Saves</label>
                        <input type="number" min="0" value={metric.saves}
                          onChange={e => setM('saves', e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

          <div className="flex gap-2 mt-4">
            <button type="button" onClick={requestClose}
              className="flex-1 px-4 py-2 border border-hairline rounded-full text-sm text-ink hover:bg-canvas active:scale-95 transition-all">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 active:scale-95 transition-all">
              {saving ? t('common.saving') : t('performance.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
