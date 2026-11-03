"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AssessmentRunner, SaveStatusPill, type RunnerMode } from "@/components/assessment";
import { Btn, Chip, fieldBase, focusRing, mutedText } from "@/components/assessment/ui";
import type { InstrumentDef, LayoutDoc, ResponseValue, Responses, RulesDoc } from "@/lib/assessment/core";
import { fromDbValue, toDbValue } from "@/lib/assessment/adapters/scholar/answers";
import { SAVE_DEBOUNCE_MS, confirmPatch, queuePatch, readPending, saveStatusOf, writePending, type PendingPatch } from "@/lib/assessment/adapters/scholar/autosave";
import { unansweredItems, unansweredMandatory } from "@/lib/assessment/adapters/scholar/submit-check";
import { SELF_BANNER, SELF_NOTICE } from "@/lib/assessment/adapters/scholar/vocab";

// THE SELF-ASSESSMENT RUNNER -- the shared AssessmentRunner (Standard Checklist and Guided Assessment over ONE set of answers) plus the Scholar host:
//
//   AUTOSAVE      every answer is its own PATCH, about 800 ms after the learner stops, with the revision the browser last saw. The server's 409 returns its
//                 copy and the learner chooses. Answers not yet confirmed are kept in sessionStorage and replayed when the page is reopened.
//   SAVE STATUS   Saving / Saved / Offline (will retry) / Conflict, always visible, never silent.
//   NOT ANSWERED  clears the answer (it is not stored as an answer). "Unable to judge" is a state the scale words, never zero.
//   SUBMIT        asks first, listing the required criteria still unanswered. They are recorded as incomplete, never as zero.
//   BANNER        "Self-reported, not verified competence", always.
//
// The browser's answers are never trusted: the server validates every one against the pinned definition and computes whether it is satisfactory.

export type EvidenceItem = { id: string; itemKey: string | null; kind: string; note: string | null; label: string | null; createdAt: string };
type Choice = { id: string; label: string };
type Conflict = { key: string; server: { value: unknown; revision: number } | null };

const sessionStore = (): Storage | null => { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } };
const API = (id: string, tail: string) => `/api/individual/scholar/assessments/instances/${encodeURIComponent(id)}${tail ? `/${tail}` : ""}`;
const json = { "Content-Type": "application/json" };

