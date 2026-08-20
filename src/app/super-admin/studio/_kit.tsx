import Link from "next/link";
// Shared presentation kit — extracted, not redesigned.
 

// Carried with it — the declarations its body depends on, lifted from the same file so the kit is
// self-contained.
type Mod = { code: string; icon: string; label: string; desc: string; href?: string; stat?: string | null; planned?: boolean };

// Lifted verbatim from src/app/super-admin/studio/assessment/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function ModuleCard({ m }: { m: Mod }) {
  const inner = (
    <>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-xl shrink-0">{m.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-gray-500 tracking-widest">{m.code}</p>
          <p className={`font-bold text-sm leading-tight ${m.planned ? "text-gray-500" : "text-gray-900 group-hover:text-teal-700"}`}>{m.label}</p>
        </div>
        {m.planned && <span className="ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] px-1.5 py-0.5 rounded">Planned</span>}
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">{m.desc}</p>
      {m.stat && <p className="text-[10px] font-semibold text-teal-600 mt-2">{m.stat}</p>}
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href
    ? <Link href={m.href} className={`${base} hover:border-teal-200 hover:shadow-sm transition-all group`}>{inner}</Link>
    : <div className={`${base} opacity-80`}>{inner}</div>;
}
