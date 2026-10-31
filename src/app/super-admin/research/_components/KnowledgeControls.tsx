"use client";

import { useState } from "react";
import { input, primary } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";
import { Msg, useResearchSend } from "./ResearchControls";
import Link from "next/link";
import { SOURCE_KIND_LABEL, SOURCE_KINDS, normaliseSource, type SourceKind } from "@/lib/knowledge/question-source";
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
// The labels below are this form's own (a client bundle does not import the Scholar module).
const FORMATS: { value: string; label: string; marking: string[] }[] = [
  { value: "mcq", label: "Single best answer", marking: ["deterministic"] }, { value: "mrq", label: "Multiple response", marking: ["deterministic"] },
  { value: "short", label: "Short answer", marking: ["deterministic", "self"] }, { value: "cloze", label: "Fill the blank", marking: ["deterministic"] },
  { value: "true_false", label: "True or false", marking: ["deterministic"] }, { value: "extended", label: "Extended response", marking: ["rubric_ai_formative", "self"] },
  { value: "flashcard", label: "Flashcard", marking: ["self"] }, { value: "match", label: "Matching", marking: ["deterministic"] },
  { value: "sequence", label: "Sequence", marking: ["deterministic"] }, { value: "structured", label: "Structured (parts)", marking: ["deterministic", "self"] },
];
const MARKING: Record<string, string> = {
  deterministic: "Marked by code against the key (the learner judges an answer code cannot)", self: "The learner marks it against the key",
  rubric_ai_formative: "Formative AI feedback against the key points, then the learner's own judgement",
};
type QForm = {
  format: string; stem: string; options: string[]; correctIndex: number; correct: number[]; accepted: string; truth: string; modelAnswer: string; marks: string;
  keyPoints: string; back: string; pairs: { prompt: string; match: string }[]; steps: string; parts: { prompt: string; marks: number; accepted: string }[];
  rubric: { level: string; objective: string; keyPoints: string; misconceptions: string }; marking: string; rationale: string; source: SourceForm;
};
const EMPTY_Q: QForm = {
  format: "mcq", stem: "", options: ["", "", "", ""], correctIndex: 0, correct: [], accepted: "", truth: "", modelAnswer: "", marks: "", keyPoints: "", back: "",
  pairs: [{ prompt: "", match: "" }, { prompt: "", match: "" }, { prompt: "", match: "" }], steps: "", parts: [{ prompt: "", marks: 1, accepted: "" }, { prompt: "", marks: 1, accepted: "" }],
  rubric: { level: "", objective: "", keyPoints: "", misconceptions: "" }, marking: "", rationale: "", source: { includes: false, kind: "governed_reference", reference: "", licence: "", permissionNote: "" },
};
/** The form state of stored fields (the server's fieldsFromQuestionContent), over the empty form. */
function qFormOf(f: Record<string, unknown> | undefined): QForm {
  if (!f) return EMPTY_Q;
  const r = (f.rubric ?? {}) as Record<string, unknown>;
  return {
    ...EMPTY_Q, ...(f as Partial<QForm>), marks: f.marks === undefined || f.marks === null ? "" : String(f.marks), truth: String(f.truth ?? ""),
    options: Array.isArray(f.options) && f.options.length ? (f.options as string[]) : EMPTY_Q.options,
    correct: Array.isArray(f.correct) ? (f.correct as number[]) : [], pairs: Array.isArray(f.pairs) && f.pairs.length ? (f.pairs as QForm["pairs"]) : EMPTY_Q.pairs,
    parts: Array.isArray(f.parts) && f.parts.length ? (f.parts as QForm["parts"]) : EMPTY_Q.parts,
    rubric: { level: String(r.level ?? ""), objective: String(r.objective ?? ""), keyPoints: String(r.keyPoints ?? ""), misconceptions: String(r.misconceptions ?? "") },
    source: sourceFormOf(f.source),
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
    return { ...q, rubric, source: src.includes ? { kind: src.kind, reference: src.reference, licence: src.licence, permissionNote: src.permissionNote } : { kind: "own_writing" } };
  }
  return { body: f.body ?? "", ...(kind === "targeted_resource" ? { links: (f.links ?? "").split(/\s+/).filter(Boolean) } : {}) };
}

