import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { GovHeader, Panel, EmptyOrUnreadable, StateList, Needs, Explain, Cite } from "../_components/gov-ui";

// CPR-PD-010 §11 — DECISIONS & APPROVALS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE OUTCOME VOCABULARY IS THIS PAGE'S CONTENT. §11 lists CONDITIONAL among the outcomes, and a
// conditional approval is not an approval until its conditions are met — which is why the record has no
// in-effect column and the state is derived. Showing the six outcomes and what each means is worth a
// screen over an empty register, because "approved subject to a test" is the one a reader will
// otherwise treat as approved.

export const dynamic = "force-dynamic";

const OUTCOMES = [
  { key: "pending", label: "Pending", note: "Submitted, not yet decided. Somebody is waiting." },
  { key: "approved", label: "Approved", note: "In force from its effective date." },
  { key: "conditional", label: "Conditional", note: "⚠ NOT in force until every before-effect condition is met — and in force the moment the last one is, with nothing updated on the decision." },
  { key: "rejected", label: "Rejected", note: "Carries a rationale, or the database refuses it." },
  { key: "deferred", label: "Deferred", note: "Not decided, and deliberately so." },
  { key: "withdrawn", label: "Withdrawn", note: "Taken back by the submitter." },
] as const;

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();

  const live = await admin.from("gov_decision_live")
    .select("decision_id, reference, title, outcome, decided_by, is_in_effect, unmet_before_effect, unmet_after_effect, is_emergency, retrospective_review_outstanding")
    .limit(300);

  const rows = live.error ? null : (live.data as Record<string, unknown>[]);
  const all = rows ?? [];
  const tally = OUTCOMES.map(o => ({ key: o.key, label: o.label, n: all.filter(r => r.outcome === o.key).length }));
  const outstanding = all.filter(r => r.retrospective_review_outstanding === true).length;

  return (
    <div className="flex flex-col gap-4">
      <GovHeader
        title="Decisions & Approvals"
        purpose="Governed decisions, who made them, on what reasoning, and what conditions attach."
      />

      <Panel title="The decision record (§11)">
        <EmptyOrUnreadable
          rows={rows} what="governed decision"
          meaning="A measured zero. ⚠ It does not mean no decisions have been taken about this product — it means none has been recorded as a GOVERNED decision, with a decision maker, the options considered, a rationale and an audit trail. Decisions made in conversation leave nothing to review."
        />
        {all.length > 0 && (
          <ul className="flex flex-col divide-y divide-gray-100">
            {all.map(d => (
              <li key={String(d.decision_id)} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                    <span className="font-mono text-[11px] text-gray-500">{String(d.reference)}</span> {String(d.title)}
                  </p>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    d.is_in_effect ? "border-teal-300 bg-teal-50 text-teal-800" : "border-gray-300 bg-gray-50 text-gray-700"}`}>
                    {String(d.outcome)}{d.is_in_effect ? " · in force" : " · not in force"}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-gray-600">
                  {d.decided_by ? String(d.decided_by) : "not decided"}
                  {Number(d.unmet_before_effect) > 0 && ` · ${d.unmet_before_effect} condition(s) outstanding before it takes effect`}
                  {Number(d.unmet_after_effect) > 0 && ` · ${d.unmet_after_effect} follow-up condition(s)`}
                  {d.is_emergency ? " · emergency" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="The six outcomes §11 defines" note="One of them is not what it appears to be.">
        <StateList items={tally} total={Math.max(1, all.length)} />
        <ul className="mt-3 flex flex-col gap-1">
          {OUTCOMES.map(o => (
            <li key={o.key} className="text-[11.5px] leading-relaxed text-gray-600">
              <span className="font-semibold text-gray-800">{o.label}</span> — {o.note}
            </li>
          ))}
        </ul>
        <Explain summary="Why a conditional approval is not an approval">
          &ldquo;Approved subject to a penetration test&rdquo; is not an approval until the test happens.
          A flag set at decision time says it is, for ever, because the person setting it was recording a
          decision rather than tracking a condition. So conditions are rows with a met state and a
          before- or after-effect timing, and the decision comes into force the moment the last
          before-effect condition is met — with nothing updated on the decision itself.
          <Cite>gov_decision has no in_effect column; gov_decision_live computes it from the conditions</Cite>
        </Explain>
      </Panel>

      <Panel title="Emergency approvals (§11, §3)">
        <p className="text-[12px] leading-relaxed text-gray-700">
          {outstanding === 0
            ? "No emergency approval is awaiting retrospective review. ⚠ No emergency approval has been recorded either, so this is a zero about an empty register rather than about a well-reviewed one."
            : `${outstanding} emergency approval${outstanding === 1 ? "" : "s"} awaiting retrospective governance review.`}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          §11 says emergency approvals must be clearly identified and <em>may</em> require retrospective
          review — may, per decision. So the requirement is a field somebody sets, and there is no
          deadline column with a default: a number typed there would manufacture the very threshold §3
          then measures against, in a place that reads as plumbing. A review is outstanding from the
          moment it is required and stays that way until it is done.
        </p>
      </Panel>

      <Panel title="What §11 asks for that no query can produce">
        <Needs items={[
          { label: "The decisions themselves", why: "What is being decided, by whom, and on what reasoning. §19 adds that the Product Director must not self-approve everything, and the schema enforces the half it can: the decider cannot be the submitter." },
          { label: "Options considered", why: "§11 asks for the material alternatives where appropriate. The question a governance review asks months later is 'what else did you look at', and a paragraph answers it only if somebody wrote a good paragraph — so options are rows, and a rejected one states why." },
          { label: "Delegated authority", why: "Which decisions the Product Director may take alone. The Delegation & Escalation Matrix is versioned and empty until it is formally published." },
        ]} />
      </Panel>
    </div>
  );
}
