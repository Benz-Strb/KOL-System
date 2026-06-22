import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { PlacementRow, PlacementMetric } from '../api/index.js';
import { getPlacementMetrics } from '../api/index.js';
import { useModalTransition } from '../hooks/useModalTransition.js';

type Props = { placement: PlacementRow; onClose: () => void; };

const CHANNEL_LABELS: Record<string, string> = {
  shopee: 'Shopee',
  lazada: 'Lazada',
  website: 'Website',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  lamon8: 'Lemon8',
};

function fmt(val: string | number | null | undefined, type: 'int' | 'thb' = 'int'): string {
  if (val == null) return '—';
  const n = Number(val);
  if (isNaN(n)) return '—';
  if (type === 'thb') return n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' ฿';
  return n.toLocaleString('th-TH');
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-hairline last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-medium text-ink tabular-nums">{value}</span>
    </div>
  );
}

function ChannelCard({ metric }: { metric: PlacementMetric }) {
  const ch = metric.channel;
  const isMarketplace = ['shopee', 'lazada', 'website'].includes(ch);
  const isTiktok = ch === 'tiktok';
  const isYoutube = ch === 'youtube';
  const isLamon8 = ch === 'lamon8';

  return (
    <div className="border border-hairline rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-ink">{CHANNEL_LABELS[ch] ?? ch}</span>
        <div className="flex items-center gap-2">
          {metric.is_automated && (
            <span className="text-xs text-muted bg-canvas px-1.5 py-0.5 rounded-full border border-hairline">auto</span>
          )}
          {metric.measured_at && (
            <span className="text-xs text-muted">
              {new Date(metric.measured_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      </div>
      <div>
        {isMarketplace && (
          <>
            <Row label="Visits" value={fmt(metric.visits)} />
            <Row label="ATC" value={fmt(metric.atc)} />
            {ch === 'shopee' && <Row label="ATC Value" value={fmt(metric.atc_value, 'thb')} />}
            <Row label="Orders" value={fmt(metric.orders)} />
            <Row label="GMV" value={fmt(metric.gmv, 'thb')} />
          </>
        )}
        {isTiktok && (
          <>
            <Row label="VDO Views" value={fmt(metric.vdo_view)} />
            <Row label="Clicks" value={fmt(metric.clicks)} />
            <Row label="Ads Spend" value={fmt(metric.ads_spend, 'thb')} />
            <Row label="Orders" value={fmt(metric.orders)} />
            <Row label="GMV" value={fmt(metric.gmv, 'thb')} />
          </>
        )}
        {isYoutube && (
          <>
            <Row label="Views" value={fmt(metric.vdo_view)} />
            <Row label="Likes" value={fmt(metric.likes)} />
            <Row label="Comments" value={fmt(metric.comments)} />
          </>
        )}
        {isLamon8 && (
          <>
            <Row label="Likes" value={fmt(metric.likes)} />
            <Row label="Comments" value={fmt(metric.comments)} />
            <Row label="Saves" value={fmt(metric.saves)} />
          </>
        )}
      </div>
    </div>
  );
}

export default function MetricsViewModal({ placement, onClose }: Props) {
  const { closed, requestClose } = useModalTransition(onClose);
  const [metrics, setMetrics] = useState<PlacementMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlacementMetrics(placement.id)
      .then(setMetrics)
      .finally(() => setLoading(false));
  }, [placement.id]);

  const kolName = placement.kols?.handle ?? '—';
  const platformLabel = placement.platforms?.name ?? '—';
  const campaignLabel = placement.campaigns?.label ?? placement.campaigns?.code ?? '—';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div className={`bg-surface border border-hairline rounded-2xl shadow-2xl w-full max-w-lg transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h3 className="font-semibold text-ink tracking-tight">ผลลัพธ์</h3>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 pt-4 pb-6">
          <div className="bg-canvas border border-hairline rounded-xl px-3 py-2.5 mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="text-xs"><span className="text-muted">KOL </span><span className="text-ink font-medium">{kolName}</span></div>
            <div className="text-xs"><span className="text-muted">Platform </span><span className="text-ink">{platformLabel}</span></div>
            <div className="text-xs col-span-2"><span className="text-muted">Campaign </span><span className="text-ink">{campaignLabel}</span></div>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : metrics.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">ยังไม่มีข้อมูลผลลัพธ์</p>
          ) : (
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-0.5">
              {metrics.map(m => <ChannelCard key={m.id} metric={m} />)}
            </div>
          )}

          <div className="mt-4">
            <button type="button" onClick={requestClose}
              className="w-full px-4 py-2 border border-hairline rounded-full text-sm text-ink hover:bg-canvas active:scale-95 transition-all">
              ปิด
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
