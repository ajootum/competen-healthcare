import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { withStudy } from "@/lib/individual/scholar/study-carry";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { Notice, PageHeader } from "@/app/individual/_components/chrome";
import { ModuleCards } from "../../_module/module-parts";

export const dynamic = "force-dynamic";

// PRACTICE ASSESSMENTS -- SCHOLAR-MODULES-01. A hub of links to the practice engines that already exist in My Learning:
// adaptive exams, question practice, case practice, OSCE and papers. Nothing is built or run here and no AI is called.
// An open study session (?study=) is carried on every link, as My Learning's own tabs do; the destination validates it.
// Practice is formative: it is not a Competen assessment and never counts as one.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "Practice Assessments" }); }

export default async function PracticeAssessments({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { study } = await searchParams;
  const to = (seg: string) => withStudy(experienceHref("scholar", `study/${seg}`), study);
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="Practice Assessments" intro="Practise from your own notes. Each opens in My Learning." />
      <Notice>{FORMATIVE_NOTICE}. Practice assessments are for your own learning. They are not Competen Assessments and never count as one.</Notice>
      <ModuleCards items={[
        { href: to("revise/adaptive"), title: "Adaptive exams", body: "An exam from your notes that adjusts to your answers." },
        { href: to("revise"), title: "Question practice", body: "Practice questions, spaced revision, weak areas and flashcards." },
        { href: to("apply/case"), title: "Case practice", body: "Clinical cases to reason through." },
        { href: to("apply/osce"), title: "OSCE stations", body: "Practise a clinical station." },
        { href: to("apply"), title: "Past and practice papers", body: "Papers you have added are listed in Apply." },
      ]} />
    </>
  );
}
