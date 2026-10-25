"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import type { Activity, Blueprint, Block, Module, Question } from "@/lib/learning/blueprint";
import { RELATIONS, RELATION_LABEL, RIGHTS, RIGHTS_LABEL } from "@/lib/learning/blueprint";
import { ghost, input, Message, primary, Problems, useLearningSend } from "./LearningControls";

// ── THE NO-CODE COURSE STUDIO EDITOR ── COMPETEN-LEARNING-01 S1, product definition s7 ─────────────────────────────
//
// Edits one DRAFT learning-blueprint/1 document: basics, the four responsibilities, objectives mapped to CFCA outcomes
// with their relation, modules and sessions of lessons, knowledge checks, reflections and library cases, completion,
// certificate, CPD information, access, the external listing, and provenance. Save sends the whole document to
// /api/hq/learning (save), which normalises it, records the editor as an author, and answers its problems. Submitting
// is a separate action. Nothing here approves, publishes, prices or certifies.

type Opt = { id: string; label: string };
type CompOpt = { id: string; label: string; outcomes: string[] };

export function LearningEditor({ versionId, delivery, initial, responsibilities, risk, providers, competencies, professions, specialties, levels, formats }: {
  versionId: string; delivery: "hosted" | "external"; initial: Blueprint; responsibilities: Record<string, string | null>; risk: string;
  providers: { id: string; name: string; kind: string }[]; competencies: CompOpt[]; professions: Opt[]; specialties: Opt[]; levels: string[]; formats: string[];
}) {
  const [b, setB] = useState<Blueprint>(initial);
  const [resp, setResp] = useState(responsibilities);
  const [rk, setRk] = useState(risk);
  const [checked, setChecked] = useState(false);
  const { busy, msg, problems, send } = useLearningSend();
  const [upMsg, setUpMsg] = useState<string | null>(null);
  const set = (patch: Partial<Blueprint>) => setB({ ...b, ...patch });
  const ids = new Set([...b.objectives.map(o => o.id), ...b.modules.flatMap(m => [m.id, ...m.activities.map(a => a.id)])]);
  const fresh = (p: string) => { let n = 1; while (ids.has(`${p}${n}`)) n++; return `${p}${n}`; };
  const setModule = (i: number, m: Module) => set({ modules: b.modules.map((x, j) => (j === i ? m : x)) });
  const setActivity = (mi: number, ai: number, a: Activity) => setModule(mi, { ...b.modules[mi], activities: b.modules[mi].activities.map((x, j) => (j === ai ? a : x)) });
  const field = "block text-[12.5px] text-gray-700";
  const all = b.modules.flatMap(m => m.activities);

  async function upload(mi: number, ai: number, bi: number, file: File) {
    setUpMsg(null);
    const fd = new FormData(); fd.set("versionId", versionId); fd.set("file", file);
    const res = await fetch("/api/hq/learning/media", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setUpMsg(j?.error ?? "The file could not be uploaded."); return; }
    const a = b.modules[mi].activities[ai] as Extract<Activity, { kind: "lesson" }>;
    setActivity(mi, ai, { ...a, blocks: a.blocks.map((x, k) => (k === bi ? { ...x, mediaPath: j.mediaPath } as Block : x)) });
    setUpMsg("Uploaded. Save the draft to keep it.");
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-[14px] font-bold text-gray-900">Basics</h3>
        <label className={field}>Title<input className={`${input} mt-1 w-full`} value={b.title} onChange={e => set({ title: e.target.value })} /></label>
        <label className={field}>Summary a learner decides from<textarea className={`${input} mt-1 w-full`} rows={3} value={b.summary} onChange={e => set({ summary: e.target.value })} /></label>
        <div className="flex flex-wrap gap-3">
          <label className={field}>Level<select className={`${input} mt-1`} value={b.level} onChange={e => set({ level: e.target.value })}>{levels.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
          <label className={field}>Format<select className={`${input} mt-1`} value={b.format} onChange={e => set({ format: e.target.value })}>{formats.map(l => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}</select></label>
          <label className={field}>Language<input className={`${input} mt-1 w-20`} value={b.language} onChange={e => set({ language: e.target.value })} /></label>
          <label className={field}>Duration (minutes)<input className={`${input} mt-1 w-24`} inputMode="numeric" value={b.durationMinutes ?? ""} onChange={e => set({ durationMinutes: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label className={field}>Clinical risk<select className={`${input} mt-1`} value={rk} onChange={e => setRk(e.target.value)}><option value="standard">Standard</option><option value="high">High (higher approval count)</option></select></label>
        </div>
        <label className={field}>Topics (comma-separated)<input className={`${input} mt-1 w-full`} value={b.topics.join(", ")} onChange={e => set({ topics: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} /></label>
        <div className="flex flex-wrap gap-3">
          <MultiPick label="Professions" options={professions} value={b.audience.professionTermIds} onChange={v => set({ audience: { ...b.audience, professionTermIds: v } })} />
          <MultiPick label="Specialties" options={specialties} value={b.audience.specialtyTermIds} onChange={v => set({ audience: { ...b.audience, specialtyTermIds: v } })} />
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-[14px] font-bold text-gray-900">Who is responsible for what</h3>
        <p className="text-[12.5px] text-gray-600">Four separate responsibilities. A learner sees each one.</p>
        <div className="flex flex-wrap gap-3">
          {([["contentOwnerId", "Content owner"], ["deliveryProviderId", "Delivery provider"], ["certificateIssuerId", "Certificate issuer"], ["commercialProviderId", "Commercial party (takes payment)"]] as const).map(([k, l]) => (
            <label key={k} className={field}>{l}<select className={`${input} mt-1`} value={resp[k] ?? ""} onChange={e => setResp({ ...resp, [k]: e.target.value || null })}>
              <option value="">None</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}</select></label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-[14px] font-bold text-gray-900">Learning objectives and CFCA outcomes</h3>
        <p className="text-[12.5px] text-gray-600">Map each objective to the competencies it serves, and say how. These relations are distinct claims: none of them is verification of competence.</p>
        {b.objectives.map((o, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-100 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className={field}>Id<input className={`${input} mt-1 w-24`} value={o.id} onChange={e => set({ objectives: b.objectives.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} /></label>
              <label className={`${field} flex-1`}>Objective<input className={`${input} mt-1 w-full`} value={o.text} onChange={e => set({ objectives: b.objectives.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} /></label>
              <button type="button" className={ghost} onClick={() => set({ objectives: b.objectives.filter((_, j) => j !== i) })}>Remove</button>
            </div>
            {o.outcomeRefs.map((r, k) => {
              const c = competencies.find(x => x.id === r.competencyId);
              const upd = (patch: any) => set({ objectives: b.objectives.map((x, j) => (j === i ? { ...x, outcomeRefs: x.outcomeRefs.map((y, n) => (n === k ? { ...y, ...patch } : y)) } : x)) });
              return (
                <div key={k} className="flex flex-wrap items-end gap-2 pl-4">
                  <label className={field}>Competency<select className={`${input} mt-1 max-w-xs`} value={r.competencyId} onChange={e => upd({ competencyId: e.target.value, index: -1 })}>
                    <option value="">Choose</option>{competencies.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                  <label className={field}>Outcome<select className={`${input} mt-1 max-w-xs`} value={r.index} onChange={e => upd({ index: Number(e.target.value) })}>
                    <option value={-1}>The competency as a whole</option>{(c?.outcomes ?? []).map((t, n) => <option key={n} value={n}>{t || `Outcome ${n + 1}`}</option>)}</select></label>
                  <label className={field}>Relation<select className={`${input} mt-1`} value={r.relation} onChange={e => upd({ relation: e.target.value })}>{RELATIONS.map(x => <option key={x} value={x}>{RELATION_LABEL[x]}</option>)}</select></label>
                  <button type="button" className={ghost} onClick={() => set({ objectives: b.objectives.map((x, j) => (j === i ? { ...x, outcomeRefs: x.outcomeRefs.filter((_, n) => n !== k) } : x)) })}>Remove</button>
                </div>
              );
            })}
            <button type="button" className={ghost} onClick={() => set({ objectives: b.objectives.map((x, j) => (j === i ? { ...x, outcomeRefs: [...x.outcomeRefs, { competencyId: "", index: -1, relation: "develops" }] } : x)) })}>Map to a competency</button>
          </div>
        ))}
        <button type="button" className={ghost} onClick={() => set({ objectives: [...b.objectives, { id: fresh("obj-"), text: "", outcomeRefs: [] }] })}>Add an objective</button>
      </section>

      {delivery === "hosted" ? (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-[14px] font-bold text-gray-900">Modules, sessions and activities</h3>
          {upMsg && <p role="status" className="text-[12.5px] text-gray-700">{upMsg}</p>}
          {b.modules.map((m, mi) => (
            <div key={mi} className="space-y-3 rounded-lg border border-gray-100 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className={field}>Id<input className={`${input} mt-1 w-20`} value={m.id} onChange={e => setModule(mi, { ...m, id: e.target.value })} /></label>
                <label className={`${field} flex-1`}>Title<input className={`${input} mt-1 w-full`} value={m.title} onChange={e => setModule(mi, { ...m, title: e.target.value })} /></label>
                <label className={field}>Kind<select className={`${input} mt-1`} value={m.kind} onChange={e => setModule(mi, { ...m, kind: e.target.value as Module["kind"] })}><option value="module">Module</option><option value="session">Session (practical or live)</option></select></label>
                <button type="button" className={ghost} onClick={() => set({ modules: b.modules.filter((_, j) => j !== mi) })}>Remove module</button>
              </div>
              {m.activities.map((a, ai) => (
                <div key={ai} className="space-y-2 rounded-lg bg-gray-50 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="text-[12px] font-semibold uppercase text-gray-500">{a.kind}</span>
                    <label className={field}>Id<input className={`${input} mt-1 w-20`} value={a.id} onChange={e => setActivity(mi, ai, { ...a, id: e.target.value })} /></label>
                    <label className={`${field} flex-1`}>Title<input className={`${input} mt-1 w-full`} value={a.title} onChange={e => setActivity(mi, ai, { ...a, title: e.target.value })} /></label>
                    <button type="button" className={ghost} onClick={() => setModule(mi, { ...m, activities: m.activities.filter((_, j) => j !== ai) })}>Remove</button>
                  </div>
                  {a.kind === "lesson" && <LessonBlocks a={a} onChange={x => setActivity(mi, ai, x)} onUpload={(bi, f) => upload(mi, ai, bi, f)} />}
                  {a.kind === "check" && <CheckQuestions a={a} onChange={x => setActivity(mi, ai, x)} />}
                  {a.kind === "reflection" && <label className={field}>Prompt<textarea className={`${input} mt-1 w-full`} rows={2} value={a.prompt} onChange={e => setActivity(mi, ai, { ...a, prompt: e.target.value })} /></label>}
                  {a.kind === "case" && <label className={field}>Published library case version id<input className={`${input} mt-1 w-96`} value={a.caseVersionId} onChange={e => setActivity(mi, ai, { ...a, caseVersionId: e.target.value })} /></label>}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={ghost} onClick={() => setModule(mi, { ...m, activities: [...m.activities, { id: fresh("l"), kind: "lesson", title: "", minutes: 10, blocks: [{ type: "text", text: "" }] }] })}>Add a lesson</button>
                <button type="button" className={ghost} onClick={() => setModule(mi, { ...m, activities: [...m.activities, { id: fresh("q"), kind: "check", title: "Knowledge check", passMark: 70, questions: [] }] })}>Add a knowledge check</button>
                <button type="button" className={ghost} onClick={() => setModule(mi, { ...m, activities: [...m.activities, { id: fresh("r"), kind: "reflection", title: "Reflection", prompt: "" }] })}>Add a reflection</button>
                <button type="button" className={ghost} onClick={() => setModule(mi, { ...m, activities: [...m.activities, { id: fresh("c"), kind: "case", title: "Clinical case", caseVersionId: "" }] })}>Add a library case</button>
              </div>
            </div>
          ))}
          <button type="button" className={ghost} onClick={() => set({ modules: [...b.modules, { id: fresh("m"), title: "", kind: "module", activities: [] }] })}>Add a module or session</button>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <h4 className="text-[13px] font-bold text-gray-900">Completion</h4>
            <p className="text-[12.5px] text-gray-600">Completion is every required activity done, a required check passed. If the assessed checks below are all passed, the completion is recorded as assessed knowledge.</p>
            <div className="flex flex-wrap gap-3">{all.map(a => (
              <label key={a.id} className="text-[12.5px] text-gray-700"><input type="checkbox" checked={b.completion.requiredActivityIds.includes(a.id)}
                onChange={e => set({ completion: { ...b.completion, requiredActivityIds: e.target.checked ? [...b.completion.requiredActivityIds, a.id] : b.completion.requiredActivityIds.filter(x => x !== a.id) } })} /> Required: {a.title || a.id}</label>))}</div>
            <div className="flex flex-wrap gap-3">{all.filter(a => a.kind === "check").map(a => (
              <label key={a.id} className="text-[12.5px] text-gray-700"><input type="checkbox" checked={b.completion.assessedCheckIds.includes(a.id)}
                onChange={e => set({ completion: { ...b.completion, assessedCheckIds: e.target.checked ? [...b.completion.assessedCheckIds, a.id] : b.completion.assessedCheckIds.filter(x => x !== a.id) } })} /> Assessed: {a.title || a.id}</label>))}</div>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
            <label className="text-[12.5px] text-gray-700"><input type="checkbox" checked={b.certificate.offered} onChange={e => set({ certificate: { offered: e.target.checked } })} /> Offers a certificate (issued only under a Learning Certificate Issuer authorisation)</label>
            <label className={field}>Access<select className={`${input} mt-1`} value={b.access.model} onChange={e => set({ access: { model: e.target.value as "free" | "paid" } })}><option value="paid">Needs access (a price or an HQ grant)</option><option value="free">Free</option></select></label>
          </div>
        </section>
      ) : (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-[14px] font-bold text-gray-900">External listing</h3>
          <p className="text-[12.5px] text-gray-600">Publishing approves this listing as accurate and linked. It is not a clinical endorsement, and the learner is told so.</p>
          {b.external && (<>
            <label className={field}>Secure link (https)<input className={`${input} mt-1 w-full`} value={b.external.url} onChange={e => set({ external: { ...b.external!, url: e.target.value } })} /></label>
            <label className={field}>What the learner will find there, and how to come back to record it<textarea className={`${input} mt-1 w-full`} rows={3} value={b.external.providerNote} onChange={e => set({ external: { ...b.external!, providerNote: e.target.value } })} /></label>
            <div className="flex flex-wrap gap-3">
              <label className={field}>Delivery location<input className={`${input} mt-1`} value={b.external.deliveryLocation} onChange={e => set({ external: { ...b.external!, deliveryLocation: e.target.value } })} /></label>
              <label className={field}>Who takes payment<select className={`${input} mt-1`} value={b.external.payment} onChange={e => set({ external: { ...b.external!, payment: e.target.value as any } })}><option value="provider">The provider</option><option value="none">Free</option><option value="competen">Competen (under agreement)</option></select></label>
              <label className={field}>Certificate<select className={`${input} mt-1`} value={b.external.certificateBy} onChange={e => set({ external: { ...b.external!, certificateBy: e.target.value as any } })}><option value="provider">Issued by the provider</option><option value="none">None</option></select></label>
              <label className={field}>Next review date<input type="date" className={`${input} mt-1`} value={b.external.reviewDueOn} onChange={e => set({ external: { ...b.external!, reviewDueOn: e.target.value } })} /></label>
            </div>
            <label className={field}>CPD information, as the provider states it<input className={`${input} mt-1 w-full`} value={b.external.cpdInfo} onChange={e => set({ external: { ...b.external!, cpdInfo: e.target.value } })} /></label>
          </>)}
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-[14px] font-bold text-gray-900">CPD information and provenance</h3>
        <div className="flex flex-wrap gap-3">
          <label className={field}>Hours<input className={`${input} mt-1 w-20`} inputMode="decimal" value={b.cpd.hours ?? ""} onChange={e => set({ cpd: { ...b.cpd, hours: e.target.value === "" ? null : Number(e.target.value) } })} /></label>
          <label className={field}>Points<input className={`${input} mt-1 w-20`} inputMode="numeric" value={b.cpd.points ?? ""} onChange={e => set({ cpd: { ...b.cpd, points: e.target.value === "" ? null : Number(e.target.value) } })} /></label>
          <label className={`${field} flex-1`}>Note (never a claim of accreditation)<input className={`${input} mt-1 w-full`} value={b.cpd.note} onChange={e => set({ cpd: { ...b.cpd, note: e.target.value } })} /></label>
        </div>
        <label className={field}>Rights in the material<select className={`${input} mt-1`} value={b.provenance.rights} onChange={e => set({ provenance: { ...b.provenance, rights: e.target.value as any } })}>{RIGHTS.map(r => <option key={r} value={r}>{RIGHTS_LABEL[r]}</option>)}</select></label>
        {b.provenance.sources.map((s, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            {(["title", "licence", "url"] as const).map(k => <label key={k} className={field}>{k}<input className={`${input} mt-1`} value={s[k]} onChange={e => set({ provenance: { ...b.provenance, sources: b.provenance.sources.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) } })} /></label>)}
            <button type="button" className={ghost} onClick={() => set({ provenance: { ...b.provenance, sources: b.provenance.sources.filter((_, j) => j !== i) } })}>Remove</button>
          </div>
        ))}
        <button type="button" className={ghost} onClick={() => set({ provenance: { ...b.provenance, sources: [...b.provenance.sources, { title: "", licence: "", url: "" }] } })}>Add a source</button>
        {b.provenance.kind === "ai_draft" && <label className="block text-[12.5px] text-amber-900"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I have checked this AI draft line by line</label>}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "save", versionId, content: b, responsibilities: resp, risk: rk, checked }, "Draft saved.")}>Save draft</button>
        <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "submit", versionId }, delivery === "hosted" ? "Submitted for independent clinical review. It is frozen now." : "Submitted for listing approval. It is frozen now.")}>Submit</button>
      </div>
      <Message msg={msg} />
      <Problems items={problems} />
    </div>
  );
}

function MultiPick({ label, options, value, onChange }: { label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="block text-[12.5px] text-gray-700">{label}
      <select multiple className={`${input} mt-1 h-28 min-w-[14rem]`} value={value} onChange={e => onChange([...e.target.selectedOptions].map(o => o.value))}>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

function LessonBlocks({ a, onChange, onUpload }: { a: Extract<Activity, { kind: "lesson" }>; onChange: (a: Activity) => void; onUpload: (bi: number, f: File) => void }) {
  const field = "block text-[12.5px] text-gray-700";
  const setBlock = (i: number, x: Block) => onChange({ ...a, blocks: a.blocks.map((y, j) => (j === i ? x : y)) });
  return (
    <div className="space-y-2">
      <label className={field}>Minutes<input className={`${input} ml-1 w-16`} inputMode="numeric" value={a.minutes} onChange={e => onChange({ ...a, minutes: Number(e.target.value) || 1 })} /></label>
      {a.blocks.map((x, i) => (
        <div key={i} className="space-y-1">
          {x.type === "text" && <label className={field}>Text<textarea className={`${input} mt-1 w-full`} rows={5} value={x.text} onChange={e => setBlock(i, { ...x, text: e.target.value })} /></label>}
          {(x.type === "image" || x.type === "pdf") && (
            <div className="flex flex-wrap items-end gap-2">
              <label className={field}>{x.type === "image" ? "Image" : "PDF"} file<input type="file" accept={x.type === "image" ? "image/png,image/jpeg,image/webp" : "application/pdf"} className="mt-1 text-[12.5px]" onChange={e => e.target.files?.[0] && onUpload(i, e.target.files[0])} /></label>
              <span className="text-[12px] text-gray-500">{x.mediaPath ? `Stored: ${x.mediaPath.split("/").pop()}` : "Not uploaded yet"}</span>
              {x.type === "image" ? <label className={field}>Description for learners who cannot see it<input className={`${input} mt-1 w-72`} value={x.alt} onChange={e => setBlock(i, { ...x, alt: e.target.value })} /></label>
                : <label className={field}>Title<input className={`${input} mt-1 w-72`} value={x.title} onChange={e => setBlock(i, { ...x, title: e.target.value })} /></label>}
            </div>)}
          {x.type === "video" && <div className="flex flex-wrap gap-2"><label className={field}>Video link (https)<input className={`${input} mt-1 w-96`} value={x.url} onChange={e => setBlock(i, { ...x, url: e.target.value })} /></label>
            <label className={field}>Title<input className={`${input} mt-1 w-56`} value={x.title} onChange={e => setBlock(i, { ...x, title: e.target.value })} /></label></div>}
          <button type="button" className={ghost} onClick={() => onChange({ ...a, blocks: a.blocks.filter((_, j) => j !== i) })}>Remove block</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ghost} onClick={() => onChange({ ...a, blocks: [...a.blocks, { type: "text", text: "" }] })}>Add text</button>
        <button type="button" className={ghost} onClick={() => onChange({ ...a, blocks: [...a.blocks, { type: "image", mediaPath: "", alt: "" }] })}>Add an image</button>
        <button type="button" className={ghost} onClick={() => onChange({ ...a, blocks: [...a.blocks, { type: "pdf", mediaPath: "", title: "" }] })}>Add a PDF</button>
        <button type="button" className={ghost} onClick={() => onChange({ ...a, blocks: [...a.blocks, { type: "video", url: "", title: "" }] })}>Add a video link</button>
      </div>
    </div>
  );
}

function CheckQuestions({ a, onChange }: { a: Extract<Activity, { kind: "check" }>; onChange: (a: Activity) => void }) {
  const field = "block text-[12.5px] text-gray-700";
  const setQ = (i: number, q: Question) => onChange({ ...a, questions: a.questions.map((x, j) => (j === i ? q : x)) });
  const nextQ = () => { let n = a.questions.length + 1; while (a.questions.some(q => q.id === `${a.id}-${n}`)) n++; return `${a.id}-${n}`; };
  return (
    <div className="space-y-3">
      <label className={field}>Pass mark (%)<input className={`${input} ml-1 w-16`} inputMode="numeric" value={a.passMark} onChange={e => onChange({ ...a, passMark: Number(e.target.value) || 1 })} /></label>
      {a.questions.map((q, i) => (
        <div key={i} className="space-y-1 rounded border border-gray-200 bg-white p-2">
          <label className={field}>Question<input className={`${input} mt-1 w-full`} value={q.prompt} onChange={e => setQ(i, { ...q, prompt: e.target.value })} /></label>
          {q.options.map((o, k) => (
            <div key={k} className="flex items-center gap-2">
              <input type="checkbox" aria-label={`Option ${o.id} is correct`} checked={q.correct.includes(o.id)} onChange={e => setQ(i, { ...q, correct: e.target.checked ? [...q.correct, o.id] : q.correct.filter(c => c !== o.id) })} />
              <input className={`${input} flex-1`} value={o.text} aria-label={`Option ${o.id}`} onChange={e => setQ(i, { ...q, options: q.options.map((x, n) => (n === k ? { ...x, text: e.target.value } : x)) })} />
              <button type="button" className={ghost} onClick={() => setQ(i, { ...q, options: q.options.filter((_, n) => n !== k), correct: q.correct.filter(c => c !== o.id) })}>Remove</button>
            </div>
          ))}
          <button type="button" className={ghost} onClick={() => { const used = new Set(q.options.map(o => o.id)); const id = "abcdefgh".split("").find(c => !used.has(c)) ?? "z"; setQ(i, { ...q, options: [...q.options, { id, text: "" }] }); }}>Add an option</button>
          <label className={field}>Why the answer is correct (shown once the check is passed or attempts run out)<input className={`${input} mt-1 w-full`} value={q.rationale} onChange={e => setQ(i, { ...q, rationale: e.target.value })} /></label>
          <button type="button" className={ghost} onClick={() => onChange({ ...a, questions: a.questions.filter((_, j) => j !== i) })}>Remove question</button>
        </div>
      ))}
      <button type="button" className={ghost} onClick={() => onChange({ ...a, questions: [...a.questions, { id: nextQ(), prompt: "", options: [{ id: "a", text: "" }, { id: "b", text: "" }], correct: [], rationale: "" }] })}>Add a question</button>
    </div>
  );
}
