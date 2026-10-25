import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { RELATION_LABEL } from "@/lib/learning/blueprint";
import { learningEnabled } from "@/lib/learning/policy";
import { learningReviewQueue } from "@/lib/learning/studio";
import { Decide } from "@/app/super-admin/clinical-review/_components/ReviewControls";
import { Alert, Header, Off, when } from "../_components/Bits";

// /super-admin/learning/review -- independent clinical review of hosted learning (COMPETEN-LEARNING-01 S1, migration
// 461). Guarded by hq.quality.clinical.approve, the existing Clinical Content Reviewer position. A decision posts to the
// existing /api/hq/clinical-review route, and the 395/461 trigger decides it: independence, an active appointment,
// a scope covering EVERY competency the version serves, and the exact hash.
//
// ⚠ APPROVAL IS NOT PUBLICATION, and an external listing never comes here: it is approved as a listing only.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learning review" };

export default async function LearningReviewPage() {
  const ctx = await requireHqCapability("hq.quality.clinical.approve");
  if (!(await learningEnabled(ctx.admin))) return <Off />;
  const q = await learningReviewQueue(ctx.admin, ctx.userId);
  return (
    <div className="max-w-4xl space-y-6">
      <Header eyebrow="Competen Holdings · Clinical content" title="Learning review" intro="Hosted learning waiting for your independent clinical review. You approve the exact content shown, including every lesson, question, answer key and rationale. If it changes, it needs review again. You cannot review learning you wrote, edited or put forward." />
      {q === null ? <Alert text="The review queue could not be read just now." />
        : q.appointments.length === 0 ? <p className="text-[13.5px] text-gray-700">You hold no active Clinical Content Reviewer appointment, so there is nothing for you to review.</p>
        : q.items.length === 0 ? <p className="text-[13.5px] text-gray-700">Nothing is waiting for you. Learning appears here when someone else puts it forward within your scope.</p> : (
          <ul className="space-y-4">{q.items.map(i => (
            <li key={i.reviewVersionId} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-bold text-gray-900">{i.title}</h2>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-900">{i.approvals} of {i.required} approval{i.required === 1 ? "" : "s"}</span>
              </div>
              <p className="text-[12.5px] text-gray-600">Serves: {i.competencies.join(", ")} · put forward {when(i.submittedAt)}</p>
              <p className="mt-2 text-[13.5px] text-gray-800">{i.content.summary}</p>
              <h3 className="mt-3 text-[13px] font-bold text-gray-900">Objectives</h3>
              <ul className="list-disc pl-5 text-[13px] text-gray-800">{i.content.objectives.map(o => <li key={o.id}>{o.text} {o.outcomeRefs.length ? <span className="text-gray-500">({o.outcomeRefs.map(r => RELATION_LABEL[r.relation]).join(", ")})</span> : null}</li>)}</ul>
              {i.content.modules.map(m => (
                <details key={m.id} className="mt-3 rounded-lg border border-gray-100 p-3">
                  <summary className="cursor-pointer text-[13px] font-semibold text-teal-800">{m.kind === "session" ? "Session" : "Module"}: {m.title}</summary>
                  {m.activities.map(a => (
                    <div key={a.id} className="mt-2 border-t border-gray-100 pt-2 text-[13px] text-gray-800">
                      <p className="font-semibold">{a.kind}: {a.title}</p>
                      {a.kind === "lesson" && a.blocks.map((b, n) => <p key={n} className="whitespace-pre-wrap">{b.type === "text" ? b.text : b.type === "video" ? `Video: ${b.title} (${b.url})` : b.type === "image" ? `Image: ${b.alt}` : `PDF: ${b.title}`}</p>)}
                      {a.kind === "check" && <ol className="list-decimal pl-5">{a.questions.map(qq => <li key={qq.id}>{qq.prompt}<ul className="list-disc pl-5">{qq.options.map(op => <li key={op.id}>{op.text}{qq.correct.includes(op.id) ? " (correct)" : ""}</li>)}</ul><p className="text-gray-600">Rationale: {qq.rationale}</p></li>)}</ol>}
                      {a.kind === "reflection" && <p>{a.prompt}</p>}
                      {a.kind === "case" && <p>Library case version {a.caseVersionId}</p>}
                    </div>))}
                </details>))}
              <p className="mt-3 text-[12.5px] text-gray-600">Certificate offered: {i.content.certificate.offered ? "yes (issued only under a separate issuer authorisation)" : "no"} · CPD note: {i.content.cpd.note || "none"} · rights: {i.content.provenance.rights.replace(/_/g, " ")}</p>
              <div className="mt-4 border-t border-gray-100 pt-3"><Decide versionId={i.reviewVersionId} appointmentId={i.appointmentId} idPrefix={`lv-${i.reviewVersionId}`} /></div>
            </li>))}</ul>
        )}
    </div>
  );
}
