import Link from "next/link";
import type { Figure } from "@/lib/hq/pd-support";

// The Support & Incidents view kit.
//
// ⚠ THE MISSING-EVIDENCE PATTERN IS TAKEN, NOT COPIED. CPR-CORE-MOS-001 §17 asks for one standard
// pattern; three modules had grown their own before the shared file existed. This module is the first
// built after it, and takes AbsentList, PlaneRefusal, Explain and Cite from there. Nothing in this file
// redefines them, which is why the doctrine harness's ratchet does not move.
export { Explain, Cite, Absent, AbsentList, PlaneRefusal } from "../../_components/evidence";

export function SupportHeader({ title, spec, purpose, readAt }: {
  title: string; spec: string; purpose: string; readAt: string;
}) {
  return (
    <header className="mb-4 border-b border-gray-200 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Support &amp; Incidents</p>
          <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">{purpose}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* GMT, so freshness means the same thing to two readers in two countries. */}
          <p className="font-mono text-[11px] text-gray-500">
            {new Date(readAt).toISOString().replace("T", " ").slice(0, 16)} GMT
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-gray-400">{spec}</p>
        </div>
      </div>
    </header>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** ⚠ COLOUR IS GRANTED ONLY TO A MEASUREMENT — an unread figure cannot wear a reassuring tint. */
export function Stat({ label, f, unit, tone }: {
  label: string; f: Figure; unit?: string; tone?: "warn";
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      {f.state === "value" ? (
        <p className={`mt-0.5 text-[22px] font-bold leading-none tracking-tight tabular-nums ${
          tone === "warn" && f.value > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
          {f.value.toLocaleString("en-GB")}
          {unit && <span className="ml-1 text-[12px] font-medium text-gray-400">{unit}</span>}
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-[13px] font-semibold text-gray-400">
            {f.state === "unknown" ? "Could not be read" : "No such record"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{f.why}</p>
        </>
      )}
    </div>
  );
}

const SEV_TONE: Record<string, string> = {
  "SEV-1 Critical": "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] text-[var(--cmp-text-critical)]",
  "SEV-2 High": "border-orange-400 bg-orange-50 text-orange-800",
  "SEV-3 Moderate": "border-amber-300 bg-amber-50 text-amber-800",
  "SEV-4 Low": "border-gray-300 bg-gray-100 text-gray-700",
  Informational: "border-sky-300 bg-sky-50 text-sky-800",
};

/** ⚠ NEVER COLOUR ALONE — the grade is printed, so severity survives a monochrome screen. */
export function SeverityBadge({ label }: { label: string }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
      SEV_TONE[label] ?? SEV_TONE["SEV-4 Low"]}`}>
      {label}
    </span>
  );
}

export function StatusChip({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
      {label}
    </span>
  );
}

export function SubmoduleGrid({ items }: {
  items: readonly { key: string; label: string; href: string; spec: string; state: string }[];
}) {
  const WORD: Record<string, string> = { real: "Built", partial: "Partly built", absent: "No record type" };
  const TONE: Record<string, string> = {
    real: "border-teal-300 bg-teal-50 text-teal-800",
    partial: "border-amber-300 bg-amber-50 text-amber-800",
    absent: "border-gray-300 bg-gray-100 text-gray-600",
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(s => (
        <Link key={s.key} href={s.href}
          className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 hover:bg-gray-50">
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold text-gray-900">{s.label} →</span>
            <span className="mt-0.5 block font-mono text-[10px] text-gray-400">{s.spec}</span>
          </span>
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[s.state]}`}>
            {WORD[s.state]}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function ReadFailures({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
      <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">Some reads did not answer</p>
      <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-relaxed text-gray-800">
        {problems.map(p => <li key={p}>{p}</li>)}
      </ul>
    </div>
  );
}
