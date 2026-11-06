import Link from "next/link";
import type { Metadata } from "next";
import { PageSearch } from "@/app/individual/_components/search/PageSearch";
import { scopeLine } from "@/lib/individual/search/registry";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learningEnabled } from "@/lib/learning/policy";
import { loadLearningRecords } from "@/lib/learning/products";
import { learningCertificateHref, learningRecordHref } from "@/lib/individual/professional/learning";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { Notice, PageHeader, Unreadable, focusRing } from "@/app/individual/_components/chrome";
import { EmptyLine, RowList, TextLink } from "../../_module/module-parts";
import { completedView, filterCompleted } from "../courses-view";

export const dynamic = "force-dynamic";

// LEARNING PROGRESS -- SCHOLAR-MODULES-01. Completed Competen Learning records, read by reference with
// loadLearningRecords (completed only; only while Learning is on). Any number shown belongs to the Holdings record and
// opens its own page: nothing is issued, copied or re-stated here. A completion is not a qualification.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("courses", { title: "Learning Progress" }); }

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function LearningProgress({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ q?: string }> }) {
  const page = await experienceModulePage((await params).experience, "courses");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "courses");
  const { ctx } = page;
  const x = SCHOLAR;
  const on = await learningEnabled(ctx.admin);
  const refs = on ? await loadLearningRecords(ctx.admin, ctx.userId).catch(() => null) : [];
  const view = completedView(on, refs);
  const rawQ = (await searchParams).q;
  const q = typeof rawQ === "string" ? rawQ.slice(0, 200).trim() : "";
  const shown = view.kind === "items" ? filterCompleted(view.items, q) : [];
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Courses & Training" title="Learning Progress" intro="Courses you have completed." />
      {view.kind === "items" && <Notice>A completion says what you did on a course. It is not an accreditation and not a verification of clinical competence.</Notice>}
      {view.kind === "items" && <PageSearch scope={scopeLine("courses")} action={experienceHref("scholar", "courses/progress")} value={q} placeholder="Search your completed courses" clearHref={experienceHref("scholar", "courses/progress")} />}
      {view.kind === "unreadable" ? <Unreadable what="completed courses" />
        : view.kind === "empty" ? <EmptyLine>{view.text}</EmptyLine>
          : shown.length === 0 ? <EmptyLine>No completed course matches that search.</EmptyLine>
          : (
            <RowList>
              {shown.map(c => (
                <li key={c.recordId} className="py-3">
                  <TextLink href={learningRecordHref(c.recordId)} accent={x.accent}>{c.title}</TextLink>
                  <p className="text-[12.5px] text-gray-600">{c.outcomeLabel} · completed {fmt(c.completedOn)} · {c.evidenceLabel}</p>
                  {c.certificates.length > 0 && (
                    <p className="text-[12.5px] text-gray-700">
                      Issued on Competen Learning:{" "}
                      {c.certificates.map(k => (
                        <Link key={k.no} href={learningCertificateHref(k.no)} className={`mr-3 font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>
                          No. {k.no}{k.revoked ? " (revoked)" : ""}
                        </Link>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </RowList>
          )}
    </>
  );
}
