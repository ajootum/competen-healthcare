import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadSafetyScope } from "@/lib/hq/gov-safety-scope";
import { Explain, Cite } from "../../_components/evidence";

// CPR-PD-010 §9 — CLINICAL SAFETY GOVERNANCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ §9 DRAWS A LINE THIS PAGE MUST NOT CROSS: clinical safety governance "does not convert the Product
// Director workspace into patient outcome analytics". So a hazard here is about a FEATURE — "the
// interaction warning does not fire for a brand name" — and never about a person it happened to. A
// patient who came to harm is an incident, and belongs to a clinical safety process that is not this
// workspace. Migration 327 gives these tables no patient column, so there is no path to one.
//
// ⚠ AND PRESENCE IS NOT VERIFICATION. Every mitigation below is checked against the source, which
// proves it EXISTS. Whether it works is a safety verification with evidence behind it — §9 requires
// one, this product has none, and the schema refuses to let a hazard read "verified" without it.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();
  const hazards = await admin.from("gov_safety_hazard")
    .select("hazard_id, reference, title, feature_area, state, owner_name, verification_evidence_id, residual_statement")
    .limit(200);
  const scope = loadSafetyScope();

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-1 border-b border-gray-200 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Governance &amp; Risk</p>
        <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">Clinical Safety Governance</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">
          Product features whose failure, misleading behaviour or automation could plausibly influence
          clinical care — and the assurance around them.
        </p>
      </header>

      {/* ── the hazard register ──────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The safety hazard register (§9)</h2>
        {hazards.error ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The hazard register could not be read. That is not zero hazards.
          </p>
        ) : (hazards.data ?? []).length === 0 ? (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <p className="text-[12px] font-semibold text-gray-700">No clinical safety hazard has been recorded.</p>
            <p className="mt-0.5 max-w-4xl text-[11.5px] leading-relaxed text-gray-600">
              A measured zero, and the one on this page that should be read most carefully. ⚠ It does not
              mean nothing in this product could influence clinical care — the panel below lists six
              features that plainly could, each already carrying a deliberate mitigation. It means none
              of them has a hazard record, an owner, or verification evidence that its mitigation works.
            </p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-gray-100">
            {(hazards.data as Record<string, unknown>[]).map(h => (
              <li key={String(h.hazard_id)} className="py-2.5 first:pt-0 last:pb-0">
                <p className="text-[12.5px] font-semibold text-gray-900">
                  <span className="font-mono text-[11px] text-gray-500">{String(h.reference)}</span> {String(h.title)}
                </p>
                <p className="mt-1 text-[11.5px] text-gray-600">
                  {String(h.feature_area)} · {String(h.state)}
                  {h.owner_name ? ` · ${String(h.owner_name)}` : " · no owner"}
                  {h.verification_evidence_id ? " · verified" : " · not verified"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── what already falls in scope ──────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-[13px] font-bold text-amber-900">Features already inside §9&apos;s scope</h2>
        {scope === null ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The product source could not be read from this environment. This panel is unavailable
            rather than empty — it is <em>not</em> a statement that this product carries no clinical
            safety mitigations.
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-4xl text-[12px] leading-relaxed text-gray-800">
              §9 names five example categories. This product has a counterpart to each, and{" "}
              <strong>{scope.found} of {scope.items.length}</strong> already carry a deliberate mitigation
              — each checked against the source rather than remembered. None is a governed hazard.
            </p>

            <ul className="mt-3 flex flex-col gap-2">
              {scope.items.map(i => (
                <li key={i.key} className="rounded-lg border border-amber-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">{i.label}</p>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      i.present
                        ? "border-gray-300 bg-gray-50 text-gray-700"
                        : "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>
                      {i.present ? "mitigation present" : "marker not found"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{i.category}</p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-700">
                    <span className="font-semibold text-gray-800">Hazard:</span> {i.hazard}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-700">
                    <span className="font-semibold text-gray-800">Mitigation in the product:</span> {i.mitigation}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] text-gray-500">{i.source}</p>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[12.5px] font-semibold text-amber-900">
              {scope.found} mitigations in the product. 0 governed hazards, 0 owners, 0 verifications.
            </p>

            <Explain summary="Why &ldquo;mitigation present&rdquo; is not &ldquo;verified&rdquo;">
              Finding the marker proves the mitigation EXISTS. It does not prove it works, that it works
              in every path, or that it still works after the last change to it. §9 asks for verification
              evidence and residual safety risk, and neither is a thing a file search can produce.
              Migration 327 refuses to let a hazard read <em>verified</em> without evidence attached,
              which is the same rule §22 applies to an untested control.
              <Cite>gov_safety_hazard has a constraint requiring verification evidence before state = verified</Cite>
            </Explain>

            <Explain summary="Why these six and not others">
              Choosing which features are clinically significant is itself a safety judgement, and
              inventing one would be the same error as inventing a risk score. This list answers to §9&apos;s
              own five example categories — decision support and AI output, encounter signing, clinical
              workflow data integrity, and critical patient-related detail. A product safety review would
              almost certainly find more; this is what the specification names, not what somebody decided
              was risky.
            </Explain>
          </>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">What §9 asks for that does not exist</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {[
            ["Safety severity scale", "§9 asks for residual safety risk. No safety scoring methodology is published, so a hazard records a residual STATEMENT and no scale is manufactured — the same position taken on risk posture, in the domain where inventing one would matter most."],
            ["Pre-release safety approval rule", "§9 says high-risk clinical feature changes MAY require safety review before release. Which changes qualify is a threshold nobody has stated, so the hazard record carries the flag and no rule fires it."],
            ["Verification evidence", "Six mitigations exist and none has evidence recorded that it works. That is the gap this page exists to make visible."],
          ].map(([label, why]) => (
            <li key={label} className="rounded-lg border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] px-3 py-2">
              <p className="text-[12px] font-bold text-gray-700">{label}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{why}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The line this page does not cross (§9)</h2>
        <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-gray-700">
          §9: clinical safety governance &ldquo;does not convert the Product Director workspace into
          patient outcome analytics&rdquo;. A hazard here is about a feature — the warning that does not
          fire, the note that could be edited after signing. A patient who came to harm is an incident,
          and belongs to a clinical safety process that is not this workspace. These tables carry no
          patient, encounter or outcome column, so there is no path by which one could arrive. Safety
          incidents are coordinated in{" "}
          <Link href="/super-admin/pd/support" className="font-semibold text-teal-700 hover:underline">
            Support &amp; Incidents
          </Link>{" "}
          while governance retains the assurance question.
        </p>
      </section>
    </div>
  );
}
