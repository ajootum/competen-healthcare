"use client";

import { useState } from "react";
import { input, primary } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";
import { Msg, useResearchSend } from "./ResearchControls";

// The educator half of K3 (COMPETEN-KNOWLEDGE-RESEARCH-01 s5). Posts to /api/hq/knowledge/educator, which re-checks the
// capability, and 442 decides every write. Content is typed here by the educator: nothing is taken from a student.

const EP = "/api/hq/knowledge/educator";
type Kind = "explanation" | "revision_question" | "targeted_resource";
type Fields = { body?: string; links?: string; stem?: string; options?: string[]; correctIndex?: number; rationale?: string };

function toFields(kind: Kind, f: Fields) {
  if (kind === "revision_question") return { stem: f.stem ?? "", options: f.options ?? ["", "", "", ""], correctIndex: f.correctIndex ?? 0, rationale: f.rationale ?? "" };
  return { body: f.body ?? "", ...(kind === "targeted_resource" ? { links: (f.links ?? "").split(/\s+/).filter(Boolean) } : {}) };
}

/** The kind-specific fields. A revision question is four options, one correct, with a rationale. */
function KindFields({ kind, f, set }: { kind: Kind; f: Fields; set: (f: Fields) => void }) {
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
    </div>
  );
  return (
    <div className="grid gap-2">
      <label className="text-[12.5px]">Text<textarea rows={5} value={f.body ?? ""} onChange={e => set({ ...f, body: e.target.value })} className={`${input} w-full`} /></label>
      {kind === "targeted_resource" && <label className="text-[12.5px]">Links (https, separated by spaces)<input value={f.links ?? ""} onChange={e => set({ ...f, links: e.target.value })} className={`${input} w-full`} /></label>}
    </div>
  );
}

export function NewResource({ needId }: { needId?: string }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [kind, setKind] = useState<Kind>("explanation");
  const [code, setCode] = useState(""); const [title, setTitle] = useState(""); const [f, setF] = useState<Fields>({});
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Kind" value={kind} onChange={e => setKind(e.target.value as Kind)} className={input}><option value="explanation">Explanation</option><option value="revision_question">Revision question</option><option value="targeted_resource">Targeted resource</option></select>
        <input aria-label="Code" placeholder="code, e.g. fluid-balance-1" value={code} onChange={e => setCode(e.target.value)} className={input} />
        <input aria-label="Title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} className={`${input} min-w-[16rem]`} />
      </div>
      <KindFields kind={kind} f={f} set={setF} />
      <div className="flex items-center gap-2"><button type="button" disabled={busy} className={primary} onClick={() => send({ action: "resource_create", kind, code, title, needId, fields: toFields(kind, f) }, "Draft created. Review it, name its competencies, then submit it for clinical review.")}>Create draft</button><Msg msg={msg} /></div>
    </div>
  );
}

export function EditDraft({ versionId, kind, initial }: { versionId: string; kind: Kind; initial: Record<string, unknown> }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [f, setF] = useState<Fields>(kind === "revision_question"
    ? { stem: String(initial.stem ?? ""), options: Array.isArray(initial.options) ? initial.options.map(String) : ["", "", "", ""], correctIndex: Number(initial.correct_index ?? 0), rationale: String(initial.rationale ?? "") }
    : { body: String(initial.body ?? ""), links: Array.isArray(initial.links) ? initial.links.join(" ") : "" });
  return (
    <div className="space-y-2">
      <KindFields kind={kind} f={f} set={setF} />
      <div className="flex items-center gap-2"><button type="button" disabled={busy} className={primary} onClick={() => send({ action: "draft_save", versionId, fields: toFields(kind, f) }, "Saved. Saving clears any earlier educator review.")}>Save draft</button><Msg msg={msg} /></div>
    </div>
  );
}
