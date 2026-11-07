import type { Metadata } from "next";
import { formatForReader } from "@/lib/datetime";
import { readerClock } from "@/lib/individual/scholar/reader-clock";
import Link from "next/link";
import { PageSearch } from "@/app/individual/_components/search/PageSearch";
import { pageScope } from "@/lib/individual/search/registry";
import { matchesSearch } from "@/lib/individual/search/match";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { withStudy } from "@/lib/individual/scholar/study-carry";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { experienceModulePage, gatedModuleMetadata } from "@/app/individual/_components/shell-context";
import { requireScholarModule } from "@/lib/individual/scholar/module-access";
import { Notice, PageHeader, Unreadable, focusRing } from "@/app/individual/_components/chrome";
import StartButton from "@/app/individual/_components/competencies/StartButton";
import GrantActions from "@/app/individual/_components/competencies/GrantActions";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { loadSelfSide, expectedMap } from "@/lib/assessment/adapters/scholar/overview-data";
import { MODE_LABEL, MODE_SELF, isSelfAssessment, ASSESSOR_NOTICE, SELF_CLASS_LABEL, SELF_NOTICE } from "@/lib/assessment/adapters/scholar/vocab";
import { Block, EmptyLine, ModuleCards, PlaceholderCard } from "../../_module/module-parts";

export const dynamic = "force-dynamic";

// ASSESSMENTS -- Checklist Studio S3. "Start Self-Assessment" is the PRIMARY action on every instrument HQ offers that allows it (owner addendum 4).
// An assessor-led card appears only beside a grant made for THIS learner: "awaiting your acceptance" until they accept, then live (and they can end it).
// Below: self-assessments saved and still open (Continue), the history of submitted ones (Review report), and formative practice in My Learning.
// Nothing here is verification, and a self-assessment is never described as anything but the learner's own rating. No AI.

export async function generateMetadata(): Promise<Metadata> { return gatedModuleMetadata("competencies", { title: "Assessments" }); }

