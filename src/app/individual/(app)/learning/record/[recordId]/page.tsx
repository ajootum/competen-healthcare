/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element -- a lesson image is a short-lived signed URL from the server, not a static asset next/image can optimise */
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { individualShell, gatedMetadata } from "../../../../_components/shell-context";
import { StatePanel } from "../../../../_components/chrome";
import { PaneGrid } from "@/components/ui/pane-grid";
import { allActivities } from "@/lib/learning/blueprint";
import { learningEnabled } from "@/lib/learning/policy";
import { EVIDENCE_LABEL, OUTCOME_LABEL, learnState } from "@/lib/learning/record";
import { LearningShell, day } from "../../_components/LearningShell";
import { CheckForm, ExternalCompleteForm, LessonDone, WithdrawButton } from "../../_components/LearnerControls";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/learning/record/[recordId] -- LEARN -> ASSESS -> COMPLETE (COMPETEN-LEARNING-01 S2).
//
// Hosted: the lesson player over the PINNED version of the record (the learner view -- no answer key), resuming at the
// first activity not done. ?a=<activity> opens another. Progress, scores and completion are the server's.
// External: the completion form (date, hours, reflection, the provider's certificate), self-declared or source-linked.
// The record is the person's own; anyone else's id is 404.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My course" }); }

