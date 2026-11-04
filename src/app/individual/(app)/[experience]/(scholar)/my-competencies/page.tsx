import { headers } from "next/headers";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { noProgrammeText } from "@/lib/individual/scholar/classify-view";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { Notice, PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import OverviewPanels from "@/app/individual/_components/competencies/OverviewPanels";
import { competenciesWithOwn, expectedMap, loadSelfSide, overviewFrom, progressFacts, verificationFacts } from "@/lib/assessment/adapters/scholar/overview-data";
import { loadStageSide } from "@/lib/assessment/adapters/scholar/progression-read";
import type { ActivityFact, OverviewCompetency } from "@/lib/assessment/adapters/scholar/competency-overview-model";
import { SELF_CLASS_LABEL } from "@/lib/assessment/adapters/scholar/vocab";
import CompetencyExplorer from "@/app/individual/_components/competencies/CompetencyExplorer";
import { Block, EmptyLine, TextLink } from "../_module/module-parts";
import { frameworksView } from "./competencies-view";
import { loadCompetencyProfile, myPlanOn } from "./competency-profile-data";
import { loadExplorerData } from "./explorer-data";
import { FrameworksSection } from "./frameworks-section";
import { CompetencyEvidenceViews } from "./evidence-views";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCompetencyEvidenceRecords } from "@/lib/individual/scholar/application-evidence-data";
import { competencyThreeViews } from "@/lib/individual/scholar/application-evidence";
import { loadCompetencyLabels } from "@/lib/assessment/adapters/scholar/store";
import { verificationPanel } from "@/lib/assessment/adapters/scholar/competency-overview-model";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// MY COMPETENCIES -- OVERVIEW (Checklist Studio S3, owner addendum 5). Four classes, kept visibly apart for every competency of the learner's programme:
//   How I rate myself ("Self-reported - Not independently verified"), What my learning evidence shows (only practice linked to the competency),
//   Compare (the two, never altering a rating) and Verified competency (from the Passport; "Not yet verified" without a record).
// Self ratings come from the learner's own assessment instances, learning evidence from the existing competency progress readers, verification
// from the Passport: no second score, engine or history is built here. The frameworks sit at the foot. No AI.
// SCHOLAR-COMPETENCY-EXPLORER-HFE-01 (owner, 3 Nov 2026): the Explorer -- the programme as Holdings organised it (Framework -> Area -> Domain ->
// Competency, saved order), with independent progress indicators and a detail drawer -- replaces the alphabetical "not practised yet" list. The two
// perspectives below it are unchanged.
// The segment is my-competencies: Competen Professional owns /competencies.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "My Competencies" }); }

