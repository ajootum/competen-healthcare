// The encounter trend, drawn as bars.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A BAR IS A COUNT DRAWN TO SCALE, WHICH IS NOT A RATE -- and the numbers stay readable beside it.
//
// The comp draws a smoothed line with a dashed "previous period" overlay. A line implies interpolation
// between points, and there is nothing between two days: a practice either saw people on Tuesday or it
// did not. Bars say the same thing without implying a continuum that does not exist.
//
// NO AXIS SCALE IS PRINTED, deliberately. An axis invites reading a value off the picture; the tallest
// day carries its number, and the tooltip carries every day's. The picture is for shape, the text is for
// fact -- the same division CPR-330 makes about most-used templates.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Server component: it holds no state and needs no interactivity beyond a title attribute, so it ships
// no JavaScript at all.

export default function Trend({ buckets }: { buckets: { day: string; total: number }[] }) {
  const peak = Math.max(1, ...buckets.map(b => b.total));
  const total = buckets.reduce((n, b) => n + b.total, 0);

  if (total === 0) {
    return (
      <p className="mt-3 text-[12px] text-gray-400">
        Nothing recorded in this period. That is a fact about the period, not a gap in the data.
      </p>
    );
  }

  return (
    <>
      <div className="mt-3 flex h-24 items-end gap-[2px]" role="img"
        aria-label={`Consultations per day: ${total} across ${buckets.length} days, busiest ${peak}`}>
        {buckets.map(b => (
          <span key={b.day} className="flex-1 rounded-t bg-[var(--cp-primary)]"
            // The height is the only thing the picture says; the title carries the fact.
            style={{ height: `${Math.max(b.total === 0 ? 1 : 6, (b.total / peak) * 100)}%`,
              opacity: b.total === 0 ? 0.15 : 1 }}
            title={`${b.day}: ${b.total}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{buckets[0]?.day}</span>
        <span>busiest day: {peak}</span>
        <span>{buckets[buckets.length - 1]?.day}</span>
      </div>
    </>
  );
}
