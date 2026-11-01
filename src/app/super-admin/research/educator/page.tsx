import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { ckriEnabled, loadCkriPolicy } from "@/lib/knowledge/governance";
import { listSnapshots, readSnapshot } from "@/lib/knowledge/intelligence";
import { duplicatesOf, listNeeds, listResources, loadQuestionPool, servedToLearners } from "@/lib/knowledge/educator";
import { MEASURES } from "@/lib/knowledge/data-contracts";
import { ActionButton, FieldsForm } from "../_components/ResearchControls";
import { EditDraft, NewResource, SubmitDraft } from "../_components/KnowledgeControls";
import { SnapshotView } from "../_components/SnapshotView";
import { StationPreview, StatusChip } from "../_components/KnowledgeStatus";
import { QuestionView } from "../_components/QuestionView";
import { fieldsFromQuestionContent } from "@/lib/knowledge/question-format";
import { listLearnerOffers } from "@/lib/knowledge/learner-offers";
import { loadIndividualPolicy } from "@/lib/individual/policy";

// /super-admin/research/educator -- CKRI educator knowledge improvement (COMPETEN-KNOWLEDGE-RESEARCH-01 K3, migration 442).
// Guarded by hq.learning.ckri.educator. Only the measures the published policy releases to educators, as suppressed
// cells. A need is raised from one reported cell. Resources keep origin, educator review and clinical approval apart.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Educator knowledge" };
const card = "rounded-xl border border-gray-200 bg-white p-4";
const EP = "/api/hq/knowledge/educator";
const KIND: Record<string, string> = { explanation: "Explanation", revision_question: "Revision question", targeted_resource: "Targeted resource", osce_station: "OSCE practice station" };

