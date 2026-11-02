import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import AssessmentRunnerHost, { type EvidenceItem } from "@/app/individual/_components/competencies/AssessmentRunnerHost";
import { listMaterials, listRevisionSessions } from "@/lib/individual/scholar/store";
import { loadInstanceBundle } from "@/lib/assessment/adapters/scholar/store";
import { MODE_SELF } from "@/lib/assessment/adapters/scholar/vocab";

export const dynamic = "force-dynamic";

// THE SELF-ASSESSMENT RUNNER -- Checklist Studio S3. The learner's own instance, answered in the shared runner (Standard Checklist or Guided Assessment over one
// set of answers), saved as they go. A submitted instance, or one that is not the learner's own self-assessment, goes to its report. Another person's id is the
// ordinary not-found. Self-reported, always. No AI.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "Self-assessment" }); }

export default async function AssessmentRunPage({ params }: { params: Promise<{ experience: string; instanceId: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { ctx } = page;
  const { instanceId } = await params;
  const base = experienceHref("scholar", "my-competencies/assessments");
  const bundle = await loadInstanceBundle(ctx.admin, ctx.userId, instanceId);
  if (!bundle.ok) return (<><PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="Self-assessment" /><Unreadable what="assessment" /></>);
  if (!bundle.data) notFound();
  const b = bundle.data;
  if (b.instance.status !== "in_progress" || b.instance.respondentRole !== "self") redirect(`${base}/${instanceId}/report`);
  const [materials, sessions] = await Promise.all([listMaterials(ctx.admin, ctx.userId), listRevisionSessions(ctx.admin, ctx.userId, 20)]);
  const label = (m: { title: string }) => m.title.slice(0, 80);
  const evidence: EvidenceItem[] = b.evidence.map(e => ({ id: e.id, itemKey: e.itemKey, kind: e.kind, note: e.note, label: e.kind === "record_ref" ? (e.refKind === "material" ? materials.ok ? materials.data.find(m => m.id === e.refId)?.title ?? "One of your materials" : "One of your materials" : "A practice session") : null, createdAt: e.createdAt }));
  const m = b.loaded.meta;
  return (
    <AssessmentRunnerHost
      instanceId={instanceId} def={b.loaded.def} rules={b.loaded.rules} layout={b.layout} guidedLayout={b.guidedLayout}
      initialResponses={b.responses} initialRevisions={b.revisions} initialEvidence={evidence}
      title={m.title?.trim() || m.instrumentName} subtitle={`${m.instrumentCode} · version ${m.versionNo} · ${m.deliveryModes.includes(MODE_SELF) ? "Self-assessment" : "Assessment"}`}
      methodLabels={b.loaded.methodLabels}
      materials={materials.ok ? materials.data.slice(0, 50).map(x => ({ id: x.id, label: label(x) })) : []}
      sessions={sessions.ok ? sessions.data.map(s => ({ id: s.id, label: `${s.mode.replace(/_/g, " ")} session, ${new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` })) : []}
      readOnly={false} reportHref={`${base}/${instanceId}/report`} listHref={base}
    />
  );
}
