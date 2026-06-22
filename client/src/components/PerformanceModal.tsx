import { useState } from 'react';
import { X } from 'lucide-react';
import type { PlacementRow } from '../api/index.js';
import { updatePerformance } from '../api/index.js';
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
  const { closed, requestClose } = useModalTransition(onClose);
  const platformName = placement.platforms?.name?.toLowerCase() ?? '';
  const isYoutube = platformName === 'youtube';
  const isLamon8 = /lemon8|lamon8/i.test(platformName);
  const showManualMetrics = isYoutube || isLamon8;

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

      await updatePerformance(placement.id, {
        publication_date: form.publication_date || null,
        post_url: form.post_url.trim() || null,
        ...(placement.payment_type === 'paid' && form.pay_amount !== ''
          ? { pay_amount: form.pay_amount }
          : {}),
        metrics: hasMetric ? [{
          channel,
          measured_at: new Date().toISOString().slice(0, 10),
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
        }] : undefined,
      });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
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
          <h3 className="font-semibold text-ink tracking-tight">บันทึกผลงาน</h3>
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

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Publication Date</label>
                <input type="date" value={form.publication_date}
                  onChange={e => set('publication_date', e.target.value)} className={inputCls} />
              </div>
              {placement.payment_type === 'paid' && (
                <div>
                  <label className={labelCls}>Pay Amount (บาท)</label>
                  <input type="number" value={form.pay_amount}
                    onChange={e => set('pay_amount', e.target.value)}
                    placeholder={placement.final_price ? `ตกลง ${Number(placement.final_price).toLocaleString()}` : ''}
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

            {showManualMetrics && (
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                  {isYoutube ? 'YouTube Stats' : 'Lemon8 Stats'} (ไม่บังคับ)
                </p>
                <div className="grid grid-cols-2 gap-2">
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
              ยกเลิก
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 active:scale-95 transition-all">
              {saving ? 'กำลังบันทึก...' : 'บันทึกผล'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
