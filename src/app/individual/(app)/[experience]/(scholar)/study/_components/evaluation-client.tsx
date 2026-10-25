"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { EVALUATION_METHOD_LABEL } from "@/lib/individual/scholar/config";
import { evaluationHref, studyHref } from "./question-view";

// EVALUATION-01 (Stage 6) E1: choosing what to evaluate and how, without knowing the CFCA underneath. "From your
// existing evidence" keeps an evaluation at once. "A fresh knowledge check" and "Existing evidence and a fresh
// check" first run a knowledge check -- a Mock session over the same scope, feedback held to the end (Revision's
// own sitting) -- and the evaluation is made when it is finished.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;
const field = `w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; status: number; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

type Method = "existing" | "fresh" | "combined";
type ScopeKind = "all" | "topic" | "document" | "documents" | "competency" | "outcome" | "context";
const SCOPE_LABEL: Record<ScopeKind, string> = {
  all: "All my learning", topic: "A topic", document: "One material", documents: "Chosen materials", competency: "A competency", outcome: "A learning outcome", context: "A clinical context",
};

/** The scope a fresh knowledge check runs over: Revision's scopes (an outcome checks its competency; a context, everything). */
function checkScope(scope: Record<string, unknown>): Record<string, unknown> {
  if (scope.kind === "all" || scope.kind === "context") return { kind: "library" };
  if (scope.kind === "outcome") return { kind: "competency", competencyId: scope.competencyId };
  return scope;
}

export function EvaluationStart(props: {
  methods: Method[]; materials: { id: string; title: string }[]; competencies: { id: string; title: string; outcomes: string[] }[];
  contexts: { value: string; label: string }[]; freshQuantity: number;
}) {
  const router = useRouter();
  const kinds = (Object.keys(SCOPE_LABEL) as ScopeKind[]).filter(k => (k !== "competency" && k !== "outcome") || props.competencies.length > 0)
    .filter(k => (k !== "document" && k !== "documents") || props.materials.length > 0);
  const [kind, setKind] = useState<ScopeKind>("all");
  const [method, setMethod] = useState<Method>(props.methods[0] ?? "existing");
  const [topic, setTopic] = useState("");
  const [material, setMaterial] = useState(props.materials[0]?.id ?? "");
  const [chosen, setChosen] = useState<string[]>([]);
  const [competency, setCompetency] = useState(props.competencies[0]?.id ?? "");
  const [outcome, setOutcome] = useState("");
  const [context, setContext] = useState(props.contexts[0]?.value ?? "general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [continuity, setContinuity] = useState("");
  const outcomes = props.competencies.find(c => c.id === competency)?.outcomes ?? [];

  const scope = (): Record<string, unknown> =>
    kind === "topic" ? { kind, topic } : kind === "document" ? { kind, materialId: material } : kind === "documents" ? { kind, materialIds: chosen }
      : kind === "competency" ? { kind, competencyId: competency } : kind === "outcome" ? { kind, competencyId: competency, outcome } : kind === "context" ? { kind, context } : { kind: "all" };

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setContinuity("");
    const s = scope();
    if (method === "existing") {
      const r = await call("/api/individual/scholar/evaluations", { scope: s, method });
      setBusy(false);
      if (!r.ok) { setError(r.json.error ?? "Your evaluation could not be made just now."); return; }
      router.push(evaluationHref(r.json.id));
      return;
    }
    const r = await call("/api/individual/scholar/revision/sessions", { mode: "mock", scope: checkScope(s), quantity: props.freshQuantity });
    setBusy(false);
    if (!r.ok && r.json.continuity) { setContinuity(r.json.error ?? "A knowledge check cannot be written right now."); return; }
    if (!r.ok) { setError(r.json.error ?? "The knowledge check could not start just now."); return; }
    if (!r.json.session?.id) { setError("Knowledge checks are not kept on this environment, so they cannot feed an evaluation."); return; }
    router.push(`${studyHref("revise")}?session=${r.json.session.id}&evaluate=${method}&evscope=${encodeURIComponent(JSON.stringify(s))}`);
  }

  return (
    <form onSubmit={start} aria-labelledby="ev-start-h" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="ev-start-h" className="text-[15px] font-bold text-gray-900">Start a new evaluation</h2>
      <fieldset className="mt-3">
        <legend className="text-[13px] font-semibold text-gray-800">What to evaluate</legend>
        <div className="mt-1 flex flex-wrap gap-2">{kinds.map(k => (
          <label key={k} className={`inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13.5px] pointer-coarse:min-h-[48px] ${kind === k ? "border-gray-900 font-semibold" : "border-gray-300"}`}>
            <input type="radio" name="ev-scope" value={k} checked={kind === k} onChange={() => setKind(k)} /> {SCOPE_LABEL[k]}
          </label>
        ))}</div>
      </fieldset>
      <div className="mt-3 space-y-2">
        {kind === "topic" && <input aria-label="Topic" className={field} placeholder="For example: oxygen therapy" value={topic} onChange={e => setTopic(e.target.value)} />}
        {kind === "document" && (
          <select aria-label="Material" className={field} value={material} onChange={e => setMaterial(e.target.value)}>{props.materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
        )}
        {kind === "documents" && (
          <fieldset><legend className="sr-only">Materials</legend>{props.materials.map(m => (
            <label key={m.id} className="flex min-h-[40px] items-center gap-2 text-[13.5px] pointer-coarse:min-h-[48px]">
              <input type="checkbox" checked={chosen.includes(m.id)} onChange={e => setChosen(c => (e.target.checked ? [...c, m.id] : c.filter(x => x !== m.id)))} /> {m.title}
            </label>
          ))}</fieldset>
        )}
        {(kind === "competency" || kind === "outcome") && (
          <select aria-label="Competency" className={field} value={competency} onChange={e => { setCompetency(e.target.value); setOutcome(""); }}>{props.competencies.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
        )}
        {kind === "outcome" && (outcomes.length ? (
          <select aria-label="Learning outcome" className={field} value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="">Choose a learning outcome</option>{outcomes.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : <p className="text-[13px] text-gray-600">This competency records no learning outcomes. Evaluate the competency instead.</p>)}
        {kind === "context" && (
          <select aria-label="Clinical context" className={field} value={context} onChange={e => setContext(e.target.value)}>{props.contexts.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        )}
      </div>
      <fieldset className="mt-4">
        <legend className="text-[13px] font-semibold text-gray-800">How</legend>
        <div className="mt-1 space-y-1">{props.methods.map(m => (
          <label key={m} className="flex min-h-[40px] items-center gap-2 text-[13.5px] pointer-coarse:min-h-[48px]">
            <input type="radio" name="ev-method" value={m} checked={method === m} onChange={() => setMethod(m)} />
            {EVALUATION_METHOD_LABEL[m]}{m !== "existing" ? <span className="text-gray-500"> · {props.freshQuantity} questions, feedback at the end</span> : null}
          </label>
        ))}</div>
      </fieldset>
      <button type="submit" className={`${btn} mt-4`} style={{ background: accent }} disabled={busy || (kind === "outcome" && !outcome) || (kind === "documents" && !chosen.length) || (kind === "topic" && topic.trim().length < 2)}>
        {busy ? "Preparing…" : method === "existing" ? "Evaluate" : "Start the knowledge check"}
      </button>
      {continuity && (
        <div role="status" className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-900">No knowledge check right now</p>
          <p className="mt-1 text-[14px] text-gray-800">{continuity} You can still evaluate from your existing evidence.</p>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-800">{error}</p>}
    </form>
  );
}

/** Keep the continuous evaluation as a record, so it can be looked back on. */
export function KeepContinuous() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function keep() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/evaluations", { scope: { kind: "all" }, method: "existing", continuous: true });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "It could not be kept just now."); return; }
    router.push(evaluationHref(r.json.id));
  }
  return (
    <div>
      <button type="button" className={ghost} disabled={busy} onClick={keep}>{busy ? "Keeping…" : "Keep this evaluation"}</button>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
    </div>
  );
}

/** A kept record names its scope as it was shown (kind, label, ids): the request that evaluates it again. */
export function requestScopeOf(v: Record<string, any>): Record<string, unknown> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = Array.isArray(v.ids) ? v.ids[0] : undefined;
  switch (v.kind) {
    case "topic": return { kind: "topic", topic: v.label };
    case "document": return { kind: "document", materialId: id };
    case "documents": return { kind: "documents", materialIds: v.ids ?? [] };
    case "competency": return { kind: "competency", competencyId: id };
    case "outcome": return { kind: "outcome", competencyId: id, outcome: v.outcome };
    case "section": return { kind: "section", chunkId: id };
    case "context": return { kind: "context", context: v.context };
    default: return { kind: "all" };
  }
}

/** On a kept evaluation: evaluate the same scope again (a new record that follows this one), or remove it. */
export function EvaluationActions({ id, scope }: { id: string; scope: Record<string, unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function again() {
    setBusy("again"); setError("");
    const r = await call("/api/individual/scholar/evaluations", { scope: requestScopeOf(scope), method: "existing", supersedesId: id });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "It could not be evaluated again just now."); return; }
    router.push(evaluationHref(r.json.id));
  }
  async function remove() {
    if (!window.confirm("Remove this evaluation? The learning it read is not affected.")) return;
    setBusy("remove"); setError("");
    const r = await call(`/api/individual/scholar/evaluations/${id}`, undefined, "DELETE");
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "It could not be removed just now."); return; }
    router.push(evaluationHref());
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} style={{ background: accent }} disabled={!!busy} onClick={again}>{busy === "again" ? "Evaluating…" : "Evaluate this again from my evidence"}</button>
      <button type="button" className={ghost} disabled={!!busy} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove"}</button>
      {error && <p role="alert" className="w-full text-[13px] font-semibold text-red-800">{error}</p>}
    </div>
  );
}

/** At the end of a knowledge check started for an evaluation: make the evaluation from it. */
export function MakeEvaluation({ sessionId, method, scope, toGrade }: { sessionId: string; method: "fresh" | "combined"; scope: Record<string, unknown>; toGrade: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function make() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/evaluations", { scope, method, freshSessionId: sessionId });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your evaluation could not be made just now."); return; }
    router.push(evaluationHref(r.json.id));
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <p className="text-[14px] font-semibold text-gray-900">This knowledge check was for an evaluation ({EVALUATION_METHOD_LABEL[method].toLowerCase()}).</p>
      {toGrade > 0 && <p className="mt-1 text-[13px] text-gray-700">Mark the short answers above first: any left unmarked are not counted.</p>}
      <button type="button" className={`${btn} mt-2`} style={{ background: accent }} disabled={busy} onClick={make}>{busy ? "Evaluating…" : "See my evaluation"}</button>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
    </div>
  );
}

/** PROGRESS-01 P5: show this evaluation in the Passport, with the student's label -- or take it off. Never shown unless chosen. */
export function PassportEvaluationChoice({ evaluationId, shown, suggested }: { evaluationId: string; shown: boolean; suggested: string }) {
  const router = useRouter();
  const [label, setLabel] = useState(suggested.slice(0, 120));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(method: "POST" | "DELETE") {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/passport-evaluations", method === "POST" ? { evaluationId, label } : { evaluationId }, method);
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "It could not be changed just now."); return; }
    router.refresh();
  }
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
      <p className="text-[13px] font-semibold text-gray-900">Your Passport</p>
      {shown ? (
        <p className="mt-1 text-[13px] text-gray-700">Shown in your Passport as an educational evaluation: formative, never verified.{" "}
          <button type="button" className={`underline ${focusRing}`} disabled={busy} onClick={() => send("DELETE")}>{busy ? "Taking it off…" : "Take it off"}</button></p>
      ) : (
        <form onSubmit={e => { e.preventDefault(); send("POST"); }} className="mt-1 flex flex-wrap items-end gap-2">
          <label className="text-[12.5px] text-gray-700">Show it in your Passport as
            <input value={label} onChange={e => setLabel(e.target.value)} maxLength={120} className={`${field} mt-1 block w-72 max-w-full`} />
          </label>
          <button type="submit" className={ghost} disabled={busy || !label.trim()}>{busy ? "Adding…" : "Show in my Passport"}</button>
          <p className="w-full text-[12px] text-gray-600">It appears as an educational evaluation, with its confidence and how many limitations it states. Not your notes or answers, and never a credential.</p>
        </form>
      )}
      {error && <p role="alert" className="mt-1 text-[13px] font-semibold text-red-800">{error}</p>}
    </div>
  );
}
