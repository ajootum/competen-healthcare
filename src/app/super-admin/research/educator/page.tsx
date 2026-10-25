import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { ckriEnabled, loadCkriPolicy } from "@/lib/knowledge/governance";
import { listSnapshots, readSnapshot } from "@/lib/knowledge/intelligence";
import { listNeeds, listResources } from "@/lib/knowledge/educator";
import { MEASURES } from "@/lib/knowledge/data-contracts";
import { ActionButton, FieldsForm } from "../_components/ResearchControls";
import { EditDraft, NewResource } from "../_components/KnowledgeControls";
import { SnapshotView } from "../_components/SnapshotView";

// /super-admin/research/educator -- CKRI educator knowledge improvement (COMPETEN-KNOWLEDGE-RESEARCH-01 K3, migration 442).
// Guarded by hq.learning.ckri.educator. Only the measures the published policy releases to educators, as suppressed
// cells. A need is raised from one reported cell. Resources keep origin, educator review and clinical approval apart.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Educator knowledge" };
const card = "rounded-xl border border-gray-200 bg-white p-4";
const EP = "/api/hq/knowledge/educator";
const CLINICAL: Record<string, string> = { draft: "Draft", in_review: "In clinical review", approved: "Clinically approved", rejected: "Rejected in clinical review" };

export default async function EducatorKnowledgePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireHqCapability("hq.learning.ckri.educator");
  const sp = await searchParams;
  const [on, policy] = await Promise.all([ckriEnabled(ctx.admin), loadCkriPolicy(ctx.admin)]);
  const [snaps, needs, resources] = await Promise.all([listSnapshots(ctx.admin, policy.educatorMeasures), listNeeds(ctx.admin), listResources(ctx.admin)]);
  const open = sp.snapshot && /^[0-9a-f-]{36}$/i.test(sp.snapshot) ? await readSnapshot(ctx.admin, sp.snapshot, policy.educatorMeasures) : null;
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

      <section className={card} aria-labelledby="r-h">
        <h2 id="r-h" className="text-[15px] font-bold text-gray-900">Knowledge resources</h2>
        <details className="mb-2"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">New resource</summary><div className="mt-2"><NewResource /></div></details>
        {!resources ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Resources could not be read.</p>
          : resources.length === 0 ? <p className="text-[13px] text-gray-600">None yet.</p> : (
          <ul className="divide-y divide-gray-100 text-[13px]">{resources.map(r => (
            <li key={r.id} className="space-y-1 py-2">
              <div><span className="font-semibold">{r.title}</span> <code className="text-gray-600">{r.code}</code> · {r.kind} · {r.status}</div>
              {r.versions.slice(0, 3).map(v => (
                <div key={v.id} className="ml-3 space-y-1 border-l border-gray-200 pl-3">
                  <div>Version {v.versionNo} · {v.origin === "ai_draft" ? "AI draft" : "Written by an educator"} · {v.educatorReviewed ? "educator-reviewed" : "not yet educator-reviewed"} · {CLINICAL[v.clinical]}{v.required !== null ? ` (${v.approvals} of ${v.required})` : ""} · {v.state} · {v.competencies.length} competencies</div>
                  {v.state === "draft" && <div className="flex flex-wrap gap-2">
                    <details><summary className="cursor-pointer font-semibold text-teal-800">Edit</summary><EditDraft versionId={v.id} kind={r.kind} initial={v.content} /></details>
                    <ActionButton endpoint={EP} body={{ action: "competencies_set", versionId: v.id }} label="Set competencies" done="Saved." note="CFCA competency ids" />
                    <ActionButton endpoint={EP} body={{ action: "review", versionId: v.id }} label="I have reviewed this content" done="Educator review recorded." />
                    <ActionButton endpoint={EP} body={{ action: "submit", versionId: v.id }} label="Submit for clinical review" done="Submitted." tone="primary" />
                  </div>}
                  {v.state !== "draft" && v.versionNo === r.versions[0].versionNo && <ActionButton endpoint={EP} body={{ action: "version_new", resourceId: r.id }} label="Start a new version" done="New draft started." />}
                </div>
              ))}
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
