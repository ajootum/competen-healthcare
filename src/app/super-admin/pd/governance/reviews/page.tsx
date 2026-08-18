import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { GovHeader, Panel, EmptyOrUnreadable, Needs, Explain, Cite } from "../_components/gov-ui";

// CPR-PD-010 §14 — GOVERNANCE REVIEWS, with §17's triggers.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ §14: "GOVERNANCE REVIEW IS NOT MERELY MEETING MINUTES — decisions and actions must create LINKED
// STRUCTURED RECORDS." So a review's outputs are foreign keys into the registers that own them, and a
// review cannot be closed with no outputs unless it explicitly declares that none arose. Concluding
// nothing is a legitimate outcome of a governance review; concluding nothing silently is not.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();

  const [reviews, triggers] = await Promise.all([
    admin.from("gov_review")
      .select("review_id, reference, title, review_kind, cadence, trigger_kind, held_on, state, next_review_on, no_actions_arising")
      .limit(200),
    admin.from("gov_trigger_posture")
      .select("trigger_kind, label, expected_action, is_enabled, awaiting_threshold, pending_events, total_events"),
  ]);

  const rows = reviews.error ? null : (reviews.data as Record<string, unknown>[]);
  const trg = triggers.error ? null : (triggers.data as Record<string, unknown>[]);
  const awaiting = (trg ?? []).filter(t => t.awaiting_threshold === true);
  const enabled = (trg ?? []).filter(t => t.is_enabled === true);

  return (
    <div className="flex flex-col gap-4">
      <GovHeader
        title="Governance Reviews"
        purpose="Scheduled and event-triggered reviews of the product's governance, and the records each produced."
      />

      <Panel title="The review record (§14)">
        <EmptyOrUnreadable
          rows={rows} what="governance review"
          meaning="A measured zero. ⚠ No governance review of Competen Practice has been held and recorded — which, with a risk register, a control catalogue and an obligation register all empty, is consistent rather than surprising. A review needs something to review."
        />
        {(rows ?? []).map(r => (
          <div key={String(r.review_id)} className="border-b border-gray-100 py-2.5 last:border-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                <span className="font-mono text-[11px] text-gray-500">{String(r.reference)}</span> {String(r.title)}
              </p>
              <span className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-700">
                {String(r.state)}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] text-gray-600">
              {r.review_kind === "recurring" ? `${String(r.cadence)} review` : `triggered by ${String(r.trigger_kind).replace(/_/g, " ")}`}
              {r.held_on ? ` · held ${String(r.held_on)}` : " · not yet held"}
              {r.no_actions_arising ? " · no actions arising" : ""}
            </p>
          </div>
        ))}
      </Panel>

      <Panel
        title="What triggers a review (§17)"
        note="Eight event kinds. Six of them turn on a number nobody has stated, so they cannot fire."
      >
        {trg === null ? (
          <p className="text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The trigger rules could not be read.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[12px] leading-relaxed text-gray-700">
              {enabled.length} of {trg.length} rules are enabled. {awaiting.length} are waiting on a
              threshold — &ldquo;qualifying&rdquo; SEV-2, &ldquo;material&rdquo; release,
              &ldquo;repeated&rdquo; control failure, &ldquo;approaching&rdquo; expiry. Each of those
              adjectives is a policy number the specification never states.
            </p>
            <ul className="flex flex-col gap-1.5">
              {trg.map(t => (
                <li key={String(t.trigger_kind)} className="flex items-start justify-between gap-3 border-b border-gray-100 pb-1.5 last:border-0">
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-gray-900">{String(t.label)}</span>
                    <span className="block text-[11px] leading-relaxed text-gray-600">{String(t.expected_action)}</span>
                  </span>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    t.is_enabled ? "border-teal-300 bg-teal-50 text-teal-800"
                      : t.awaiting_threshold ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-gray-300 bg-gray-50 text-gray-600"}`}>
                    {t.is_enabled ? "enabled" : t.awaiting_threshold ? "awaiting threshold" : "disabled"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Explain summary="Why a disabled trigger is better than a guessed threshold">
                A number chosen here becomes the policy this module enforces, and it is the worst place
                in the workspace to invent one — a threshold inside a trigger reads as plumbing rather
                than as governance, so nobody would think to audit it. &ldquo;Awaiting threshold&rdquo;
                names the rule as waiting on a decision rather than on code, which is a state somebody
                can act on.
                <Cite>gov_trigger_rule cannot be enabled while requires_threshold is true and no threshold is set</Cite>
              </Explain>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Why a review cannot close quietly">
        <p className="text-[12px] leading-relaxed text-gray-700">
          §14 is explicit that a review is not meeting minutes. Its outputs are links into the registers
          that own them — a decision, a risk action, an audit finding, an exception — never a copy or a
          note about one, so closing the action there closes it everywhere and there is no second version
          to drift. A review with no outputs cannot be closed unless it declares that none arose, with a
          reason; and a review that declares that while holding linked outputs is refused too. The
          declaration is checked against the records in both directions.
        </p>
      </Panel>

      <Panel title="What §14 asks for that nothing here can supply">
        <Needs items={[
          { label: "A review cadence", why: "Monthly, quarterly, annual — a governance decision about how often this product's risk posture is examined, and by whom." },
          { label: "The attendees and their roles", why: "§14 asks for both. Whether the security owner was in the room is a different question from whether a particular person was." },
          { label: "Something to review", why: "The agenda §14 names — risk posture, high risks, control effectiveness, obligations, exceptions, findings, overdue actions — reads across six registers, and all six are empty." },
        ]} />
        <p className="mt-3 text-[12px] leading-relaxed text-gray-700">
          The material a review would examine is assembled on the{" "}
          <Link href="/super-admin/pd/governance" className="font-semibold text-teal-700 hover:underline">
            Governance Overview
          </Link>.
        </p>
      </Panel>
    </div>
  );
}
