import Link from "next/link";
import type { WizardView } from "./wizard";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-HFE-002 s14 -- the first-time stepper, drawn from computeSetupWizard's arithmetic.
//
// Presentation only: five stages, the first incomplete one carries the Continue action, and each
// stage is itself a link to the tab that owns its work (nothing here is a number you cannot press).
// The whole strip disappears after first publication -- see wizard.ts.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function SetupWizard({ view }: { view: WizardView }) {
  if (!view.show) return null;
  const current = view.stages.find(s => s.state === "current") ?? null;

  return (
    <section className="rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-3.5"
      aria-label="First-time setup">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] font-bold text-gray-900">Set up patient booking</p>
        <p className="text-[10.5px] text-gray-500">
          Five stages. Everything saves as you go — nothing is live until you publish.
        </p>
        {current && (
          <Link href={`/practice/setup/patient-booking?tab=${current.tab}`}
            className="ml-auto rounded-lg bg-[var(--cp-primary)] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
            Continue: {current.title} →
          </Link>
        )}
      </div>

      <ol className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2">
        {view.stages.map(s => (
          <li key={s.n} className="min-w-[150px] max-w-[240px] flex-1">
            <Link href={`/practice/setup/patient-booking?tab=${s.tab}`}
              className="group flex items-start gap-2">
              <span aria-hidden className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                s.state === "done" ? "bg-emerald-100 text-emerald-700"
                  : s.couldNotCheck ? "bg-slate-100 text-slate-500 ring-1 ring-dashed ring-slate-300"
                    : s.state === "current" ? "bg-[var(--cp-primary)] text-white"
                      : "bg-white text-gray-400 ring-1 ring-gray-200"}`}>
                {s.state === "done" ? "✓" : s.couldNotCheck ? "?" : s.n}
              </span>
              <span className="min-w-0">
                <span className={`block text-[11.5px] font-bold group-hover:underline ${
                  s.state === "current" ? "text-[var(--cp-primary-deep)]"
                    : s.state === "done" ? "text-gray-700" : "text-gray-500"}`}>
                  {s.title}
                </span>
                {/* The sentence rides with the current stage and with anything unreadable -- the two
                    places a reader needs more than a tick or a number. */}
                {(s.state === "current" || s.couldNotCheck) && (
                  <span className="block text-[10px] leading-snug text-gray-500">{s.detail}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
