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
import { expectedMap, loadSelfSide, overviewFrom, progressFacts, verificationFacts } from "@/lib/assessment/adapters/scholar/overview-data";
import type { ActivityFact, OverviewCompetency } from "@/lib/assessment/adapters/scholar/competency-overview-model";
import { SELF_CLASS_LABEL } from "@/lib/assessment/adapters/scholar/vocab";
import { Block, EmptyLine, TextLink } from "../_module/module-parts";
import { frameworksView, gapsView } from "./competencies-view";
import { loadCompetencyProfile, myPlanOn } from "./competency-profile-data";
import { FrameworksSection } from "./frameworks-section";
import { GapsSection } from "./gaps-section";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// MY COMPETENCIES -- OVERVIEW (Checklist Studio S3, owner addendum 5). Four classes, kept visibly apart for every competency of the learner's programme:
//   How I rate myself ("Self-reported - Not independently verified"), What my learning evidence shows (only practice linked to the competency),
//   Compare (the two, never altering a rating) and Verified competency (from the Passport; "Not yet verified" without a record).
// Self ratings come from the learner's own assessment instances, learning evidence from the existing competency progress readers, verification
// from the Passport: no second score, engine or history is built here. The frameworks and the not-yet-practised list sit at the foot. No AI.
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
    loadCompetencyProfile(ctx.admin, ctx.userId, today, learnerTimeZone(hdrs)),
    loadIndividualPassport(ctx.admin, ctx.userId, today).catch(() => null),
    myPlanOn(ctx.admin, ctx.userId),
  ]);
  const catalogue = d.learner.competencies ?? [];
  const side = d.learner.provisioned && d.learner.programme ? await loadSelfSide(ctx.admin, ctx.userId, expectedMap(catalogue)) : null;
  const competencies: OverviewCompetency[] = catalogue.map(c => ({ id: c.id, code: c.code, title: c.title, domain: c.domain, expected: c.expectedLevel, contentStatus: c.contentStatus === "approved" || c.contentStatus === "draft" ? c.contentStatus : "unreviewed" }));
  const activity: ReadonlyMap<string, ActivityFact> | null = d.activity;
  const ready = side && side.state === "ready" ? side : null;
  const model = overviewFrom({ competencies, side: ready, progress: progressFacts(d.progress), activity, verifications: verificationFacts(passport) });
  const rows = model.rows.filter(r => r.active || r.self);
  const others = model.rows.filter(r => !rows.includes(r));
  const framework = frameworksView(d.learner, d.offered);
  const gaps = gapsView(d.learner, d.coverage, d.offered);
  const base = experienceHref("scholar", "my-competencies/assessments");
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Competencies" title="My Competencies" intro="How you rate yourself, what your learning shows, and where they differ. Each is kept apart, and none of it is verified competence." />
      <Notice>{FORMATIVE_NOTICE}. {SELF_CLASS_LABEL}: your ratings are your own view of yourself. Your practice is observed practice on your own notes. Only an independent verification is a verified competency, and each is shown on its own line.</Notice>

      {!d.learner.provisioned ? <EmptyLine>{noProgrammeText(0)}</EmptyLine>
        : !d.learner.programme ? <EmptyLine>{noProgrammeText(d.offered)}</EmptyLine>
          : d.unreadable ? <Unreadable what="competencies" />
            : catalogue.length === 0 ? <EmptyLine>{framework.kind === "empty" ? framework.text : "Your programme has no competencies to show yet."}</EmptyLine>
              : (
                <>
                  {side?.state === "unreadable" && <Unreadable what="self-assessments" />}
                  {side?.state === "not_ready" && <p className="mb-4 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-[13.5px] text-gray-700">Self-assessments are not available yet. Your learning evidence and verification status are shown below.</p>}
                  <OverviewPanels rows={rows} others={others} scaleMax={ready?.history.scaleMax ?? 6} myPlanOn={planOn} study={study ?? null} topLine={model.topLine}
                    verifiedClass={model.verifiedCount === null ? "unreadable" : model.verifiedCount === 0 ? "not_yet" : "verified"} reportBase={base} />
                  <p className="mt-4"><TextLink href={base} accent={x.accent}>Go to Assessments</TextLink></p>
                </>
              )}

      <div className="mt-10 space-y-8">
        <Block id="gaps" title="Not practised yet" note="Competencies in your programme that your practice has not reached yet.">
          <GapsSection view={gaps} myPlanOn={planOn} study={study ?? null} />
        </Block>
        <Block id="frameworks" title="Competency frameworks" note="The published frameworks behind your programme.">
          <FrameworksSection view={framework} />
        </Block>
      </div>
    </>
  );
}
