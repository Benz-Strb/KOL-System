import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { PlacementRow, PlacementRepost } from '../api/index.js';
import { getReposts, createRepost, deleteRepost, saveRepostMetrics } from '../api/index.js';
import { useModalTransition } from '../hooks/useModalTransition.js';
import PlatformLogo from './PlatformLogo.js';

type Props = { placement: PlacementRow; onClose: () => void };

const inputCls = [
  'w-full px-3 py-2 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent',
].join(' ');
const labelCls = 'block text-xs font-medium text-muted mb-1 tracking-wide uppercase';

const CHANNELS = ['tiktok', 'instagram', 'facebook', 'youtube', 'lemon8'];

function MetricRow({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-mono font-medium text-ink">{value.toLocaleString()}</span>
    </div>
  );
}

type MetricForm = { channel: string; measured_at: string; vdo_view: string; likes: string; comments: string; saves: string; shares: string };

function RepostCard({ repost, platformName, onDeleted, onMetricsSaved }: {
  repost: PlacementRepost;
  platformName: string;
  onDeleted: () => void;
  onMetricsSaved: (updated: PlacementRepost) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [metricForm, setMetricForm] = useState<MetricForm>({
    channel: platformName.toLowerCase(),
    measured_at: new Date().toISOString().slice(0, 10),
    vdo_view: '', likes: '', comments: '', saves: '', shares: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const setM = (k: keyof MetricForm, v: string) => setMetricForm(f => ({ ...f, [k]: v }));

  const isYoutube = metricForm.channel === 'youtube';
  const isTiktok = metricForm.channel === 'tiktok';
  const showViews = isYoutube || isTiktok;
  const showSaves = !isYoutube;

  async function handleSaveMetrics() {
    setSaving(true); setError('');
    try {
      await saveRepostMetrics(repost.placement_id, repost.id, {
        channel: metricForm.channel,
        measured_at: metricForm.measured_at || undefined,
        vdo_view: showViews && metricForm.vdo_view ? Number(metricForm.vdo_view) : null,
        likes: metricForm.likes ? Number(metricForm.likes) : null,
        comments: metricForm.comments ? Number(metricForm.comments) : null,
        saves: showSaves && metricForm.saves ? Number(metricForm.saves) : null,
        shares: metricForm.shares ? Number(metricForm.shares) : null,
      });
      const updated = await getReposts(repost.placement_id);
      const fresh = updated.find(r => r.id === repost.id);
      if (fresh) onMetricsSaved(fresh);
      setExpanded(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('repost.confirmDelete'))) return;
    setDeleting(true);
    try {
      await deleteRepost(repost.placement_id, repost.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  }

  const metric = repost.placement_metrics[0];

  return (
    <div className="border border-hairline rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-surface">
        <span className="text-xs font-semibold text-white bg-accent rounded-full px-2 py-0.5 shrink-0">
          {t('repost.round', { n: repost.round_number })}
        </span>
        <span className="text-xs text-muted">
          {repost.posted_by === 'brand' ? t('repost.postedByBrand') : t('repost.postedByKol')}
        </span>
        {repost.posted_at && (
          <span className="text-xs text-muted">{new Date(repost.posted_at).toLocaleDateString()}</span>
        )}
        {repost.post_url && (
          <a href={repost.post_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-accent hover:underline truncate max-w-[140px]">
            {repost.post_url.replace(/^https?:\/\//, '')}
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 text-muted hover:text-ink hover:bg-canvas rounded-lg transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-muted hover:text-red-500 hover:bg-canvas rounded-lg transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* existing metrics summary */}
      {metric && !expanded && (
        <div className="px-4 py-2.5 bg-canvas border-t border-hairline grid grid-cols-2 gap-x-6 gap-y-1">
          <MetricRow label="Views" value={metric.vdo_view} />
          <MetricRow label="Likes" value={metric.likes} />
          <MetricRow label="Comments" value={metric.comments} />
          <MetricRow label="Saves" value={metric.saves} />
          <MetricRow label="Shares" value={metric.shares} />
        </div>
      )}

      {/* metrics entry form */}
      {expanded && (
        <div className="px-4 py-4 bg-canvas border-t border-hairline space-y-3">
          <p className="text-xs font-medium text-muted uppercase tracking-wider">
            {repost.posted_by === 'kol' ? t('repost.metricsTitle') : 'Stats'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('repost.channel')}</label>
              <div className="relative">
                <select value={metricForm.channel} onChange={e => setM('channel', e.target.value)}
                  className={inputCls}>
                  {CHANNELS.map(ch => (
                    <option key={ch} value={ch}>{ch.charAt(0).toUpperCase() + ch.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>วันที่วัด</label>
              <input type="date" value={metricForm.measured_at} onChange={e => setM('measured_at', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {showViews && (
              <div>
                <label className={labelCls}>Views</label>
                <input type="number" min="0" value={metricForm.vdo_view}
                  onChange={e => setM('vdo_view', e.target.value)} placeholder="0" className={inputCls} />
              </div>
            )}
            <div>
              <label className={labelCls}>Likes</label>
              <input type="number" min="0" value={metricForm.likes}
                onChange={e => setM('likes', e.target.value)} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Comments</label>
              <input type="number" min="0" value={metricForm.comments}
                onChange={e => setM('comments', e.target.value)} placeholder="0" className={inputCls} />
            </div>
            {showSaves && (
              <div>
                <label className={labelCls}>Saves</label>
                <input type="number" min="0" value={metricForm.saves}
                  onChange={e => setM('saves', e.target.value)} placeholder="0" className={inputCls} />
              </div>
            )}
            <div>
              <label className={labelCls}>Shares</label>
              <input type="number" min="0" value={metricForm.shares}
                onChange={e => setM('shares', e.target.value)} placeholder="0" className={inputCls} />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setExpanded(false)}
              className="flex-1 px-3 py-1.5 border border-hairline rounded-full text-xs text-ink hover:bg-surface transition-colors">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handleSaveMetrics} disabled={saving}
              className="flex-1 px-3 py-1.5 bg-accent text-white rounded-full text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors">
              {saving ? t('common.saving') : t('repost.saveMetrics')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RepostModal({ placement, onClose }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);
  const [reposts, setReposts] = useState<PlacementRepost[]>([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState<{ posted_by: 'brand' | 'kol'; post_url: string; posted_at: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const platformName = placement.platforms?.name ?? '';

  useEffect(() => {
    getReposts(placement.id).then(setReposts).finally(() => setLoading(false));
  }, [placement.id]);

  async function handleAdd() {
    if (!addForm) return;
    setAdding(true); setAddError('');
    try {
      await createRepost(placement.id, {
        posted_by: addForm.posted_by,
        post_url: addForm.post_url.trim() || undefined,
        posted_at: addForm.posted_at || undefined,
      });
      const updated = await getReposts(placement.id);
      setReposts(updated);
      setAddForm(null);
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setAdding(false);
    }
  }

  const kolName = placement.kols?.handle ?? '—';
  const campaignLabel = placement.campaigns?.label ?? placement.campaigns?.code ?? '—';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div
        className={`bg-surface border border-hairline rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline shrink-0">
          <div className="flex items-center gap-2">
            <PlatformLogo name={platformName} size={18} />
            <h3 className="font-semibold text-ink tracking-tight">{t('repost.title')}</h3>
          </div>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* placement info */}
        <div className="px-6 pt-4 shrink-0">
          <div className="bg-canvas border border-hairline rounded-xl px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="text-xs"><span className="text-muted">KOL </span><span className="text-ink font-medium">{kolName}</span></div>
            <div className="text-xs"><span className="text-muted">Platform </span><span className="text-ink">{platformName || '—'}</span></div>
            <div className="text-xs"><span className="text-muted">Campaign </span><span className="text-ink">{campaignLabel}</span></div>
          </div>
        </div>

        {/* repost list */}
        <div className="px-6 py-4 flex-1 overflow-y-auto space-y-3">
          {loading ? (
            <p className="text-sm text-muted text-center py-4">{t('common.loading')}</p>
          ) : reposts.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">{t('repost.noReposts')}</p>
          ) : (
            reposts.map(r => (
              <RepostCard
                key={r.id}
                repost={r}
                platformName={platformName}
                onDeleted={() => setReposts(prev => prev.filter(x => x.id !== r.id))}
                onMetricsSaved={updated => setReposts(prev => prev.map(x => x.id === updated.id ? updated : x))}
              />
            ))
          )}

          {/* add form */}
          {addForm ? (
            <div className="border border-accent/30 rounded-xl px-4 py-4 bg-canvas space-y-3">
              <p className="text-xs font-medium text-muted uppercase tracking-wider">{t('repost.addRound')}</p>
              <div>
                <label className={labelCls}>{t('repost.postedBy')}</label>
                <div className="flex gap-2">
                  {(['brand', 'kol'] as const).map(v => (
                    <button key={v} type="button"
                      onClick={() => setAddForm(f => f ? { ...f, posted_by: v } : f)}
                      className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${addForm.posted_by === v ? 'bg-accent text-white border-accent' : 'border-hairline text-ink hover:bg-surface'}`}>
                      {v === 'brand' ? t('repost.postedByBrand') : t('repost.postedByKol')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('repost.postedAt')}</label>
                  <input type="date" value={addForm.posted_at}
                    onChange={e => setAddForm(f => f ? { ...f, posted_at: e.target.value } : f)}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('repost.postUrl')}</label>
                  <input type="url" value={addForm.post_url} placeholder="https://..."
                    onChange={e => setAddForm(f => f ? { ...f, post_url: e.target.value } : f)}
                    className={inputCls} />
                </div>
              </div>
              {addError && <p className="text-xs text-red-500">{addError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAddForm(null); setAddError(''); }}
                  className="flex-1 px-3 py-1.5 border border-hairline rounded-full text-xs text-ink hover:bg-surface transition-colors">
                  {t('common.cancel')}
                </button>
                <button type="button" onClick={handleAdd} disabled={adding}
                  className="flex-1 px-3 py-1.5 bg-accent text-white rounded-full text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors">
                  {adding ? t('common.saving') : t('common.add')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button"
              onClick={() => setAddForm({ posted_by: 'kol', post_url: '', posted_at: '' })}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-hairline rounded-xl text-sm text-muted hover:text-ink hover:border-ink transition-colors">
              <Plus size={14} />
              {t('repost.addRound')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
