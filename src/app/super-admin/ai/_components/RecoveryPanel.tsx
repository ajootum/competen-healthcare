import type { loadRecoverySummary } from "@/lib/individual/scholar/evidence-recovery";

// SAFE WITHHOLDING AND EVIDENCE RECOVERY -- SCHOLAR-SQIE-02 s8. Scholar's answer rate and its SAFE-WITHHOLDING rate,
// side by side and never merged (a safe non-answer is containment working, not an answer), and what evidence recovery
// achieved afterwards. Codes and counts only, never a question or a person. Unmeasured is said, never shown as zero.

type Summary = Awaited<ReturnType<typeof loadRecoverySummary>>;
const card = "bg-white rounded-xl border border-gray-200 p-5";
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);

export default function RecoveryPanel({ s }: { s: Summary }) {
  const a = s.answers, r = s.recovery;
  return (
    <section aria-labelledby="ai-recovery-h" className="space-y-3">
      <div>
        <h2 id="ai-recovery-h" className="font-semibold text-gray-900 text-[15px]">Scholar: answers, safe withholding and evidence recovery <span className="text-[10px] text-gray-500">last {s.days} days</span></h2>
        <p className="text-xs text-gray-500">A withheld answer could not be tied to the learner&apos;s evidence. It is counted apart from answers, never as one.</p>
      </div>
      {!s.measured && (
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Not measured yet.</span> These figures are recorded once migration 600 is applied.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className="text-[13px] font-semibold text-gray-900">Explanations</h3>
          <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[13px]">
            <dt className="text-gray-600">Actions</dt><dd className="font-semibold text-gray-900">{s.measured ? a.actions : "—"}</dd>
            <dt className="text-gray-600">Answer rate</dt><dd className="font-semibold text-gray-900">{pct(a.answerRate)} ({s.measured ? a.answered : "—"})</dd>
            <dt className="text-gray-600">Safe-withholding rate</dt><dd className="font-semibold text-gray-900">{pct(a.safeWithholdingRate)} ({s.measured ? a.safeWithheld : "—"})</dd>
            <dt className="text-gray-600">Declined: not in the notes</dt><dd className="font-semibold text-gray-900">{s.measured ? a.declined : "—"}</dd>
          </dl>
        </div>
        <div className={card}>
          <h3 className="text-[13px] font-semibold text-gray-900">Evidence recovery</h3>
          <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[13px]">
            <dt className="text-gray-600">Recoveries</dt><dd className="font-semibold text-gray-900">{s.measured ? r.requests : "—"}</dd>
            <dt className="text-gray-600">Recovered explanation</dt><dd className="font-semibold text-gray-900">{s.measured ? r.recoveredExplanation : "—"} ({pct(r.recoveryRate)})</dd>
            <dt className="text-gray-600">Explanation possible, not asked for</dt><dd className="font-semibold text-gray-900">{s.measured ? r.explanationNotRequested : "—"}</dd>
            <dt className="text-gray-600">Reading suggestions only</dt><dd className="font-semibold text-gray-900">{s.measured ? r.readingOnly : "—"}</dd>
            <dt className="text-gray-600">Unanswered</dt><dd className="font-semibold text-gray-900">{s.measured ? r.unanswered : "—"}</dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
