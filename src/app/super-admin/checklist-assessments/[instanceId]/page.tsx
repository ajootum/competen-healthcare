import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { loadInstance } from "@/lib/assessment/assessor/instances";
import { loadHeader } from "@/lib/assessment/assessor/header";
import { AssessorRunnerClient } from "../_components/AssessorRunnerClient";

// /super-admin/checklist-assessments/[instanceId] -- carry out one assessor-led assessment (standard checklist or guided).
// Guarded by hq.assessment.instrument.assess, and the instance must be MINE (respondent_id = me, role assessor): anyone else
// gets "not found", never a hint that it exists. A submitted instance opens its report instead.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assessment" };

export default async function AssessmentPage({ params }: { params: Promise<{ instanceId: string }> }) {
  const ctx = await requireHqCapability("hq.assessment.instrument.assess");
  const { instanceId } = await params;
  const l = await loadInstance(ctx.admin, ctx.userId, instanceId);
  if (!l.ok) {
    if (l.status === 404) notFound();
    return <div data-cmp-theme="platform" className="max-w-3xl"><p role="alert" className="text-sm text-[var(--cmp-app-text)]">{l.error}</p></div>;
  }
  const loaded = l.value;
  if (loaded.instance.status === "submitted") redirect(`/super-admin/checklist-assessments/${instanceId}/report`);
  if (loaded.instance.status === "withdrawn") notFound();
  const h = await loadHeader(ctx.admin, loaded);
  return (
    <div data-cmp-theme="platform" className="max-w-5xl space-y-3">
      <nav aria-label="Breadcrumb" className="text-sm"><Link href="/super-admin/checklist-assessments" className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">Assessor workspace</Link></nav>
      <AssessorRunnerClient
        instanceId={instanceId} def={loaded.definition.def} rules={loaded.definition.rules}
        standardLayout={loaded.standardLayout} guidedLayout={loaded.guidedLayout}
        initialResponses={loaded.responses} initialRevisions={loaded.revisions} initialEvidence={loaded.evidence} initialComments={loaded.comments}
        title={h.title} subtitle={h.subtitle} subjectName={h.subjectName} assessorName={h.assessorName} authority={h.authority} methodLabels={h.methodLabels}
        respondentRole={loaded.instance.respondent_role === "auditor" ? "auditor" : "assessor"}
      />
    </div>
  );
}
