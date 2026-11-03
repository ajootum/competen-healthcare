import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { redirectFor } from "@/lib/assessment/adapters/scholar/redirects";

export const dynamic = "force-dynamic";

// PRACTICE ASSESSMENTS -- retired as a page of its own (Checklist Studio S3). My Competencies is three leaves now: Overview, Assessments and My Evidence.
// This address still answers, behind the same gates as every page of the module (entitlement, then the module, then anything else), and sends an old
// bookmark to Assessments (#practice), carrying an open study session. It reads nothing and renders nothing.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "Practice Assessments" }); }

export default async function PracticeAssessmentsRedirect({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const { study } = await searchParams;
  redirect(redirectFor("practice", study));
}
