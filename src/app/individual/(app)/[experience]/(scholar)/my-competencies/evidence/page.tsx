import { headers } from "next/headers";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { Notice, PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { expectedMap, loadSelfSide, verificationFacts } from "@/lib/assessment/adapters/scholar/overview-data";
import { NOT_VERIFIED_LINE, VERIFICATION_UNREADABLE } from "@/lib/assessment/adapters/scholar/vocab";
import { Block, EmptyLine, TextLink } from "../../_module/module-parts";
import { EvidenceSections } from "../evidence-sections";
import { FORMAL_RECORDS_TITLE, LEARNER_EVIDENCE_TITLE, NO_EVIDENCE, assessmentEvidenceSections, evidenceView } from "../competencies-view";

export const dynamic = "force-dynamic";

// MY EVIDENCE -- SCHOLAR-MODULES-01, extended by Checklist Studio S3. Read-only. The person's Passport (loadIndividualPassport) in two groups that are
// never merged: "Your learning evidence (formative, not verified)" -- study achievements and evaluations they chose to show -- and "Formal records" --
// what organisations and Competen Holdings recorded. Between them, the learner's own assessments grouped by WHO attested them: "Self-assessments
// (self-reported, not verified)" and "Assessor-led assessments (not formal verification)", each linking to its report. Every row carries its evidence
// label (EVIDENCE_LABEL). Nothing here is written to the Passport (decision D6), and a self-assessment never appears as a formal record. No AI.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "My Evidence" }); }

export default async function MyEvidence({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { ctx } = page;
  const x = SCHOLAR;
  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, learnerToday(await headers())).catch(() => null);
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  const side = await loadSelfSide(ctx.admin, ctx.userId, expectedMap(learner.competencies));
  const v = passport ? evidenceView(passport) : null;
  const reportHref = (id: string) => experienceHref("scholar", `my-competencies/assessments/${id}/report`);
  const asmt = assessmentEvidenceSections(side.state === "ready" ? side.summaries : side.state === "not_ready" ? [] : null, reportHref);
  const facts = verificationFacts(passport);
  const verified = facts === null ? null : facts.filter(f => f.current).length;
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Competencies" title="My Evidence" intro="What you have shown and what is on your record, kept apart." />
      <Notice>Read only. Your learning evidence and your self-assessments are formative and never verified. Formal records are decided or confirmed by an organisation or Competen Holdings.</Notice>
      {v === null ? <Unreadable what="evidence" /> : (
        <>
          {v.allEmpty && asmt.self.state !== "items" && asmt.assessor.state !== "items" && <EmptyLine>{NO_EVIDENCE}</EmptyLine>}
          <Block id="learner-h" title={LEARNER_EVIDENCE_TITLE} note="Practice and evaluations from your own notes that you chose to show. Private to you unless you share your Passport.">
            <EvidenceSections sections={v.learner} />
          </Block>
          <Block id="assessments-h" title="Your assessments" note="Each says who recorded it. A self-assessment is your own rating, and an assessor-led assessment is not formal verification. Neither is added to your Passport.">
            <EvidenceSections sections={[asmt.self, asmt.assessor]} />
          </Block>
          <Block id="formal-h" title={FORMAL_RECORDS_TITLE} note="Issued or confirmed by others. Each says who.">
            <EvidenceSections sections={v.formal} />
          </Block>
          <Block id="verification" title="Verification" note="Independent verification of a competency. A self-assessment and a practice result never count as one.">
            <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] font-semibold text-gray-900" role="status">
              {verified === null ? VERIFICATION_UNREADABLE : verified === 0 ? NOT_VERIFIED_LINE : `Verified competency: ${verified} ${verified === 1 ? "competency is" : "competencies are"} verified. See Formal records above.`}
            </p>
          </Block>
          <p className="mt-6"><TextLink href={experienceHref("scholar", "passport")} accent={x.accent}>Open your Competen Passport</TextLink></p>
        </>
      )}
    </>
  );
}
