import { useState, useEffect, type ReactNode } from 'react';
import { X, ExternalLink, TrendingUp, Wallet, Gauge, PackageCheck, CalendarClock, XCircle } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { getKolTrend, type KolTrendOverview } from '../api/index.js';
import { useModalTransition } from '../hooks/useModalTransition.js';

type Props = {
  kolId: number;
  brandId?: string;
  onClose: () => void;
};

function formatMoney(n: number) {
  return '฿' + Math.round(n).toLocaleString('th-TH');
}

function formatAxisMoney(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function formatFollower(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function StatChip({ icon, label, value, tone = 'neutral' }: { icon: ReactNode; label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const toneCls = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-500' : 'text-ink';
  return (
    <div className="flex flex-col gap-1 bg-canvas border border-hairline rounded-xl px-3 py-2.5 flex-1 min-w-[110px]">
      <div className="flex items-center gap-1.5 text-muted">
        <span className="shrink-0">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <span className={`text-base font-bold tabular-nums ${toneCls}`}>{value}</span>
    </div>
  );
}

export default function KolTrendModal({ kolId, brandId, onClose }: Props) {
  const { closed, requestClose } = useModalTransition(onClose);
  const [data, setData] = useState<KolTrendOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    getKolTrend(kolId, { brand_id: brandId })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'))
      .finally(() => setLoading(false));
  }, [kolId, brandId]);

  const chartData = data ? data.trend.map(t => ({ ...t, name: t.code ?? 'ไม่มีแคมเปญ' })) : [];

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div className={`bg-surface border border-hairline rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-hairline shrink-0">
          <div className="min-w-0 flex-1">
            {data ? (
              <div className="flex items-center gap-2 flex-wrap">
                {data.kol.profile_url ? (
                  <a href={data.kol.profile_url} target="_blank" rel="noopener noreferrer"
                    className="font-semibold text-ink hover:text-accent transition-colors inline-flex items-center gap-1">
                    {data.kol.handle}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="font-semibold text-ink">{data.kol.handle}</span>
                )}
                {data.kol.follower_count != null && (
                  <span className="text-[11px] text-muted bg-canvas border border-hairline px-1.5 py-px rounded-md tabular-nums">
                    {formatFollower(data.kol.follower_count)}
                  </span>
                )}
                {data.kol.platform && <span className="text-[11px] text-muted">{data.kol.platform.name}</span>}
              </div>
            ) : (
              <span className="font-semibold text-ink">กำลังโหลด...</span>
            )}
            {data?.kol.gen_name && <p className="text-xs text-muted mt-0.5">{data.kol.gen_name}</p>}
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
                <StatChip icon={<TrendingUp size={12} />} label="GMV รวม" value={formatMoney(data.totals.total_gmv)} />
                <StatChip icon={<Wallet size={12} />} label="ค่าใช้จ่ายรวม" value={formatMoney(data.totals.total_spend)} />
                <StatChip icon={<Gauge size={12} />} label="ROI" value={data.totals.roi != null ? `x${data.totals.roi.toFixed(2)}` : '—'} />
                <StatChip icon={<PackageCheck size={12} />} label="โพสต์แล้ว" value={String(data.reliability.posted_count)} tone="good" />
                <StatChip icon={<CalendarClock size={12} />} label="วางแผน" value={String(data.reliability.planned_count)} />
                <StatChip icon={<XCircle size={12} />} label="ยกเลิก" value={String(data.reliability.cancelled_count)} tone={data.reliability.cancelled_count > 0 ? 'bad' : 'neutral'} />
              </div>
              <p className="text-[11px] text-muted">ค่าใช้จ่ายรวม/ROI ที่นี่นับเฉพาะค่าจ้าง KOL (ไม่รวม Ads Cost) — ดูความคุ้มค่าตัว KOL เอง</p>
              {data.reliability.delivery_rate != null && (
                <p className="text-xs text-muted">
                  อัตราทำตามนัด (โพสต์ ÷ โพสต์+ยกเลิก): <span className="font-semibold text-ink">{(data.reliability.delivery_rate * 100).toFixed(0)}%</span>
                </p>
              )}

              {/* Trend chart */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-3">เทรนด์ GMV / ค่าใช้จ่าย / ROI ต่อแคมเปญ</h3>
                {chartData.length === 0 ? (
                  <p className="text-sm text-muted">ยังไม่มีข้อมูลแคมเปญ</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={chartData} margin={{ left: -16, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={50} />
                      <YAxis yAxisId="money" tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                      <YAxis yAxisId="roi" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `x${v}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                        labelStyle={{ color: 'var(--ink)' }}
                        formatter={(v, n) => {
                          if (n === 'roi') return [v != null ? `x${Number(v).toFixed(2)}` : '—', 'ROI'];
                          return [formatMoney(Number(v ?? 0)), n === 'gmv' ? 'GMV' : 'ค่าใช้จ่าย'];
                        }}
                      />
                      <Legend formatter={(v: string) => (v === 'gmv' ? 'GMV' : v === 'spend' ? 'ค่าใช้จ่าย' : 'ROI')} wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="money" dataKey="gmv" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={500} />
                      <Bar yAxisId="money" dataKey="spend" fill="#f97316" radius={[4, 4, 0, 0]} animationDuration={500} />
                      <Line yAxisId="roi" dataKey="roi" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls animationDuration={500} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
