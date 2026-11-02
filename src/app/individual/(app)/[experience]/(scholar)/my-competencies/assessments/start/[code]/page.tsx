import { headers } from "next/headers";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { PageHeader } from "@/app/individual/_components/chrome";
import { startFromPage } from "@/lib/assessment/adapters/scholar/store";
import { EmptyLine, TextLink } from "../../../../_module/module-parts";

export const dynamic = "force-dynamic";

// START A SELF-ASSESSMENT -- Checklist Studio S3. A link to this address starts a NEW self-assessment on the latest published version of the instrument (when
// HQ offers it to this learner) and goes to it. Starting is a write, so a browser's PREFETCH of the link never starts one, and a repeat within two minutes of an
// instance with no answer yet opens that one instead of a second copy. The instrument code is not an id of a person; the learner is the session's.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "Start a self-assessment" }); }

export default async function StartSelfAssessment({ params }: { params: Promise<{ experience: string; code: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { ctx } = page;
  const { code } = await params;
  const base = experienceHref("scholar", "my-competencies/assessments");
  const h = await headers();
  const prefetch = h.has("next-router-prefetch") || h.get("purpose") === "prefetch" || (h.get("sec-purpose") ?? "").includes("prefetch");
  if (prefetch) return null;
  const r = await startFromPage(ctx.admin, ctx.userId, decodeURIComponent(code));
  if (r.ok) redirect(`${base}/${r.data.instanceId}`);
  if (r.status === 404) notFound();
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="Start a self-assessment" />
      <EmptyLine>{r.error}</EmptyLine>
      <p className="mt-3"><TextLink href={base} accent={SCHOLAR.accent}>Back to Assessments</TextLink></p>
    </>
  );
}
