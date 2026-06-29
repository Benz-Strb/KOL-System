import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import {
  getPlacement, getPlacementMetrics, getReposts,
  type PlacementRow, type PlacementMetric, type PlacementRepost,
} from '../api/index.js';
import KolAvatar from '../components/KolAvatar.js';
import PlatformLogo from '../components/PlatformLogo.js';
import BrandLogo from '../components/BrandLogo.js';
import { numberLocale } from '../i18n/locale.js';

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

const STATUS_STYLE: Record<string, string> = {
  planned:   'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25',
  posted:    'bg-green-100 text-green-800 ring-1 ring-green-200 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/25',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-[#86868b]',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-hairline last:border-0">
      <span className="text-xs text-muted w-32 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-ink font-medium min-w-0">{children}</span>
    </div>
  );
}

export default function PlacementDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [placement, setPlacement] = useState<PlacementRow | null>(null);
  const [metrics, setMetrics] = useState<PlacementMetric[]>([]);
  const [reposts, setReposts] = useState<PlacementRepost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const pid = Number(id);
    if (!Number.isInteger(pid)) { setError(true); setLoading(false); return; }
    setLoading(true);
    Promise.all([getPlacement(pid), getPlacementMetrics(pid), getReposts(pid)])
      .then(([p, m, r]) => { setPlacement(p); setMetrics(m); setReposts(r); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !placement) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-screen-md mx-auto">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4">
          <ArrowLeft size={15} /> {t('placementDetail.back')}
        </button>
        <p className="text-sm text-muted">{t('placementDetail.notFound')}</p>
      </div>
    );
  }

  const handle = placement.kols?.handle ?? '';
  const modelOrStore = placement.placement_type === 'online'
    ? placement.products?.model_code ?? null
    : placement.stores ? `${placement.stores.name}${placement.stores.branch ? ` · ${placement.stores.branch}` : ''}` : null;
  const fmtPrice = (p: string | null) => p ? Number(p).toLocaleString(numberLocale()) + ' ฿' : t('placementDetail.none');

  return (
    <div className="px-4 sm:px-6 py-6 max-w-screen-md mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4 transition-colors">
        <ArrowLeft size={15} /> {t('placementDetail.back')}
      </button>

      {/* KOL header */}
      <div className="bg-surface border border-hairline rounded-xl p-5 mb-4">
        <div className="flex items-center gap-3">
          {handle && <KolAvatar handle={handle} avatarUrl={placement.kols?.avatar_url} size="md" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {safeUrl(placement.kols?.profile_url) ? (
                <a href={safeUrl(placement.kols?.profile_url)!} target="_blank" rel="noopener noreferrer"
                  className="font-semibold text-ink hover:text-accent inline-flex items-center gap-1">
                  {handle} <ExternalLink size={12} className="text-muted" />
                </a>
              ) : (
                <span className="font-semibold text-ink">{handle || '—'}</span>
              )}
              {placement.brands && <BrandLogo name={placement.brands.name} logoUrl={placement.brands.logo_url} size={18} />}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
              {placement.platforms?.name && <PlatformLogo name={placement.platforms.name} size={14} />}
              <span>{placement.placement_type === 'online' ? 'Online' : 'Offline'}</span>
              {placement.kols?.content_categories?.name && <span>· {placement.kols.content_categories.name}</span>}
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_STYLE[placement.status] ?? STATUS_STYLE.planned}`}>
            {placement.status}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="bg-surface border border-hairline rounded-xl p-5 mb-4">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t('placementDetail.sectionInfo')}</h2>
        {placement.campaigns?.code && <DetailRow label={t('placementDetail.campaign')}>{placement.campaigns.code}{placement.campaigns.label ? ` · ${placement.campaigns.label}` : ''}</DetailRow>}
        {modelOrStore && <DetailRow label={placement.placement_type === 'online' ? t('placementDetail.product') : t('placementDetail.store')}>{modelOrStore}</DetailRow>}
        <DetailRow label={t('placementDetail.plannedDate')}>{placement.target_pub_date ?? t('placementDetail.none')}</DetailRow>
        <DetailRow label={t('placementDetail.actualDate')}>{placement.publication_date ?? t('placementDetail.none')}</DetailRow>
        <DetailRow label={t('placementDetail.payment')}>{placement.payment_type}</DetailRow>
        <DetailRow label={t('placementDetail.price')}>{fmtPrice(placement.final_price)}</DetailRow>
        {placement.users_placements_person_in_charge_idTousers?.full_name && (
          <DetailRow label={t('placementDetail.pic')}>{placement.users_placements_person_in_charge_idTousers.full_name}</DetailRow>
        )}
        {placement.notes && <DetailRow label={t('placementDetail.notes')}>{placement.notes}</DetailRow>}
        {safeUrl(placement.post_url) && (
          <DetailRow label={t('placementDetail.postUrl')}>
            <a href={safeUrl(placement.post_url)!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              <ExternalLink size={12} /> {placement.post_url}
            </a>
          </DetailRow>
        )}
      </div>

      {/* Metrics */}
      <div className="bg-surface border border-hairline rounded-xl p-5 mb-4">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t('placementDetail.metrics')}</h2>
        {metrics.length === 0 ? (
          <p className="text-sm text-muted">{t('placementDetail.noMetrics')}</p>
        ) : (
          <div className="space-y-1.5">
            {metrics.map(m => (
              <div key={m.id} className="flex items-center justify-between text-sm py-1.5 border-b border-hairline last:border-0">
                <span className="font-medium text-ink capitalize">{m.channel}</span>
                <span className="text-muted tabular-nums font-mono text-xs">
                  GMV {m.gmv ? Number(m.gmv).toLocaleString(numberLocale()) : '—'} · Orders {m.orders ?? '—'} · Visits {m.visits ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reposts */}
      {reposts.length > 0 && (
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t('placementDetail.reposts')}</h2>
          <div className="space-y-1.5">
            {reposts.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b border-hairline last:border-0">
                <span className="font-medium text-ink">Round {r.round_number} · {r.posted_by}</span>
                {safeUrl(r.post_url) && <a href={safeUrl(r.post_url)!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-xs inline-flex items-center gap-1"><ExternalLink size={11} /> link</a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