function EvidenceBox({ itemKey, items, materials, sessions, disabled, onAdd }: {
  itemKey: string; items: EvidenceItem[]; materials: Choice[]; sessions: Choice[]; disabled: boolean; onAdd: (itemKey: string, body: Record<string, unknown>) => Promise<string | null>;
}) {
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = items.filter(e => e.itemKey === itemKey);
  async function add(body: Record<string, unknown>, done: () => void) {
    setBusy(true); setError(null);
    const e = await onAdd(itemKey, body);
    setBusy(false);
    if (e) setError(e); else done();
  }
  return (
    <details className="mt-2 text-[13px]">
      <summary className={`min-h-9 cursor-pointer py-1 font-semibold text-[var(--cmp-app-text)] ${focusRing}`}>Evidence and notes ({mine.length})</summary>
      <div className="space-y-2 pt-1">
        {mine.length > 0 && <ul className="list-disc pl-5">{mine.map(e => <li key={e.id}>{e.kind === "note" ? e.note : e.label ?? "A linked record"}</li>)}</ul>}
        {!disabled && (
          <>
            <label className={`flex flex-col gap-1 text-xs font-semibold ${mutedText}`}>
              <span>Add a note about why you rated yourself this way</span>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={4000} className={`${fieldBase}`} />
            </label>
            <Btn size="sm" disabled={busy || !note.trim()} onClick={() => add({ kind: "note", note }, () => setNote(""))}>Add note</Btn>
            {(materials.length > 0 || sessions.length > 0) && (
              <div className="flex flex-wrap items-end gap-2">
                <label className={`flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold ${mutedText}`}>
                  <span>Link one of your own materials or practice sessions</span>
                  <select value={ref} onChange={e => setRef(e.target.value)} className={fieldBase}>
                    <option value="">Choose one</option>
                    {materials.length > 0 && <optgroup label="My materials">{materials.map(m => <option key={m.id} value={`material:${m.id}`}>{m.label}</option>)}</optgroup>}
                    {sessions.length > 0 && <optgroup label="My practice sessions">{sessions.map(s => <option key={s.id} value={`revision_session:${s.id}`}>{s.label}</option>)}</optgroup>}
                  </select>
                </label>
                <Btn size="sm" disabled={busy || !ref} onClick={() => { const [refKind, refId] = ref.split(":"); void add({ kind: "record_ref", refKind, refId }, () => setRef("")); }}>Link it</Btn>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="text-[12.5px] text-[var(--cmp-text-error)]">{error}</p>}
      </div>
    </details>
  );
}

export default function AssessmentRunnerHost(props: {
  instanceId: string; def: InstrumentDef; rules: RulesDoc; layout: LayoutDoc | null; guidedLayout: LayoutDoc | null;
  initialResponses: Responses; initialRevisions: Record<string, number>; initialEvidence: EvidenceItem[];
  title: string; subtitle: string; methodLabels: Record<string, string>; materials: Choice[]; sessions: Choice[];
  readOnly: boolean; reportHref: string; listHref: string;
}) {
  const { instanceId, def, readOnly } = props;
  const router = useRouter();
  const [responses, setResponses] = useState<Responses>(props.initialResponses);
  const [evidence, setEvidence] = useState<EvidenceItem[]>(props.initialEvidence);
  const [mode, setMode] = useState<RunnerMode>("standard");
  const [sync, setSync] = useState({ inFlight: false, queued: 0, offline: false, everSaved: false });
  const rev = useRef<Record<string, number>>({ ...props.initialRevisions });
  const queue = useRef<PendingPatch[]>([]);
  const inflight = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const offline = useRef(false);
  const everSaved = useRef(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const conflictKey = useRef<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const persist = useCallback(() => writePending(sessionStore(), instanceId, queue.current), [instanceId]);
  const flushRef = useRef<(key: string) => Promise<void>>(async () => {});
  const refresh = () => setSync({ inFlight: inflight.current.size > 0, queued: queue.current.length, offline: offline.current, everSaved: everSaved.current });

  const flush = useCallback(async (key: string): Promise<void> => {
    if (conflictKey.current === key) return;
    if (inflight.current.has(key)) return;
    const patch = queue.current.find(p => p.key === key);
    if (!patch) return;
    inflight.current.add(key); refresh();
    let again = false;
    try {
      const res = await fetch(API(instanceId, "responses"), { method: "PATCH", headers: json, body: JSON.stringify({ key, value: patch.value, revision: rev.current[key] ?? 0 }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        rev.current[key] = body.cleared ? 0 : Number(body.revision) || 0;
        queue.current = confirmPatch(queue.current, key, patch.at); persist();
        offline.current = false; everSaved.current = true; setProblem(null);
        again = queue.current.some(p => p.key === key);
      } else if (res.status === 409) {
        conflictKey.current = key;
        setConflict({ key, server: body.server && typeof body.server === "object" ? body.server : null });
      } else if (res.status >= 500 || res.status === 429) {
        offline.current = true;
      } else {
        // The server refused this answer (for example it is not valid for the item). It is dropped from the queue, and the saved answer is shown again.
        queue.current = confirmPatch(queue.current, key, patch.at); persist();
        setProblem(typeof body.error === "string" ? body.error : "That answer could not be saved.");
        const back = await fetch(API(instanceId, ""), { cache: "no-store" }).then(r => r.json()).catch(() => null);
        if (back?.ok) { setResponses(prev => { const n = { ...prev }; if (back.responses[key]) n[key] = back.responses[key]; else delete n[key]; return n; }); rev.current[key] = back.revisions?.[key] ?? 0; }
      }
    } catch { offline.current = true; }
    inflight.current.delete(key); refresh();
    if (again && !offline.current) void flushRef.current(key);
  }, [instanceId, persist]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const schedule = useCallback((key: string) => {
    const t = timers.current.get(key); if (t) clearTimeout(t);
    timers.current.set(key, setTimeout(() => { timers.current.delete(key); void flush(key); }, SAVE_DEBOUNCE_MS));
  }, [flush]);

  const flushAll = useCallback(async () => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    await Promise.all(queue.current.map(p => flush(p.key)));
  }, [flush]);

  // Reopened with answers that were never confirmed: show them, and save them.
  useEffect(() => {
    if (readOnly) return;
    // After the first paint (the server rendered without storage), so the page never mismatches what the server sent.
    const t = setTimeout(() => {
      const pending = readPending(sessionStore(), instanceId);
      if (!pending.length) return;
      queue.current = pending;
      setResponses(prev => { const n = { ...prev }; for (const p of pending) { const v = fromDbValue(toDbValue(p.value as ResponseValue | null)); if (v) n[p.key] = v; else delete n[p.key]; } return n; });
      for (const p of pending) void flush(p.key);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Offline: retry every few seconds and the moment the browser says it is back.
  useEffect(() => {
    if (readOnly) return;
    const retry = () => { if (queue.current.length) { offline.current = false; refresh(); void flushAll(); } };
    const id = setInterval(() => { if (offline.current) retry(); }, 5000);
    window.addEventListener("online", retry);
    return () => { clearInterval(id); window.removeEventListener("online", retry); };
  }, [readOnly, flushAll]);

  const onChange = (next: Responses, change: { key: string; value: ResponseValue | null }) => {
    if (readOnly) return;
    setResponses(next);
    const value = toDbValue(change.value);
    queue.current = queuePatch(queue.current, { key: change.key, value, revision: rev.current[change.key] ?? 0, at: Date.now() });
    persist(); refresh(); schedule(change.key);
  };

  const keepMine = () => { if (!conflict) return; rev.current[conflict.key] = conflict.server?.revision ?? 0; conflictKey.current = null; setConflict(null); void flush(conflict.key); };
  const useSaved = () => {
    if (!conflict) return;
    const k = conflict.key, v = conflict.server ? fromDbValue(conflict.server.value) : null;
    setResponses(prev => { const n = { ...prev }; if (v) n[k] = v; else delete n[k]; return n; });
    rev.current[k] = conflict.server?.revision ?? 0;
    queue.current = queue.current.filter(p => p.key !== k); persist();
    conflictKey.current = null; setConflict(null); refresh();
  };

  async function addEvidence(itemKey: string, body: Record<string, unknown>): Promise<string | null> {
    try {
      const res = await fetch(API(instanceId, "evidence"), { method: "POST", headers: json, body: JSON.stringify({ ...body, itemKey }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return typeof out.error === "string" ? out.error : "That could not be added just now.";
      const label = body.kind === "record_ref" ? [...props.materials, ...props.sessions].find(c => c.id === body.refId)?.label ?? "A linked record" : null;
      setEvidence(list => [...list, { id: String(out.id), itemKey, kind: String(body.kind), note: typeof body.note === "string" ? body.note.trim() : null, label, createdAt: new Date().toISOString() }]);
      return null;
    } catch { return "That could not be added just now. Check your connection."; }
  }

  const evidenceCounts = useMemo(() => { const c: Record<string, number> = {}; for (const e of evidence) if (e.itemKey) c[e.itemKey] = (c[e.itemKey] ?? 0) + 1; return c; }, [evidence]);
  const unanswered = useMemo(() => unansweredItems(def, responses, props.rules.defaults), [def, responses, props.rules.defaults]);
  const mandatory = unansweredMandatory(unanswered);
  const status = saveStatusOf({ ...sync, conflict: !!conflict });

  async function submit() {
    setSubmitting(true); setSubmitError(null);
    await flushAll();
    if (queue.current.length || conflictKey.current) { setSubmitting(false); setSubmitError("Some answers are not saved yet. Wait for Saved, then submit again."); return; }
    try {
      const res = await fetch(API(instanceId, "submit"), { method: "POST", headers: json, body: JSON.stringify({ confirmUnanswered: mandatory.length > 0 }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok && typeof out.href === "string") { writePending(sessionStore(), instanceId, []); router.push(out.href); return; }
      setSubmitError(typeof out.error === "string" && out.error !== "unanswered" ? out.error : "It could not be submitted just now. Try again shortly.");
    } catch { setSubmitError("It could not be submitted just now. Check your connection and try again."); }
    setSubmitting(false);
  }

  const actions = readOnly ? (
    <Link href={props.reportHref} className={`inline-flex min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-accent)] px-3 text-sm font-semibold text-[var(--cmp-theme-on-accent)] ${focusRing}`}>Open the report</Link>
  ) : (
    <>
      <Btn onClick={() => void flushAll()} disabled={status === "idle" || status === "saved"}>Save draft</Btn>
      <Btn kind="primary" onClick={() => { setConfirming(true); setSubmitError(null); }}>Submit</Btn>
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={props.listHref} className={`text-[13px] font-semibold underline underline-offset-2 text-[var(--cmp-app-text)] ${focusRing}`}>Back to Assessments</Link>
        {!readOnly && <SaveStatusPill status={status} />}
      </div>
      {problem && <p role="alert" className="rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-surface-error)] px-3 py-2 text-[13px] text-[var(--cmp-text-error)]">{problem}</p>}
      {conflict && (
        <div role="alert" className="rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-surface-warning)] px-3 py-2 text-[13px] text-[var(--cmp-text-warning)]">
          <p className="font-semibold">This answer was changed somewhere else, for example on another device.</p>
          <p className="mt-0.5">Keep what you just chose, or use the answer that was already saved.</p>
          <div className="mt-2 flex flex-wrap gap-2"><Btn size="sm" kind="primary" onClick={keepMine}>Keep my answer</Btn><Btn size="sm" onClick={useSaved}>Use the saved answer</Btn></div>
        </div>
      )}
      {confirming && !readOnly && (
        <section aria-label="Submit your self-assessment" className="rounded-xl border border-[var(--cmp-theme-border)] bg-[var(--cmp-app-surface)] p-4">
          <h2 className="text-base font-bold text-[var(--cmp-app-text)]">Submit your self-assessment?</h2>
          <p className={`mt-1 text-[13px] ${mutedText}`}>{def.items.length - unanswered.length} of {def.items.length} criteria are answered. After you submit you cannot change these answers. You can repeat the self-assessment later, and each attempt is kept.</p>
          {mandatory.length > 0 ? (
            <div className="mt-2">
              <p className="text-[13px] font-semibold text-[var(--cmp-text-warning)]">{mandatory.length} required criteri{mandatory.length === 1 ? "on is" : "a are"} not answered. {mandatory.length === 1 ? "It" : "They"} will be recorded as incomplete, not as zero:</p>
              <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-[13px] text-[var(--cmp-app-text)]">{mandatory.map(i => <li key={i.itemKey}>{i.code ? `${i.code} ` : ""}{i.prompt}{i.why === "unable_to_judge" ? " (you chose Unable to judge)" : ""}</li>)}</ul>
            </div>
          ) : unanswered.length > 0 ? <p className={`mt-2 text-[13px] ${mutedText}`}>{unanswered.length} optional criteri{unanswered.length === 1 ? "on is" : "a are"} not answered.</p> : null}
          <p className="mt-2"><Chip tone="info">{SELF_BANNER}</Chip></p>
          {submitError && <p role="alert" className="mt-2 text-[13px] text-[var(--cmp-text-error)]">{submitError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn kind="primary" disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting..." : mandatory.length > 0 ? "Submit anyway" : "Submit"}</Btn>
            <Btn disabled={submitting} onClick={() => setConfirming(false)}>Go back and answer</Btn>
          </div>
        </section>
      )}
      <AssessmentRunner
        def={def} layout={props.layout} guidedLayout={props.guidedLayout} responses={responses} onChange={onChange} rules={props.rules}
        mode={mode} onModeChange={setMode} breakpoint="auto" saveStatus={readOnly ? "idle" : status} readOnly={readOnly}
        title={props.title} subtitle={props.subtitle}
        banner={<div className="space-y-1"><p className="text-sm font-bold text-[var(--cmp-text-information)]">{SELF_BANNER}</p><p className="text-[13px] text-[var(--cmp-app-text)]">{SELF_NOTICE}</p></div>}
        actions={actions} methodLabels={props.methodLabels} evidenceCounts={evidenceCounts}
        renderEvidence={readOnly ? undefined : (k) => <EvidenceBox key={k} itemKey={k} items={evidence} materials={props.materials} sessions={props.sessions} disabled={readOnly} onAdd={addEvidence} />}
      />
    </div>
  );
}
