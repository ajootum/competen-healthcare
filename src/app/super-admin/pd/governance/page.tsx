import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadGovernanceOverview } from "@/lib/hq/pd-governance";
import { TREND_UNAVAILABLE_LABEL, TREND_UNAVAILABLE_NOTE } from "@/lib/hq/gov-evidence";
import { Explain, Cite, AbsentList } from "../_components/evidence";

// CPR-PD-010 §3 — GOVERNANCE OVERVIEW.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7: "a hidden navigation item does not
// constitute authorization"). The await resolves before any JSX is returned.
//
// ⚠ §21 ASKS THIS SCREEN TO ANSWER FOUR QUESTIONS QUICKLY: what are our biggest risks, which controls
// are failing, what is overdue, what requires my decision. Three of the four have no store yet, and this
// page says which — because "lead with high/critical risk before decorative analytics" cannot be
// satisfied by leading with an empty list styled to look like an answer.
//
// ⚠ AND THE PRECEDENCE RULE IS THE OWNER'S, RECORDED 2026-08-18:
//   specification / governance rule -> available evidence -> visual comp.
// The comp decides layout, hierarchy and intent. It does not decide data semantics. So the posture card
// occupies the position the comp gives it and states what it cannot say.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();
  const g = await loadGovernanceOverview(admin);

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-1 border-b border-gray-200 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Governance &amp; Risk</p>
            <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">Governance Overview</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">
              Assurance, risk oversight and accountable decisions for Competen Practice.
            </p>
          </div>
          <p className="shrink-0 font-mono text-[11px] text-gray-500">
            {new Date(g.readAt).toISOString().replace("T", " ").slice(0, 16)} GMT
          </p>
        </div>
      </header>

      {g.problems.length > 0 && (
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
          <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">Some reads did not answer</p>
          <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-relaxed text-gray-800">
            {g.problems.map(p => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {/* ── §3's posture, in the comp's position, saying what it cannot say ──────────────────────── */}
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Overall Risk Posture</p>
        <p className="mt-1 text-[26px] font-bold leading-none tracking-tight text-amber-900">
          {g.postureLabel}
        </p>
        {g.posture.state === "not_determined" ? (
          <>
            <p className="mt-2 max-w-4xl text-[12.5px] leading-relaxed text-gray-800">{g.posture.why}</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-700">
              <span className="font-semibold">What would determine it:</span> {g.posture.needs}
            </p>
            <Explain summary="Why this is not shown as Low, or left blank">
              Posture is a band over an aggregate score. With no approved scale there is no aggregate,
              and with no published bands there is nowhere for one to land — so any word here would be a
              word somebody chose, wearing the typography of a governed figure. Blank would be no better:
              a reader fills a blank with the most comfortable available assumption. Naming the state and
              naming what is missing is the only rendering that leaves them with the truth.
              <Cite>gov_risk_methodology holds no published, currently-effective row</Cite>
            </Explain>
          </>
        ) : (
          <>
            <p className="mt-2 max-w-4xl text-[12.5px] leading-relaxed text-gray-800">{g.posture.definition}</p>
            <p className="mt-1.5 text-[11.5px] text-gray-600">
              Under {g.posture.methodologyName} v{g.posture.methodologyVersion}
              {g.posture.aggregationRule ? ` — ${g.posture.aggregationRule}` : ""}
            </p>
          </>
        )}
        <div className="mt-3 border-t border-amber-200 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Trend</p>
          <p className="mt-0.5 text-[13px] font-semibold text-gray-500">{TREND_UNAVAILABLE_LABEL}</p>
          <p className="text-[11.5px] leading-relaxed text-gray-600">
            {TREND_UNAVAILABLE_NOTE}
            {g.postureTrend.state === "unavailable" ? ` — ${g.postureTrend.why}` : ""}
          </p>
        </div>
      </section>

      {/* ── the risk register, which IS real ─────────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Risks on the register", v: g.register.total, tone: false },
          { label: "Open", v: g.register.open, tone: false },
          { label: "Open and unowned", v: g.register.ownerless, tone: true },
          { label: "Open and unassessed", v: g.register.unassessed, tone: true },
          { label: "Review overdue", v: g.register.reviewOverdue, tone: true },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{s.label}</p>
            {g.register.readable ? (
              <p className={`mt-0.5 text-[22px] font-bold leading-none tabular-nums ${
                s.tone && s.v > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                {s.v}
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] font-semibold text-gray-400">Could not be read</p>
            )}
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The product risk register (§4)</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Open risks, newest first. A risk may be registered before it can be scored.
        </p>
        <div className="mt-3">
          {!g.register.readable ? (
            <p className="text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
              ⚠ The register could not be read. That is not zero risks.
            </p>
          ) : g.register.rows.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-gray-700">No product risk has been registered.</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">
                The register was read and holds none — a measured zero, not an unavailable one. ⚠ It is
                also not an assurance: an unpopulated register describes the record-keeping, not the
                estate.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {g.register.rows.map(r => (
                <li key={r.riskId} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                      <span className="font-mono text-[11px] text-gray-500">{r.reference}</span> {r.title}
                    </p>
                    <span className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-700">
                      {r.assessed ? r.treatment : "Unscored"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-gray-600">
                    {r.ownerName ?? "no owner recorded"} · {r.category}
                    {r.nextReviewOn ? ` · review ${r.nextReviewOn}` : " · no review date"}
                  </p>
                  {!r.assessed && (
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">
                      Not yet scored — no methodology is published, so this risk has no likelihood or
                      impact and is not counted in any severity figure.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── §6's control assurance, refused at source ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Control assurance (§6)</h2>
        {g.controls === null ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The control store could not be read. That is not zero controls, and nothing below it is a
            measurement.
          </p>
        ) : (
          <>
            {/* ⚠ THE OWNER'S CARD SHAPE: a count and its denominator, with the untested named beside it
                rather than folded into it. Never a single effectiveness percentage. */}
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assessed</p>
                <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-gray-900">
                  {g.controls.assurance.assessed}
                  <span className="ml-1 text-[13px] font-medium text-gray-400">/ {g.controls.assurance.total}</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">Both axes answered.</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Not tested</p>
                <p className={`mt-0.5 text-[20px] font-bold leading-none tabular-nums ${
                  g.controls.assurance.notTested > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                  {g.controls.assurance.notTested}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">Never Effective.</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Not assessed (design)</p>
                <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-gray-900">
                  {g.controls.assurance.notAssessedDesign}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Test overdue</p>
                <p className={`mt-0.5 text-[20px] font-bold leading-none tabular-nums ${
                  g.controls.testOverdue > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                  {g.controls.testOverdue}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                  Over the {g.controls.rows.length - g.controls.withoutDueDate} carrying a due date.
                </p>
              </div>
            </div>

            {g.controls.rows.length === 0 && (
              <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11.5px] leading-relaxed text-gray-600">
                No control has been recorded. The store was read and holds none — a measured zero. ⚠ An
                empty control catalogue is not an absence of risk; it is an absence of assurance.
              </p>
            )}

            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              {[
                { title: "Design effectiveness", note: "Would this control work if it ran as described?", items: g.controls.assurance.design },
                { title: "Operating effectiveness", note: "Did it actually run, and did it work?", items: g.controls.assurance.operating },
              ].map(col => (
                <div key={col.title}>
                  <p className="text-[11.5px] font-semibold text-gray-800">{col.title}</p>
                  <p className="text-[11px] leading-relaxed text-gray-500">{col.note}</p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {col.items.map(i => (
                      <li key={i.value} className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="text-gray-700">{i.label}</span>
                        <span className="tabular-nums font-semibold text-gray-900">{i.n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-3">
          <Explain summary="Why no single effectiveness percentage appears, now that there is real data">
            §6 keeps design effectiveness and operating effectiveness as two separate judgements: a
            control can be well designed and never once executed. One blended number answers neither
            question and hides the untested inside its denominator, and §22 is explicit that a control
            which has not been tested renders Not Tested and never Effective. An aggregate may exist only
            alongside a published calculation methodology stating how untested and unknown controls are
            counted.
            <Cite>controlAssurance() returns aggregateEffectivenessPct typed as null</Cite>
          </Explain>
        </div>
      </section>

      {/* ── §15's follow-through ─────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Treatment actions (§15)</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            { label: "Open actions", v: g.actions.open },
            { label: "Overdue", v: g.actions.overdue },
            { label: "Done, never reassessed", v: g.actions.doneUnverified },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-gray-200 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{s.label}</p>
              <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-gray-900">{s.v}</p>
            </div>
          ))}
        </div>
        <Explain summary="Why &ldquo;done, never reassessed&rdquo; is a figure on this page">
          §15 and §24 both say completing an action does not by itself reduce risk — reassessment and
          effectiveness evidence are required. The schema makes that unavoidable: a risk carries no score
          at all, so a closing action has nothing to lower. This figure is the visible half of the same
          rule, counting the actions somebody marked done that no reassessment has followed. A promise
          kept, with no evidence yet that it worked.
          <Cite>gov_risk_action.verified_by_assessment_id, null on every unfollowed action</Cite>
        </Explain>
      </section>

      {/* ── what §2 defines that has no store ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">What this module still has no record for</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Each is a model with a lifecycle, not a query nobody has written. Shown so an empty screen is
          not read as a quiet estate.
        </p>
        <div className="mt-3">
          <AbsentList items={g.missing.map(m => ({ label: `${m.label} (${m.spec})`, why: m.why }))} />
        </div>
        <Explain summary="Why these are listed rather than rendered as zeroes">
          A zero is a measurement: somebody looked and found none. Every one of these would show zero
          open findings, zero overdue obligations, zero pending approvals — and a Director reading six
          quiet panels would reasonably conclude the product was well governed. It is not governed yet.
          Those are opposite conclusions from identical pixels, which is the whole reason this list
          exists.
        </Explain>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Where the boundary sits (§1)</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          §1 draws a line the labels alone do not:{" "}
          <Link href="/super-admin/pd/health" className="font-semibold text-teal-700 hover:underline">Product Health</Link>{" "}
          detects reliability signals,{" "}
          <Link href="/super-admin/pd/support" className="font-semibold text-teal-700 hover:underline">Support &amp; Incidents</Link>{" "}
          coordinates response, Product Operations remediates, and this module assesses the control and
          risk implications. Governance oversees the product; it does not operate it.
        </p>
      </section>
    </div>
  );
}
