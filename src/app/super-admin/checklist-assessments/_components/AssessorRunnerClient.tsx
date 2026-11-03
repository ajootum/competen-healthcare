"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AssessmentRunner, type RunnerMode, type SaveStatus } from "@/components/assessment";
import { Btn, Chip, classTone, mutedText } from "@/components/assessment/ui";
import { evaluate, itemProgress, RulesError, type Evaluation, type InstrumentDef, type LayoutDoc, type ResponseValue, type Responses, type RulesDoc } from "@/lib/assessment/core";
import { PatchQueue, type Conflict, type SendResult } from "@/lib/assessment/assessor/autosave";
import type { CommentView, EvidenceView } from "@/lib/assessment/assessor/instances";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { CommentPanel, EvidencePanel } from "./ItemNotes";

// The assessor's runner. The page hands it the pinned definition and the stored answers. Autosave is per answer with a
// revision (a stale one is a conflict the assessor resolves), unsaved changes live in sessionStorage and are replayed when the
// assessment is opened again, and the status pill says Saving, Saved, Offline or Conflict. Submit asks for confirmation and
// lists what is still open. The server evaluates and records; nothing here decides the outcome.

const API = (id: string) => `/api/hq/checklist-assessments/instances/${id}`;

export interface AssessorRunnerProps {
  instanceId: string;
  def: InstrumentDef;
  rules: RulesDoc;
  standardLayout: LayoutDoc | null;
  guidedLayout: LayoutDoc | null;
  initialResponses: Responses;
  initialRevisions: Record<string, number>;
  initialEvidence: EvidenceView[];
  initialComments: CommentView[];
  title: string;
  subtitle: string;
  subjectName: string | null;
  assessorName: string | null;
  authority: string | null;
  methodLabels: Record<string, string>;
}

