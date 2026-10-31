import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { countDue, mistakeNotebookRows } from "@/lib/individual/scholar/store";
import { buildMistakeNotebook, MISTAKES_ROW_CAP, type MistakeItem } from "@/lib/individual/scholar/mistakes";
import { FORMATIVE_FEEDBACK_LABEL } from "@/lib/individual/scholar/config";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice, EmptyState } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { studyHref, sourceHref } from "../../_components/question-view";
import { ReviseThese } from "../../_components/mistakes-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// MISTAKE NOTEBOOK -- SCHOLAR-COMPANION-01 P1 (owner instruction, 31 Oct 2026), under Revise.
//
// The learner's OWN wrong answers, newest first, grouped by material: the question, what they answered, the key and the
// explanation already stored with the question, when, how many times it was missed, and whether a later answer corrected
// it. Read from existing attempts (372, 416): nothing new is stored, no AI is used, nothing is published. "Revise these"
// starts the existing weak-areas revision session. There is no "mark as understood": no mechanism for it exists, and the
// honest signal is a later correct answer. A written answer that was AI-evaluated shows the formative feedback kept with it.
// ?show=all|fix (default: still to fix)  ?material=<id>  ?topic=<name>  ?study=<id>

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Mistake notebook" });
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const field = `rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

function Mistake({ m }: { m: MistakeItem }) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className={`rounded-full border px-2.5 py-0.5 font-semibold ${m.corrected ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
          {m.corrected ? `Corrected ${m.correctedAt ? when(m.correctedAt) : ""}`.trim() : "Still to fix"}
        </span>
        <span className="text-gray-600">Missed {m.missed} time{m.missed === 1 ? "" : "s"} · last {when(m.lastMissedAt)}</span>
      </div>
      <p className="mt-2 text-[15.5px] font-semibold leading-relaxed text-gray-900">{m.stem}</p>
      <dl className="mt-2 space-y-1.5 text-[14px]">
        <div><dt className="inline font-semibold text-gray-700">Your answer: </dt><dd className="inline text-gray-900">{m.yourAnswer}</dd>
          {m.markingLabel && <span className="ml-2 text-[12px] text-gray-500">({m.markingLabel})</span>}</div>
        {m.correctAnswer && <div><dt className="inline font-semibold text-gray-700">The answer: </dt><dd className="inline text-gray-900">{m.correctAnswer}</dd></div>}
        {m.rationale && m.rationale.trim() !== m.correctAnswer.trim() && <div><dt className="inline font-semibold text-gray-700">Why: </dt><dd className="inline text-gray-800">{m.rationale}</dd></div>}
      </dl>
      {m.formative && m.formative.texts.length > 0 && (
        <div className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          <p className="font-semibold">{FORMATIVE_FEEDBACK_LABEL}</p>
          {m.formative.texts.map((t, i) => <p key={i} className="mt-1 whitespace-pre-wrap">{t}</p>)}
        </div>
      )}
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <Link href={`${studyHref("learn")}?section=${m.chunkId}`} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Teach me this</Link>
        <Link href={sourceHref(m.materialId, m.chunkId)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Show the source</Link>
      </p>
    </li>
  );
}

