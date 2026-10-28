import type { loadAiQuality } from "@/lib/ai/outcomes";

// AI QUALITY AND COST -- COMPETEN-SCHOLAR-AI-OPT-01 (Wave 1, directive s4). Holdings sees spend, what it bought, and
// what failed: total and by product and activity, cost per ACCEPTED explanation, question and case, rejection rates and
// reasons, the cost of unsuccessful generation, and a daily trend. Aggregates only -- codes and counts, never content,
// never a person. Before migration 600 the outcome figures are "not measured" (never zero); spend is live regardless.

type Quality = Awaited<ReturnType<typeof loadAiQuality>>;

const card = "bg-white rounded-xl border border-gray-200";
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toFixed(Number(n) < 1 ? 4 : 2)}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const KIND: Record<string, string> = { explanation: "Explanations", question: "Questions", case: "Clinical cases" };
const REASON: Record<string, string> = {
  ungrounded: "Ungrounded detail", failed_verification: "Failed blind verification", verification_unavailable: "Verification unavailable",
  malformed: "Malformed reply", quote_not_in_passage: "Quote not in passage", not_in_notes: "Not in the notes", no_citation: "No citation",
  bad_citation: "Bad citation", source_insufficient: "Notes insufficient (model)", sufficiency_insufficient: "Redirected: notes insufficient",
  sufficiency_simpler: "Redirected: simpler activity offered", repeat_rejected: "Identical retry stopped", save_failed: "Save failed",
};
const SUFF: Record<string, string> = { sufficient: "Sufficient", simpler: "Simpler offered", insufficient: "Insufficient", uncertain: "Uncertain (governed attempt)" };

