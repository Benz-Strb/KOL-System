const TIER_COLOR: Record<number, string> = {
  1: '#c9a227', // ทอง
  2: '#9098a3', // เงิน
  3: '#b9743a', // ทองแดง
};

export default function RankBadge({ rank }: { rank: number }) {
  const tierColor = TIER_COLOR[rank];

  if (tierColor) {
    return (
      <div
        className="w-7 h-8 flex items-center justify-center text-white text-xs font-extrabold shrink-0"
        style={{
          background: tierColor,
          clipPath: 'polygon(0 0, 100% 0, 100% 72%, 50% 100%, 0 72%)',
        }}
      >
        {rank}
      </div>
    );
  }

  return (
    <div className="w-[26px] h-[26px] rounded-lg bg-canvas text-muted text-[11px] font-semibold flex items-center justify-center shrink-0">
      {rank}
    </div>
  );
}
