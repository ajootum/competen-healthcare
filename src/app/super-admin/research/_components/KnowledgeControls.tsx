"use client";

import { useState } from "react";
import { input, primary } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";
import { Msg, useResearchSend } from "./ResearchControls";
import Link from "next/link";
import { LIBRARY_FORM_OPTIONS } from "@/lib/individual/scholar/question-formats";
import { SOURCE_KIND_LABEL, SOURCE_KINDS, normaliseSource, type SourceKind } from "@/lib/knowledge/question-source";
import { CRITERIA_MAX, ROLE_LABEL, ROUNDING_PLACES_MAX, TOLERANCE_PERCENT_MAX, VARIANT_LABEL, calculationAccepted, calculationProblems } from "@/lib/individual/scholar/scoring-rules";
import { DIFFICULTY_LABEL, LIBRARY_DIFFICULTIES, QUALIFICATION_LABEL, QUALIFICATION_LEVELS, mappingStatus } from "@/lib/individual/scholar/library-meta";
import { OsceStationFields, checkStationForm, stationFieldsFromForm, stationFormOf, type StationForm } from "./OsceStationEditor";

// The educator half of K3 (COMPETEN-KNOWLEDGE-RESEARCH-01 s5). Posts to /api/hq/knowledge/educator, which re-checks the
// capability, and 442 decides every write. Content is typed here by the educator: nothing is taken from a student.
// OSCE-AUTHORING-01 (owner, 31 Oct 2026): an OSCE practice station is a fourth kind with a structured editor
// (OsceStationEditor), on the same draft, review, clinical approval and publication path. No separate studio.

const EP = "/api/hq/knowledge/educator";
type Kind = "explanation" | "revision_question" | "targeted_resource" | "osce_station";
type SourceForm = { includes: boolean; kind: SourceKind; reference: string; licence: string; permissionNote: string };
type Fields = { body?: string; links?: string; station?: StationForm; q?: QForm };

// ── SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F): a revision question in any format ──
// The form sends plain fields. The server builds the content (question-format.ts) and checks it with the SAME validator
// Scholar reads it with (library-format.ts validateLibraryQuestion), and 442 (widened by 800) checks it in the database.
// The format options are the registry's (question-formats.ts, which a client bundle may import); the marking words below are this form's own.
// CE-05: the options come from the format registry (a pure module: no server code, so a client bundle may import it).
const FORMATS: { value: string; label: string; marking: string[] }[] = LIBRARY_FORM_OPTIONS;
const MARKING: Record<string, string> = {
  deterministic: "Marked by code against the key (the learner judges an answer code cannot)", self: "The learner marks it against the key",
  rubric_ai_formative: "Formative AI feedback against the key points, then the learner's own judgement",
};
type QForm = {
  format: string; stem: string; options: string[]; correctIndex: number; correct: number[]; accepted: string; truth: string; modelAnswer: string; marks: string;
  keyPoints: string; back: string; pairs: { prompt: string; match: string }[]; steps: string; parts: PartForm[];
  /** SQIE-CLOSE-2026-11 (997, contracts in scoring-rules.ts): WS-B safety markers, WS-C structured variant and findings, WS-A calculation. */
  safetyCritical: boolean; unsafe: string; safetyCriticalPoints: number[]; variant: string; findings: { label: string; value: string; unit: string }[]; calc: CalcForm;
  rubric: { level: string; objective: string; keyPoints: string; misconceptions: string }; marking: string; rationale: string; source: SourceForm;
  /** SQIE-CLOSE-2026-11 WS-E: who it is written for, and its difficulty (library-meta.ts). All optional. */
  programmeCode: string; programmeLabel: string; qualificationLevel: string; qualificationLabel: string; difficulty: string;
  /** Provenance kept exactly as stored (references, source verification, competency mapping, calculation, ...). Not edited here. */
  carried: Record<string, unknown>;
};
type CriterionForm = { text: string; weight: number; safetyCritical: boolean };
type PartForm = { prompt: string; marks: number; accepted: string; role: string; options: string; correct: number | ""; criteria: CriterionForm[]; safetyCritical: boolean; unsafe: string };
type CalcForm = { value: string; unit: string; equivalentUnits: string; roundingMode: string; places: string; toleranceKind: string; toleranceAmount: string; safetyCritical: boolean; working: string; unsafe: string };
const EMPTY_PART: PartForm = { prompt: "", marks: 1, accepted: "", role: "", options: "", correct: "", criteria: [], safetyCritical: false, unsafe: "" };
const EMPTY_CALC: CalcForm = { value: "", unit: "", equivalentUnits: "", roundingMode: "", places: "", toleranceKind: "", toleranceAmount: "", safetyCritical: true, working: "", unsafe: "" };
/** The programmes an item may name (individual_scholar_programme, 387), passed down from the server page. */
export type ProgrammeChoice = { code: string; label: string; level?: string | null };
const EMPTY_Q: QForm = {
  format: "mcq", stem: "", options: ["", "", "", ""], correctIndex: 0, correct: [], accepted: "", truth: "", modelAnswer: "", marks: "", keyPoints: "", back: "",
  pairs: [{ prompt: "", match: "" }, { prompt: "", match: "" }, { prompt: "", match: "" }], steps: "", parts: [EMPTY_PART, EMPTY_PART],
  safetyCritical: false, unsafe: "", safetyCriticalPoints: [], variant: "", findings: [], calc: EMPTY_CALC,
  rubric: { level: "", objective: "", keyPoints: "", misconceptions: "" }, marking: "", rationale: "", source: { includes: false, kind: "governed_reference", reference: "", licence: "", permissionNote: "" },
  programmeCode: "", programmeLabel: "", qualificationLevel: "", qualificationLabel: "", difficulty: "", carried: {},
};
/** The form state of stored fields (the server's fieldsFromQuestionContent), over the empty form. */
function qFormOf(f: Record<string, unknown> | undefined): QForm {
  if (!f) return EMPTY_Q;
  const r = (f.rubric ?? {}) as Record<string, unknown>;
  return {
    ...EMPTY_Q, ...(f as Partial<QForm>), marks: f.marks === undefined || f.marks === null ? "" : String(f.marks), truth: String(f.truth ?? ""),
    options: Array.isArray(f.options) && f.options.length ? (f.options as string[]) : EMPTY_Q.options,
    correct: Array.isArray(f.correct) ? (f.correct as number[]) : [], pairs: Array.isArray(f.pairs) && f.pairs.length ? (f.pairs as QForm["pairs"]) : EMPTY_Q.pairs,
    parts: Array.isArray(f.parts) && f.parts.length ? (f.parts as Partial<PartForm>[]).map(p => ({ ...EMPTY_PART, ...p })) : EMPTY_Q.parts,
    calc: { ...EMPTY_CALC, ...((f.calc ?? {}) as Partial<CalcForm>), places: String((f.calc as Record<string, unknown> | undefined)?.places ?? ""), toleranceAmount: String((f.calc as Record<string, unknown> | undefined)?.toleranceAmount ?? "") },
    findings: Array.isArray(f.findings) ? (f.findings as QForm["findings"]) : [], safetyCriticalPoints: Array.isArray(f.safetyCriticalPoints) ? (f.safetyCriticalPoints as number[]) : [],
    rubric: { level: String(r.level ?? ""), objective: String(r.objective ?? ""), keyPoints: String(r.keyPoints ?? ""), misconceptions: String(r.misconceptions ?? "") },
    source: sourceFormOf(f.source),
    programmeCode: String(f.programmeCode ?? ""), programmeLabel: String(f.programmeLabel ?? ""), qualificationLevel: String(f.qualificationLevel ?? ""), qualificationLabel: String(f.qualificationLabel ?? ""),
    difficulty: String(f.difficulty ?? ""), carried: f.carried && typeof f.carried === "object" ? (f.carried as Record<string, unknown>) : {},
  };
}
const EMPTY_SOURCE: SourceForm = { includes: false, kind: "governed_reference", reference: "", licence: "", permissionNote: "" };
function sourceFormOf(raw: unknown): SourceForm {
  const s = normaliseSource(raw);
  return !s || s.kind === "own_writing" ? EMPTY_SOURCE : { includes: true, kind: s.kind, reference: s.reference ?? "", licence: s.licence ?? "", permissionNote: s.permissionNote ?? "" };
}

function toFields(kind: Kind, f: Fields) {
  if (kind === "osce_station") return stationFieldsFromForm(f.station ?? stationFormOf(null));
  if (kind === "revision_question") {
    const q = f.q ?? EMPTY_Q, src = q.source;
    const rubric = q.rubric.level || q.rubric.objective || q.rubric.keyPoints || q.rubric.misconceptions ? q.rubric : undefined;
    return { ...q, rubric, source: src.includes ? { kind: src.kind, reference: src.reference, licence: src.licence, permissionNote: src.permissionNote } : { kind: "own_writing" },
    };
  }
  return { body: f.body ?? "", ...(kind === "targeted_resource" ? { links: (f.links ?? "").split(/\s+/).filter(Boolean) } : {}) };
}

/** The kind-specific fields. A revision question is any of the library formats (QuestionFields). */
function KindFields({ kind, f, set, programmes = [] }: { kind: Kind; f: Fields; set: (f: Fields) => void; programmes?: ProgrammeChoice[] }) {
  if (kind === "osce_station") return <OsceStationFields value={f.station ?? stationFormOf(null)} set={station => set({ ...f, station })} />;
  if (kind === "revision_question") return <QuestionFields q={f.q ?? EMPTY_Q} set={q => set({ ...f, q })} programmes={programmes} />;
  return (
    <div className="grid gap-2">
      <label className="text-[12.5px]">Text<textarea rows={5} value={f.body ?? ""} onChange={e => set({ ...f, body: e.target.value })} className={`${input} w-full`} /></label>
      {kind === "targeted_resource" && <label className="text-[12.5px]">Links (https, separated by spaces)<input value={f.links ?? ""} onChange={e => set({ ...f, links: e.target.value })} className={`${input} w-full`} /></label>}
    </div>
  );
}

