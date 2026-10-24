import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { governanceView } from "@/lib/competency/clinical-review-hq";
import { loadRequiredApprovals } from "@/lib/competency/clinical-review";
import { AddScope, EndScope, FrameworkSpecialty, RequiredCounts } from "../_components/ReviewControls";

// /super-admin/clinical-review/governance -- owner decision D2, migration 395.
//
// Guarded by hq.quality.clinical.govern (the Quality Council Member position). It sets what each Clinical
// Content Reviewer APPOINTMENT may review (profession, specialty, framework or domain -- configuration, not
// code), how many independent approvals standard and higher-risk content needs (the CONFIG-002 engine), and
// which specialty a shared framework belongs to. It approves nothing. Appointing a person to the reviewer
// position stays the existing HQ appointment workflow.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinical review governance" };

export default async function ClinicalGovernancePage() {
  const ctx = await requireHqCapability("hq.quality.clinical.govern");
  const [view, counts] = await Promise.all([governanceView(ctx.admin), loadRequiredApprovals(ctx.admin)]);

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">Clinical review governance</h1>
        <p className="mt-1 text-sm text-gray-600">
          Who may approve shared clinical content, within which scope, and how many independent approvals it needs. A reviewer can never
          approve content they wrote, edited or put forward, and an approval lapses when the content materially changes.
        </p>
      </header>

      {view === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          Clinical review governance could not be read just now (or migration 395 is not applied on this environment).
        </p>
      ) : (
        <>
          <section aria-labelledby="rev-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="rev-h" className="text-[16px] font-bold text-gray-900">Reviewer appointments and their scopes</h2>
            {view.reviewers.length === 0 ? (
              <p className="mt-2 text-[13.5px] text-gray-700">No one holds an active Clinical Content Reviewer appointment yet. Appoint one through the HQ appointment workflow, then give it a scope here.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {view.reviewers.map(r => (
                  <li key={r.appointmentId} className="py-3">
                    <p className="text-[14px] font-semibold text-gray-900">{r.name}</p>
                    {r.scopes.length === 0 ? <p className="text-[12.5px] text-amber-900">No scope: this reviewer can approve nothing yet.</p> : (
                      <ul className="mt-1 space-y-1">
                        {r.scopes.map(s => <li key={s.id} className="flex flex-wrap items-center gap-2 text-[13px] text-gray-800">{s.label} <EndScope scopeId={s.id} /></li>)}
                      </ul>
                    )}
                    <div className="mt-2"><AddScope appointmentId={r.appointmentId} options={view.options} idPrefix={`a-${r.appointmentId}`} /></div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="cnt-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="cnt-h" className="text-[16px] font-bold text-gray-900">Independent approvals needed</h2>
            <p className="text-[13px] text-gray-600">Now: {counts.standard} for standard content, {counts.high} for higher-risk content (a high-risk competency or clinical practice unit). Between 1 and 5. A change applies to content put forward after it is published.</p>
            <div className="mt-3"><RequiredCounts standard={counts.standard} high={counts.high} /></div>
          </section>

          <section aria-labelledby="sp-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="sp-h" className="text-[16px] font-bold text-gray-900">Framework specialty</h2>
            <p className="text-[13px] text-gray-600">A specialty scope matches the competencies of frameworks that carry that specialty.{view.specialties.length === 0 ? " No specialty terms exist yet in the taxonomy." : ""}</p>
            <ul className="mt-3 divide-y divide-gray-100">
              {view.frameworks.map(f => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-[13.5px] text-gray-900">{f.name}</span>
                  <FrameworkSpecialty frameworkId={f.id} termId={f.specialtyTermId} specialties={view.specialties} idPrefix={`f-${f.id}`} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
