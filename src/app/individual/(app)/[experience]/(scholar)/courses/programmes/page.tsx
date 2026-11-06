import type { Metadata } from "next";
import { PageSearch } from "@/app/individual/_components/search/PageSearch";
import { scopeLine } from "@/lib/individual/search/registry";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learnerProgramme, listProgrammes } from "@/lib/individual/scholar/store";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { Block, EmptyLine, RowList, TextLink } from "../../_module/module-parts";
import { filterProgrammes, programmeLine, programmesView } from "../courses-view";

export const dynamic = "force-dynamic";

// MY PROGRAMMES -- SCHOLAR-MODULES-01. The programme the learner follows (learnerProgramme) and the programmes Competen
// offers (listProgrammes), both read through the Scholar store. Choosing or changing one stays in My Library, where the
// existing chooser and its API live: this page only reads. A programme is configuration, never a course or a qualification.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("courses", { title: "My Programmes" }); }

export default async function MyProgrammes({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ q?: string }> }) {
  const page = await experienceModulePage((await params).experience, "courses");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "courses");
  const { ctx } = page;
  const x = SCHOLAR;
  const [chosen, offered] = await Promise.all([learnerProgramme(ctx.admin, ctx.userId), listProgrammes(ctx.admin)]);
  const view = programmesView(chosen, offered);
  const rawQ = (await searchParams).q;
  const q = typeof rawQ === "string" ? rawQ.slice(0, 200).trim() : "";
  const listed = view.kind === "none" ? view.offered : view.kind === "chosen" ? view.others : [];
  const shownList = filterProgrammes(listed, q);
  const library = experienceHref("scholar", "study/library");
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Courses & Training" title="My Programmes" intro="The programme you follow and the competency frameworks behind it." />
      {listed.length > 0 && <PageSearch scope={scopeLine("courses")} action={experienceHref("scholar", "courses/programmes")} value={q} placeholder="Search the programmes Competen offers" clearHref={experienceHref("scholar", "courses/programmes")} />}
      {view.kind === "unreadable" ? <Unreadable what="programme" />
        : view.kind === "none" ? (
          <>
            <EmptyLine>{view.text}</EmptyLine>
            {listed.length > 0 && (
              <Block id="offered-h" title="Programmes Competen offers" note="You choose yours in My Library.">
                {shownList.length === 0 ? <EmptyLine>No programme matches that search.</EmptyLine> : <RowList>
                  {shownList.map(p => (
                    <li key={p.code} className="py-3"><p className="text-[14.5px] font-semibold text-gray-900">{p.label}</p><p className="text-[12.5px] text-gray-600">{programmeLine(p)}</p></li>
                  ))}
                </RowList>}
                <p className="mt-3"><TextLink href={library} accent={x.accent}>Choose in My Library</TextLink></p>
              </Block>
            )}
          </>
        ) : (
          <>
            <section aria-labelledby="chosen-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
              <h2 id="chosen-h" className="text-[17px] font-bold tracking-tight text-gray-900">{view.programme.label}</h2>
              <p className="mt-1 text-[13.5px] text-gray-700">{programmeLine(view.programme)}</p>
              <p className="mt-1 text-[13.5px] text-gray-700 tabular-nums">{view.programme.frameworkCount} competency framework{view.programme.frameworkCount === 1 ? "" : "s"} in this programme</p>
              <p className="mt-3"><TextLink href={library} accent={x.accent}>Change your programme in My Library</TextLink></p>
            </section>
            {listed.length > 0 && (
              <Block id="others-h" title="Other programmes Competen offers">
                {shownList.length === 0 ? <EmptyLine>No programme matches that search.</EmptyLine> : <RowList>
                  {shownList.map(p => (
                    <li key={p.code} className="py-3"><p className="text-[14.5px] font-semibold text-gray-900">{p.label}</p><p className="text-[12.5px] text-gray-600">{programmeLine(p)}</p></li>
                  ))}
                </RowList>}
              </Block>
            )}
          </>
        )}
    </>
  );
}
