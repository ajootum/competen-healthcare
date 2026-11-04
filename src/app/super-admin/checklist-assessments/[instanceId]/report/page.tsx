import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { loadReport } from "@/lib/assessment/assessor/report";
import { AssessmentReport } from "@/components/assessment";
import { ATTESTATION_LABEL, isHqRole } from "@/lib/assessment/assessor/common";

// /super-admin/checklist-assessments/[instanceId]/report -- the finished result of an assessment I carried out.
// Guarded by hq.assessment.instrument.assess; the instance must be mine. Print-friendly.
// ⚠ Assessor-evaluated, not formal verification: the banner and the label say so on screen and on paper.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assessment report" };

const KIND = { safety_concern: "Safety concern", recommendation: "Recommendation", comment: "Comment", strength: "Strength" } as const;

export default async function AssessmentReportPage({ params }: { params: Promise<{ instanceId: string }> }) {
  const ctx = await requireHqCapability("hq.assessment.instrument.assess");
  const { instanceId } = await params;
  const r = await loadReport(ctx.admin, ctx.userId, instanceId);
  if (!r.ok) {
    if (r.status === 404) notFound();
    return <div data-cmp-theme="platform" className="max-w-3xl space-y-2"><p role="alert" className="text-sm text-[var(--cmp-app-text)]">{r.error}</p>
      <Link href="/super-admin/checklist-assessments" className="text-sm font-semibold underline">Back to the assessor workspace</Link></div>;
  }
  const d = r.value;
  const { def, rules, standardLayout } = { def: d.loaded.definition.def, rules: d.loaded.definition.rules, standardLayout: d.loaded.standardLayout };
  const extra = [...d.safetyConcerns, ...d.recommendations, ...d.generalComments];
  const role = isHqRole(d.loaded.instance.respondent_role) ? d.loaded.instance.respondent_role : "assessor";
  const who = role === "auditor" ? "an authorised auditor" : "an authorised assessor";
  return (
    <div data-cmp-theme="platform" className="max-w-4xl space-y-4">
      <nav aria-label="Breadcrumb" className="text-sm print:hidden"><Link href="/super-admin/checklist-assessments" className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">Assessor workspace</Link></nav>
      <AssessmentReport
        def={def} rules={rules} responses={d.loaded.responses} evaluation={d.evaluation} evidenceCounts={d.loaded.evidenceCounts}
        attestationLabel={ATTESTATION_LABEL[role]}
        banner={<p>This is the result of an assessment recorded by {who}. It is not a formal verification of competence and does not confer one.{d.loaded.outcome?.backstop_applied ? " A database safeguard set the outcome because a critical or required item was not met." : ""}</p>}
        layout={standardLayout} title={d.loaded.definition.version.title ?? "Assessment report"} subtitle={d.subjectName ? `Assessment of ${d.subjectName}` : undefined}
        metadata={d.metadata} strengths={d.strengths} gaps={d.gaps} evidenceRefs={d.evidenceRefs} comments={d.itemComments}
        generatedAt={d.loaded.instance.submitted_at ? `Submitted ${new Date(d.loaded.instance.submitted_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : undefined}
        showPrintButton
      />
      {extra.length ? (
        <section aria-label="Comments on the whole assessment" className="rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-[var(--cmp-app-text)]">
          <h3 className="mb-2 text-base font-semibold">Comments on the whole assessment</h3>
          <ul className="flex flex-col gap-1 text-sm">{extra.map(c => <li key={c.id}><span className="font-semibold">{KIND[c.kind as keyof typeof KIND] ?? c.kind}:</span> {c.body}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
