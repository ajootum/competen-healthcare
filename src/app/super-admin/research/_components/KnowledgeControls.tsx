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
type Fields = { body?: string; links?: string; stem?: string; options?: string[]; correctIndex?: number; rationale?: string; station?: StationForm; source?: SourceForm };
const EMPTY_SOURCE: SourceForm = { includes: false, kind: "governed_reference", reference: "", licence: "", permissionNote: "" };
function sourceFormOf(raw: unknown): SourceForm {
  const s = normaliseSource(raw);
  return !s || s.kind === "own_writing" ? EMPTY_SOURCE : { includes: true, kind: s.kind, reference: s.reference ?? "", licence: s.licence ?? "", permissionNote: s.permissionNote ?? "" };
}

function toFields(kind: Kind, f: Fields) {
  if (kind === "osce_station") return stationFieldsFromForm(f.station ?? stationFormOf(null));
  if (kind === "revision_question") {
    const src = f.source ?? EMPTY_SOURCE;
    return { stem: f.stem ?? "", options: f.options ?? ["", "", "", ""], correctIndex: f.correctIndex ?? 0, rationale: f.rationale ?? "",
      source: src.includes ? { kind: src.kind, reference: src.reference, licence: src.licence, permissionNote: src.permissionNote } : { kind: "own_writing" } };
  }
  return { body: f.body ?? "", ...(kind === "targeted_resource" ? { links: (f.links ?? "").split(/\s+/).filter(Boolean) } : {}) };
}

/** The kind-specific fields. A revision question is four options, one correct, with a rationale. */
function KindFields({ kind, f, set }: { kind: Kind; f: Fields; set: (f: Fields) => void }) {
  if (kind === "osce_station") return <OsceStationFields value={f.station ?? stationFormOf(null)} set={station => set({ ...f, station })} />;
  if (kind === "revision_question") return (
    <div className="grid gap-2">
      <label className="text-[12.5px]">Question<textarea rows={2} value={f.stem ?? ""} onChange={e => set({ ...f, stem: e.target.value })} className={`${input} w-full`} /></label>
      {[0, 1, 2, 3].map(i => (
        <label key={i} className="flex items-center gap-2 text-[12.5px]">
          <input type="radio" name="correct" checked={(f.correctIndex ?? 0) === i} onChange={() => set({ ...f, correctIndex: i })} aria-label={`Option ${i + 1} is correct`} />
          <input value={f.options?.[i] ?? ""} onChange={e => { const o = [...(f.options ?? ["", "", "", ""])]; o[i] = e.target.value; set({ ...f, options: o }); }} placeholder={`Option ${i + 1}`} className={`${input} w-full`} />
        </label>
      ))}
      <label className="text-[12.5px]">Rationale<textarea rows={2} value={f.rationale ?? ""} onChange={e => set({ ...f, rationale: e.target.value })} className={`${input} w-full`} /></label>
      <SourceFields value={f.source ?? EMPTY_SOURCE} set={source => set({ ...f, source })} />
    </div>
  );
  return (
    <div className="grid gap-2">
      <label className="text-[12.5px]">Text<textarea rows={5} value={f.body ?? ""} onChange={e => set({ ...f, body: e.target.value })} className={`${input} w-full`} /></label>
      {kind === "targeted_resource" && <label className="text-[12.5px]">Links (https, separated by spaces)<input value={f.links ?? ""} onChange={e => set({ ...f, links: e.target.value })} className={`${input} w-full`} /></label>}
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

export function EditDraft({ versionId, kind, initial }: { versionId: string; kind: Kind; initial: Record<string, unknown> }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [f, setF] = useState<Fields>(kind === "osce_station" ? { station: stationFormOf(initial) } : kind === "revision_question"
    ? { stem: String(initial.stem ?? ""), options: Array.isArray(initial.options) ? initial.options.map(String) : ["", "", "", ""], correctIndex: Number(initial.correct_index ?? 0), rationale: String(initial.rationale ?? ""), source: sourceFormOf(initial.source) }
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