export default async function MistakeNotebook({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ show?: string; material?: string; topic?: string; study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const q = await searchParams;
  const [due, policy] = await Promise.all([countDue(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  const study = await loadStudy(ctx.admin, ctx.userId, q.study, "revise", policy);
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow="Revise" title="Mistake notebook" intro="The questions you got wrong, with the answer and why. A question is corrected when you later answer it right." />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <p className="mb-4 text-[13.5px]"><Link href={studyHref("revise")} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Back to Revise</Link></p>
      <BoundaryNotice notice={FORMATIVE_NOTICE} />
    </>
  );
  if (policy.scholarMistakeNotebook !== "on") {
    return <>{header}<StatePanel title="The mistake notebook is not offered here"><p>Your revision history and weak areas are still in Revise.</p></StatePanel></>;
  }
  const rows = await mistakeNotebookRows(ctx.admin, ctx.userId);
  if (!rows.ok) {
    return <>{header}{rows.notProvisioned ? <StatePanel title="The mistake notebook is not available here yet"><p>The revision answers it reads have not been installed here.</p></StatePanel> : <Unreadable what="mistakes" />}</>;
  }
  const show = q.show === "all" ? "all" : "fix";
  const nb = buildMistakeNotebook({
    wrong: rows.data.wrong, history: rows.data.history, questions: rows.data.questions, titles: rows.data.titles, topics: rows.data.topics,
    show, materialId: q.material ?? null, topic: q.topic ?? null,
  });
  if (nb.total === 0) {
    return (
      <>
        {header}
        <EmptyState title="No mistakes yet" action={<Link href={studyHref("revise")} className={`inline-flex min-h-[44px] items-center rounded-xl px-5 text-[14.5px] font-semibold text-white pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} style={{ background: x.accent }}>Go to Revise</Link>}>
          Questions you answer wrongly in Revise or Practice are kept here, with the answer and why. Nothing has been answered wrongly yet.
        </EmptyState>
      </>
    );
  }
  const weakOn = policy.scholarRevisionModes.includes("weak");
  const shown = nb.groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <>
      {header}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4" aria-label="Filter the notebook">
        {study && <input type="hidden" name="study" value={study.session.id} />}
        <label className="text-[13px] font-semibold text-gray-800">Show
          <select name="show" defaultValue={show} className={`${field} ml-2`}>
            <option value="fix">Still to fix ({nb.toFix})</option>
            <option value="all">All mistakes ({nb.total})</option>
          </select>
        </label>
        <label className="text-[13px] font-semibold text-gray-800">Material
          <select name="material" defaultValue={q.material ?? ""} className={`${field} ml-2 max-w-[16rem]`}>
            <option value="">All materials</option>
            {nb.materials.map(m => <option key={m.id} value={m.id}>{m.title} ({m.toFix})</option>)}
          </select>
        </label>
        {nb.topics.length > 0 && (
          <label className="text-[13px] font-semibold text-gray-800">Topic
            <select name="topic" defaultValue={q.topic ?? ""} className={`${field} ml-2 max-w-[16rem]`}>
              <option value="">All topics</option>
              {nb.topics.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
        <button type="submit" className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Apply</button>
      </form>
      <p className="mb-3 text-[13px] text-gray-600" role="status">
        {nb.toFix} still to fix of {nb.total} mistake{nb.total === 1 ? "" : "s"}; showing {shown}.
        {rows.data.capped ? ` Your ${MISTAKES_ROW_CAP} most recent wrong answers are read; older ones are not listed.` : ""}
      </p>
      {weakOn && nb.toFix > 0 && <div className="mb-4"><ReviseThese materialId={q.material ?? null} label={q.material ? "Revise these" : "Revise what I got wrong"} /></div>}
      {shown === 0 ? (
        <EmptyState title={show === "fix" ? "Nothing left to fix here" : "No mistakes match"}>
          {show === "fix" ? "Every mistake in this view has since been answered correctly." : "Try a different material or topic."}
          {show === "fix" && nb.total > nb.toFix && <> <Link href={`?show=all${q.material ? `&material=${q.material}` : ""}`} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Show all mistakes</Link></>}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {nb.groups.map(g => (
            <section key={g.materialId} aria-labelledby={`g-${g.materialId}`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 id={`g-${g.materialId}`} className="text-[15px] font-bold text-gray-900">{g.title} <span className="text-[13px] font-normal text-gray-600">· {g.toFix} to fix of {g.items.length}</span></h2>
                {weakOn && g.toFix > 0 && !q.material && nb.groups.length > 1 && <ReviseThese materialId={g.materialId} label="Revise these" />}
              </div>
              <ul className="space-y-3">{g.items.map(m => <Mistake key={m.questionId} m={m} />)}</ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