export default function QualityCostPanel({ q }: { q: Quality }) {
  const unmeasured = !q.measured;
  const maxSpend = Math.max(...q.trend.map(t => t.spend), 0.0001);
  return (
    <section aria-labelledby="ai-quality-h" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ai-quality-h" className="font-semibold text-gray-900 text-[15px]">AI Quality &amp; Cost <span className="text-[10px] text-gray-500">last {q.days} days · estimated list price</span></h2>
          <p className="text-xs text-gray-500">Cost per accepted output: all calls of an action (writing, blind checks, retries) over what the learner kept.</p>
        </div>
      </div>
      {unmeasured && (
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Outcomes not measured yet.</span> Accepted and rejected outputs, reasons and feedback are recorded once migration 600 is applied. Spend below is live.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-[14px] mb-2">Spend</h3>
          <p className="text-2xl font-bold tabular-nums text-gray-900">{q.usageReady ? money(q.totalSpend) : "—"}</p>
          <p className="text-[11px] text-gray-500">{q.requests.toLocaleString()} calls · {money(q.attributedSpend)} tied to a measured learner action</p>
          <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">By product <span className="normal-case font-normal">· calls · spend · people · per person</span></h4>
          <ul className="mt-1 space-y-1">
            {q.byProduct.length === 0 ? <li className="text-xs text-gray-500">No AI calls in this window.</li> : q.byProduct.map(p => (
              <li key={p.label} className="flex justify-between gap-2 text-xs"><span className="text-gray-700">{p.label}</span><span className="tabular-nums text-gray-600">{p.n} · {money(p.cost)} · {p.learners || "—"} · {money(p.costPerLearner)}</span></li>
            ))}
          </ul>
          {/* SCHOLAR-AI-OPT-01 P8/P10: per active learner, for allowance and pricing planning. Counts only. */}
          <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Scholar learners</h4>
          <dl className="mt-1 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-gray-100 p-2"><dt className="text-[10px] text-gray-500">Active</dt><dd className="text-lg font-bold tabular-nums text-gray-900">{q.usageReady ? q.learners.scholar : "—"}</dd></div>
            <div className="rounded-lg border border-gray-100 p-2"><dt className="text-[10px] text-gray-500">Cost / learner</dt><dd className="text-lg font-bold tabular-nums text-gray-900">{money(q.learners.costPerLearner)}</dd></div>
            <div className="rounded-lg border border-gray-100 p-2"><dt className="text-[10px] text-gray-500">Calls / learner</dt><dd className="text-lg font-bold tabular-nums text-gray-900">{q.learners.callsPerLearner ?? "—"}</dd></div>
          </dl>
          <p className="mt-1 text-[10px] text-gray-500">Active = at least one Scholar AI call in the window. Over the window, not per month.</p>
        </div>

        <div className={`${card} p-5 lg:col-span-2 overflow-x-auto`}>
          <h3 className="font-semibold text-gray-900 text-[14px] mb-2">Accepted output</h3>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500">
              <th className="py-1 pr-2 font-semibold">Output</th><th className="py-1 pr-2 font-semibold text-right">Actions</th><th className="py-1 pr-2 font-semibold text-right">Kept</th>
              <th className="py-1 pr-2 font-semibold text-right">Cost per kept</th><th className="py-1 pr-2 font-semibold text-right">Rejected</th>
              <th className="py-1 pr-2 font-semibold text-right">Unsuccessful cost</th><th className="py-1 pr-2 font-semibold text-right">Redirected</th>
              <th className="py-1 pr-2 font-semibold text-right">Actions / learner</th><th className="py-1 pr-2 font-semibold text-right">Feedback rate</th><th className="py-1 font-semibold text-right">Feedback +</th>
            </tr></thead>
            <tbody>
              {q.perKind.map(k => (
                <tr key={k.kind} className="border-t border-gray-100">
                  <td className="py-1.5 pr-2 font-medium text-gray-800">{KIND[k.kind]}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : k.actions}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : k.accepted}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{unmeasured ? "—" : money(k.costPerAccepted)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : `${k.rejectedActions} (${pct(k.rejectionRate)})`}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : money(k.unsuccessfulCost)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : k.redirected}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured || k.actionsPerLearner == null ? "—" : k.actionsPerLearner}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured || !q.feedbackReady ? "—" : pct(k.feedbackRate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{!q.feedbackReady || !k.feedback.n ? "—" : `${k.feedback.positive}/${k.feedback.n}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-gray-500">Rejected = nothing kept after the grounding, quality and blind-verification checks, which are unchanged. Redirected = not sent (saved content offered, notes unsuitable, or an identical rejected retry); no cost. A redirect is not counted as a saving. Feedback rate = ratings over outputs kept.</p>
        </div>
      </div>

      {/* Owner D3 (AI-ROUTING-01, 28 Oct): a fully withheld, unsupported answer is a SAFE NON-ANSWER -- recorded on its own
          four counts and never an accepted output. An expected "not in your notes" decline is kept apart from it. */}
      <div className={`${card} p-5 overflow-x-auto`}>
        <h3 className="font-semibold text-gray-900 text-[14px] mb-1">When nothing was delivered</h3>
        <p className="text-[11px] text-gray-500 mb-2">Safe non-answers (withheld, unsupported): safety containment <span className="font-semibold text-gray-700">successful</span> · educational output <span className="font-semibold text-gray-700">not delivered</span> · provider cost <span className="font-semibold text-gray-700">incurred</span> · learner usefulness <span className="font-semibold text-gray-700">unsuccessful</span>. Never counted as kept output.</p>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-gray-500">
            <th className="py-1 pr-2 font-semibold">Output</th>
            <th className="py-1 pr-2 font-semibold text-right">Safe non-answers</th><th className="py-1 pr-2 font-semibold text-right">Their cost</th>
            <th className="py-1 pr-2 font-semibold text-right">Not-in-notes declines</th><th className="py-1 pr-2 font-semibold text-right">Their cost</th>
            <th className="py-1 pr-2 font-semibold text-right">Other failures</th><th className="py-1 font-semibold text-right">Their cost</th>
          </tr></thead>
          <tbody>
            {q.perKind.map(k => (
              <tr key={k.kind} className="border-t border-gray-100">
                <td className="py-1.5 pr-2 font-medium text-gray-800">{KIND[k.kind]}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{unmeasured ? "—" : k.safeNonAnswers.n}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : money(k.safeNonAnswers.cost)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : k.declined.n}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : money(k.declined.cost)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{unmeasured ? "—" : k.otherFailures.n}</td>
                <td className="py-1.5 text-right tabular-nums">{unmeasured ? "—" : money(k.otherFailures.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-gray-500">The three together are the Rejected column above, and their cost is its unsuccessful cost. Declines: the notes do not cover the request, or the model said the material cannot support it. Other failures: malformed or incomplete drafts, outages.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-[14px] mb-2">Rejection reasons</h3>
          {unmeasured || !q.reasons.length ? <p className="text-xs text-gray-500">{unmeasured ? "Not measured." : "None recorded."}</p> : (
            <ul className="space-y-1">{q.reasons.map(r => <li key={r.label} className="flex justify-between text-xs"><span className="text-gray-700">{REASON[r.label] ?? r.label}</span><span className="tabular-nums text-gray-600">{r.n}</span></li>)}</ul>
          )}
          {q.sufficiency.length > 0 && (
            <>
              <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Source sufficiency</h4>
              <ul className="mt-1 space-y-1">{q.sufficiency.map(s => <li key={s.label} className="flex justify-between text-xs"><span className="text-gray-700">{SUFF[s.label] ?? s.label}</span><span className="tabular-nums text-gray-600">{s.n}</span></li>)}</ul>
            </>
          )}
          {q.feedbackReasons.length > 0 && (
            <>
              <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Learner feedback reasons</h4>
              <ul className="mt-1 space-y-1">{q.feedbackReasons.map(s => <li key={s.label} className="flex justify-between text-xs"><span className="text-gray-700">{s.label}</span><span className="tabular-nums text-gray-600">{s.n}</span></li>)}</ul>
            </>
          )}
        </div>

        <div className={`${card} p-5 overflow-x-auto`}>
          <h3 className="font-semibold text-gray-900 text-[14px] mb-2">Spend by activity</h3>
          {q.byActivity.length === 0 ? <p className="text-xs text-gray-500">No AI calls in this window.</p> : (
            <ul className="space-y-1">{q.byActivity.slice(0, 14).map(a => (
              <li key={`${a.product}|${a.activity}`} className="flex justify-between gap-2 text-xs"><span className="truncate text-gray-700"><span className="text-gray-500">{a.product} · </span>{a.activity}</span><span className="shrink-0 tabular-nums text-gray-600">{a.n} · {money(a.cost)}</span></li>
            ))}</ul>
          )}
        </div>

        <div className={`${card} p-5 overflow-x-auto`}>
          <h3 className="font-semibold text-gray-900 text-[14px] mb-2">Daily trend</h3>
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-gray-500"><th className="font-semibold pr-1">Day</th><th className="font-semibold pr-1">Spend</th><th className="font-semibold text-right pr-1">Learners</th><th className="font-semibold text-right pr-1">Kept</th><th className="font-semibold text-right pr-1">Rej.</th><th className="font-semibold text-right pr-1">Per kept</th><th className="font-semibold text-right">Fb +</th></tr></thead>
            <tbody>
              {q.trend.slice(-10).map(t => (
                <tr key={t.day} className="border-t border-gray-50">
                  <td className="py-0.5 pr-1 text-gray-600">{t.day.slice(5)}</td>
                  <td className="py-0.5 pr-1"><span className="inline-block h-2 rounded bg-teal-200 align-middle" style={{ width: `${Math.max(2, (t.spend / maxSpend) * 40)}px` }} /> <span className="tabular-nums">{money(t.spend)}</span></td>
                  <td className="py-0.5 pr-1 text-right tabular-nums">{t.learners}</td>
                  <td className="py-0.5 pr-1 text-right tabular-nums">{unmeasured ? "—" : t.accepted}</td>
                  <td className="py-0.5 pr-1 text-right tabular-nums">{unmeasured ? "—" : pct(t.rejectionRate)}</td>
                  <td className="py-0.5 pr-1 text-right tabular-nums">{unmeasured ? "—" : money(t.costPerAccepted)}</td>
                  <td className="py-0.5 text-right tabular-nums">{pct(t.positiveRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
