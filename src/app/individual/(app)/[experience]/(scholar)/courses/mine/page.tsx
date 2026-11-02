import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { learningEnabled } from "@/lib/learning/policy";
import { myRecords } from "@/lib/learning/record";
import { learningRecordHref } from "@/lib/individual/professional/learning";
import { experienceModulePage, gatedMetadata } from "@/app/individual/_components/shell-context";
import { PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { EmptyLine, RowList, TextLink } from "../../_module/module-parts";
import { myCoursesView } from "../courses-view";

export const dynamic = "force-dynamic";

// MY COURSES -- SCHOLAR-MODULES-01. The records in Competen Learning that are not completed, read by reference with
// myRecords (only while Learning is on). Each links to its own record page in Competen Learning, where the lesson is
// taken. Nothing is started, paid for or issued from here.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My Courses" }); }

const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function MyCourses({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "courses");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const on = await learningEnabled(ctx.admin);
  const records = on ? await myRecords(ctx.admin, ctx.userId).catch(() => null) : [];
  const view = myCoursesView(on, records);
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Courses & Training" title="My Courses" intro="The courses you are taking now." />
      {view.kind === "unreadable" ? <Unreadable what="courses" />
        : view.kind === "empty" ? <EmptyLine>{view.text}</EmptyLine>
          : (
            <RowList>
              {view.items.map(c => (
                <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0">
                    <TextLink href={learningRecordHref(c.id)} accent={x.accent}>{c.title}</TextLink>
                    <p className="text-[12.5px] text-gray-600">{c.code} · {c.deliveryLabel} · started {fmt(c.enrolledAt)}</p>
                  </div>
                  <p className="text-[12.5px] font-semibold text-gray-800">{c.statusLabel}</p>
                </li>
              ))}
            </RowList>
          )}
    </>
  );
}
