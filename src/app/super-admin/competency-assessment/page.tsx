import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadAssessorQueue, loadConfirmationQueue, loadDecisionDraft, loadVersionsById, outcomeTexts, verificationReady, type RequestView } from "@/lib/competency/verification";
import { EMPTY_CONTENT, EVIDENCE_KIND_LABEL, NOT_A_DECLARATION, STATE_LABEL, type MethodContent } from "@/lib/competency/verification-config";
import { AssessorEvidenceForm, Claim, ConfirmForm, Decline, DecisionForm } from "./_components/AssessControls";
import { DecisionSummary } from "./_components/DecisionSummary";
import { listComponents } from "@/lib/competency/studio-components";

// /super-admin/competency-assessment -- COMPETEN-PROFESSIONAL-COMPETENCY-01 C5 (migration 510), the Competency Assessor.
// Guarded by hq.competency.verification.assess, which only the Competency Assessor position holds, and nobody holds that
// until the owner appoints someone. NOT the Clinical Content Reviewer's page: approving content authorises no verification.
//
// ⚠ ONLY WHAT WAS SUBMITTED. The evidence shown is the provenance snapshot taken when the person submitted it, and its
// documents open only for the assigned assessor (audited). Nothing here lists anyone's record otherwise.
// ⚠ NEVER YOUR OWN. A request of yours is never listed, and 510 refuses a decision on it whatever is sent.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competency assessment" };

const fmt = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const h2 = "text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500";

