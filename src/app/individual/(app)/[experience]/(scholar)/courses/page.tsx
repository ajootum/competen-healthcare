import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "@/app/individual/_components/shell-context";
import { Notice, PageHeader } from "@/app/individual/_components/chrome";
import { ModuleCards } from "../_module/module-parts";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// COURSES & TRAINING -- Overview. SCHOLAR-MODULES-01. Four destinations, linked; this page reads nothing of its own.
// Courses live in Competen Learning (ADR-017) and the programme in Scholar's own store: they are shown by reference
// on the pages below, never copied here.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Courses & Training" }); }

export default async function CoursesOverview({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "courses");
  if (!page) return null;
  const go = (s: string) => experienceHref("scholar", `courses/${s}`);
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="Courses & Training" title="Courses & Training" intro="Learn through structured programmes: what is offered, what you are taking and what you have completed." />
      <Notice>Courses are separate from your own study in My Learning. Practice there is formative and never counts as a course or a qualification.</Notice>
      <ModuleCards items={[
        { href: go("explore"), title: "Explore Courses", body: "See what Competen offers." },
        { href: go("mine"), title: "My Courses", body: "The courses you are taking now." },
        { href: go("programmes"), title: "My Programmes", body: "The programme you follow and the frameworks behind it." },
        { href: go("progress"), title: "Learning Progress", body: "Courses you have completed." },
      ]} />
    </>
  );
}