/** A revision question in any format: the question, the fields of its format, its rubric, its marking rule, its source. */
function QuestionFields({ q, set, programmes }: { q: QForm; set: (q: QForm) => void; programmes: ProgrammeChoice[] }) {
  const fmt = FORMATS.find(x => x.value === q.format) ?? FORMATS[0];
  const lbl = "text-[12.5px]";
  const link = "font-semibold text-teal-800 underline";
  const ta = (label: string, value: string, on: (v: string) => void, rows = 2, hint?: string) => (
    <label className={lbl}>{label}{hint && <span className="block text-[11.5px] text-gray-600">{hint}</span>}<textarea rows={rows} value={value} onChange={e => on(e.target.value)} className={`${input} w-full`} /></label>
  );
  const optionRows = (n: [number, number], multi: boolean) => (
    <fieldset className="grid gap-1"><legend className={`${lbl} font-semibold`}>{multi ? "Options (tick every correct one)" : "Options (choose the correct one)"}</legend>
      {q.options.map((o, i) => (
        <label key={i} className="flex items-center gap-2 text-[12.5px]">
          {multi ? <input type="checkbox" checked={q.correct.includes(i)} onChange={e => set({ ...q, correct: e.target.checked ? [...q.correct, i] : q.correct.filter(x => x !== i) })} aria-label={`Option ${i + 1} is correct`} />
            : <input type="radio" name="correct" checked={q.correctIndex === i} onChange={() => set({ ...q, correctIndex: i })} aria-label={`Option ${i + 1} is correct`} />}
          <input value={o} onChange={e => { const x = [...q.options]; x[i] = e.target.value; set({ ...q, options: x }); }} placeholder={`Option ${i + 1}`} className={`${input} w-full`} />
        </label>
      ))}
      {multi && <div className="flex gap-2 text-[12.5px]">
        {q.options.length < n[1] && <button type="button" className={link} onClick={() => set({ ...q, options: [...q.options, ""] })}>Add option</button>}
        {q.options.length > n[0] && <button type="button" className={link} onClick={() => set({ ...q, options: q.options.slice(0, -1), correct: q.correct.filter(x => x < q.options.length - 1) })}>Remove last option</button>}
      </div>}
    </fieldset>
  );
  const setPair = (i: number, p: QForm["pairs"][number]) => { const x = [...q.pairs]; x[i] = p; set({ ...q, pairs: x }); };
  const setPart = (i: number, p: QForm["parts"][number]) => { const x = [...q.parts]; x[i] = p; set({ ...q, parts: x }); };
  return (
    <div className="grid gap-2">
      <label className={lbl}>Format<select value={q.format} onChange={e => {
        const v = e.target.value;
        const four = [...q.options, "", "", "", ""].slice(0, 4);
        set({ ...q, format: v, marking: "", options: v === "mcq" ? four : v === "mrq" ? (q.options.length >= 4 ? q.options : four) : q.options });
      }} className={`${input} w-full`}>{FORMATS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
      {ta(q.format === "true_false" ? "Statement" : q.format === "flashcard" ? "Front of the card" : q.format === "structured" ? "Lead-in" : "Question", q.stem, v => set({ ...q, stem: v }), 2,
        q.format === "cloze" ? "Mark the one blank as _____ (five underscores)." : undefined)}
      {q.format === "mcq" && optionRows([4, 4], false)}
      {q.format === "mrq" && optionRows([4, 6], true)}
      {(q.format === "short" || q.format === "cloze") && ta("Accepted answers, one per line", q.accepted, v => set({ ...q, accepted: v }), 3)}
      {q.format === "short" && <Safety critical={q.safetyCritical} unsafe={q.unsafe} set={(c, u) => set({ ...q, safetyCritical: c, unsafe: u })} />}
      {q.format === "true_false" && (
        <fieldset className="flex gap-4 text-[12.5px]"><legend className="font-semibold">The statement is</legend>
          <label className="flex items-center gap-1"><input type="radio" name="truth" checked={q.truth === "true"} onChange={() => set({ ...q, truth: "true" })} /> True</label>
          <label className="flex items-center gap-1"><input type="radio" name="truth" checked={q.truth === "false"} onChange={() => set({ ...q, truth: "false" })} /> False</label>
        </fieldset>
      )}
      {q.format === "extended" && <>
        {ta("Model answer", q.modelAnswer, v => set({ ...q, modelAnswer: v }), 3)}
        {ta("Key points it is marked against, one per line (3 to 8)", q.keyPoints, v => set({ ...q, keyPoints: v }), 4)}
        <label className={lbl}>Practice marks (1 to 10)<input type="number" min={1} max={10} value={q.marks} onChange={e => set({ ...q, marks: e.target.value })} className={`${input} w-24`} /></label>
        {q.keyPoints.split(/\r?\n/).filter(x => x.trim()).length > 0 && (
          <fieldset className="grid gap-1 rounded-lg border border-red-200 p-2 text-[12.5px]"><legend className="px-1 font-semibold text-red-900">Safety-critical key points (a miss is flagged and named in the feedback, and scores nothing when HQ turns clinical scoring caps on)</legend>
            {q.keyPoints.split(/\r?\n/).filter(x => x.trim()).map((kp, i) => (
              <label key={i} className="flex items-center gap-2"><input type="checkbox" checked={q.safetyCriticalPoints.includes(i)} onChange={e => set({ ...q, safetyCriticalPoints: e.target.checked ? [...q.safetyCriticalPoints, i] : q.safetyCriticalPoints.filter(x => x !== i) })} />{kp}</label>
            ))}
          </fieldset>
        )}
        <Safety critical={false} unsafe={q.unsafe} hideCritical set={(_c, u) => set({ ...q, unsafe: u })} />
      </>}
      {q.format === "flashcard" && ta("Back of the card", q.back, v => set({ ...q, back: v }), 2)}
      {q.format === "match" && (
        <fieldset className="grid gap-1"><legend className={`${lbl} font-semibold`}>Pairs (3 to 6): each prompt and its match</legend>
          {q.pairs.map((p, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-2">
              <input aria-label={`Prompt ${i + 1}`} placeholder={`Prompt ${i + 1}`} value={p.prompt} onChange={e => setPair(i, { ...p, prompt: e.target.value })} className={input} />
              <input aria-label={`Match ${i + 1}`} placeholder={`Match ${i + 1}`} value={p.match} onChange={e => setPair(i, { ...p, match: e.target.value })} className={input} />
            </div>
          ))}
          <div className="flex gap-2 text-[12.5px]">
            {q.pairs.length < 6 && <button type="button" className={link} onClick={() => set({ ...q, pairs: [...q.pairs, { prompt: "", match: "" }] })}>Add pair</button>}
            {q.pairs.length > 3 && <button type="button" className={link} onClick={() => set({ ...q, pairs: q.pairs.slice(0, -1) })}>Remove last pair</button>}
          </div>
        </fieldset>
      )}
      {q.format === "sequence" && ta("Steps IN THE CORRECT ORDER, one per line (3 to 6). Learners see them shuffled.", q.steps, v => set({ ...q, steps: v }), 4)}
      {q.format === "structured" && (
        <div className="grid gap-2 md:grid-cols-2">
          <label className={lbl}>Kind of structured question<select value={q.variant} onChange={e => set({ ...q, variant: e.target.value })} className={`${input} w-full`}>
            <option value="">Plain parts</option>{(Object.keys(VARIANT_LABEL) as (keyof typeof VARIANT_LABEL)[]).map(v => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}</select></label>
        </div>
      )}
      {q.format === "structured" && (q.variant === "interpretation" || q.findings.length > 0) && (
        <fieldset className="grid gap-1 rounded-lg border border-gray-200 p-2 text-[12.5px]"><legend className="px-1 font-semibold">Findings shown first (1 to 12): label, value, unit</legend>
          {q.findings.map((r, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              {(["label", "value", "unit"] as const).map(k => <input key={k} aria-label={`Finding ${i + 1} ${k}`} placeholder={k} value={r[k]} onChange={e => { const x = [...q.findings]; x[i] = { ...r, [k]: e.target.value }; set({ ...q, findings: x }); }} className={input} />)}
            </div>
          ))}
          <div className="flex gap-2">
            {q.findings.length < 12 && <button type="button" className={link} onClick={() => set({ ...q, findings: [...q.findings, { label: "", value: "", unit: "" }] })}>Add finding</button>}
            {q.findings.length > 0 && <button type="button" className={link} onClick={() => set({ ...q, findings: q.findings.slice(0, -1) })}>Remove last finding</button>}
          </div>
        </fieldset>
      )}
      {q.format === "structured" && (
        <fieldset className="grid gap-2"><legend className={`${lbl} font-semibold`}>Parts (2 to 4)</legend>
          {q.parts.map((p, i) => (
            <div key={i} className="grid gap-1 rounded-lg border border-gray-200 p-2">
              <span className="text-[12px] font-semibold">Part {String.fromCharCode(97 + i)}</span>
              <input aria-label={`Part ${i + 1} question`} placeholder="Question" value={p.prompt} onChange={e => setPart(i, { ...p, prompt: e.target.value })} className={input} />
              <label className="text-[12px]">Marks (1 to 5)<input type="number" min={1} max={5} value={p.marks} onChange={e => setPart(i, { ...p, marks: Number(e.target.value) })} className={`${input} ml-2 w-20`} /></label>
              <textarea aria-label={`Part ${i + 1} accepted answers`} placeholder="Accepted answers, one per line (1 to 4)" rows={2} value={p.accepted} onChange={e => setPart(i, { ...p, accepted: e.target.value })} className={input} />
              <PartExtras p={p} set={x => setPart(i, x)} n={i} />
            </div>
          ))}
          <div className="flex gap-2 text-[12.5px]">
            {q.parts.length < 4 && <button type="button" className={link} onClick={() => set({ ...q, parts: [...q.parts, EMPTY_PART] })}>Add part</button>}
            {q.parts.length > 2 && <button type="button" className={link} onClick={() => set({ ...q, parts: q.parts.slice(0, -1) })}>Remove last part</button>}
          </div>
        </fieldset>
      )}
      {q.format === "calculation" && <CalcFields c={q.calc} set={calc => set({ ...q, calc })} />}
      {ta("Explanation learners see after answering", q.rationale, v => set({ ...q, rationale: v }), 2)}
      <fieldset className="grid gap-2 rounded-lg border border-gray-200 p-2 text-[12.5px]">
        <legend className="px-1 font-semibold text-gray-700">Rubric{q.format === "extended" ? " (its key points are above)" : " (optional)"}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          <label>Cognitive level<select value={q.rubric.level} onChange={e => set({ ...q, rubric: { ...q.rubric, level: e.target.value } })} className={`${input} w-full`}>
            <option value="">{q.format === "extended" ? "Understanding (default)" : "No rubric"}</option><option value="recall">Recall</option><option value="understanding">Understanding</option><option value="application">Application</option><option value="reasoning">Clinical reasoning</option></select></label>
          <label>Learning objective<input value={q.rubric.objective} onChange={e => set({ ...q, rubric: { ...q.rubric, objective: e.target.value } })} className={`${input} w-full`} /></label>
        </div>
        {q.format !== "extended" && <label>Key points, one per line<textarea rows={2} value={q.rubric.keyPoints} onChange={e => set({ ...q, rubric: { ...q.rubric, keyPoints: e.target.value } })} className={`${input} w-full`} /></label>}
        <label>Common misconceptions, one per line (up to 3)<textarea rows={2} value={q.rubric.misconceptions} onChange={e => set({ ...q, rubric: { ...q.rubric, misconceptions: e.target.value } })} className={`${input} w-full`} /></label>
      </fieldset>
      <label className={lbl}>Marking rule<select value={q.marking || fmt.marking[0]} onChange={e => set({ ...q, marking: e.target.value })} className={`${input} w-full`} disabled={fmt.marking.length === 1}>
        {fmt.marking.map(m => <option key={m} value={m}>{MARKING[m]}</option>)}</select></label>
      <MetaFields q={q} set={set} programmes={programmes} />
      <SourceFields value={q.source} set={source => set({ ...q, source })} />
    </div>
  );
}

// ── SQIE-CLOSE-2026-11 (997): the WS-B, WS-C and WS-A fields, exactly as scoring-rules.ts reads them ──

/** WS-B: a key or part is safety-critical, and the answers that would be unsafe to act on (matched by code, exactly). */
function Safety({ critical, unsafe, set, hideCritical }: { critical: boolean; unsafe: string; set: (critical: boolean, unsafe: string) => void; hideCritical?: boolean }) {
  return (
    <fieldset className="grid gap-1 rounded-lg border border-red-200 p-2 text-[12.5px]"><legend className="px-1 font-semibold text-red-900">Clinical safety</legend>
      {!hideCritical && <label className="flex items-center gap-2"><input type="checkbox" checked={critical} onChange={e => set(e.target.checked, unsafe)} /> Safety-critical: a miss is flagged and named in the feedback, and scores nothing when HQ turns clinical scoring caps on</label>}
      <label>Unsafe answers, one per line (up to 6): an answer that says one of these is flagged and told why, and earns at most half the marks when HQ turns clinical scoring caps on<textarea rows={2} value={unsafe} onChange={e => set(critical, e.target.value)} className={`${input} w-full`} /></label>
    </fieldset>
  );
}

/** WS-C: a part's role, a choice part (answer and justify), weighted criteria for a justification or interpretation, safety. */
function PartExtras({ p, set, n }: { p: PartForm; set: (p: PartForm) => void; n: number }) {
  const opts = p.options.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return (
    <details className="text-[12px]"><summary className="cursor-pointer font-semibold text-teal-800">Role, choice, criteria and safety</summary>
      <div className="mt-1 grid gap-1">
        <label>Role<select value={p.role} onChange={e => set({ ...p, role: e.target.value })} className={`${input} ml-2`}><option value="">Answer (default)</option>{(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        <label>Choice options, one per line (2 to 6; leave empty for a written part)<textarea aria-label={`Part ${n + 1} options`} rows={2} value={p.options} onChange={e => set({ ...p, options: e.target.value })} className={`${input} w-full`} /></label>
        {opts.length >= 2 && <label>The correct option<select value={p.correct === "" ? "" : String(p.correct)} onChange={e => set({ ...p, correct: e.target.value === "" ? "" : Number(e.target.value) })} className={`${input} ml-2`}><option value="">Choose</option>{opts.map((o, i) => <option key={i} value={i}>{o}</option>)}</select></label>}
        <fieldset className="grid gap-1"><legend className="font-semibold">Criteria it is marked against (up to {CRITERIA_MAX}, weight 1 to 5)</legend>
          {p.criteria.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label={`Part ${n + 1} criterion ${i + 1}`} value={c.text} onChange={e => { const x = [...p.criteria]; x[i] = { ...c, text: e.target.value }; set({ ...p, criteria: x }); }} className={`${input} min-w-[14rem] flex-1`} />
              <input aria-label={`Part ${n + 1} criterion ${i + 1} weight`} type="number" min={1} max={5} value={c.weight} onChange={e => { const x = [...p.criteria]; x[i] = { ...c, weight: Number(e.target.value) }; set({ ...p, criteria: x }); }} className={`${input} w-16`} />
              <label className="flex items-center gap-1"><input type="checkbox" checked={c.safetyCritical} onChange={e => { const x = [...p.criteria]; x[i] = { ...c, safetyCritical: e.target.checked }; set({ ...p, criteria: x }); }} /> safety-critical</label>
            </div>
          ))}
          <div className="flex gap-2">
            {p.criteria.length < CRITERIA_MAX && <button type="button" className="font-semibold text-teal-800 underline" onClick={() => set({ ...p, criteria: [...p.criteria, { text: "", weight: 1, safetyCritical: false }] })}>Add criterion</button>}
            {p.criteria.length > 0 && <button type="button" className="font-semibold text-teal-800 underline" onClick={() => set({ ...p, criteria: p.criteria.slice(0, -1) })}>Remove last criterion</button>}
          </div>
        </fieldset>
        <Safety critical={p.safetyCritical} unsafe={p.unsafe} set={(c, u) => set({ ...p, safetyCritical: c, unsafe: u })} />
      </div>
    </details>
  );
}

/** WS-A: the calculation key -- value, unit, equivalent units, rounding, tolerance (inactive until policy), safety, working. */
function CalcFields({ c, set }: { c: CalcForm; set: (c: CalcForm) => void }) {
  const value = c.value.trim() === "" ? NaN : Number(c.value);
  const key = {
    format: "calculation", value, unit: c.unit.trim(), accepted: Number.isFinite(value) ? calculationAccepted(value, c.unit) : [],
    ...(c.equivalentUnits.trim() ? { equivalentUnits: c.equivalentUnits.split(/[,\n]/).map(x => x.trim()).filter(Boolean) } : {}),
    ...(c.roundingMode && c.places !== "" ? { rounding: { mode: c.roundingMode, places: Number(c.places) } } : {}),
    ...(c.toleranceKind && c.toleranceAmount !== "" ? { tolerance: { kind: c.toleranceKind, amount: Number(c.toleranceAmount) } } : {}),
    safetyCritical: c.safetyCritical,
  };
  const problems = c.value.trim() || c.unit.trim() ? calculationProblems(key) : [];
  return (
    <fieldset className="grid gap-2 rounded-lg border border-gray-200 p-2 text-[12.5px]"><legend className="px-1 font-semibold">The answer, marked by code</legend>
      <div className="grid gap-2 md:grid-cols-3">
        <label>Value (already rounded)<input inputMode="decimal" value={c.value} onChange={e => set({ ...c, value: e.target.value })} className={`${input} w-full`} /></label>
        <label>Unit (empty for none)<input value={c.unit} onChange={e => set({ ...c, unit: e.target.value })} placeholder="mL, mg, mL/h" className={`${input} w-full`} /></label>
        <label>Equivalent units accepted (comma separated)<input value={c.equivalentUnits} onChange={e => set({ ...c, equivalentUnits: e.target.value })} placeholder="L" className={`${input} w-full`} /></label>
        <label>Rounding<select value={c.roundingMode} onChange={e => set({ ...c, roundingMode: e.target.value })} className={`${input} w-full`}><option value="">Exact, as written</option><option value="decimal_places">Decimal places</option><option value="significant_figures">Significant figures</option></select></label>
        {c.roundingMode && <label>Places (0 to {ROUNDING_PLACES_MAX})<input type="number" min={0} max={ROUNDING_PLACES_MAX} value={c.places} onChange={e => set({ ...c, places: e.target.value })} className={`${input} w-full`} /></label>}
        <label>Tolerance<select value={c.toleranceKind} onChange={e => set({ ...c, toleranceKind: e.target.value })} className={`${input} w-full`}><option value="">None (exact)</option><option value="absolute">Absolute</option><option value="percent">Percent (up to {TOLERANCE_PERCENT_MAX}%)</option></select></label>
        {c.toleranceKind && <label>Tolerance amount<input inputMode="decimal" value={c.toleranceAmount} onChange={e => set({ ...c, toleranceAmount: e.target.value })} className={`${input} w-full`} /></label>}
      </div>
      {c.toleranceKind && <p role="note" className="text-amber-950">A tolerance is recorded but NOT used until the clinical calculation policy is approved and HQ turns on &quot;Calculation tolerances&quot;. Until then the answer must be exact.</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={c.safetyCritical} onChange={e => set({ ...c, safetyCritical: e.target.checked })} /> Safety-critical (default): a tenfold or greater error is unsafe, whatever any tolerance says</label>
      <label>Worked answer shown after answering (optional)<textarea rows={2} value={c.working} onChange={e => set({ ...c, working: e.target.value })} className={`${input} w-full`} /></label>
      {problems.length > 0 && <ul role="alert" className="ml-4 list-disc text-[var(--cmp-text-critical)]">{problems.map(x => <li key={x}>{x}</li>)}</ul>}
      {!problems.length && Number.isFinite(value) && <p className="text-gray-700">Learners answer with a number and a unit. Key: <strong>{key.accepted[0]}</strong></p>}
    </fieldset>
  );
}

/** SQIE-CLOSE-2026-11 WS-E: programme, qualification level and difficulty (all optional), and the provenance kept with it. */
function MetaFields({ q, set, programmes }: { q: QForm; set: (q: QForm) => void; programmes: ProgrammeChoice[] }) {
  const known = programmes.some(p => p.code === q.programmeCode);
  const levelKnown = (QUALIFICATION_LEVELS as readonly string[]).includes(q.qualificationLevel);
  const map = mappingStatus(q.carried, "draft");
  const refs = Array.isArray(q.carried.references) ? q.carried.references.length : 0;
  const sv = q.carried.source_verification as { label?: string; status?: string } | undefined;
  return (
    <fieldset className="grid gap-2 rounded-lg border border-gray-200 p-2 text-[12.5px]">
      <legend className="px-1 font-semibold text-gray-700">Who it is for (optional)</legend>
      <p className="text-gray-600">Left empty, the question suits every learner whose competency links match. A learner whose programme or qualification level is known and differs is not given it.</p>
      <div className="grid gap-2 md:grid-cols-3">
        <label>Programme<select value={q.programmeCode} onChange={e => set({ ...q, programmeCode: e.target.value, programmeLabel: programmes.find(p => p.code === e.target.value)?.label ?? "" })} className={`${input} w-full`}>
          <option value="">Every programme</option>{programmes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
          {q.programmeCode && !known && <option value={q.programmeCode}>{q.programmeCode} (not an active programme)</option>}</select></label>
        <label>Qualification level<select value={q.qualificationLevel} onChange={e => set({ ...q, qualificationLevel: e.target.value, qualificationLabel: (QUALIFICATION_LABEL as Record<string, string>)[e.target.value] ?? q.qualificationLabel })} className={`${input} w-full`}>
          <option value="">Any level</option>{QUALIFICATION_LEVELS.map(l => <option key={l} value={l}>{QUALIFICATION_LABEL[l]}</option>)}
          {q.qualificationLevel && !levelKnown && <option value={q.qualificationLevel}>{q.qualificationLabel || q.qualificationLevel}</option>}</select></label>
        <label>Difficulty<select value={q.difficulty} onChange={e => set({ ...q, difficulty: e.target.value })} className={`${input} w-full`}>
          <option value="">Not set (counts as standard)</option>{LIBRARY_DIFFICULTIES.map(d => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}</select></label>
      </div>
      {(map.status !== "none" || refs > 0 || sv) && (
        <div className="rounded border border-gray-200 bg-gray-50 p-2 text-gray-700">
          <p className="font-semibold">Provenance kept with this draft (not edited here)</p>
          {map.status !== "none" && <p>Competency mapping: {[map.framework, map.version ? `v${map.version}` : null, map.competency].filter(Boolean).join(" · ")}{map.objective ? ` · objective: ${map.objective}` : ""} <strong className="text-amber-950">Draft mapping, not validated evidence</strong></p>}
          {refs > 0 && <p>{refs} reference{refs === 1 ? "" : "s"} recorded</p>}
          {sv && <p>Source verification: {sv.label ?? sv.status ?? "recorded"}</p>}
        </div>
      )}
    </fieldset>
  );
}

/** Source rights (SQIE-COMPLETE-01). Off means own writing. On, the source is named and a reusable licence or permission is recorded. */
function SourceFields({ value, set }: { value: SourceForm; set: (s: SourceForm) => void }) {
  return (
    <fieldset className="grid gap-2 rounded-lg border border-gray-200 p-2 text-[12.5px]">
      <legend className="px-1 font-semibold text-gray-700">Source and rights</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.includes} onChange={e => set({ ...value, includes: e.target.checked })} /> Includes material from a source (otherwise this is my own writing)</label>
      {value.includes && (
        <div className="grid gap-2 md:grid-cols-2">
          <label>Kind of source<select value={value.kind} onChange={e => set({ ...value, kind: e.target.value as SourceKind })} className={`${input} w-full`}>
            {SOURCE_KINDS.filter(k => k !== "own_writing").map(k => <option key={k} value={k}>{SOURCE_KIND_LABEL[k]}</option>)}</select></label>
          <label>Citation or link<input value={value.reference} onChange={e => set({ ...value, reference: e.target.value })} className={`${input} w-full`} /></label>
          {value.kind === "open_licence" && <label>Licence (CC0, CC BY, CC BY-SA, public domain, OGL)<input value={value.licence} onChange={e => set({ ...value, licence: e.target.value })} className={`${input} w-full`} /></label>}
          {value.kind === "permission" && <label>Permission: who gave it, and when<input value={value.permissionNote} onChange={e => set({ ...value, permissionNote: e.target.value })} className={`${input} w-full`} /></label>}
        </div>
      )}
    </fieldset>
  );
}

export function NewResource({ needId, programmes = [] }: { needId?: string; programmes?: ProgrammeChoice[] }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [kind, setKind] = useState<Kind>("explanation");
  const [code, setCode] = useState(""); const [title, setTitle] = useState(""); const [f, setF] = useState<Fields>({});
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Kind" value={kind} onChange={e => setKind(e.target.value as Kind)} className={input}><option value="explanation">Explanation</option><option value="revision_question">Revision question</option><option value="targeted_resource">Targeted resource</option><option value="osce_station">OSCE practice station</option></select>
        <input aria-label="Code" placeholder="code, e.g. fluid-balance-1" value={code} onChange={e => setCode(e.target.value)} className={input} />
        <input aria-label="Title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} className={`${input} min-w-[16rem]`} />
      </div>
      <KindFields kind={kind} f={f} set={setF} programmes={programmes} />
      <div className="flex items-center gap-2"><button type="button" disabled={busy || (kind === "osce_station" && !checkStationForm(f.station ?? stationFormOf(null)).ok)} className={primary} onClick={() => send({ action: "resource_create", kind, code, title, needId, fields: toFields(kind, f) }, "Draft created. Review it, name its competencies, then submit it for clinical review.")}>Create draft</button><Msg msg={msg} /></div>
    </div>
  );
}

export function EditDraft({ versionId, kind, initial, questionFields, programmes = [] }: { versionId: string; kind: Kind; initial: Record<string, unknown>; /** revision_question: the server's fieldsFromQuestionContent of `initial`. */ questionFields?: Record<string, unknown>; programmes?: ProgrammeChoice[] }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [f, setF] = useState<Fields>(kind === "osce_station" ? { station: stationFormOf(initial) } : kind === "revision_question"
    ? { q: qFormOf(questionFields) }
    : { body: String(initial.body ?? ""), links: Array.isArray(initial.links) ? initial.links.join(" ") : "" });
  return (
    <div className="space-y-2">
      <KindFields kind={kind} f={f} set={setF} programmes={programmes} />
      <div className="flex items-center gap-2"><button type="button" disabled={busy || (kind === "osce_station" && !checkStationForm(f.station ?? stationFormOf(null)).ok)} className={primary} onClick={() => send({ action: "draft_save", versionId, fields: toFields(kind, f) }, "Saved. Saving clears any earlier educator review.")}>Save draft</button><Msg msg={msg} /></div>
    </div>
  );
}

export type DuplicateHit = { code: string; title: string; band: "likely_duplicate" | "similar"; score: number; href: string };

/**
 * Submit for clinical review, with the possible duplicates shown first (SQIE-COMPLETE-01). Submission is never blocked by
 * a match, but a LIKELY duplicate needs the educator to confirm they checked it. The server asks again (educator.ts submitDraft).
 */
export function SubmitDraft({ versionId, duplicates }: { versionId: string; duplicates: DuplicateHit[] }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [checked, setChecked] = useState(false);
  const likely = duplicates.some(d => d.band === "likely_duplicate");
  return (
    <div className="space-y-1">
      {duplicates.length > 0 && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[12.5px] text-amber-950">
          <p className="font-semibold">Possible duplicates</p>
          <ul className="ml-4 list-disc">{duplicates.map(d => <li key={d.code}><Link className="underline" href={d.href}>{d.title}</Link> <code>{d.code}</code> · {d.band === "likely_duplicate" ? "likely duplicate" : "similar"} ({Math.round(d.score * 100)}%)</li>)}</ul>
          {likely && <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I checked these are not duplicates</label>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || (likely && !checked)} className={primary}
          onClick={() => send({ action: "submit", versionId, duplicatesChecked: likely && checked }, "Submitted.")}>Submit for clinical review</button><Msg msg={msg} />
      </div>
    </div>
  );
}
