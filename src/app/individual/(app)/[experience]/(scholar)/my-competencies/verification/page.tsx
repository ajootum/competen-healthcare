import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { PageHeader } from "@/app/individual/_components/chrome";
import { PlaceholderCard, TextLink } from "../../_module/module-parts";

export const dynamic = "force-dynamic";

// COMPETENCY VERIFICATION -- SCHOLAR-MODULES-01. Placeholder, by design: the verification studio is not enabled for
// Scholar. A verification that already exists is read-only on the Passport and on My Competency Profile; this page
// requests, schedules and decides nothing. The wording is the owner-approved copy.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "Competency Verification" }); }

export default async function CompetencyVerification({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="Competency Verification" intro="Independent verification of a competency." />
      <PlaceholderCard title="Not available in Scholar yet" action={<TextLink href={experienceHref("scholar", "passport")} accent={SCHOLAR.accent}>Open your Competen Passport</TextLink>}>
        <p>Independent verification of your competencies is not available in Scholar yet. Any verification already on your record is shown in your Passport.</p>
      </PlaceholderCard>
    </>
  );
}
