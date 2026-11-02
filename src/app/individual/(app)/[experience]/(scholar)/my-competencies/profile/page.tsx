import { headers } from "next/headers";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learnerToday, learnerTimeZone } from "@/lib/individual/scholar/learning-definitions";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { noProgrammeText } from "@/lib/individual/scholar/classify-view";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { Notice, PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { CompetencySection } from "../../study/_components/competency-section";
import { Block, EmptyLine, TextLink } from "../../_module/module-parts";
import { EvidenceSections } from "../evidence-sections";
import { evidenceView } from "../competencies-view";
import { loadCompetencyProfile } from "../competency-profile-data";

export const dynamic = "force-dynamic";

// MY COMPETENCY PROFILE -- SCHOLAR-MODULES-01. Two blocks, kept apart on purpose:
//   1. Your practice against your programme -- the SAME section Progress shows (study/_components/competency-section.tsx),
//      formative, from the person's own notes and answers. Never a judgement of competence.
//   2. On your record -- what an organisation or Competen Holdings recorded, read from the Passport (assessed competencies
//      and verifications). Read-only, labelled by who issued it.
// The catalogue is read only through loadLearnerCatalogue (published, fail-closed). No AI.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "My Competency Profile" }); }

export default async function CompetencyProfile({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { ctx } = page;
  const x = SCHOLAR;
  const hdrs = await headers();
  const today = learnerToday(hdrs);
  const [d, passport] = await Promise.all([
    loadCompetencyProfile(ctx.admin, ctx.userId, today, learnerTimeZone(hdrs)),
    loadIndividualPassport(ctx.admin, ctx.userId, today).catch(() => null),
  ]);
  const record = passport ? evidenceView(passport).formal.filter(s => s.id === "assessed" || s.id === "verified") : null;
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Competencies" title="My Competency Profile" intro="Your practice against your programme, and what is on your record, kept apart." />
      <Notice>{FORMATIVE_NOTICE}. The practice below is observed practice on your own notes: it is not an assessment of competence and not verified competence.</Notice>

      {!d.learner.provisioned
        ? <EmptyLine>{noProgrammeText(0)}</EmptyLine>
        : <CompetencySection learner={d.learner} progress={d.progress} coverage={d.coverage} unreadable={d.unreadable} accent={x.accent} activity={d.activity} offered={d.offered} />}

      <Block id="record-h" title="On your record" note="Decided or confirmed by an organisation or by Competen Holdings, each labelled by who issued it. Practice above is never added to it.">
        {record === null ? <Unreadable what="record" /> : <EvidenceSections sections={record} />}
        <p className="mt-3"><TextLink href={experienceHref("scholar", "passport")} accent={x.accent}>Open your Competen Passport</TextLink></p>
      </Block>
    </>
  );
}
