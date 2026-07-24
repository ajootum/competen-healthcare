import Link from "next/link";

// Shared honest next-phase / cross-link body for Patient Operations modules that need
// a store the platform doesn't have yet, or whose data entry lives in the shared SSW
// operational surface. Presentational only — the page supplies the tabbed header. Every
// instance names the spec objects it will hold and where the authoritative action lives,
// so the surface is honest about what is and isn't built rather than faking data.
const card = "bg-white rounded-xl border border-gray-200";

export default function PosPlaceholder({ banner, sections, footer, cta }: {
  banner: string;
  sections: { heading: string; items: string[] }[];
  footer: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3"><span className="text-lg">🚧</span><p className="text-sm text-amber-900 max-w-3xl">{banner}</p></div>
        {cta && <Link href={cta.href} className="text-sm rounded-lg bg-emerald-600 text-white px-3.5 py-2 hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0">{cta.label} →</Link>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sections.map(s => (
          <div key={s.heading} className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">{s.heading}</h3>
            <ul className="space-y-1.5">{s.items.map((it, i) => <li key={i} className="flex items-start gap-2 text-xs text-gray-600"><span className="text-gray-300 mt-0.5">◦</span><span>{it}</span></li>)}</ul>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">{footer}</p>
    </div>
  );
}