export default async function RecordPage({ params, searchParams }: { params: Promise<{ recordId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state !== "READY") redirect("/individual/access");
  const { admin, userId, live } = shell.ctx;
  if (!(await learningEnabled(admin))) notFound();
  const { recordId } = await params;
  const sp = await searchParams;
  const s = await learnState(admin, userId, recordId);

  if (!s) {
    // An external record, or none of this person's.
    const { data: rec } = await admin.from("learning_record").select("id, status, delivery, completed_at, completion_kind, evidence_class, external_completed_on, document_path, learning_offering!inner(code, title), learning_offering_version!inner(content)").eq("id", recordId).eq("user_id", userId).maybeSingle();
    if (!rec || rec.delivery !== "external") notFound();
    const ext = (rec as any).learning_offering_version.content?.external;
    return (
      <LearningShell live={live} current="mine">
        <div className="max-w-2xl space-y-5">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{(rec as any).learning_offering.title}</h1>
          {rec.status === "completed" ? (
            <StatePanel title="Recorded">
              <p>You recorded completing this on {day(rec.external_completed_on)}. It is {EVIDENCE_LABEL[rec.evidence_class as keyof typeof EVIDENCE_LABEL]?.toLowerCase() ?? "self-declared"}: Competen has not checked it with the provider.</p>
              {rec.document_path && <p><a className="font-semibold text-[var(--cmp-theme-ink)] underline" href={`/api/individual/learning/file?record=${rec.id}&evidence=1`}>Open the document you attached</a></p>}
              <p>It counts in your learning record, and Professional shows it with your CPD.</p>
            </StatePanel>
          ) : (<>
            {ext?.url && <p className="text-[14.5px] text-gray-700">Taken with the provider: <a className="font-semibold text-[var(--cmp-theme-ink)] underline" href={ext.url} target="_blank" rel="noopener noreferrer nofollow">open it again (new tab)</a>.</p>}
            <section className="rounded-2xl border border-gray-200 bg-white p-5"><h2 className="mb-3 text-[16px] font-bold text-gray-900">Record your completion</h2><ExternalCompleteForm recordId={rec.id} /></section>
            {rec.status !== "withdrawn" && <WithdrawButton recordId={rec.id} />}
          </>)}
        </div>
      </LearningShell>
    );
  }

  const { record, content, done, next, accessLive, title } = s;
  const acts = allActivities(content);
  const doneKeys = new Set(done.filter(d => d.kind !== "check" || d.passed).map(d => d.activity_key));
  const current = acts.find(a => a.id === sp.a) ?? acts.find(a => a.id === next) ?? acts[0];
  const idx = current ? acts.indexOf(current) : -1;
  const after = idx >= 0 && idx + 1 < acts.length ? acts[idx + 1] : null;
  const href = (k: string) => `/individual/learning/record/${record.id}?a=${encodeURIComponent(k)}`;
  const completed = record.status === "completed";

  return (
    <LearningShell live={live} current="mine">
      <PaneGrid bp="lg" gap="gap-6"
        start={{ storageKey: "scholar.record.contents.w", defaultPx: 256, label: "Resize the course contents", node: (
        <nav aria-label="Course contents" className="space-y-3">
          <p className="text-[15px] font-bold text-gray-900">{title}</p>
          {content.modules.map(m => (
            <div key={m.id}><p className="text-[12px] font-bold uppercase tracking-wide text-gray-500">{m.title}</p>
              <ul className="mt-1 space-y-1">{m.activities.map(a => (
                <li key={a.id}><Link href={href(a.id)} aria-current={current?.id === a.id ? "step" : undefined} className={`flex min-h-[40px] items-center gap-2 rounded-lg px-2 text-[14px] ${current?.id === a.id ? "bg-[var(--cmp-theme-soft)] font-semibold text-[var(--cmp-theme-ink)]" : "text-gray-700 hover:bg-gray-100"}`}>
                  <span aria-hidden>{doneKeys.has(a.id) ? "✓" : "○"}</span><span>{a.title}</span><span className="sr-only">{doneKeys.has(a.id) ? "(done)" : "(not done)"}</span></Link></li>))}</ul>
            </div>))}
        </nav>
        ) }}>
        <section className="min-w-0 space-y-5">
          {completed && (
            <StatePanel title={sp.done ? "You have completed the course" : "Completed"}>
              <p>Recorded {day(record.completed_at)} as {OUTCOME_LABEL[record.completion_kind as keyof typeof OUTCOME_LABEL]?.toLowerCase() ?? "course completion"}. Any certificate this course offers is in <Link className="font-semibold text-[var(--cmp-theme-ink)] underline" href="/individual/learning?view=mine">My learning</Link>.</p>
              <p>Completing a course is not verification of clinical competence.</p>
            </StatePanel>
          )}
          {!completed && !accessLive && <StatePanel tone="warning" title="Your access has ended"><p>Everything you did is kept in your learning record. Lessons reopen if your access is renewed.</p></StatePanel>}
          {current && (
            <article className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-7">
              <p className="text-[12px] font-bold uppercase tracking-wide text-[var(--cmp-theme-ink)]">{current.kind === "check" ? "Knowledge check" : current.kind === "reflection" ? "Reflection" : current.kind === "case" ? "Clinical case" : "Lesson"}</p>
              <h1 className="mt-1 text-xl font-bold text-gray-900">{current.title}</h1>
              <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-gray-800">
                {current.kind === "lesson" && current.blocks.map((b, n) => b.type === "text" ? <p key={n} className="whitespace-pre-wrap">{b.text}</p>
                  : b.type === "image" ? (accessLive ? <img key={n} src={`/api/individual/learning/file?record=${record.id}&media=${encodeURIComponent(b.mediaPath)}`} alt={b.alt} className="max-w-full rounded-xl" /> : null)
                  : b.type === "pdf" ? (accessLive ? <p key={n}><a className="font-semibold text-[var(--cmp-theme-ink)] underline" href={`/api/individual/learning/file?record=${record.id}&media=${encodeURIComponent(b.mediaPath)}`} target="_blank" rel="noopener noreferrer">{b.title || "Open the PDF"}</a></p> : null)
                  : <p key={n}><a className="font-semibold text-[var(--cmp-theme-ink)] underline" href={b.url} target="_blank" rel="noopener noreferrer nofollow">{b.title || "Watch the video"} (opens the video provider)</a></p>)}
                {current.kind === "reflection" && <p>{current.prompt}</p>}
                {current.kind === "case" && <p>This activity uses a clinical case from the Competen case library. Open it from Competen Scholar&apos;s Apply, then mark it done here.</p>}
              </div>
              {!completed && accessLive && (
                <div className="mt-6">
                  {current.kind === "check" ? (doneKeys.has(current.id) ? <p className="text-[14px] font-semibold text-[var(--cmp-theme-ink)]">Passed.</p>
                    : <CheckForm key={current.id} recordId={record.id} activityKey={current.id} questions={current.questions.map(q => ({ id: q.id, prompt: q.prompt, options: q.options }))} />)
                    : doneKeys.has(current.id) ? <p className="text-[14px] font-semibold text-[var(--cmp-theme-ink)]">Done.</p>
                    : <LessonDone recordId={record.id} activityKey={current.id} nextHref={after ? href(after.id) : `/individual/learning/record/${record.id}`} />}
                </div>
              )}
              {after && <p className="mt-4"><Link href={href(after.id)} className="text-[14px] font-semibold text-[var(--cmp-theme-ink)] underline">Next: {after.title}</Link></p>}
            </article>
          )}
          {!completed && <WithdrawButton recordId={record.id} />}
        </section>
      </PaneGrid>
    </LearningShell>
  );
}