export function AssessorRunnerClient(p: AssessorRunnerProps) {
  const router = useRouter();
  const [responses, setResponses] = useState<Responses>(p.initialResponses);
  const [evidence, setEvidence] = useState<EvidenceView[]>(p.initialEvidence);
  const [comments, setComments] = useState<CommentView[]>(p.initialComments);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const [mode, setMode] = useState<RunnerMode>("standard");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queue = useRef<PatchQueue | null>(null);
  const submitPanel = useRef<HTMLDivElement>(null);

  const codeOf = useMemo(() => new Map(p.def.items.map(i => [i.stable_key, i.code])), [p.def.items]);
  const label = (key: string) => codeOf.get(key.split("#")[0]) ?? key;

  const send = useCallback(async (key: string, value: ResponseValue | null, revision: number): Promise<SendResult> => {
    let res: Response;
    try {
      res = await fetch(`${API(p.instanceId)}/responses`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value, revision }) });
    } catch { return { kind: "offline" }; }
    if (res.ok) { const b = await res.json().catch(() => ({})); return { kind: "ok", revision: Number(b.revision ?? 0) }; }
    const b = await res.json().catch(() => ({}));
    if (res.status === 409 && b.server) return { kind: "conflict", server: b.server };
    if (res.status >= 500 || res.status === 429) return { kind: "offline" };
    return { kind: "rejected", message: b.error ?? "That answer was not accepted." };
  }, [p.instanceId]);

  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { storage = null; }
    const q = new PatchQueue({
      instanceId: p.instanceId, send, storage,
      onStatus: s => setStatus(s),
      onConflict: () => setConflicts(q.conflictList),
      onRejected: (k, m) => setRejected(`${label(k)}: ${m}`),
    }, p.initialRevisions);
    queue.current = q;
    // what an earlier session left unsaved is shown again and sent
    const left = q.replay();
    const keys = Object.keys(left);
    if (keys.length) setResponses(r => { const n = { ...r }; for (const k of keys) { if (left[k] === null) delete n[k]; else n[k] = left[k] as ResponseValue; } return n; });
    const onOnline = () => q.online();
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener("online", onOnline); q.dispose(); queue.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.instanceId]);

  const onChange = useCallback((next: Responses, change: { key: string; value: ResponseValue | null }) => {
    setResponses(next);
    queue.current?.enqueue(change.key, change.value);
  }, []);

  function resolve(key: string, choice: "mine" | "theirs") {
    const v = queue.current?.resolve(key, choice);
    setConflicts(queue.current?.conflictList ?? []);
    if (choice === "theirs") setResponses(r => { const n = { ...r }; if (v === null || v === undefined) delete n[key]; else n[key] = v; return n; });
  }

  const evidenceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of evidence) if (e.item_key) c[e.item_key] = (c[e.item_key] ?? 0) + 1;
    return c;
  }, [evidence]);

  // ── submit ────────────────────────────────────────────────────────────────────────────────────────────────
  const review = useMemo(() => {
    if (!confirming) return null;
    const rows = p.def.items.map(i => ({ item: i, pr: itemProgress(i, responses, { evidenceCounts }, p.rules.defaults) }));
    const open = rows.filter(r => (r.item.mandatory || r.item.critical) && !r.pr.primary.answered);
    const critical = rows.filter(r => r.item.critical);
    let ev: Evaluation | null = null; let err: string | null = null;
    try { ev = evaluate(p.def, p.rules, responses, { evidenceCounts }); } catch (e) { err = e instanceof RulesError ? e.message : "The outcome cannot be previewed."; }
    return { open, critical, ev, err, unanswered: rows.filter(r => !r.pr.primary.answered).length };
  }, [confirming, p.def, p.rules, responses, evidenceCounts]);

  // The submit dialog: focus in, Tab trapped, Escape closes it (not while a submit is in flight), focus back on the trigger.
  useModalFocus(confirming, submitPanel, () => { if (!submitting) setConfirming(false); });

  async function startConfirm() {
    setSubmitError(null);
    await queue.current?.flush();
    if ((queue.current?.conflictList.length ?? 0) > 0) { setSubmitError("Resolve the conflicting answers first."); return; }
    if ((queue.current?.unsaved ?? 0) > 0) { setSubmitError("Some answers are not saved yet (no connection). Wait until the status says Saved."); return; }
    setConfirming(true);
  }

  async function submit() {
    setSubmitting(true); setSubmitError(null);
    try {
      await queue.current?.flush();
      if ((queue.current?.unsaved ?? 0) > 0 || (queue.current?.conflictList.length ?? 0) > 0) { setSubmitError("Some answers are not saved yet."); setSubmitting(false); return; }
      const res = await fetch(`${API(p.instanceId)}/submit`, { method: "POST" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setSubmitError(b.error ?? "That could not be submitted."); setSubmitting(false); return; }
      try { window.sessionStorage.removeItem(`asmt.assessor.pending.${p.instanceId}`); } catch { /* ignore */ }
      router.push(`/super-admin/checklist-assessments/${p.instanceId}/report`);
      router.refresh();
    } catch { setSubmitError("There is no connection. Try again."); setSubmitting(false); }
  }

  const actions = (
    <div className="flex items-center gap-2">
      <Btn kind="primary" onClick={startConfirm} disabled={submitting}>Submit assessment</Btn>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {conflicts.length ? (
        <section role="alert" aria-label="Conflicting answers" className="flex flex-col gap-2 rounded-xl border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-error)] p-4 text-sm text-[var(--cmp-text-error)]">
          <p className="font-semibold">An answer was changed somewhere else (another device or window). Choose which one to keep.</p>
          <ul className="flex flex-col gap-2">
            {conflicts.map(c => (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-semibold">{label(c.key)}</span>: yours {describe(c.mine)}, saved {describe(c.server.value)}</span>
                <span className="flex gap-2"><Btn size="sm" onClick={() => resolve(c.key, "mine")}>Keep mine</Btn><Btn size="sm" onClick={() => resolve(c.key, "theirs")}>Use the saved one</Btn></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rejected ? (
        <p role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-surface-warning)] p-3 text-sm text-[var(--cmp-text-warning)]">
          <span>An answer was not accepted and is not saved. {rejected}</span><Btn size="sm" onClick={() => setRejected(null)}>Dismiss</Btn>
        </p>
      ) : null}

      <AssessmentRunner
        def={p.def} layout={p.standardLayout} guidedLayout={p.guidedLayout} responses={responses} onChange={onChange} rules={p.rules}
        mode={mode} onModeChange={setMode} saveStatus={status} breakpoint="auto"
        title={p.title} subtitle={p.subtitle} evidenceCounts={evidenceCounts} methodLabels={p.methodLabels} actions={actions}
        banner={<p className="rounded-lg border border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] px-4 py-2 text-sm text-[var(--cmp-theme-ink)]"><span className="font-semibold">Assessor-evaluated, not formal verification.</span> You are assessing {p.subjectName ?? "a person"}{p.authority ? ` as ${p.authority}` : ""}.</p>}
        subject={<p>Person assessed: <span className="font-semibold">{p.subjectName ?? "Not set"}</span>{p.assessorName ? <> · Assessor: <span className="font-semibold">{p.assessorName}</span></> : null}</p>}
        renderEvidence={k => <EvidencePanel instanceId={p.instanceId} itemKey={k} evidence={evidence} onAdded={e => setEvidence(x => [...x, e])} />}
        renderComment={k => <CommentPanel instanceId={p.instanceId} itemKey={k} comments={comments} onAdded={c => setComments(x => [...x, c])} />}
      />

      <section aria-label="Comments on the whole assessment" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-[var(--cmp-app-text)]">Comments on the whole assessment</h3>
        <p className={`text-sm ${mutedText}`}>Record a safety concern, a strength or a recommendation here. These are kept as they are written and appear on the report.</p>
        <CommentPanel instanceId={p.instanceId} itemKey={null} comments={comments} onAdded={c => setComments(x => [...x, c])} />
      </section>

      {submitError && !confirming ? <p role="alert" className="text-sm text-[var(--cmp-text-error)]">{submitError}</p> : null}

      {confirming && review ? (
        <div role="dialog" aria-modal="true" aria-labelledby="submit-h" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div ref={submitPanel} tabIndex={-1} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-5 text-[var(--cmp-app-text)]">
            <h2 id="submit-h" className="text-lg font-semibold">Submit this assessment?</h2>
            <p className={`mt-1 text-sm ${mutedText}`}>Once submitted, the answers cannot be changed. The result is assessor-evaluated and is not formal verification.</p>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <div>
                <p className="font-semibold">Required items still open ({review.open.length})</p>
                {review.open.length ? <ul className="list-disc pl-5">{review.open.map(r => <li key={r.item.stable_key}>{r.item.code}: {r.item.prompt}</li>)}</ul> : <p className={mutedText}>None. Every required item has an answer.</p>}
                {review.open.length ? <p className="mt-1 text-[var(--cmp-text-warning)]">The result will be Incomplete while a required item is open.</p> : null}
              </div>
              <div>
                <p className="font-semibold">Critical items ({review.critical.length})</p>
                {review.critical.length ? (
                  <ul className="flex flex-col gap-1">
                    {review.critical.map(r => (
                      <li key={r.item.stable_key} className="flex flex-wrap items-center gap-2">
                        <span>{r.item.code}</span>
                        <Chip tone={r.pr.criticalFailed ? "critical" : r.pr.primary.answered ? "success" : "warning"}>{r.pr.criticalFailed ? "Not met" : r.pr.primary.answered ? "Met" : "Not answered"}</Chip>
                      </li>
                    ))}
                  </ul>
                ) : <p className={mutedText}>This checklist has no critical items.</p>}
                {review.critical.some(r => r.pr.criticalFailed) ? <p className="mt-1 text-[var(--cmp-text-critical)]">A critical item that is not met fails the assessment, whatever the other answers are.</p> : null}
              </div>
              <p>{review.unanswered} of {p.def.items.length} items have no answer.</p>
              {review.ev ? <p className="flex flex-wrap items-center gap-2">Expected outcome: <Chip tone={classTone(review.ev.class)}>{review.ev.outcome.label}</Chip><span className={`text-xs ${mutedText}`}>The server works it out again when you submit.</span></p> : review.err ? <p className="text-[var(--cmp-text-error)]">{review.err}</p> : null}
            </div>
            {submitError ? <p role="alert" className="mt-3 text-sm text-[var(--cmp-text-error)]">{submitError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => setConfirming(false)} disabled={submitting}>Keep working</Btn>
              <Btn kind="primary" onClick={submit} disabled={submitting}>{submitting ? "Submitting" : "Submit"}</Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function describe(v: ResponseValue | null | undefined): string {
  if (!v) return "not answered";
  if (v.level_code) return `level ${v.level_code}`;
  if (v.state) return String(v.state).replace(/_/g, " ");
  if (v.value !== undefined && v.value !== null) return typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value);
  return "not answered";
}
