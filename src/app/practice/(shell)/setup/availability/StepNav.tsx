import Link from "next/link";

// CPR-SCH-002 — the left progress navigator.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A FIVE-STEP WIZARD WHOSE LAST STEP CAN NEVER COMPLETE IS A WIZARD PEOPLE STOP TRUSTING.
//
// The comp's fifth step is "Preview & Publish", and this build cannot publish: there is no
// patient-facing booking page. So step 5 is PREVIEW, and it says so. The same decision the setup hub
// made about its four unbuilt modules -- shown in position, honest about what it is, and never counted
// towards a completion figure it could not reach.
//
// STEP 3 CARRIES NO TICK AT ALL, deliberately. Leave and extra clinics are things a practice may or may
// not have; a tick would imply somebody had failed to do something optional, and an empty circle for
// ever would nag about nothing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type Step = {
  n: number;
  title: string;
  purpose: string;
  href: string;
  /** null = nothing to complete. Optional work does not get a tick it can never earn. */
  done: boolean | null;
  detail: string;
};

export default function StepNav({ steps, activeStep }: { steps: Step[]; activeStep: number }) {
  return (
    <nav aria-label="Setup steps" className="rounded-xl border border-gray-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <ol>
        {steps.map(s => {
          const active = s.n === activeStep;
          return (
            <li key={s.n}>
              <Link href={s.href}
                aria-current={active ? "step" : undefined}
                className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 transition ${
                  active ? "bg-[var(--cp-primary)]/[0.07] ring-1 ring-inset ring-[var(--cp-primary)]/20" : "hover:bg-gray-50"}`}>
                <span aria-hidden
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    s.done === true ? "bg-emerald-100 text-emerald-700"
                      : active ? "bg-[var(--cp-primary)] text-white"
                        : "bg-slate-100 text-slate-500"}`}>
                  {s.done === true ? "✓" : s.n}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13px] font-semibold ${active ? "text-[var(--cp-primary-deep)]" : "text-gray-900"}`}>
                    {s.title}
                  </span>
                  <span className="block text-[11px] leading-tight text-gray-500">{s.purpose}</span>
                  <span className={`block text-[10px] leading-tight ${
                    s.done === false ? "text-amber-700" : "text-gray-400"}`}>
                    {s.detail}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
