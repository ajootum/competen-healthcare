import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { ckriEnabled, loadCkriPolicy, participationNotice, PERMISSIONS } from "@/lib/knowledge/governance";
import { governanceOverview } from "@/lib/knowledge/research-governance";
import { COHORT_DIMENSIONS, MEASURES } from "@/lib/knowledge/data-contracts";
import { ActionButton, FieldsForm, PolicyForm } from "../_components/ResearchControls";

// /super-admin/research/governance -- CKRI research governance (COMPETEN-KNOWLEDGE-RESEARCH-01 K1, migration 440).
// Guarded by hq.quality.research.govern. Purposes, the policy, and the decisions on projects. Participation is shown
// as counts only: who chose what is visible to nobody but the person.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research governance" };

const card = "rounded-xl border border-gray-200 bg-white p-4";

export default async function ResearchGovernancePage() {
  const ctx = await requireHqCapability("hq.quality.research.govern");
  const [on, policy, ov] = await Promise.all([ckriEnabled(ctx.admin), loadCkriPolicy(ctx.admin), governanceOverview(ctx.admin)]);
  const notice = participationNotice();
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Research governance</h1>
        <p className="mt-1 text-sm text-gray-600">Permitted purposes, the disclosure policy, and independent decisions on research projects. Research access is aggregate only.</p>
      </header>
      {!on && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">CKRI is switched off in this environment (flag ckri_research). Nothing can be started. People can still withdraw.</p>}
      {!notice && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">No research participation notice is published here, so nobody can take part yet.</p>}
      {!ov ? <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">The governance records could not be read (or migration 440 is not applied here).</p> : (
        <>
          <section className={card} aria-labelledby="perm-h">
            <h2 id="perm-h" className="text-[15px] font-bold text-gray-900">The four permissions</h2>
            <ul className="mt-2 space-y-1 text-[13px] text-gray-800">
              {PERMISSIONS.map(p => <li key={p.code}><span className="font-semibold">{p.label}</span> <span className="text-gray-600">({p.record})</span>
                {p.code === "collective_analytics" && <span> · {ov.counts.collective_analytics?.granted ?? 0} taking part, {ov.counts.collective_analytics?.withdrawn ?? 0} withdrawn</span>}</li>)}
            </ul>
          </section>

          <section className={card} aria-labelledby="pur-h">
            <h2 id="pur-h" className="text-[15px] font-bold text-gray-900">Permitted purposes</h2>
            {ov.purposes.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">None yet.</p> : (
              <ul className="mt-2 divide-y divide-gray-100">
                {ov.purposes.map((p: Record<string, string>) => (
                  <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <span><span className="font-semibold">{p.label}</span> <code className="text-gray-600">{p.code}</code> · {p.permission} · <span className="font-medium">{p.status}</span><br /><span className="text-gray-600">{p.description}</span></span>
                    {p.status === "draft" && <ActionButton body={{ action: "purpose_activate", code: p.code }} label="Activate" done="Activated." tone="primary" />}
                    {p.status === "active" && <ActionButton body={{ action: "purpose_retire", code: p.code }} label="Retire" done="Retired." />}
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Draft a purpose</summary>
              <div className="mt-2"><FieldsForm action="purpose_create" submit="Save draft" done="Draft saved. Another governor activates it."
                fields={[{ name: "code", label: "Code", required: true }, { name: "permission", label: "Rests on", kind: "select", options: ["collective_analytics", "research_study"], required: true },
                  { name: "label", label: "Name", required: true }, { name: "description", label: "What it is for (shown to people choosing)", kind: "textarea", required: true }]} /></div>
            </details>
          </section>

          <section className={card} aria-labelledby="proj-h">
            <h2 id="proj-h" className="text-[15px] font-bold text-gray-900">Research projects</h2>
            {ov.projects.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">None yet. Research Leads propose projects in the research workspace.</p> : (
              <ul className="mt-2 divide-y divide-gray-100">
                {ov.projects.map((p: Record<string, string>) => (
                  <li key={p.id} className="space-y-1 py-2 text-[13px]">
                    <div><span className="font-semibold">{p.title}</span> <code className="text-gray-600">{p.code}</code> · {p.purpose_code} · {p.sponsor} · cohort ≥ {p.min_cohort} · <span className="font-medium">{p.status}</span>
                      {p.ethics_ref ? <span> · ethics {p.ethics_body} {p.ethics_ref}</span> : <span className="text-gray-600"> · no ethics record</span>}
                      {p.status === "recruiting" && <span> · {ov.counts[`study:${p.id}`]?.granted ?? 0} taking part</span>}</div>
                    <div className="flex flex-wrap gap-2">
                      {p.status === "submitted" && <>
                        <ActionButton body={{ action: "approve", projectId: p.id }} label="Approve" done="Approved." date="Keep outputs until" note="Decision note" tone="primary" />
                        <ActionButton body={{ action: "reject", projectId: p.id }} label="Reject" done="Rejected." note="Reason (required)" />
                        <ActionButton body={{ action: "return", projectId: p.id }} label="Return to draft" done="Returned." />
                      </>}
                      {(p.status === "submitted" || p.status === "approved") && <details><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Record ethics decision</summary>
                        <FieldsForm action="ethics" extra={{ projectId: p.id }} submit="Record" done="Recorded."
                          fields={[{ name: "ethicsBody", label: "Ethics committee", required: true }, { name: "ethicsRef", label: "Approval reference", required: true }, { name: "decidedOn", label: "Decision date", kind: "date", required: true }]} /></details>}
                      {p.status === "approved" && <ActionButton body={{ action: "recruit", projectId: p.id }} label="Open recruitment" done="Recruiting." tone="primary" />}
                      {p.status === "recruiting" && <ActionButton body={{ action: "close", projectId: p.id }} label="Close" done="Closed." />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-labelledby="pol-h">
            <h2 id="pol-h" className="text-[15px] font-bold text-gray-900">Disclosure and retention policy</h2>
            <p className="mb-2 text-[12.5px] text-gray-600">Small groups are suppressed and counts rounded. These controls reduce re-identification risk. They do not remove it.</p>
            <PolicyForm initial={policy} dimensions={COHORT_DIMENSIONS} measures={MEASURES.map(m => ({ code: m.code, label: m.label, available: m.status === "available" }))} />
          </section>
        </>
      )}
    </div>
  );
}
