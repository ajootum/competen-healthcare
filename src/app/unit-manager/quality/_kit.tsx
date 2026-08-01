// Shared presentation kit — extracted, not redesigned.
 

// Lifted verbatim from src/app/unit-manager/quality/audits/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function SegDonut({ segments, total }: { segments: { n: number; color: string }[]; total: number }) {
  const sum = segments.reduce((a, s) => a + s.n, 0) || 1;
  const active = segments.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const before = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(before / sum) * 360}deg ${((before + s.n) / sum) * 360}deg`; }).join(", ")})` : "conic-gradient(#f1f5f9 0deg 360deg)";
  return <div className="relative w-[128px] h-[128px] shrink-0" style={{ background: grad, borderRadius: "9999px" }}><div className="absolute inset-[18px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{total}</span><span className="text-[10px] text-gray-400">Total</span></div></div>;
}
