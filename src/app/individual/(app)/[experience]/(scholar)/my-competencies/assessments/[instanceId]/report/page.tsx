import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { listMaterials } from "@/lib/individual/scholar/store";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import ReportHost, { type GapAction } from "@/app/individual/_components/competencies/ReportHost";
import { evaluate } from "@/lib/assessment/core";
import { loadInstanceBundle, itemContextsFor, loadCompetencyLabels } from "@/lib/assessment/adapters/scholar/store";
import { expectedMap } from "@/lib/assessment/adapters/scholar/overview-data";
import { findStrengthsAndGaps, findingText } from "@/lib/assessment/adapters/scholar/findings";
import { ASSESSOR_NOTICE, SELF_ATTESTATION_LABEL, SELF_BANNER, SELF_NOTICE } from "@/lib/assessment/adapters/scholar/vocab";
import { myPlanOn } from "../../../competency-profile-data";

export const dynamic = "force-dynamic";

// THE REPORT OF ONE ASSESSMENT -- Checklist Studio S3. Strengths, gaps, the outcome with the rule that decided it, evidence references, and (for the
// learner's own gaps) what to do next through the functions that already exist. A self-assessment says "Self-reported, not verified" beside its outcome
// and on a banner; an assessor-led one says "not formal verification". Prints cleanly. Another person's id is the ordinary not-found. No AI.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "Assessment report" }); }

export default async function AssessmentReportPage({ params, searchParams }: { params: Promise<{ experience: string; instanceId: string }>; searchParams: Promise<{ study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { ctx } = page;
  const { instanceId } = await params;
  const { study } = await searchParams;
  const base = experienceHref("scholar", "my-competencies/assessments");
  const bundle = await loadInstanceBundle(ctx.admin, ctx.userId, instanceId);
  if (!bundle.ok) return (<><PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="Assessment report" /><Unreadable what="assessment" /></>);
  if (!bundle.data) notFound();
  const b = bundle.data;
  if (b.instance.status !== "submitted") {
    if (b.instance.status === "in_progress" && b.instance.respondentRole === "self") redirect(`${base}/${instanceId}`);
    notFound();
  }
  const isSelf = b.instance.respondentRole === "self";
  const [learner, materials, planOn] = await Promise.all([
    loadLearnerCatalogue(ctx.admin, ctx.userId), listMaterials(ctx.admin, ctx.userId), myPlanOn(ctx.admin, ctx.userId),
  ]);
  const { contexts, wording } = await itemContextsFor(ctx.admin, b.loaded, expectedMap(learner.competencies));
  const { strengths, gaps } = findStrengthsAndGaps(b.loaded.def, b.responses, contexts, b.loaded.rules.defaults);
  // A competency the learner rated themselves on that their programme does not offer is still named (name only), never hidden.
  const outside = [...new Set(gaps.map(g => g.competencyId).filter((id): id is string => !!id && !learner.competencies?.some(c => c.id === id)))];
  const outsideNames = outside.length ? await loadCompetencyLabels(ctx.admin, outside) : new Map();
  const titleOf = (id: string | null) => (id ? learner.competencies?.find(c => c.id === id)?.title ?? outsideNames.get(id)?.title ?? "A competency you rated yourself on" : "This assessment");
  const m = b.loaded.meta;
  const counts: Record<string, number> = {};
  for (const e of b.evidence) if (e.itemKey) counts[e.itemKey] = (counts[e.itemKey] ?? 0) + 1;

  // The outcome the database RECORDED may be a safety rule's (a critical or required item). Say so when it differs from the plain scoring.
  let recordedNote: string | null = null;
  try {
    const ev = evaluate(b.loaded.def, b.loaded.rules, b.responses, { evidenceCounts: counts });
    if (b.outcome && ev.outcome.code !== b.outcome.code) {
      const label = b.loaded.rules.outcomes.find(o => o.code === b.outcome!.code)?.label ?? b.outcome.code;
      recordedNote = `The recorded outcome is "${label}". A safety rule of this assessment (a critical or required criterion) set it.`;
    }
  } catch { /* the report below says what it can */ }

  const gapActions: GapAction[] = gaps.filter(g => g.competencyId).slice(0, 8).map(g => ({
    itemKey: g.itemKey, competencyId: g.competencyId!, competencyTitle: titleOf(g.competencyId), wording: wording.get(g.itemKey) ?? g.prompt, label: g.label,
  }));
  const refs = b.evidence.map(e => ({
    label: e.kind === "note" ? (e.note ?? "A note").slice(0, 160) : e.refKind === "material" ? `Your material: ${materials.ok ? materials.data.find(x => x.id === e.refId)?.title ?? "a material" : "a material"}` : "One of your practice sessions",
    kind: e.kind, itemKey: e.itemKey ?? undefined, added: e.createdAt.slice(0, 10),
    href: e.kind === "record_ref" ? (e.refKind === "material" && e.refId ? experienceHref("scholar", `study/${e.refId}`) : experienceHref("scholar", "study/revise")) : undefined,
  }));
  const done = b.instance.submittedAt ? new Date(b.instance.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  return (
    <ReportHost
      def={b.loaded.def} rules={b.loaded.rules} responses={b.responses} evidenceCounts={counts}
      attestationLabel={isSelf ? SELF_ATTESTATION_LABEL : "Assessor-evaluated, not formal verification"}
      bannerTitle={isSelf ? SELF_BANNER : "Assessor-led assessment"} bannerText={isSelf ? SELF_NOTICE : ASSESSOR_NOTICE} recordedNote={recordedNote}
      title={m.title?.trim() || m.instrumentName} subtitle={`${m.instrumentCode} · version ${m.versionNo}`}
      metadata={[
        { label: "Assessed person", value: ctx.profile.fullName ?? "You" },
        { label: "Recorded by", value: isSelf ? "You (self-reported)" : "An authorised assessor" },
        { label: "Submitted", value: done || null },
        { label: "Method", value: m.methodCodes.map(c => b.loaded.methodLabels[c] ?? c).join(", ") || null },
      ]}
      strengths={strengths.map(f => ({ text: findingText(f), itemKey: f.itemKey }))}
      gaps={gaps.map(f => ({ text: findingText(f), itemKey: f.itemKey }))}
      evidenceRefs={refs} generatedAt={done}
      gapActions={gapActions} myPlanOn={planOn} study={study ?? null} listHref={base} showActions={isSelf}
    />
  );
}
