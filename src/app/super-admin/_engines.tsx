import Link from "next/link";

// Super-admin section index — the "here are this platform's engines" landing pattern.
//
// WHY THIS IS A HAND-WRITTEN MODULE AND NOT A LIFTED COPY. Four section landing pages (Assurance, CGR,
// Delivery, Performance) each carried their own Status/Mod/BADGE/EngineCard/Layer. `Layer` was IDENTICAL
// in all four; `EngineCard` was different in every one — and the only difference was the ACCENT COLOUR.
// So the duplication could not be removed mechanically: a shared Layer would have bound to one page's
// card and silently restyled the other three.
//
// The accent is therefore an explicit prop rather than something each page re-implements a component to
// express. That is a small design decision, made deliberately: it is the difference between four copies
// that happen to differ and one component that is told what it is.
//
// EVERY ACCENT REPRODUCES ITS PAGE'S EXISTING CLASSES VERBATIM — two of them are already tokenised and two
// are still raw Tailwind, and they are left exactly as each page had them. Unifying those four into one
// palette is a separate decision about how these sections should relate, not something to slip into a
// de-duplication pass. scripts/pui-migration-harness.ts pins each pair.

export type Status = "real" | "linked" | "partial" | "gap";
export type Mod = { code: string; icon: string; label: string; desc: string; href?: string; status: Status };

export const BADGE: Record<Status, { text: string; cls: string }> = {
  real: { text: "Live", cls: "text-teal-700 bg-teal-50 border-teal-100" },
  linked: { text: "Linked", cls: "text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)]" },
  partial: { text: "Partial", cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" },
  gap: { text: "Planned", cls: "text-gray-500 bg-gray-50 border-gray-100" },
};

// label = the hover colour on the module name, border = the hover colour on the card edge. Both taken
// verbatim from the page that used them, so no section changes appearance.
export type Accent = keyof typeof ACCENT;
export const ACCENT = {
  indigo:      { label: "group-hover:text-indigo-700", border: "hover:border-indigo-200" },                                         // Assurance
  emerald:     { label: "group-hover:text-emerald-700", border: "hover:border-[var(--cmp-color-success)]" },                        // CGR
  violet:      { label: "group-hover:text-violet-700", border: "hover:border-violet-200" },                                         // Delivery
  information: { label: "group-hover:text-[var(--cmp-text-information)]", border: "hover:border-[var(--cmp-color-information)]" },  // Performance
} as const;

export function EngineCard({ m, accent = "indigo" }: { m: Mod; accent?: Accent }) {
  const b = BADGE[m.status];
  const a = ACCENT[accent];
  const inner = (
    <>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-xl shrink-0">{m.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-gray-500 tracking-widest">{m.code}</p>
          <p className={`font-bold text-sm leading-tight ${m.status === "gap" ? "text-gray-500" : `text-gray-900 ${a.label}`}`}>{m.label}</p>
        </div>
        <span className={`ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded ${b.cls}`}>{b.text}</span>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">{m.desc}</p>
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href
    ? <Link href={m.href} className={`${base} ${a.border} hover:shadow-sm transition-all group`}>{inner}</Link>
    : <div className={`${base} opacity-80`}>{inner}</div>;
}

export function Layer({ title, mods, accent = "indigo" }: { title: string; mods: Mod[]; accent?: Accent }) {
  return (
    <>
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">{mods.map(m => <EngineCard key={m.code} m={m} accent={accent} />)}</div>
    </>
  );
}
