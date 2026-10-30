import { SCHOLAR_EDU_AI } from "@/lib/individual/scholar/config";

// SCHOLAR-EDU-AI-01 (owner, 30 Oct 2026). Scholar is an AI-supported EDUCATION product, not clinical decision support.
// s3: ONE persistent, quiet line in the Scholar shell (never repeated per answer), with the full disclaimer one tap
// away -- a native disclosure, so it is keyboard reachable and works without script, at any width.
// s4: one short formative label per block of AI feedback on a student's answer or knowledge check.
// Every word comes from SCHOLAR_EDU_AI (scholar/config.ts), so the wording changes in one place.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export function ScholarEduNotice() {
  return (
    <aside aria-label="About Scholar's AI" data-notice-version={SCHOLAR_EDU_AI.version}
      className="mb-4 rounded-[9px] border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] px-3 py-1.5 text-[12.5px] leading-relaxed text-[var(--cmp-app-text-secondary)]">
      <details>
        <summary className={`flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 rounded pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:items-center [&::-webkit-details-marker]:hidden ${focusRing}`}>
          <span>{SCHOLAR_EDU_AI.notice}</span>
          <span className="font-semibold text-gray-900 underline underline-offset-2">{SCHOLAR_EDU_AI.disclaimerLabel}</span>
        </summary>
        <div className="mt-2 border-t border-[var(--cmp-app-border)] pt-2 pb-1">
          <p className="font-semibold text-gray-900">{SCHOLAR_EDU_AI.disclaimerHeading}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {SCHOLAR_EDU_AI.disclaimer.map(line => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </details>
    </aside>
  );
}

/** Once per block of AI feedback. `evaluation`: Evaluate's results, computed from the student's evidence, not AI-written. */
export function FormativeAiLabel({ evaluation = false, className = "" }: { evaluation?: boolean; className?: string }) {
  return (
    <p className={`text-[12px] font-semibold text-[var(--cmp-app-text-secondary)] ${className}`}>
      {evaluation ? SCHOLAR_EDU_AI.formativeEvaluation : SCHOLAR_EDU_AI.formative}
    </p>
  );
}
