import { headers } from "next/headers";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { experienceModulePage, gatedMetadata } from "@/app/individual/_components/shell-context";
import { Notice, PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { Block, EmptyLine, TextLink } from "../../_module/module-parts";
import { EvidenceSections } from "../evidence-sections";
import { FORMAL_RECORDS_TITLE, LEARNER_EVIDENCE_TITLE, NO_EVIDENCE, evidenceView } from "../competencies-view";

export const dynamic = "force-dynamic";

// MY EVIDENCE -- SCHOLAR-MODULES-01. Read-only. The person's Passport (loadIndividualPassport) in two groups that are
// never merged: "Your learning evidence (formative, not verified)" -- study achievements and evaluations they chose to
// show -- and "Formal records" -- what organisations and Competen Holdings recorded. Every row carries its evidence
// label (EVIDENCE_LABEL). Choosing, showing, sharing or removing stays in the Passport and in My Learning. No AI.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My Evidence" }); }

export default async function MyEvidence({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, learnerToday(await headers())).catch(() => null);
  const v = passport ? evidenceView(passport) : null;
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Competencies" title="My Evidence" intro="What you have shown and what is on your record, kept apart." />
      <Notice>Read only. Your learning evidence is formative and never verified. Formal records are decided or confirmed by an organisation or Competen Holdings.</Notice>
      {v === null ? <Unreadable what="evidence" /> : (
        <>
          {v.allEmpty && <EmptyLine>{NO_EVIDENCE}</EmptyLine>}
          <Block id="learner-h" title={LEARNER_EVIDENCE_TITLE} note="Practice and evaluations from your own notes that you chose to show. Private to you unless you share your Passport.">
            <EvidenceSections sections={v.learner} />
          </Block>
          <Block id="formal-h" title={FORMAL_RECORDS_TITLE} note="Issued or confirmed by others. Each says who.">
            <EvidenceSections sections={v.formal} />
          </Block>
          <p className="mt-6"><TextLink href={experienceHref("scholar", "passport")} accent={x.accent}>Open your Competen Passport</TextLink></p>
        </>
      )}
    </>
  );
}