/** The kind-specific fields. A revision question is any of the library formats (QuestionFields). */
function KindFields({ kind, f, set }: { kind: Kind; f: Fields; set: (f: Fields) => void }) {
  if (kind === "osce_station") return <OsceStationFields value={f.station ?? stationFormOf(null)} set={station => set({ ...f, station })} />;
  if (kind === "revision_question") return <QuestionFields q={f.q ?? EMPTY_Q} set={q => set({ ...f, q })} />;
  return (
    <div className="grid gap-2">
      <label className="text-[12.5px]">Text<textarea rows={5} value={f.body ?? ""} onChange={e => set({ ...f, body: e.target.value })} className={`${input} w-full`} /></label>
      {kind === "targeted_resource" && <label className="text-[12.5px]">Links (https, separated by spaces)<input value={f.links ?? ""} onChange={e => set({ ...f, links: e.target.value })} className={`${input} w-full`} /></label>}
    </div>
  );
}

/** A revision question in any format: the question, the fields of its format, its rubric, its marking rule, its source. */
function QuestionFields({ q, set }: { q: QForm; set: (q: QForm) => void }) {
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
        <fieldset className="grid gap-2"><legend className={`${lbl} font-semibold`}>Parts (2 to 4)</legend>
          {q.parts.map((p, i) => (
            <div key={i} className="grid gap-1 rounded-lg border border-gray-200 p-2">
              <span className="text-[12px] font-semibold">Part {String.fromCharCode(97 + i)}</span>
              <input aria-label={`Part ${i + 1} question`} placeholder="Question" value={p.prompt} onChange={e => setPart(i, { ...p, prompt: e.target.value })} className={input} />
              <label className="text-[12px]">Marks (1 to 5)<input type="number" min={1} max={5} value={p.marks} onChange={e => setPart(i, { ...p, marks: Number(e.target.value) })} className={`${input} ml-2 w-20`} /></label>
              <textarea aria-label={`Part ${i + 1} accepted answers`} placeholder="Accepted answers, one per line (1 to 4)" rows={2} value={p.accepted} onChange={e => setPart(i, { ...p, accepted: e.target.value })} className={input} />
            </div>
          ))}
          <div className="flex gap-2 text-[12.5px]">
            {q.parts.length < 4 && <button type="button" className={link} onClick={() => set({ ...q, parts: [...q.parts, { prompt: "", marks: 1, accepted: "" }] })}>Add part</button>}
            {q.parts.length > 2 && <button type="button" className={link} onClick={() => set({ ...q, parts: q.parts.slice(0, -1) })}>Remove last part</button>}
          </div>
        </fieldset>
      )}
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
      <SourceFields value={q.source} set={source => set({ ...q, source })} />
    </div>
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

export function NewResource({ needId }: { needId?: string }) {
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
      <KindFields kind={kind} f={f} set={setF} />
      <div className="flex items-center gap-2"><button type="button" disabled={busy || (kind === "osce_station" && !checkStationForm(f.station ?? stationFormOf(null)).ok)} className={primary} onClick={() => send({ action: "resource_create", kind, code, title, needId, fields: toFields(kind, f) }, "Draft created. Review it, name its competencies, then submit it for clinical review.")}>Create draft</button><Msg msg={msg} /></div>
    </div>
  );
}

export function EditDraft({ versionId, kind, initial, questionFields }: { versionId: string; kind: Kind; initial: Record<string, unknown>; /** revision_question: the server's fieldsFromQuestionContent of `initial`. */ questionFields?: Record<string, unknown> }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [f, setF] = useState<Fields>(kind === "osce_station" ? { station: stationFormOf(initial) } : kind === "revision_question"
    ? { q: qFormOf(questionFields) }
    : { body: String(initial.body ?? ""), links: Array.isArray(initial.links) ? initial.links.join(" ") : "" });
  return (
    <div className="space-y-2">
      <KindFields kind={kind} f={f} set={setF} />
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
