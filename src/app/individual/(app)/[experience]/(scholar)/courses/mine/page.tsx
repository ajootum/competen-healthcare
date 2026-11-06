import type { Metadata } from "next";
import { formatForReader } from "@/lib/datetime";
import { readerClock } from "@/lib/individual/scholar/reader-clock";
import { PageSearch } from "@/app/individual/_components/search/PageSearch";
import { scopeLine } from "@/lib/individual/search/registry";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learningEnabled } from "@/lib/learning/policy";
import { myRecords } from "@/lib/learning/record";
import { learningRecordHref } from "@/lib/individual/professional/learning";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { EmptyLine, RowList, TextLink } from "../../_module/module-parts";
import { filterCourses, myCoursesView } from "../courses-view";

export const dynamic = "force-dynamic";

// MY COURSES -- SCHOLAR-MODULES-01. The records in Competen Learning that are not completed, read by reference with
// myRecords (only while Learning is on). Each links to its own record page in Competen Learning, where the lesson is
// taken. Nothing is started, paid for or issued from here.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("courses", { title: "My Courses" }); }


export default async function MyCourses({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ q?: string }> }) {
  const page = await experienceModulePage((await params).experience, "courses");
  if (!page) return null;
  const clock = await readerClock(page.ctx);
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "courses");
  const { ctx } = page;
  const x = SCHOLAR;
  const on = await learningEnabled(ctx.admin);
  const records = on ? await myRecords(ctx.admin, ctx.userId).catch(() => null) : [];
  const view = myCoursesView(on, records);
  const rawQ = (await searchParams).q;
  const q = typeof rawQ === "string" ? rawQ.slice(0, 200).trim() : "";
  const shown = view.kind === "items" ? filterCourses(view.items, q) : [];
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Courses & Training" title="My Courses" intro="The courses you are taking now." />
      {view.kind === "items" && <PageSearch scope={scopeLine("courses")} action={experienceHref("scholar", "courses/mine")} value={q} placeholder="Search the courses you are taking" clearHref={experienceHref("scholar", "courses/mine")} />}
      {view.kind === "unreadable" ? <Unreadable what="courses" />
        : view.kind === "empty" ? <EmptyLine>{view.text}</EmptyLine>
          : shown.length === 0 ? <EmptyLine>No course matches that search.</EmptyLine>
          : (
            <RowList>
              {shown.map(c => (
                <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0">
                    <TextLink href={learningRecordHref(c.id)} accent={x.accent}>{c.title}</TextLink>
                    <p className="text-[12.5px] text-gray-600">{c.code} · {c.deliveryLabel} · started {formatForReader(c.enrolledAt, clock, "date", "UTC")}</p>
                  </div>
                  <p className="text-[12.5px] font-semibold text-gray-800">{c.statusLabel}</p>
                </li>
              ))}
            </RowList>
          )}
    </>
  );
}
