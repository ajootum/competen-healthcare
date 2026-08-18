import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { GovHeader, Panel, EmptyOrUnreadable, Needs, Explain, Cite } from "../_components/gov-ui";

// CPR-PD-010 §4 — PRODUCT RISK REGISTER.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE REGISTER IS EMPTY AND THE REASON IS NOT "NOBODY HAS TYPED ONE IN". A risk can be REGISTERED
// today — title, cause, event, consequence, category, owner, review date. It cannot be SCORED, because
// scoring requires a published methodology and none exists. §4: "a risk score must never be a hidden
// arbitrary number." So this page separates the two acts, and says which one is blocked on what.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();

  const [risks, categories, methodology, escalation] = await Promise.all([
    admin.from("gov_product_risk")
      .select("risk_id, reference, title, category_code, owner_name, treatment, status, trend, next_review_on, escalation_state")
      .limit(300),
    admin.from("gov_risk_category").select("code, label, description, sort_order").order("sort_order"),
    admin.from("gov_risk_methodology").select("methodology_id, version, name, status").eq("status", "published"),
    admin.from("gov_risk_escalation_state").select("risk_id, escalation_state, never_determined").limit(300),
  ]);

  const rows = risks.error ? null : (risks.data as Record<string, unknown>[]);
  const cats = categories.error ? [] : (categories.data as Record<string, unknown>[]);
  const published = methodology.error ? [] : (methodology.data as Record<string, unknown>[]);
  const undetermined = escalation.error
    ? null
    : (escalation.data as Record<string, unknown>[]).filter(e => e.never_determined === true).length;

  return (
    <div className="flex flex-col gap-4">
      <GovHeader
        title="Product Risk Register"
        purpose="The material risks to Competen Practice — what each is, who owns it, how it is being treated, and when it is next reviewed."
      />

      {/* ── the two acts, separated ──────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-[12.5px] font-bold text-amber-900">
          A risk can be registered today. No risk can be scored.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          Recording that something is a risk — its cause, the event, the consequence, who owns it, when
          it is next reviewed — needs nothing but somebody to write it down. Attaching a likelihood and
          an impact needs a published scoring methodology, and there is not one. The register will accept
          the first and refuse the second, which is §4 holding rather than a gap in the build.
        </p>
        <Explain summary="Why registering and scoring are deliberately different acts">
          Blocking registration on a methodology would mean a known risk goes unrecorded while a
          governance process runs — the recording is the urgent part and the scoring is the considered
          one. Blocking scoring is the opposite trade and the right one: a score with no published scale
          behind it is the hidden arbitrary number §4 forbids, and two assessors would mean different
          things by &ldquo;4&rdquo; with nothing to tell them apart.
          <Cite>gov_risk_assessment.methodology_id is NOT NULL and no methodology is published</Cite>
        </Explain>
        <p className="mt-2 text-[11.5px] leading-relaxed text-gray-700">
          {published.length === 0
            ? "No methodology is published, so no risk in this estate carries a likelihood, an impact or a score."
            : `Active methodology: ${String(published[0].name)} v${String(published[0].version)}.`}
        </p>
      </section>

      <Panel title="The register (§4)">
        <EmptyOrUnreadable
          rows={rows} what="product risk"
          meaning="A measured zero. ⚠ It is not a statement that this product carries no risk — it is a statement that none has been written down. An unpopulated register describes the record-keeping, not the estate."
        />
        {rows && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-gray-100">
            {rows.map(r => (
              <li key={String(r.risk_id)} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                    <span className="font-mono text-[11px] text-gray-500">{String(r.reference)}</span> {String(r.title)}
                  </p>
                  <span className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-700">
                    {String(r.status)}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-gray-600">
                  {String(r.category_code)}
                  {r.owner_name ? ` · ${String(r.owner_name)}` : " · no owner"}
                  {" · treatment: "}{String(r.treatment)}
                  {r.next_review_on ? ` · review ${String(r.next_review_on)}` : " · no review date"}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">
                  Not scored — no methodology is published, so this risk has no likelihood or impact and
                  appears in no severity figure anywhere in the workspace.
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="The categories §4 defines"
        note="Seeded from the specification's own list, because a category vocabulary is the spec's and a threshold is not."
      >
        {cats.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The category list could not be read.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cats.map(c => (
              <li key={String(c.code)} className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[12px] font-semibold text-gray-900">{String(c.label)}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">{String(c.description ?? "")}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Escalation is a separate question from severity (§18)"
        note="Owner policy: a severe risk can sit wholly within Product authority; a small one can need HQ for setting a precedent."
      >
        <p className="text-[12px] leading-relaxed text-gray-700">
          {undetermined === null
            ? "⚠ The escalation state could not be read."
            : `${undetermined} risk${undetermined === 1 ? "" : "s"} ${undetermined === 1 ? "has" : "have"} no escalation determination, and therefore ${undetermined === 1 ? "reads" : "read"} Escalation Review Required rather than "no escalation required".`}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          Escalation is decided by eleven corporate-impact triggers, not by a score — multi-product
          impact, safety beyond delegated authority, regulatory exposure, and so on. Severity measures
          the harm; escalation measures whose decision it is.{" "}
          <Link href="/super-admin/pd/governance/decisions" className="font-semibold text-teal-700 hover:underline">
            Decisions &amp; Approvals
          </Link>{" "}
          records what was decided once a matter is escalated.
        </p>
      </Panel>

      <Panel title="What would let this register carry a score">
        <Needs items={[
          { label: "A published risk methodology", why: "Likelihood and impact scales with published definitions — a five-point scale whose points are called 1 to 5 is the hidden arbitrary number §4 forbids — plus an explicit aggregation rule and at least one posture band." },
          { label: "The risks themselves", why: "Which risks Competen Practice actually carries. A judgement, and the one thing on this page nobody but a person can supply." },
          { label: "Owners", why: "§22 makes an ownerless major risk a high-priority governance exception. That rule cannot fire over an empty register, and will the moment it is not." },
        ]} />
      </Panel>
    </div>
  );
}
