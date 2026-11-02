import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { learningEnabled } from "@/lib/learning/policy";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { PageHeader, focusRing } from "@/app/individual/_components/chrome";
import { PlaceholderCard } from "../../_module/module-parts";
import { exploreView } from "../courses-view";

export const dynamic = "force-dynamic";

// EXPLORE COURSES -- SCHOLAR-MODULES-01 (coordinator decision 3). While Competen Learning is off (production today)
// this is an honest empty state. When it is on, ONE handoff card to the Competen Learning catalogue: nothing of the
// catalogue is copied here, so a course is described, priced and started in one place only (ADR-017).

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("courses", { title: "Explore Courses" }); }

export default async function ExploreCourses({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "courses");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "courses");
  const x = SCHOLAR;
  const view = exploreView(await learningEnabled(page.ctx.admin));
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Courses & Training" title="Explore Courses" intro="See what Competen offers." />
      {view.kind === "off" ? (
        <PlaceholderCard title="No courses yet"><p>{view.text}</p></PlaceholderCard>
      ) : (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="text-[17px] font-bold tracking-tight text-gray-900">Competen Learning</h2>
          <p className="mt-1.5 max-w-2xl text-[14.5px] leading-relaxed text-gray-700">
            Courses are published in the Competen Learning catalogue, which is shared with Competen Professional. Open it to see what is offered, who provides it and what each course involves.
          </p>
          <Link href={view.href} className={`mt-4 inline-flex min-h-[44px] items-center rounded-xl px-5 text-[14.5px] font-semibold text-white pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} style={{ background: x.accent }}>
            Open the Competen Learning catalogue
          </Link>
        </section>
      )}
    </>
  );
}