const chip = "inline-flex items-center rounded-full border border-[var(--cmp-app-border)] bg-[var(--cmp-surface-neutral)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--cmp-text-neutral)]";
const linkBtn = `inline-flex min-h-[44px] items-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-[13.5px] font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export default async function Assessments({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string; q?: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  await requireScholarModule(page.ctx.admin, page.ctx.userId, "competencies");
  const clock = await readerClock(page.ctx);
  const when = (iso: string) => formatForReader(iso, clock, "date", "UTC");
  const { ctx } = page;
  const { study, q: rawQ } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ.slice(0, 200).trim() : "";
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  const side = await loadSelfSide(ctx.admin, ctx.userId, expectedMap(learner.competencies));
  const base = experienceHref("scholar", "my-competencies/assessments");
  const to = (seg: string) => withStudy(experienceHref("scholar", `study/${seg}`), study);
  const offers = side.state === "ready" ? side.offers.filter(c => matchesSearch([c.title, c.code, c.summary ?? ""], q)) : [];
  const drafts = side.state === "ready" ? side.summaries.filter(i => i.status === "in_progress" && isSelfAssessment(i) && matchesSearch(i.instrumentName, q)) : [];
  const done = side.state === "ready" ? side.summaries.filter(i => i.status === "submitted" && matchesSearch([i.instrumentName, i.outcomeLabel ?? "", i.assessorName ?? ""], q)).sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")) : [];
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="My Competencies" title="Assessments" intro="Rate yourself against the criteria Competen offers, and keep each attempt." />
      <Notice>{SELF_CLASS_LABEL}. {SELF_NOTICE}</Notice>

      {side.state === "ready" && <PageSearch scope={pageScope("assessments")} action={base} value={q} placeholder="Search assessments by name or code" hidden={{ study }} clearHref={withStudy(base, study)} />}

      <Block id="offered-h" title="Start an assessment">
        {side.state === "unreadable" ? <Unreadable what="assessments" />
          : side.state === "not_ready" ? (
            <PlaceholderCard title="No assessments yet">
              <p>Assessments are not available yet. Your practice in My Learning is formative and never counts as one.</p>
            </PlaceholderCard>
          ) : side.offers.length === 0 ? <EmptyLine>No assessment is offered to you yet. When Competen offers one it appears here, with Start Self-Assessment as the first thing you can do.</EmptyLine>
            : offers.length === 0 ? <EmptyLine>No assessment matches that search.</EmptyLine>
            : (
              <ul className="grid gap-3 md:grid-cols-2">
                {offers.map(c => (
                  <li key={c.instrumentId} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                    <h3 className="text-[16px] font-bold text-gray-900">{c.title}</h3>
                    <p className="mt-0.5 text-[12px] text-gray-500">{c.code} · version {c.versionNo}</p>
                    {c.summary && <p className="mt-2 text-[13.5px] leading-relaxed text-gray-700">{c.summary}</p>}
                    <p className="mt-2 flex flex-wrap gap-1.5" aria-label="Permitted ways to take it">
                      {c.modes.map(m => <span key={m} className={chip}>{MODE_LABEL[m] ?? m}</span>)}
                    </p>
                    {c.selfAssessment && (
                      <div className="mt-4"><StartButton code={c.code} label="Start Self-Assessment" /></div>
                    )}
                    {c.assessorLed && (
                      <div className="mt-4 rounded-xl border border-dashed border-gray-300 p-3">
                        <p className="text-[13.5px] font-semibold text-gray-900">
                          {c.assessorLed.standing === "awaiting_acceptance" ? "Awaiting your acceptance" : "Assessor-led assessment is on"}
                          {c.assessorLed.assessorName ? ` · Assessor: ${c.assessorLed.assessorName}` : ""}
                        </p>
                        <p className="mt-1 text-[12.5px] text-gray-600">
                          {c.assessorLed.standing === "awaiting_acceptance" ? "An authorised assessor has been given access to assess you with this. Nothing happens until you accept, and you can end it at any time." : "You accepted this. You can end it at any time."} {ASSESSOR_NOTICE}
                        </p>
                        <div className="mt-2"><GrantActions grantId={c.assessorLed.grantId} standing={c.assessorLed.standing} /></div>
                      </div>
                    )}
                    {!c.selfAssessment && !c.assessorLed && <p className="mt-3 text-[12.5px] text-gray-600">{MODE_LABEL[MODE_SELF]} is not offered for this one.</p>}
                  </li>
                ))}
              </ul>
            )}
      </Block>

      {side.state === "ready" && (
        <>
          <Block id="saved-h" title="Saved self-assessments" note="Started and not yet submitted. Your answers are saved as you go.">
            {drafts.length === 0 ? <EmptyLine>{q ? "No saved self-assessment matches that search." : "You have no self-assessment in progress."}</EmptyLine> : (
              <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-4 sm:px-5">
                {drafts.map(i => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{i.instrumentName}</p>
                      <p className="text-[12.5px] text-gray-600">Started {when(i.startedAt)} · {i.answered} of {i.total} criteria answered</p>
                    </div>
                    <Link href={`${base}/${i.id}`} className={linkBtn}>Continue</Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block id="history-h" title="History" note="Submitted assessments. Each attempt is kept, and none is overwritten.">
            {done.length === 0 ? <EmptyLine>{q ? "No submitted assessment matches that search." : "You have not submitted an assessment yet."}</EmptyLine> : (
              <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-4 sm:px-5">
                {done.map(i => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{i.instrumentName}</p>
                      <p className="text-[12.5px] text-gray-600">
                        {i.submittedAt ? `Submitted ${when(i.submittedAt)}` : "Submitted"}{i.outcomeLabel ? ` · ${i.outcomeLabel}` : ""} · {isSelfAssessment(i) ? "Self-reported, not verified" : `Assessor-led${i.assessorName ? ` by ${i.assessorName}` : ""}, not formal verification`}
                      </p>
                    </div>
                    <Link href={`${base}/${i.id}/report`} className={linkBtn}>Review report</Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        </>
      )}

      <Block id="practice" title="Formative practice in My Learning" note={`${FORMATIVE_NOTICE}. Practice is for your own learning. It is not an assessment and never counts as one.`}>
        <ModuleCards items={[
          { href: to("revise/adaptive"), title: "Adaptive exams", body: "An exam from your notes that adjusts to your answers." },
          { href: to("revise"), title: "Question practice", body: "Practice questions, spaced revision, weak areas and flashcards." },
          { href: to("apply/case"), title: "Case practice", body: "Clinical cases to reason through." },
          { href: to("apply/osce"), title: "OSCE stations", body: "Practise a clinical station." },
          { href: to("apply"), title: "Past and practice papers", body: "Papers you have added are listed in Apply." },
        ]} />
      </Block>
    </>
  );
}
