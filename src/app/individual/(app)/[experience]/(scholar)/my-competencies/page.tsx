import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "@/app/individual/_components/shell-context";
import { Notice, PageHeader } from "@/app/individual/_components/chrome";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { ModuleCards } from "../_module/module-parts";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// MY COMPETENCIES -- Overview. SCHOLAR-MODULES-01. Seven destinations, linked; this page reads nothing of its own.
// The segment is my-competencies: Competen Professional owns /competencies.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My Competencies" }); }

export default async function MyCompetenciesOverview({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  const go = (s: string) => experienceHref("scholar", `my-competencies/${s}`);
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="My Competencies" intro="Develop and demonstrate your competencies: see where you stand, practise, and keep your evidence." />
      <Notice>{FORMATIVE_NOTICE}. What you practise here is never counted as a verified competency. Formal records, where you have any, are shown apart from it.</Notice>
      <ModuleCards items={[
        { href: go("profile"), title: "My Competency Profile", body: "Your practice against your programme, and what is on your record." },
        { href: go("frameworks"), title: "Competency Frameworks", body: "The published frameworks behind your programme." },
        { href: go("gaps"), title: "My Development Gaps", body: "Competencies you have not practised yet." },
        { href: go("practice"), title: "Practice Assessments", body: "Formative practice from your own notes." },
        { href: go("assessments"), title: "Competen Assessments", body: "Assessments Competen has approved." },
        { href: go("verification"), title: "Competency Verification", body: "Independent verification of a competency." },
        { href: go("evidence"), title: "My Evidence", body: "Your learning evidence and your formal records, kept apart." },
      ]} />
    </>
  );
}
