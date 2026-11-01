"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { sourceHref, studyHref } from "./question-view";
import { carry, studyField } from "./study-active";
import { SpellingNote } from "./spelling-note";
import type { AnswerSpelling } from "@/lib/individual/scholar/spelling";
import { readSpellingChoice, spellingField } from "@/lib/individual/scholar/spelling-variant";
import type { CaseFrom } from "@/lib/individual/scholar/study-carry";
import { CASE_CONTEXT_LABEL, CASE_DIMENSION_LABEL, CASE_ENTRY_LABEL, MARKING_LABEL, type CaseContext, type CaseEntry } from "@/lib/individual/scholar/config";
import type { LearnerView } from "@/lib/cases/blueprint";
import { AiFeedback } from "./ai-feedback";
import { FormativeAiLabel } from "./edu-notice";

// CLINICAL REASONING -- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (Stage 5A), the student's side.
// A case shows only what the student has reached: the findings revealed so far and the decisions of the stages reached
// (learnerView, tokens only). After a decision, what the route sends back (answeredView): the key, the rationale, any
// safety criteria broken, and how it was marked -- by code, by the student, or AI feedback in its own labelled box.
// Every case says what it is: a private practice case written by AI from the notes, or a governed library case.
// One column below md (the CPR-MOB-001 single md edge); touch targets grow on coarse pointers.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const field = `rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; status: number; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}
const caseHref = (kind: string, id: string) => `${studyHref("apply/case")}?kind=${kind}&session=${id}`;

type Offer = { versionId: string; title: string; intro: string | null; level: string; why?: string[] };
/** Apply opened from Learn, Teach me, Revision or the study journey: the words for "the section you came from". */
const FROM_LABEL: Record<CaseFrom, string> = { learn: "The section from Learn", teach: "The section you were learning", revision: "The question you were revising", journey: "The section from your study journey" };
/** SCHOLAR-AI-OPT-01: why a case was not written from these notes, and what to do instead (sufficiency.ts). */
type Readiness = { outcome: string; message?: string | null; alternative: "case_question" | "teach" | null; canAttempt: boolean; sectionIds?: string[]; materialId?: string };

// ── START A CASE ──