export default async function MyCompetenciesOverview({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { ctx } = page;
  const x = SCHOLAR;
  const { study } = await searchParams;
  const hdrs = await headers();
  const today = learnerToday(hdrs);
  const [d, passport, planOn] = await Promise.all([
    loadCompetencyProfile(ctx.admin, ctx.userId, today, learnerTimeZone(hdrs), { coverage: false }),
    loadIndividualPassport(ctx.admin, ctx.userId, today).catch(() => null),
    myPlanOn(ctx.admin, ctx.userId),
  ]);
  const catalogue = d.learner.competencies ?? [];
  // The learner's own self-reported ratings are shown whatever the programme offers: the self side is read for everyone, and its competencies are
  // UNIONED with the programme's (a competency outside the programme carries a neutral note, and no expected level).
  const [side, stageSide] = await Promise.all([loadSelfSide(ctx.admin, ctx.userId, expectedMap(catalogue)), loadStageSide(ctx.admin, ctx.userId)]);
  // The evidence-supported stage (assessor-led evidence, by a published rule set). Unreadable shows nothing: it is never presented as "no stage".
  const stageEntries = stageSide.state === "ready" ? stageSide.entries : [];
  const programmeCompetencies: OverviewCompetency[] = catalogue.map(c => ({ id: c.id, code: c.code, title: c.title, domain: c.domain, expected: c.expectedLevel, contentStatus: c.contentStatus === "approved" || c.contentStatus === "draft" ? c.contentStatus : "unreviewed" }));
  const activity: ReadonlyMap<string, ActivityFact> | null = d.activity;
  const ready = side.state === "ready" ? side : null;
  const competencies = await competenciesWithOwn(ctx.admin, programmeCompetencies, ready);
  const model = overviewFrom({ competencies, side: ready, progress: progressFacts(d.progress), activity, verifications: verificationFacts(passport), stages: stageEntries });
  const rows = model.rows.filter(r => r.active || r.self);
  const others = model.rows.filter(r => !rows.includes(r));
  const framework = frameworksView(d.learner, d.offered);
  const base = experienceHref("scholar", "my-competencies/assessments");
  // The Explorer: only with a programme that offers competencies. Its reads are the existing ones (explorer-data.ts).
  const explorer = catalogue.length ? await loadExplorerData(ctx.admin, ctx.userId, catalogue, model.rows, activity) : null;
  // SALE-2026-11 R4 (SALE-14): the three separate views, behind scholar_competency_evidence_views (default off). Self from the rows' own
  // self panels, learning evidence from the traceable records, verified ONLY from the rows' verification (the Passport). No AI.
  const viewsOn = (await loadIndividualPolicy(ctx.admin).catch(() => null))?.scholarCompetencyEvidenceViews === "on";
  const evidenceRecords = viewsOn ? await loadCompetencyEvidenceRecords(ctx.admin, ctx.userId).catch(() => null) : null;
  // A record may name a competency outside the rows (not in the programme, never self-rated): it is still the learner's learning evidence, named from its label.
  const inRows = new Set(model.rows.map(r => r.competency.id));
  const extraIds = evidenceRecords?.ok ? [...new Set(evidenceRecords.data.flatMap(r => r.competencies.map(l => l.competencyId)))].filter(id => !inRows.has(id)).slice(0, 50) : [];
  const extraLabels = extraIds.length ? await loadCompetencyLabels(ctx.admin, extraIds) : new Map();
  const verifications = verificationFacts(passport);
  const threeViews = viewsOn ? competencyThreeViews({
    competencies: [
      ...model.rows.map(r => ({ id: r.competency.id, code: r.competency.code, title: r.competency.title, framework: r.competency.framework ?? null })),
      ...extraIds.map(id => ({ id, code: extraLabels.get(id)?.code ?? null, title: extraLabels.get(id)?.title ?? "A competency outside your current programme", framework: extraLabels.get(id)?.framework ?? null })),
    ],
    self: new Map(model.rows.map(r => [r.competency.id, r.self ? { rating: r.self.rating, descriptor: r.self.descriptor } : null])),
    scaleMax: ready?.history.scaleMax ?? null,
    records: evidenceRecords?.ok ? evidenceRecords.data : [],
    verification: id => model.rows.find(r => r.competency.id === id)?.verification ?? verificationPanel(id, verifications),
  }) : null;
  const codes = [...new Set(catalogue.map(c => c.frameworkCode).filter((c): c is string => !!c))];
  const title = codes.length === 1 ? `My Competencies · ${codes[0]}` : "My Competencies";
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Competencies" title={title} intro="How you rate yourself, what your learning shows, and where they differ. Each is kept apart, and none of it is verified competence." />
      <Notice>{FORMATIVE_NOTICE}. {SELF_CLASS_LABEL}. Only an independent verification is a verified competency.</Notice>

      {threeViews && (
        <div className="mb-10">
          <Block id="three-views" title="Self-assessment, learning evidence and verified competence" note="What you believe, what your learning records show, and what has been verified, kept apart.">
            <CompetencyEvidenceViews views={threeViews} recordsUnreadable={!evidenceRecords?.ok} />
          </Block>
        </div>
      )}

      {explorer && (
        <CompetencyExplorer model={explorer.model} details={explorer.details} scaleMax={ready?.history.scaleMax ?? 6} study={study ?? null} assessmentsBase={base}
          structureUnreadable={explorer.structureUnreadable} practiceUnreadable={explorer.practiceUnreadable} expectedConfigured={catalogue.some(c => c.expectedLevel !== null)} />
      )}

      <div className={explorer ? "mt-10" : ""}>
      {explorer && <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">By competency: how I rate myself and what my learning evidence shows</h2>}
      {rows.length === 0 && others.length === 0 && !d.learner.provisioned ? <EmptyLine>{noProgrammeText(0)}</EmptyLine>
        : rows.length === 0 && others.length === 0 && !d.learner.programme ? <EmptyLine>{noProgrammeText(d.offered)}</EmptyLine>
          : rows.length === 0 && others.length === 0 && d.unreadable ? <Unreadable what="competencies" />
            : rows.length === 0 && others.length === 0 && catalogue.length === 0 ? <EmptyLine>{framework.kind === "empty" ? framework.text : "Your programme has no competencies to show yet."}</EmptyLine>
              : (
                <>
                  {d.unreadable && <Unreadable what="competencies" />}
                  {side.state === "unreadable" && <Unreadable what="self-assessments" />}
                  {side.state === "not_ready" && <p className="mb-4 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-[13.5px] text-gray-700">Self-assessments are not available yet. Your learning evidence and verification status are shown below.</p>}
                  <OverviewPanels rows={rows} others={others} scaleMax={ready?.history.scaleMax ?? 6} myPlanOn={planOn} study={study ?? null} topLine={model.topLine}
                    verifiedClass={model.verifiedCount === null ? "unreadable" : model.verifiedCount === 0 ? "not_yet" : "verified"} reportBase={base} stageViews={stageEntries.map(e => e.view)} />
                  <p className="mt-4"><TextLink href={base} accent={x.accent}>Go to Assessments</TextLink></p>
                </>
              )}
      </div>

      <div className="mt-10 space-y-8">
        <Block id="frameworks" title="Competency frameworks" note="The published frameworks behind your programme.">
          <FrameworksSection view={framework} />
        </Block>
      </div>
    </>
  );
}