export default async function EducatorKnowledgePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireHqCapability("hq.learning.ckri.educator");
  const sp = await searchParams;
  const [on, policy] = await Promise.all([ckriEnabled(ctx.admin), loadCkriPolicy(ctx.admin)]);
  const [snaps, needs, resources, offers] = await Promise.all([listSnapshots(ctx.admin, policy.educatorMeasures), listNeeds(ctx.admin), listResources(ctx.admin), loadIndividualPolicy(ctx.admin).then(ip => listLearnerOffers(ctx.admin, { expireDays: ip.scholarQuestionOfferDays }))]);
  const open = sp.snapshot && /^[0-9a-f-]{36}$/i.test(sp.snapshot) ? await readSnapshot(ctx.admin, sp.snapshot, policy.educatorMeasures) : null;
  // SQIE-COMPLETE-01: possible duplicates of each draft revision question, shown before it is submitted.
  const pool = resources?.some(r => r.kind === "revision_question" && r.versions.some(v => v.state === "draft")) ? await loadQuestionPool(ctx.admin) : null;
  const reported = open?.cells.filter(c => !c.suppressed) ?? [];
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Educator knowledge</h1>
        <p className="mt-1 text-sm text-gray-600">Learning needs from aggregate, suppressed measures, answered with educator-written resources that reach learners only after clinical approval and publication.</p>
      </header>
      {!on && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">CKRI is switched off in this environment. Nothing can be changed.</p>}

      <section className={card} aria-labelledby="s-h">
        <h2 id="s-h" className="text-[15px] font-bold text-gray-900">Released measures</h2>
        {policy.educatorMeasures.length === 0 ? <p className="text-[13px] text-gray-600">The published CKRI policy releases no measure to educators.</p>
          : !snaps ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Snapshots could not be read.</p>
          : snaps.length === 0 ? <p className="text-[13px] text-gray-600">No snapshot of a released measure yet.</p> : (
            <ul className="divide-y divide-gray-100 text-[13px]">{snaps.map((s: Record<string, string | number | null>) => <li key={String(s.id)} className="py-1.5"><Link className="font-semibold text-teal-800 underline" href={`?snapshot=${s.id}`}>{MEASURES.find(m => m.code === s.measure)?.label}</Link> · {s.period_from} to {s.period_to} · by {s.cohort_dimension}</li>)}</ul>
          )}
      </section>
      {open && <SnapshotView s={open} />}
      {open && reported.length > 0 && (
        <section className={card} aria-labelledby="n-h">
          <h2 id="n-h" className="text-[15px] font-bold text-gray-900">Raise a learning need from this snapshot</h2>
          <p className="mb-2 text-[12.5px] text-gray-600">Only a reported cell can be chosen. Its figures are copied as evidence by the database.</p>
          {reported.slice(0, 30).map(c => (
            <details key={`${c.subjectRef}-${c.cohort}-${c.period}`} className="border-t border-gray-100 py-1.5"><summary className="cursor-pointer text-[13px]">{c.subject} · {c.cohort} · {c.period}</summary>
              <FieldsForm action="need_raise" endpoint={EP} submit="Raise need" done="Raised." extra={{ snapshotId: open.snapshot.id, subjectKind: c.subjectKind, subjectRef: c.subjectRef, cohort: c.cohort, period: c.period }}
                fields={[{ name: "summary", label: "What learners need", kind: "textarea", required: true }, { name: "responseKind", label: "Answer with", kind: "select", options: ["knowledge_resource", "clinical_case", "competency_improvement"], required: true }]} />
            </details>
          ))}
        </section>
      )}

      <section className={card} aria-labelledby="ln-h">
        <h2 id="ln-h" className="text-[15px] font-bold text-gray-900">Learning needs</h2>
        {!needs ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Needs could not be read (or migration 442 is not applied here).</p>
          : needs.length === 0 ? <p className="text-[13px] text-gray-600">None yet.</p> : (
          <ul className="divide-y divide-gray-100 text-[13px]">{needs.map((n: Record<string, unknown>) => (
            <li key={String(n.id)} className="space-y-1 py-2">
              <div><span className="font-semibold">{String(n.summary)}</span> · {String(n.measure)} · {String(n.cohort_value)} · {String(n.period_start)} · answer with {String(n.response_kind)} · <span className="font-medium">{String(n.status)}</span></div>
              {(n.status === "open" || n.status === "in_progress") && <div className="flex flex-wrap gap-2">
                {n.status === "open" && <ActionButton endpoint={EP} body={{ action: "need_move", needId: n.id, status: "in_progress" }} label="Start" done="Started." />}
                <details><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Mark addressed</summary><FieldsForm action="need_move" endpoint={EP} extra={{ needId: n.id, status: "addressed" }} submit="Addressed" done="Addressed." fields={[{ name: "responseRef", label: `The ${String(n.response_kind).replace("_", " ")} record id`, required: true }, { name: "note", label: "Note" }]} /></details>
                <ActionButton endpoint={EP} body={{ action: "need_move", needId: n.id, status: "declined" }} label="Decline" done="Declined." note="Reason (required)" />
                {n.response_kind === "knowledge_resource" && <details><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Write a resource for this need</summary><NewResource needId={String(n.id)} /></details>}
              </div>}
            </li>
          ))}</ul>
        )}
      </section>

      {/* SQIE-LIBRARY-EXPANSION-01 (802): questions learners offered, one at a time, under their separate permission. */}
      <section className={card} aria-labelledby="lo-h">
        <h2 id="lo-h" className="text-[15px] font-bold text-gray-900">Learner offers</h2>
        <p className="mb-2 text-[12.5px] text-gray-600">Questions learners chose to offer, screened for patient details and for text copied from their notes. The learner is never named. Taking one makes a draft: it still needs your review of its exact content, independent clinical approval and publication. Nothing is approved automatically.</p>
        {offers === null ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Learner offers could not be read.</p>
          : offers.length === 0 ? <p className="text-[13px] text-gray-600">No learner offers.</p> : (
          <ul className="divide-y divide-gray-100 text-[13px]">{offers.map(o => (
            <li key={o.id} className="space-y-1 py-2">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{o.formatLabel}</span>
                <span className="rounded border border-gray-300 px-1.5 py-0.5 text-[11.5px]">{o.status === "offered" ? "Waiting" : o.status === "taken" ? "Taken as a draft" : "Published from this offer"}</span>
                <span className="text-gray-600">{o.aiWritten ? "AI-written in the learner's Scholar, not clinically reviewed" : "Written by the learner's study tools, not clinically reviewed"} · rights attested: {o.attestation.replace("_", " ")} · offered {o.offeredAt.slice(0, 10)}</span></div>
              <p className="whitespace-pre-wrap font-medium text-gray-900">{o.stem}</p>
              <p><span className="font-semibold text-gray-700">Key: </span>{o.keyText || "none readable"}</p>
              <p><span className="font-semibold text-gray-700">Explanation: </span>{o.rationale}</p>
              {o.sourceQuote && <p><span className="font-semibold text-gray-700">Quoted passage (the learner confirmed their rights to it): </span>{o.sourceQuote}</p>}
              {o.status === "offered" && <div className="flex flex-wrap items-start gap-3">
                <details><summary className="cursor-pointer font-semibold text-teal-800">Take as a library draft</summary>
                  <FieldsForm action="offer_take" endpoint={EP} extra={{ offerId: o.id }} submit="Take as a draft" done="Taken. The draft is in Knowledge resources below: review it, name its competencies and submit it."
                    fields={[{ name: "title", label: "Title (its topic)", required: true }, { name: "code", label: "Resource code (optional)" }]} /></details>
                <ActionButton endpoint={EP} body={{ action: "offer_decline", offerId: o.id }} label="Decline" done="Declined. Its content was removed." note="Reason (required)" />
              </div>}
              {o.takenResourceId && <a className="font-semibold text-teal-800 underline" href={`#res-${o.takenResourceId}`}>Open the draft</a>}
            </li>
          ))}</ul>
        )}
      </section>

      <section className={card} aria-labelledby="r-h">
        <h2 id="r-h" className="text-[15px] font-bold text-gray-900">Knowledge resources</h2>
        <details className="mb-2"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">New resource</summary><div className="mt-2"><NewResource /></div></details>
        {!resources ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Resources could not be read.</p>
          : resources.length === 0 ? <p className="text-[13px] text-gray-600">None yet.</p> : (
          <ul className="divide-y divide-gray-100 text-[13px]">{resources.map(r => {
            const served = r.versions.find(servedToLearners);
            return (
            <li key={r.id} id={`res-${r.id}`} className="space-y-1 py-2">
              <div><span className="font-semibold">{r.title}</span> <code className="text-gray-600">{r.code}</code> · {KIND[r.kind] ?? r.kind} · {r.status}</div>
              <p className="text-[12.5px] text-gray-700">{served ? `Learners are given version ${served.versionNo}, the published, clinically approved one. A newer draft reaches them only once it is approved and published.` : "Learners are given nothing yet: no version is both clinically approved and published."}</p>
              {r.versions.slice(0, 3).map(v => (
                <div key={v.id} className="ml-3 space-y-1 border-l border-gray-200 pl-3">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="font-semibold">Version {v.versionNo}</span><StatusChip status={v.status} /><span>{v.origin === "ai_draft" ? "AI draft" : v.origin === "learner_contribution" ? "Drafted from a learner offer" : "Written by an educator"} · {v.educatorReviewed ? "educator-reviewed" : "not yet educator-reviewed"}{v.required !== null ? ` · ${v.approvals} of ${v.required} clinical approvals` : ""} · {v.competencies.length} competencies</span></div>
                  {r.kind === "osce_station" && v.state !== "draft" && <details><summary className="cursor-pointer font-semibold text-teal-800">View station</summary><StationPreview content={v.content} /></details>}
                  {r.kind === "revision_question" && <details><summary className="cursor-pointer font-semibold text-teal-800">View question as a reviewer reads it</summary><div className="mt-1"><QuestionView content={v.content} /></div></details>}
                  {v.state === "draft" && <div className="flex flex-wrap gap-2">
                    <details><summary className="cursor-pointer font-semibold text-teal-800">Edit</summary><EditDraft versionId={v.id} kind={r.kind} initial={v.content} {...(r.kind === "revision_question" ? { questionFields: fieldsFromQuestionContent(v.content) } : {})} /></details>
                    <ActionButton endpoint={EP} body={{ action: "competencies_set", versionId: v.id }} label="Set competencies" done="Saved." note="CFCA competency ids" />
                    <ActionButton endpoint={EP} body={{ action: "review", versionId: v.id }} label="I have reviewed this content" done="Educator review recorded." />
                    {r.kind === "revision_question" && pool
                      ? <SubmitDraft versionId={v.id} duplicates={duplicatesOf(v.content, pool, r.id).map(d => ({ code: d.item.code, title: d.item.title, band: d.band, score: d.score, href: `/super-admin/research/questions?r=${d.item.resourceId}` }))} />
                      : <ActionButton endpoint={EP} body={{ action: "submit", versionId: v.id }} label="Submit for clinical review" done="Submitted." tone="primary" />}
                  </div>}
                  {v.state !== "draft" && v.versionNo === r.versions[0].versionNo && r.status === "active" && <ActionButton endpoint={EP} body={{ action: "version_new", resourceId: r.id }} label={v.state === "published" ? "Edit as a new version" : "Start a new version"} done="New draft started. The published version stays in use until this one is approved and published." />}
                </div>
              ))}
            </li>
          ); })}</ul>
        )}
      </section>
    </div>
  );
}