export function CaseStart(props: {
  entries: CaseEntry[]; contexts: CaseContext[]; mode: "guided" | "independent"; libraryOn: boolean;
  materials: { id: string; title: string }[]; competencies: { id: string; title: string }[]; aiNote: string | null;
  /** SCHOLAR-SESSION-AI-02 adds `entry` with a material or competency: the open study session's focus, chosen first. */
  preset?: { chunkId?: string; from?: CaseFrom } | { entry: "notes"; materialId: string } | { entry: "competency"; competencyId: string } | null;
}) {
  const router = useRouter();
  const chunkPreset = props.preset && "chunkId" in props.preset && props.preset.chunkId ? props.preset : null;
  const focus = props.preset && "entry" in props.preset && props.entries.includes(props.preset.entry) ? props.preset : null;
  const [entry, setEntry] = useState<CaseEntry | "teach" | "revision">(chunkPreset ? (chunkPreset.from === "revision" ? "revision" : "teach") : focus?.entry ?? props.entries.find(e => e !== "library" || props.libraryOn) ?? "notes");
  const [material, setMaterial] = useState(focus?.entry === "notes" ? focus.materialId : props.materials[0]?.id ?? "");
  const [competency, setCompetency] = useState(focus?.entry === "competency" ? focus.competencyId : props.competencies[0]?.id ?? "");
  const [context, setContext] = useState<CaseContext>(props.contexts[0] ?? "general");
  const [mode, setMode] = useState(props.mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offers, setOffers] = useState<{ list: Offer[]; note: string } | null>(null);
  // Learning Continuity: a new case is not available, which is a state to explain, not an error.
  const [continuity, setContinuity] = useState("");
  // SCHOLAR-AI-OPT-01: a case already written from these sections, or why these notes suit something else better.
  const [saved, setSaved] = useState<{ caseId: string; title: string; note: string } | null>(null);
  const [readiness, setReadiness] = useState<(Readiness & { error: string }) | null>(null);
  const [alt, setAlt] = useState("");

  async function begin(generateAnyway = false, opts: { fresh?: boolean; attemptAnyway?: boolean } = {}) {
    setBusy(true); setError(""); setContinuity(""); setSaved(null); setReadiness(null); setAlt("");
    if (entry === "library") {
      const r = await call(`/api/individual/scholar/clinical/library${competency ? `?competency=${competency}` : ""}`, undefined, "GET");
      setBusy(false);
      if (!r.ok) { setError(r.json.error ?? "The case library could not be read."); return; }
      setOffers({ list: r.json.offers ?? [], note: r.json.offers?.length ? "Clinically approved cases. Playing one uses no AI." : r.json.reason ?? "No library case fits yet." });
      return;
    }
    const scope = chunkPreset?.chunkId ? { kind: "section", chunkId: chunkPreset.chunkId }
      : entry === "competency" ? { kind: "competency", competencyId: competency } : entry === "surprise" ? null : { kind: "document", materialId: material };
    const r = await call("/api/individual/scholar/clinical/cases", { entry, scope, context, mode, generateAnyway, ...opts, ...studyField() });
    setBusy(false);
    if (r.ok && r.json.offers) { setOffers({ list: r.json.offers, note: r.json.note }); return; }
    if (r.ok && r.json.saved) { setSaved({ ...r.json.saved, note: r.json.note }); return; }
    if (!r.ok && r.json.sufficiency) { setReadiness({ ...r.json.sufficiency, error: r.json.error ?? r.json.sufficiency.message ?? "A case could not be written from these notes." }); return; }
    if (!r.ok && r.json.continuity) { setContinuity(r.json.error ?? "A new case cannot be written right now."); return; }
    if (!r.ok) { setError(r.json.error ?? "A case could not be started."); return; }
    router.push(carry(caseHref("private", r.json.play.sessionId)));
  }
  // The simpler activity on the same notes: one case question, written and kept only if it passes every check.
  async function caseQuestion(chunkId: string) {
    setBusy(true); setAlt("");
    const r = await call("/api/individual/scholar/questions", { chunkId, kind: "case" });
    setBusy(false);
    setAlt(!r.ok ? r.json.error ?? "A case question could not be written just now." : r.json.created ? `${r.json.created} case question${r.json.created === 1 ? " was" : "s were"} written from this section. Open the section to answer ${r.json.created === 1 ? "it" : "them"}.` : r.json.message ?? "No case question could be written from this section.");
  }
  async function play(versionId: string) {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/clinical/sessions", { versionId, mode, ...studyField() });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "That case could not be started."); return; }
    router.push(carry(`${caseHref("library", r.json.play.sessionId)}${mode === "guided" ? "&hints=1" : ""}`));
  }
  const entries: (CaseEntry | "teach" | "revision")[] = chunkPreset?.chunkId ? [chunkPreset.from === "revision" ? "revision" : "teach"] : props.entries.filter(e => e !== "library" || props.libraryOn);
  return (
    <section aria-labelledby="case-start-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="case-start-h" className="text-[16px] font-bold text-gray-900">Clinical reasoning</h2>
      <p className="mt-0.5 text-[13.5px] text-gray-600">Work through a patient case: recognise what matters, interpret findings, prioritise, decide and explain. Formative simulation from your own notes, not an assessment.</p>
      <fieldset className="mt-3">
        <legend className="text-[13px] font-semibold text-gray-800">Start from</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-[13.5px]">
          {entries.map(e => <label key={e} className="inline-flex items-center gap-1.5"><input type="radio" name="case-entry" checked={entry === e} onChange={() => setEntry(e)} />{e === "teach" || e === "revision" ? FROM_LABEL[chunkPreset?.from ?? e] : CASE_ENTRY_LABEL[e]}</label>)}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-3">
        {entry === "notes" && !chunkPreset?.chunkId && (
          <label className="text-[13px] font-semibold text-gray-800">Material
            <select value={material} onChange={e => setMaterial(e.target.value)} className={`${field} ml-2 max-w-full`}>{props.materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
          </label>
        )}
        {(entry === "competency" || entry === "library") && props.competencies.length > 0 && (
          <label className="text-[13px] font-semibold text-gray-800">Competency
            <select value={competency} onChange={e => setCompetency(e.target.value)} className={`${field} ml-2 max-w-full`}>
              {entry === "library" && <option value="">Any</option>}
              {props.competencies.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        )}
        {entry !== "library" && (
          <label className="text-[13px] font-semibold text-gray-800">Clinical context
            <select value={context} onChange={e => setContext(e.target.value as CaseContext)} className={`${field} ml-2`}>{props.contexts.map(c => <option key={c} value={c}>{CASE_CONTEXT_LABEL[c]}</option>)}</select>
          </label>
        )}
        <label className="text-[13px] font-semibold text-gray-800">Play
          <select value={mode} onChange={e => setMode(e.target.value as "guided" | "independent")} className={`${field} ml-2`}><option value="guided">Guided (with hints)</option><option value="independent">Independent</option></select>
        </label>
      </div>
      {entry === "competency" && !props.competencies.length && <p className="mt-2 text-[13px] text-gray-600">None of your notes is linked to a competency yet, so start from your notes instead. Cases work without a catalogue.</p>}
      <button type="button" className={`${btn} mt-4`} style={{ background: accent }} disabled={busy || (entry === "notes" && !material && !chunkPreset?.chunkId) || (entry === "competency" && !competency)} onClick={() => begin(false)}>
        {busy ? "Preparing the case…" : entry === "library" ? "Show library cases" : "Start the case"}
      </button>
      {props.aiNote && entry !== "library" && <p className="mt-2 text-[12.5px] text-gray-600">{props.aiNote}</p>}
      {offers && (
        <div className="mt-4 rounded-xl border border-gray-200 p-4">
          <p className="text-[13.5px] text-gray-800">{offers.note}</p>
          <ul className="mt-2 space-y-2">
            {offers.list.map(o => (
              <li key={o.versionId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 text-[14px]"><span className="font-semibold text-gray-900">{o.title}</span>{o.intro ? <span className="block text-[12.5px] text-gray-600">{o.intro}</span> : null}
                  <span className="block text-[12px] text-gray-700"><span className="font-semibold">Why this case:</span> {o.why?.length ? o.why.join("; ") : "Clinically approved. Nothing closer to your topic or your gaps was found."}</span></span>
                <button type="button" className={ghost} disabled={busy} onClick={() => play(o.versionId)}>Play this case</button>
              </li>
            ))}
          </ul>
          {entry !== "library" && <button type="button" className={`${ghost} mt-3`} disabled={busy} onClick={() => begin(true)}>Write me a case from my notes instead</button>}
        </div>
      )}
      {saved && (
        <div role="status" className="mt-4 rounded-xl border border-gray-200 p-4">
          <p className="text-[13.5px] text-gray-800">{saved.note}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ReplayCase caseId={saved.caseId} title={`Play "${saved.title}" again`} />
            <button type="button" className={ghost} disabled={busy} onClick={() => begin(true, { fresh: true })}>Write a new case</button>
          </div>
        </div>
      )}
      {readiness && (
        <div role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-amber-900">{readiness.canAttempt ? "A simpler activity may suit these notes" : "No case from these notes"}</p>
          <p className="mt-1 text-[14px] text-gray-800">{readiness.error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {readiness.alternative === "case_question" && readiness.sectionIds?.[0] && (
              <button type="button" className={btn} style={{ background: accent }} disabled={busy} onClick={() => caseQuestion(readiness.sectionIds![0])}>{busy ? "Writing…" : "Write a case question instead"}</button>
            )}
            {readiness.materialId && readiness.sectionIds?.[0] && (
              <Link href={sourceHref(readiness.materialId, readiness.sectionIds[0])} className={ghost}>{readiness.alternative === "teach" ? "Learn from this section" : "Open the section"}</Link>
            )}
            {readiness.canAttempt && <button type="button" className={ghost} disabled={busy} onClick={() => begin(true, { attemptAnyway: true })}>Try the case anyway</button>}
          </div>
          {alt && <p role="status" className="mt-2 text-[13px] text-gray-800">{alt}</p>}
        </div>
      )}
      {continuity && (
        <div role="status" className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-900">No new case right now</p>
          <p className="mt-1 text-[14px] text-gray-800">{continuity}</p>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-800">{error}</p>}
    </section>
  );
}

// ── PLAY A CASE ──

type Answered = { token: string; options: { token: string; correct: boolean; chosen: boolean; rationale: string | null }[]; rationale: string | null; safetyEvents: string[] } | null;
type Feedback = { token: string; correct?: boolean | null; marking: string; markingLabel?: string; answered: Answered; expected?: string | null; aiFeedback?: string | null; safety?: string[]; chunkIds?: string[] };
type Debrief = {
  answered: number; of: number; correct: number; dimensions: { dimension: string; answered: number; correct: number; written: number }[];
  safetyEvents: string[]; missedFindings: { label: string }[]; objectives: { text: string }[]; revisit: { decisionPointId: string; chunkIds: string[] }[]; label: string;
};
type Closing = { reflectionPrompt: string | null; differentials: { label: string; reasoning: string }[]; managementPrinciples: string[]; expectedReasoning: string | null };
export type Play = {
  kind: "private" | "library"; sessionId: string; status: string; view: LearnerView; answered: string[]; feedback: Feedback[]; debrief: Debrief | null; label: string; materialId?: string; caseId?: string;
  /** The saved "why" per decision token, kept with the answer on the server, so it returns on any device. */
  reasons?: Record<string, string>; closing?: Closing | null;
  /** The kept record of a finished attempt (SCHOLAR-CASE-INTEGRITY-01), when there is one. */
  attempt?: Attempt | null;
};
type Attempt = {
  keptAt: string; completedAt: string; label: string; changed: boolean;
  corrected: { id: string; prompt: string; original: string; effective: string; corrections: { basis: string; reason: string; from: string; to: string; at: string }[] }[];
};

export function CasePlayer({ initial, hints }: { initial: Play; hints: boolean }) {
  const [play, setPlay] = useState<Play>(initial);
  const [fresh, setFresh] = useState<Record<string, Feedback>>({});
  const [choice, setChoice] = useState<Record<string, string[]>>({});
  const [text, setText] = useState<Record<string, string>>({});
  // SCHOLAR-LEARN-GAPS-02 item 3: how a written decision was read (display only; it is marked and kept as typed).
  const [spelt, setSpelt] = useState<Record<string, AnswerSpelling>>({});
  // "Explain your choice": typed here and sent with the answer, which keeps it on the server. Where it cannot be kept, this page still holds it for the debrief.
  const [reason, setReason] = useState<Record<string, string>>(initial.reasons ?? {});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const base = `/api/individual/scholar/clinical/sessions/${play.kind}/${play.sessionId}`;
  const feedbackFor = (token: string) => fresh[token] ?? play.feedback.find(f => f.token === token) ?? null;
  async function reveal(factToken: string) {
    setBusy(factToken); setError("");
    const r = await call(`${base}/reveal`, { factToken, hints });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "That could not be shown."); return; }
    setPlay(p => ({ ...p, ...r.json.play }));
  }
  async function answer(decisionToken: string, kind: string) {
    setBusy(decisionToken); setError("");
    const why = (reason[decisionToken] ?? "").trim();
    const r = await call(`${base}/answer`, kind === "free_text" ? { decisionToken, text: text[decisionToken] ?? "", hints, ...spellingField(readSpellingChoice()) }
      : { decisionToken, optionTokens: choice[decisionToken] ?? [], hints, ...(why ? { reason: why } : {}) });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "Your answer could not be recorded."); return; }
    setFresh(f => ({ ...f, [decisionToken]: r.json.feedback }));
    if (r.json.spelling) setSpelt(s => ({ ...s, [decisionToken]: r.json.spelling }));
    setPlay(p => ({ ...p, ...r.json.play }));
  }
  const v = play.view;
  return (
    <article aria-labelledby="case-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-gray-500">{play.label}</p>
      <h2 id="case-h" className="mt-1 text-[17px] font-bold text-gray-900">{v.title}</h2>
      {v.intro && <p className="mt-1 text-[14.5px] leading-relaxed text-gray-800">{v.intro}</p>}
      {v.patient && <p className="mt-1 text-[13px] text-gray-600">{[v.patient.ageBand, v.patient.setting, v.patient.presentingComplaint].filter(Boolean).join(" · ")}</p>}

      <section aria-labelledby="findings-h" className="mt-4 rounded-xl bg-gray-50 p-4">
        <h3 id="findings-h" className="text-[12px] font-bold uppercase tracking-[0.08em] text-gray-600">Findings so far</h3>
        {v.facts.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">None yet. Ask for what you need to know.</p> : (
          <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {v.facts.map(f => <div key={f.token} className="flex gap-2 text-[14px]"><dt className="font-semibold text-gray-800">{f.label}:</dt><dd className="text-gray-900">{f.value}{f.unit ? ` ${f.unit}` : ""}</dd></div>)}
          </dl>
        )}
      </section>

      <ol className="mt-4 space-y-4">
        {v.stages.map((st, si) => (
          <li key={st.token} className="rounded-xl border border-gray-200 p-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: accent }}>Stage {si + 1}{st.categoryLabel ? ` · ${st.categoryLabel}` : ""}</p>
            <h3 className="text-[15px] font-bold text-gray-900">{st.title}</h3>
            {st.guidance && <StageGuidanceBox g={st.guidance} />}
            {st.decisionPoints.map(d => {
              const fb = feedbackFor(d.token);
              const done = play.answered.includes(d.token);
              return (
                <div key={d.token} className="mt-3">
                  <p className="text-[14.5px] font-semibold text-gray-900">{d.prompt}</p>
                  {!done && d.hint && <p className="mt-1 rounded-lg bg-sky-50 px-3 py-1.5 text-[12.5px] text-sky-950">Hint: {d.hint}</p>}
                  {!done && d.canReveal.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="text-gray-600">Ask for:</span>
                      {d.canReveal.map(r => <button key={r.token} type="button" className={ghost} disabled={!!busy} onClick={() => reveal(r.token)}>{busy === r.token ? "…" : r.label}</button>)}
                    </div>
                  )}
                  {!done ? (
                    d.kind === "free_text" ? (
                      <label className="mt-2 block text-[13px] font-semibold text-gray-800">Your reasoning
                        <textarea rows={3} maxLength={4000} value={text[d.token] ?? ""} onChange={e => setText(t => ({ ...t, [d.token]: e.target.value }))} className={`${field} mt-1 block w-full`} />
                      </label>
                    ) : (
                      <fieldset className="mt-2"><legend className="sr-only">{d.kind === "multiple" ? "Choose all that apply" : "Choose one"}</legend>
                        {d.kind === "multiple" && <p className="mb-1 text-[12.5px] text-gray-600">Choose all that apply.</p>}
                        <div className="grid gap-2 lg:grid-cols-2">
                          {d.options.map(o => {
                            const on = (choice[d.token] ?? []).includes(o.token);
                            return (
                              <label key={o.token} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[14.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${on ? "border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>
                                <input type={d.kind === "multiple" ? "checkbox" : "radio"} name={`d-${d.token}`} checked={on} className="mt-1 h-4 w-4 shrink-0"
                                  onChange={() => setChoice(c => ({ ...c, [d.token]: d.kind === "multiple" ? (on ? (c[d.token] ?? []).filter(x => x !== o.token) : [...(c[d.token] ?? []), o.token]) : [o.token] }))} />
                                <span>{o.text}</span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    )
                  ) : null}
                  {!done && d.askReason && d.kind !== "free_text" && (
                    <label className="mt-2 block text-[13px] font-semibold text-gray-800">Explain your choice <span className="font-normal text-gray-600">(optional: it does not change how the choice is marked)</span>
                      <textarea rows={2} maxLength={1000} value={reason[d.token] ?? ""} onChange={e => setReason(r => ({ ...r, [d.token]: e.target.value }))} className={`${field} mt-1 block w-full`} />
                    </label>
                  )}
                  {!done && play.status === "active" && (
                    <button type="button" className={`${btn} mt-3`} style={{ background: accent }} disabled={!!busy || (d.kind === "free_text" ? !(text[d.token] ?? "").trim() : !(choice[d.token] ?? []).length)} onClick={() => answer(d.token, d.kind)}>
                      {busy === d.token ? "Recording…" : "Decide"}
                    </button>
                  )}
                  {done && spelt[d.token] && (
                    <div className="mt-2 rounded-lg bg-gray-50 px-3 py-1.5 text-[13px] text-gray-800">
                      <p className="whitespace-pre-wrap"><span className="font-semibold">Your reasoning:</span> {text[d.token]}</p>
                      <SpellingNote spelling={spelt[d.token]} what="reasoning" />
                    </div>
                  )}
                  {done && d.askReason && reason[d.token]?.trim() && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-1.5 text-[13px] text-gray-800"><span className="font-semibold">Your reason:</span> {reason[d.token]}</p>}
                  {done && <DecisionFeedback d={d} fb={fb} materialId={play.materialId} />}
                </div>
              );
            })}
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-800">{error}</p>}
      {play.status !== "active" && (play.debrief ? <CaseDebrief d={play.debrief} /> : <p className="mt-4 text-[14px] font-semibold text-gray-900">Case finished.</p>)}
      {play.status !== "active" && play.attempt && <AttemptRecord a={play.attempt} />}
      {play.status !== "active" && <ClosingNotes closing={play.closing ?? null} reasons={reason} view={v} />}
      {play.status !== "active" && <ReflectionCard prompt={play.closing?.reflectionPrompt ?? null} revisit={play.debrief?.revisit ?? []} materialId={play.materialId} />}
      {/* SCHOLAR-AI-OPT-01 s7: optional feedback on an AI-written private case (a library case is clinically reviewed). */}
      {play.status !== "active" && play.kind === "private" && <AiFeedback kind="case" target="case" refId={play.caseId} />}
      <nav aria-label="What next" className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
        <Link href={studyHref("apply")} className={ghost}>Try another case</Link>
        <Link href={studyHref("revise")} className={ghost}>Revise related knowledge</Link>
      </nav>
    </article>
  );
}

function DecisionFeedback({ d, fb, materialId }: { d: LearnerView["stages"][number]["decisionPoints"][number]; fb: Feedback | null; materialId?: string }) {
  if (!fb?.answered) return (
    <div className="mt-2">
      <p className="text-[13px] text-gray-600">Decision recorded.</p>
      {fb?.aiFeedback && (
        <div className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{MARKING_LABEL.ai_evaluation}</p>
          <p className="mt-1 text-[13.5px] text-amber-950">{fb.aiFeedback}</p>
          <FormativeAiLabel className="mt-1" />
        </div>
      )}
    </div>
  );
  const a = fb.answered;
  const marking = fb.marking as keyof typeof MARKING_LABEL;
  return (
    <div aria-live="polite" className={`mt-2 rounded-xl border p-3 ${fb.correct === true ? "border-emerald-300 bg-emerald-50" : fb.correct === false ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
      {fb.correct !== undefined && fb.correct !== null && <p className={`text-[14px] font-bold ${fb.correct ? "text-emerald-900" : "text-red-900"}`}>{fb.correct ? "That is what the case calls for." : "Not what the case calls for."}</p>}
      <p className="text-[12px] text-gray-700"><span className="font-semibold">{fb.markingLabel ?? MARKING_LABEL[marking] ?? "Marked against the case"}.</span></p>
      {d.kind !== "free_text" && (
        <ul className="mt-2 space-y-1 text-[13.5px]">
          {a.options.map(o => {
            const text = d.options.find(x => x.token === o.token)?.text ?? "";
            return <li key={o.token} className={o.correct ? "font-semibold text-emerald-900" : o.chosen ? "text-red-900" : "text-gray-700"}>{o.correct ? "✓ " : o.chosen ? "✗ " : "· "}{text}{o.rationale ? <span className="block pl-4 font-normal text-gray-700">{o.rationale}</span> : null}</li>;
          })}
        </ul>
      )}
      {a.rationale && <p className="mt-2 text-[13.5px] text-gray-800">{a.rationale}</p>}
      {fb.expected && <p className="mt-2 text-[13.5px] text-gray-800"><span className="font-semibold">What a good answer contains:</span> {fb.expected}</p>}
      {fb.aiFeedback && (
        <div className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{MARKING_LABEL.ai_evaluation}</p>
          <p className="mt-1 text-[13.5px] text-amber-950">{fb.aiFeedback}</p>
          <FormativeAiLabel className="mt-1" />
        </div>
      )}
      {a.safetyEvents.length > 0 && (
        <div role="alert" className="mt-2 rounded-lg border-2 border-red-400 bg-white px-3 py-2">
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-red-900">Safety-critical</p>
          <ul className="mt-1 list-disc pl-5 text-[13.5px] text-red-950">{a.safetyEvents.map(s => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {fb.correct === false && (fb.chunkIds ?? []).length > 0 && materialId && (
        <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
          <Link href={`${studyHref("learn")}?section=${fb.chunkIds![0]}`} className={ghost}>Teach me this</Link>
          <Link href={sourceHref(materialId, fb.chunkIds![0])} className={ghost}>Show the source</Link>
        </div>
      )}
    </div>
  );
}

const OUTCOME_LABEL: Record<string, string> = { correct: "what the case calls for", partial: "partly", incorrect: "not what the case calls for", unmarked: "not marked" };
const BASIS_LABEL: Record<string, string> = { rubric_error: "the rubric was wrong", key_error: "the answer key was wrong", marking_error: "it was marked wrongly", other: "reviewed" };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };

/** SCHOLAR-CASE-INTEGRITY-01: the finished attempt is kept as it was completed, and any correction is shown beside the original. */
function AttemptRecord({ a }: { a: Attempt }) {
  return (
    <section aria-labelledby="attempt-h" className="mt-5 rounded-xl border border-gray-200 p-4">
      <h3 id="attempt-h" className="text-[15px] font-bold text-gray-900">Your completed attempt</h3>
      <p className="mt-1 text-[13px] text-gray-700">Kept as you completed it{a.completedAt ? ` on ${day(a.completedAt)}` : ""}. {a.label}</p>
      {a.changed && <p role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[13px] text-amber-950">This case has changed since you completed it. Your attempt is kept against the case as you played it.</p>}
      {a.corrected.length > 0 && (
        <div className="mt-3">
          <p className="text-[12.5px] font-bold text-gray-800">Corrections</p>
          <ul className="mt-1 space-y-2 text-[13.5px] text-gray-800">
            {a.corrected.map(d => (
              <li key={d.id}>
                <span className="font-semibold">{d.prompt}</span>
                <span className="block">Originally: {OUTCOME_LABEL[d.original] ?? d.original}. Now: {OUTCOME_LABEL[d.effective] ?? d.effective}.</span>
                {d.corrections.map((c, i) => <span key={i} className="block text-[12.5px] text-gray-600">{day(c.at)}: {BASIS_LABEL[c.basis] ?? c.basis}. {c.reason}</span>)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CaseDebrief({ d }: { d: Debrief }) {
  return (
    <section aria-labelledby="debrief-h" className="mt-5 rounded-xl border border-gray-200 p-4">
      <h3 id="debrief-h" className="text-[15px] font-bold text-gray-900">How your reasoning went</h3>
      <p className="text-[12px] text-gray-600">{d.label}</p>
      <p className="mt-2 text-[14px] text-gray-900">{d.correct} of {d.answered - d.dimensions.reduce((n, x) => n + x.written, 0)} choices were what the case called for{d.dimensions.some(x => x.written) ? `; ${d.dimensions.reduce((n, x) => n + x.written, 0)} written answer(s) reviewed apart` : ""}.</p>
      <table className="mt-2 w-full text-[13px]">
        <caption className="sr-only">By reasoning dimension</caption>
        <thead><tr className="text-left text-[12px] text-gray-500"><th scope="col">Dimension</th><th scope="col">Answered</th><th scope="col">As the case called for</th></tr></thead>
        <tbody>{d.dimensions.map(x => <tr key={x.dimension} className="border-t border-gray-100"><td>{CASE_DIMENSION_LABEL[x.dimension] ?? "Reasoning"}</td><td className="tabular-nums">{x.answered}</td><td className="tabular-nums">{x.written === x.answered ? "Written: see feedback" : x.correct}</td></tr>)}</tbody>
      </table>
      {d.safetyEvents.length > 0 && <div className="mt-3"><p className="text-[12.5px] font-bold text-red-900">Safety-critical points missed</p><ul className="list-disc pl-5 text-[13.5px] text-red-950">{d.safetyEvents.map(s => <li key={s}>{s}</li>)}</ul></div>}
      {d.missedFindings.length > 0 && <div className="mt-3"><p className="text-[12.5px] font-bold text-gray-800">Findings you could have asked for</p><ul className="list-disc pl-5 text-[13.5px] text-gray-800">{d.missedFindings.map(f => <li key={f.label}>{f.label}</li>)}</ul></div>}
      {d.objectives.length > 0 && <div className="mt-3"><p className="text-[12.5px] font-bold text-gray-800">What this case was about</p><ul className="list-disc pl-5 text-[13.5px] text-gray-800">{d.objectives.map(o => <li key={o.text}>{o.text}</li>)}</ul></div>}
    </section>
  );
}

/** What a stage's own category adds as the learner reaches it (cases/blueprint.ts stageGuidance): never an answer to the decision in front of them. */
function StageGuidanceBox({ g }: { g: NonNullable<LearnerView["stages"][number]["guidance"]> }) {
  return (
    <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[13.5px] text-gray-800">
      {g.differentials && (
        <>
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-gray-600">Differentials to weigh</p>
          <ul className="mt-1 list-disc pl-5">{g.differentials.map(x => <li key={x.label}><span className="font-semibold">{x.label}</span>{x.reasoning ? <span className="block font-normal text-gray-700">{x.reasoning}</span> : null}</li>)}</ul>
        </>
      )}
      {g.managementPrinciples && (
        <>
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-gray-600">Management principles</p>
          <ul className="mt-1 list-disc pl-5">{g.managementPrinciples.map(x => <li key={x}>{x}</li>)}</ul>
        </>
      )}
    </div>
  );
}

/** At the end of a case: the author's differentials, management principles and expected reasoning, and the learner's own reasons. */
function ClosingNotes({ closing, reasons, view }: { closing: Closing | null; reasons: Record<string, string>; view: LearnerView }) {
  const prompts = new Map(view.stages.flatMap(s => s.decisionPoints.map(d => [d.token, d.prompt] as const)));
  const mine = Object.entries(reasons).filter(([t, r]) => r.trim() && prompts.has(t));
  const c = closing;
  if (!c?.differentials.length && !c?.managementPrinciples.length && !c?.expectedReasoning && !mine.length) return null;
  return (
    <section aria-labelledby="closing-h" className="mt-5 rounded-xl border border-gray-200 p-4">
      <h3 id="closing-h" className="text-[15px] font-bold text-gray-900">How the case can be reasoned</h3>
      {c?.expectedReasoning && <p className="mt-2 text-[14px] text-gray-900">{c.expectedReasoning}</p>}
      {!!c?.differentials.length && (
        <div className="mt-3"><p className="text-[12.5px] font-bold text-gray-800">Differentials</p>
          <ul className="list-disc pl-5 text-[13.5px] text-gray-800">{c.differentials.map(d => <li key={d.label}><span className="font-semibold">{d.label}</span>: {d.reasoning}</li>)}</ul></div>
      )}
      {!!c?.managementPrinciples.length && (
        <div className="mt-3"><p className="text-[12.5px] font-bold text-gray-800">Management principles</p>
          <ul className="list-disc pl-5 text-[13.5px] text-gray-800">{c.managementPrinciples.map(m => <li key={m}>{m}</li>)}</ul></div>
      )}
      {mine.length > 0 && (
        <div className="mt-3"><p className="text-[12.5px] font-bold text-gray-800">Your reasons</p>
          <ul className="list-disc pl-5 text-[13.5px] text-gray-800">{mine.map(([t, r]) => <li key={t}><span className="font-semibold">{prompts.get(t)}</span> {r}</li>)}</ul></div>
      )}
    </section>
  );
}

const REFLECTION_PROMPTS = ["What did you notice?", "What would you do differently?", "What do you need to revise?"] as const;

/**
 * A short reflection at the end of a case. The text lives in this page only: it is NOT saved, sent or kept anywhere, and
 * the card says so. If the case has a reflection stage, its prompt leads. Links go back to the sections to revisit.
 */
function ReflectionCard({ prompt, revisit, materialId }: { prompt: string | null; revisit: { decisionPointId: string; chunkIds: string[] }[]; materialId?: string }) {
  const [note, setNote] = useState("");
  const links = revisit.filter(r => r.chunkIds.length).slice(0, 3);
  return (
    <section aria-labelledby="reflect-h" className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h3 id="reflect-h" className="text-[15px] font-bold text-gray-900">Reflect on this case</h3>
      <p className="text-[12.5px] font-semibold text-gray-700">Not saved — for your own reflection.</p>
      {prompt && <p className="mt-2 text-[14px] text-gray-900">{prompt}</p>}
      <ul className="mt-2 list-disc pl-5 text-[13.5px] text-gray-800">{REFLECTION_PROMPTS.map(p => <li key={p}>{p}</li>)}</ul>
      <label className="mt-2 block text-[13px] font-semibold text-gray-800">Your reflection
        <textarea rows={4} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className={`${field} mt-1 block w-full bg-white`} />
      </label>
      {links.length > 0 && materialId && (
        <div className="mt-3 flex flex-wrap gap-2">{links.map(r => <Link key={r.decisionPointId} href={`${studyHref("learn")}?section=${r.chunkIds[0]}`} className={ghost}>Teach me what I missed</Link>)}</div>
      )}
    </section>
  );
}

// ── OFFER A CASE TO THE CASE LIBRARY (5B, the Scholar side) ──

export function CaseOfferPanel(props: { libraryOn: boolean; /** Whether offering is on (it follows the case library switch unless HQ turns it off). Off: only withdrawing is offered. */ offering: boolean; granted: boolean; attestationVersion: string; text: { own_notes: string; licensed_to_share: string; terms: string } | null; cases: { id: string; title: string }[]; offers: { sourceKey: string; status: string; reasons: string[] }[] }) {
  const router = useRouter();
  const [attestation, setAttestation] = useState<"own_notes" | "licensed_to_share" | "">("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  if (!props.libraryOn) return null;
  const anyOffer = props.offers.some(o => ["eligible", "in_development"].includes(o.status));
  // Switched off: nothing new can be granted or offered, but a student can always take back what they gave.
  if (!props.offering && !props.granted && !anyOffer) return null;
  const offered = new Map(props.offers.map(o => [o.sourceKey, o]));
  async function grant() {
    setBusy("grant"); setMsg("");
    const r = await call("/api/individual/scholar/clinical/candidacy", { attestation, attestationVersion: props.attestationVersion });
    setBusy(""); setMsg(r.ok ? "Permission recorded. You can now offer a case, one at a time." : r.json.error ?? "That could not be recorded."); if (r.ok) router.refresh();
  }
  async function revoke() {
    setBusy("revoke"); setMsg("");
    const r = await call("/api/individual/scholar/clinical/candidacy", undefined, "DELETE");
    setBusy(""); setMsg(r.ok ? `Permission withdrawn. ${r.json.withdrawn ?? 0} case(s) not yet in the library were removed.` : r.json.error ?? "That could not be withdrawn."); if (r.ok) router.refresh();
  }
  async function offer(id: string) {
    setBusy(id); setMsg("");
    const r = await call(`/api/individual/scholar/clinical/cases/${id}/offer`, { kind: "case" });
    setBusy("");
    setMsg(!r.ok ? r.json.error ?? "That case could not be offered." : r.json.status === "eligible" ? "Offered. It will be screened and may be adapted by educators; only a clinically approved version is ever published." : `Not eligible: ${(r.json.reasons ?? []).join(", ")}. Nothing of it was kept.`);
    if (r.ok) router.refresh();
  }
  async function withdraw(id: string) {
    setBusy(`w${id}`); setMsg("");
    const r = await call(`/api/individual/scholar/clinical/cases/${id}/offer`, undefined, "DELETE");
    setBusy(""); setMsg(r.ok ? "Withdrawn." : r.json.error ?? "That could not be withdrawn."); if (r.ok) router.refresh();
  }
  return (
    <section aria-labelledby="offer-panel-h" className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 id="offer-panel-h" className="text-[15px] font-bold text-gray-900">Offer your cases to the case library</h2>
      <p className="text-[12.5px] text-gray-600">Optional, and separate from your AI help setting. Nothing is offered unless you choose a case. Offering never uses your AI allowance.</p>
      {!props.offering && <p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">Offering cases is switched off here. You can still withdraw a permission or an offer you made.</p>}
      {!props.granted ? (
        !props.offering ? null :
        props.text && (
          <div className="mt-3 space-y-2 text-[13.5px] text-gray-800">
            <p>{props.text.terms}</p>
            <fieldset><legend className="text-[13px] font-semibold">The material my cases come from is</legend>
              <label className="mt-1 flex items-start gap-2"><input type="radio" name="attest" checked={attestation === "own_notes"} onChange={() => setAttestation("own_notes")} />{props.text.own_notes}</label>
              <label className="mt-1 flex items-start gap-2"><input type="radio" name="attest" checked={attestation === "licensed_to_share"} onChange={() => setAttestation("licensed_to_share")} />{props.text.licensed_to_share}</label>
            </fieldset>
            <button type="button" className={ghost} disabled={!attestation || !!busy} onClick={grant}>Allow my chosen cases to be considered</button>
          </div>
        )
      ) : (
        <>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {props.cases.map(c => { const o = offered.get(`scholar:case:${c.id}`); return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[14px]">
                <span className="min-w-0 flex-1">{c.title}{o ? <span className="text-[12.5px] text-gray-500"> · {o.status}{o.reasons.length ? ` (${o.reasons.join(", ")})` : ""}</span> : null}</span>
                {o && ["eligible", "in_development"].includes(o.status) ? <button type="button" className={ghost} disabled={!!busy} onClick={() => withdraw(c.id)}>Withdraw</button>
                  : props.offering && (!o || o.status === "withdrawn" || o.status === "ineligible") ? <button type="button" className={ghost} disabled={!!busy} onClick={() => offer(c.id)}>{busy === c.id ? "Offering…" : "Offer this case"}</button> : null}
              </li>
            ); })}
          </ul>
          <button type="button" className={`${ghost} mt-3`} disabled={!!busy} onClick={revoke}>Withdraw my permission</button>
        </>
      )}
      {msg && <p role="status" className="mt-2 text-[13px] text-gray-700">{msg}</p>}
    </section>
  );
}

/** Replay one of the student's own stored cases: a new session on the same case, with no AI. */
export function ReplayCase({ caseId, title }: { caseId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/clinical/sessions", { caseId, ...studyField() });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "That case could not be started."); return; }
    router.push(carry(caseHref("private", r.json.play.sessionId)));
  }
  return (
    <span className="text-[13.5px]">
      <button type="button" onClick={go} disabled={busy} className={`font-semibold underline underline-offset-2 disabled:opacity-50 ${focusRing}`}>{busy ? "Starting…" : title}</button>
      {error && <span role="alert" className="ml-2 text-[12.5px] text-red-800">{error}</span>}
    </span>
  );
}
