import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ExternalLink, TrendingUp, ShoppingCart, ListChecks, Users, Image as ImageIcon } from 'lucide-react';
import { getProductTrend, type ProductTrendOverview } from '../api/index.js';
import { useModalTransition } from '../hooks/useModalTransition.js';
import KolAvatar from './KolAvatar.js';
import PlatformLogo from './PlatformLogo.js';
import { numberLocale } from '../i18n/locale.js';

type Props = {
  productId: number;
  brandId?: string;
  campaignId?: string;
  dateFrom?: string;
  dateTo?: string;
  onClose: () => void;
  onSelectKol?: (kolId: number) => void;
};

function formatMoney(n: number) {
  return '฿' + Math.round(n).toLocaleString(numberLocale());
}

function formatFollower(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-canvas border border-hairline rounded-xl px-3 py-2.5 flex-1 min-w-[110px]">
      <div className="flex items-center gap-1.5 text-muted">
        <span className="shrink-0">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-base font-bold tabular-nums font-mono text-ink">{value}</span>
    </div>
  );
}

export default function ProductTrendModal({ productId, brandId, campaignId, dateFrom, dateTo, onClose, onSelectKol }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);
  const [data, setData] = useState<ProductTrendOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    getProductTrend(productId, { brand_id: brandId, campaign_id: campaignId, date_from: dateFrom, date_to: dateTo })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('common.error')))
      .finally(() => setLoading(false));
  }, [productId, brandId, campaignId, dateFrom, dateTo, t]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div className={`bg-surface border border-hairline rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-hairline shrink-0">
          <div className="min-w-0 flex-1 flex items-center gap-3">
            {data?.product.image_url ? (
              <img src={data.product.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 bg-canvas border border-hairline" />
            ) : (
              <span className="w-10 h-10 rounded-lg shrink-0 bg-canvas border border-hairline flex items-center justify-center text-muted">
                <ImageIcon size={16} />
              </span>
            )}
            <div className="min-w-0">
              <span className="font-semibold text-ink truncate block">{data ? data.product.model_code : t('productTrend.loading')}</span>
              {data?.product.category_name && <p className="text-xs text-muted mt-0.5 truncate">{data.product.category_name}</p>}
            </div>
          </div>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors ml-3 shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {loading ? (
            <div className="py-10 flex justify-center">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : !data ? null : (
            <>
              {/* Stat chips */}
              <div className="flex flex-wrap gap-2">
                <StatChip icon={<TrendingUp size={12} />} label={t('productTrend.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
                <StatChip icon={<ShoppingCart size={12} />} label={t('productTrend.totalOrders')} value={data.summary.total_orders.toLocaleString(numberLocale())} />
                <StatChip icon={<ListChecks size={12} />} label={t('productTrend.totalPlacements')} value={data.summary.total_placements.toLocaleString(numberLocale())} />
                <StatChip icon={<Users size={12} />} label={t('productTrend.kolCount')} value={data.summary.kol_count.toLocaleString(numberLocale())} />
              </div>

              {/* KOL list */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-3">{t('productTrend.kolListTitle')}</h3>
                {data.kols.length === 0 ? (
                  <p className="text-sm text-muted">{t('productTrend.noKols')}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {data.kols.map((k, i) => (
                      <div
                        key={k.kol_id}
                        onClick={onSelectKol ? () => onSelectKol(k.kol_id) : undefined}
                        className={`flex items-center gap-3 py-2.5 px-2 rounded-lg transition-colors ${onSelectKol ? 'hover:bg-canvas cursor-pointer' : ''}`}
                      >
                        <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{i + 1}</span>
                        <KolAvatar handle={k.handle ?? '?'} avatarUrl={k.avatar_url} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {k.profile_url ? (
                              <a href={k.profile_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                className="text-sm font-medium text-ink hover:text-accent transition-colors truncate inline-flex items-center gap-1">
                                {k.handle}
                                <ExternalLink size={10} className="shrink-0" />
                              </a>
                            ) : (
                              <span className="text-sm font-medium text-ink truncate">{k.handle}</span>
                            )}
                            <PlatformLogo name={k.platform_name} size={16} />
                          </div>
                          <div className="text-[11px] text-muted truncate flex items-center gap-1.5">
                            {k.gen_name && <span className="truncate">{k.gen_name}</span>}
                            {formatFollower(k.follower_count) && <span className="tabular-nums font-mono shrink-0">{formatFollower(k.follower_count)}</span>}
                          </div>
                        </div>
                        <span className="text-xs text-muted tabular-nums font-mono shrink-0">{t('dashboard.placementCountLabel', { count: k.placement_count })}</span>
                        <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{formatMoney(k.total_gmv)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