export default async function CompetencyAssessmentPage() {
  const ctx = await requireHqCapability("hq.competency.verification.assess");
  const today = new Date().toISOString().slice(0, 10);
  if (!(await verificationReady(ctx.admin))) {
    return <div className="max-w-4xl"><h1 className="text-xl font-bold text-gray-900">Competency assessment</h1><p className="mt-2 text-[13.5px] text-gray-700">Competency verification is not set up on this environment yet (migration 510).</p></div>;
  }
  const queue = await loadAssessorQueue(ctx.admin, ctx.userId, today);
  // 690: decisions waiting for this assessor as the second assessor (never their own, never on their own request).
  const confirmations = queue ? await loadConfirmationQueue(ctx.admin, ctx.userId, today) : null;
  const all = queue ? [...queue.assigned, ...queue.claimable, ...(confirmations ?? [])] : [];
  // 690: each request this assessor is deciding keeps its working draft on the server, so any device resumes it.
  const drafts = new Map(await Promise.all((queue?.assigned ?? []).filter(r => r.state === "assigned").map(async r => [r.id, await loadDecisionDraft(ctx.admin, ctx.userId, r.id)] as const)));
  const versions = await loadVersionsById(ctx.admin, [...new Set(all.map(r => r.methodVersionId))]);
  const scaleIds = [...new Set([...versions.values()].map(v => (v.content as MethodContent)?.scaleId).filter(Boolean))] as string[];
  const { data: levels } = scaleIds.length ? await ctx.admin.from("scoring_levels").select("id, scale_id, score, label").in("scale_id", scaleIds).order("score") : { data: [] };
  const people = [...new Set(all.map(r => r.userId))];
  const { data: names } = people.length ? await ctx.admin.from("profiles").select("id, full_name").in("id", people) : { data: [] };
  const nameOf = new Map((names ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? "Unnamed person"]));
  const registry = all.length ? await listComponents(ctx.admin) : [];
  const componentLabels = Object.fromEntries((registry ?? []).map(k => [k.code, k.label]));
  const levelName = new Map((levels ?? []).map((l: { id: string; score: number; label: string }) => [l.id, `${Number(l.score)} · ${l.label}`]));
  const levelLabel = (id: string | null) => (id ? levelName.get(id) ?? null : null);
  const personName = (id: string) => nameOf.get(id) ?? "person";

  const card = (r: RequestView & { claimWith?: string }, assigned: boolean) => {
    const v = versions.get(r.methodVersionId);
    const content = { ...EMPTY_CONTENT, ...((v?.content ?? {}) as Partial<MethodContent>) } as MethodContent;
    const outcomes = r.competency?.learning_outcomes ?? [];
    const lv = (levels ?? []).filter((l: { scale_id: string }) => l.scale_id === content.scaleId).map((l: { id: string; scale_id: string; score: number; label: string }) => ({ id: l.id, scaleId: l.scale_id, score: Number(l.score), label: l.label }));
    return (
      <article key={r.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-gray-900">{r.competency?.name ?? "Competency"} <span className="font-normal text-gray-500">· {personName(r.userId)}</span></h3>
          <p className="text-[12.5px] font-semibold text-gray-700">{STATE_LABEL[r.state]}</p>
        </div>
        <p className="text-[12.5px] text-gray-600">{v?.method?.name ?? "Method"}, version {v?.version_no ?? "?"} (criteria {v?.content_hash?.slice(0, 8) ?? "unpublished"}) · framework version {r.frameworkVersion ?? "not recorded"} · requested {fmt(r.createdAt)}</p>
        <div className="text-[13px] text-gray-800">
          <p className="font-semibold">Learning outcomes asked about</p>
          <ul className="list-disc pl-5">{(outcomeTexts(r.outcomeIndexes, r.outcomeIds, r.outcomeMap, outcomes) ?? ["The whole competency"]).map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
        {r.note && <p className="rounded-lg bg-gray-50 p-2.5 text-[13px] text-gray-700">From the person: {r.note}</p>}
        <div>
          <p className="text-[13px] font-semibold text-gray-900">Evidence submitted ({r.evidence.length})</p>
          {r.evidence.length === 0 ? <p className="text-[12.5px] text-gray-600">None yet.</p> : (
            <ul className="mt-1 space-y-1.5">
              {r.evidence.map(e => (
                <li key={e.id} className="text-[13px] text-gray-800">
                  <span className="font-medium">{String(e.provenance.title ?? e.provenance.template ?? EVIDENCE_KIND_LABEL[e.kind])}</span>
                  <span className="text-gray-500"> · {EVIDENCE_KIND_LABEL[e.kind]} · {e.provenance.evidence_class === "assessor_recorded" ? `Recorded by the assessor under method version ${e.provenance.method_version_no ?? "?"}` : e.provenance.evidence_class === "platform_recorded" ? "Recorded by Competen Learning" : e.provenance.evidence_class === "source_linked" ? "Self-declared, document attached" : "Self-declared"} · submitted {fmt(e.addedAt)}{e.sourcePresent ? "" : " · the person has since removed the source record"}</span>
                  {assigned && typeof e.provenance.document_path === "string" && <> · <a href={`/api/hq/competency-assessment?evidence=${e.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-800 underline underline-offset-2">Open {String(e.provenance.document_name ?? "document")}</a></>}
                  {e.kind === "reflection" && typeof e.provenance.body === "string" && <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 text-[12.5px] text-gray-700">{e.provenance.body}</p>}
                  {e.kind === "assessor_observation" && typeof e.provenance.record?.summary === "string" && <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 text-[12.5px] text-gray-700">{e.provenance.record.summary}</p>}
                  {e.kind === "exam_result" && <p className="mt-1 text-[12.5px] text-gray-700">Score {String(e.provenance.record?.score)} of {String(e.provenance.record?.maxScore)}{typeof e.provenance.record?.passMark === "number" ? `, pass mark ${e.provenance.record.passMark}` : ""}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {r.decisions.length > 0 && (
          <div>
            <p className="text-[13px] font-semibold text-gray-900">Decisions on this request ({r.decisions.length})</p>
            <ul className="mt-1 space-y-2">{[...r.decisions].reverse().map(d => <li key={d.id}><DecisionSummary d={d} levelLabel={levelLabel} componentLabels={componentLabels} /></li>)}</ul>
          </div>
        )}
        {content.decisionGuidance && <p className="rounded-lg border border-teal-100 bg-teal-50 p-2.5 text-[13px] text-teal-900">Guidance: {content.decisionGuidance}</p>}
        {assigned && r.state === "assigned" && <AssessorEvidenceForm requestId={r.id} idPrefix={`ae-${r.id.slice(0, 8)}`} components={(content.components ?? []).map(k => ({ code: k.code, label: componentLabels[k.code] ?? k.code }))} />}
        {assigned && r.state === "assigned" && <DecisionForm requestId={r.id} content={content} levels={lv} idPrefix={`d-${r.id.slice(0, 8)}`} requestTargetLevelId={r.targetLevelId} componentLabels={componentLabels}
          evidence={r.evidence.map(e => ({ id: e.id, label: `${String(e.provenance.title ?? EVIDENCE_KIND_LABEL[e.kind])} (${EVIDENCE_KIND_LABEL[e.kind]})` }))} draft={drafts.get(r.id) ?? null} />}
        {assigned && r.state === "awaiting_confirmation" && <p className="text-[13px] text-amber-900">Waiting for a second assessor to confirm your decision.</p>}
        {assigned && r.state === "awaiting_evidence" && <p className="text-[13px] text-amber-900">You asked for further evidence. The request comes back to you when the person adds it.</p>}
        {assigned && <Decline requestId={r.id} idPrefix={`dc-${r.id.slice(0, 8)}`} />}
        {!assigned && r.claimWith && <Claim requestId={r.id} appointmentId={r.claimWith} />}
      </article>
    );
  };

  // 690: the first assessor's decision, set before a second assessor who is neither the person nor the first assessor.
  const confirmCard = (r: RequestView & { decisionId: string; confirmWith: string }) => {
    const v = versions.get(r.methodVersionId);
    const d = r.decisions.find(x => x.id === r.decisionId);
    return (
      <article key={r.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-gray-900">{r.competency?.name ?? "Competency"} <span className="font-normal text-gray-500">· {personName(r.userId)}</span></h3>
          <p className="text-[12.5px] font-semibold text-gray-700">{STATE_LABEL[r.state]}</p>
        </div>
        <p className="text-[12.5px] text-gray-600">{v?.method?.name ?? "Method"}, version {v?.version_no ?? "?"} · framework version {r.frameworkVersion ?? "not recorded"} · requested {fmt(r.createdAt)}</p>
        <div>
          <p className="text-[13px] font-semibold text-gray-900">The first assessor decided</p>
          {d ? <DecisionSummary d={d} levelLabel={levelLabel} componentLabels={componentLabels} /> : <p className="text-[12.5px] text-gray-600">The decision could not be read just now.</p>}
        </div>
        <ConfirmForm requestId={r.id} decisionId={r.decisionId} appointmentId={r.confirmWith} idPrefix={`cf-${r.id.slice(0, 8)}`} />
      </article>
    );
  };

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">Competency assessment</h1>
        <p className="mt-1 text-sm text-gray-600">Requests assigned to you, within the scope of your appointment. Decide each against the criteria of its method version. Every decision is kept as history.</p>
        <p className="mt-1 text-[12.5px] text-gray-600">{NOT_A_DECLARATION}</p>
      </header>
      {queue === null ? <p role="alert" className="text-[13.5px] text-red-700">Your requests could not be read just now.</p> : (
        <>
          <section aria-labelledby="mine-h" className="space-y-3">
            <h2 id="mine-h" className={h2}>Assigned to you</h2>
            {queue.assigned.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] text-gray-600">Nothing is assigned to you.</p> : queue.assigned.map(r => card(r, true))}
          </section>
          {confirmations === null && <p role="alert" className="text-[13.5px] text-red-700">Decisions waiting for your confirmation could not be read just now.</p>}
          {confirmations && confirmations.length > 0 && (
            <section aria-labelledby="confirm-h" className="space-y-3">
              <h2 id="confirm-h" className={h2}>Waiting for your confirmation</h2>
              <p className="text-[12.5px] text-gray-600">The method asks for a second assessor. Not confirmed sets the decision aside and the request is decided again.</p>
              {confirmations.map(confirmCard)}
            </section>
          )}
          {queue.claimable.length > 0 && (
            <section aria-labelledby="claim-h" className="space-y-3">
              <h2 id="claim-h" className={h2}>Open requests you may take</h2>
              {queue.claimable.map(r => card(r, false))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
