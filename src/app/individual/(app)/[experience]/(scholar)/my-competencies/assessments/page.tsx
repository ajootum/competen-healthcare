import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "@/app/individual/_components/shell-context";
import { PageHeader } from "@/app/individual/_components/chrome";
import { PlaceholderCard } from "../../_module/module-parts";

export const dynamic = "force-dynamic";

// COMPETEN ASSESSMENTS -- SCHOLAR-MODULES-01. Placeholder, by design: no Competen-approved assessment is operational for
// Scholar. Nothing is listed, started or scored here, and nothing is invented. The wording is the owner-approved copy.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Competen Assessments" }); }

export default async function CompetenAssessments({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="Competen Assessments" intro="Assessments Competen has approved." />
      <PlaceholderCard title="No assessments yet">
        <p>Competen Assessments are not available yet. Only assessments Competen has approved and made operational will be listed here, and none is yet. Your practice in My Learning is formative and never counts as one.</p>
      </PlaceholderCard>
    </>
  );
}
