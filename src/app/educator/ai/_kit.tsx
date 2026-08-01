// Shared presentation kit — extracted, not redesigned.
 

// Lifted verbatim from src/app/educator/ai/competency/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function DonutA({ slices, center, sub }: { slices: { label: string; n: number; color: string }[]; center: string; sub: string }) {
  const totalN = slices.reduce((s, x) => s + x.n, 0) || 1;
  const C = 2 * Math.PI * 15.9;
  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        {slices.map((s, i) => { const prev = slices.slice(0, i).reduce((a, b) => a + b.n, 0); const dash = (s.n / totalN) * C; return <circle key={s.label} cx="18" cy="18" r="15.9" fill="none" stroke={s.color} strokeWidth="4" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-(prev / totalN) * C} />; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-base font-extrabold text-white">{center}</span><span className="text-[8px] text-slate-500">{sub}</span></div>
    </div>
  );
}

// Lifted verbatim from src/app/educator/ai/educator/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function DonutB({ slices, center, sub }: { slices: { label: string; n: number; color: string }[]; center: string; sub: string }) {
  const totalN = slices.reduce((s, x) => s + x.n, 0) || 1;
  const C = 2 * Math.PI * 15.9;
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        {slices.map((s, i) => { const prev = slices.slice(0, i).reduce((a, b) => a + b.n, 0); const dash = (s.n / totalN) * C; return <circle key={s.label} cx="18" cy="18" r="15.9" fill="none" stroke={s.color} strokeWidth="4" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-(prev / totalN) * C} />; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-white">{center}</span><span className="text-[8px] text-slate-500">{sub}</span></div>
    </div>
  );
}


// ── Competency navigator ─────────────────────────────────────────────────────
// The last duplicated component in the app: an identical NavTree in two educator AI pages.
//
// It could not be lifted mechanically because it depends on TWO TYPES FROM A LIB MODULE (NavNode, Tint) and
// a tone table — so the codemod refused it by name every time, correctly. Moving it is a small deliberate
// edit: the types are imported here, the table comes with it, and both pages import the pair.
//
// TINT_DOT moves rather than being copied because both pages use it for MORE than the tree (the competency
// page tints its health tiles with it too). Leaving a copy behind would have re-created the duplication
// this is removing.
// TWO LIB MODULES DECLARE THESE TYPES IDENTICALLY — competency-intelligence and educator-intelligence
// each export their own `NavNode = { id, name, meta, tint, children }` and the same four-value `Tint`.
// TypeScript accepts either here because they are structurally the same, which is why one component can
// serve both pages. Recorded rather than left implicit: if the two ever diverge, this import decides which
// one the shared tree is typed against, and the other page will start failing to compile — which is the
// right outcome, but only obvious if you know the two exist.
import type { NavNode, Tint } from "@/lib/competency-intelligence";

export const TINT_DOT: Record<Tint, string> = { green: "bg-[var(--cmp-color-success)]", amber: "bg-[var(--cmp-color-warning)]", red: "bg-[var(--cmp-color-error)]", muted: "bg-slate-600" };

export function NavTree({ node, depth }: { node: NavNode; depth: number }) {
  const dot = <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TINT_DOT[node.tint]}`} />;
  if (!node.children.length) return <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: `${depth * 12 + 8}px` }}>{dot}<span className="text-[12px] text-slate-300 truncate">{node.name}</span><span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span></div>;
  return (
    <details open={depth < 1} className="group">
      <summary className="flex items-center gap-2 py-1 pr-2 cursor-pointer list-none hover:bg-white/[0.03] rounded" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <span className="text-[9px] text-slate-500 transition-transform group-open:rotate-90">▶</span>{dot}<span className="text-[12px] font-medium text-slate-200 truncate">{node.name}</span><span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span>
      </summary>
      <div>{node.children.map(c => <NavTree key={c.id} node={c} depth={depth + 1} />)}</div>
    </details>
  );
}
