"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/competencies/authoring (migration 438). Every control posts to
// /api/hq/competency/authoring, which re-checks hq.quality.competency.author and records authorship before writing.
// Nothing here approves or publishes anything.

const PATH = "/api/hq/competency/authoring";
const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return false; }
      setMsg({ ok: true, text: done }); router.refresh(); return true;
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); return false; } finally { setBusy(false); }
  }
  return { busy, msg, send };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>;
}

const LAYERS = [["foundational", "Foundational"], ["profession", "Profession"], ["advanced", "Advanced"], ["specialty", "Specialty"], ["context", "Context"]] as const;
const RISKS = [["low", "Low"], ["standard", "Standard"], ["high", "High"], ["critical", "Critical"]] as const;

export function NewFramework({ professions }: { professions: { id: string; value: string }[] }) {
  const { busy, msg, send } = useSend();
  const [f, setF] = useState({ code: "", name: "", description: "", layer: "foundational", professionTermId: "" });
  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); if (await send({ action: "create_framework", ...f, professionTermId: f.professionTermId || null }, "Framework created as a draft.")) setF({ ...f, code: "", name: "", description: "" }); }}>
      <label className={label}>Code<input className={input} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="CF-FOUND" required /></label>
      <label className={label}>Name<input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={200} /></label>
      <label className={label}>Layer<select className={input} value={f.layer} onChange={e => setF({ ...f, layer: e.target.value })}>{LAYERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {f.layer === "profession" && (
        <label className={label}>Profession<select className={input} value={f.professionTermId} onChange={e => setF({ ...f, professionTermId: e.target.value })} required>
          <option value="">Choose</option>{professions.map(p => <option key={p.id} value={p.id}>{p.value}</option>)}
        </select></label>
      )}
      <label className={`${label} sm:col-span-2`}>Description<textarea className={input} rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} maxLength={2000} /></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><button className={primary} disabled={busy}>Create draft framework</button><Msg msg={msg} /></div>
    </form>
  );
}

export function ImportDraft() {
  const { busy, msg, send } = useSend();
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <form className="space-y-2" onSubmit={async e => {
      e.preventDefault(); setBad(false);
      let pkg: unknown; try { pkg = JSON.parse(text); } catch { setBad(true); return; }
      if (await send({ action: "import_draft", package: pkg }, "Imported as a DRAFT, not clinically reviewed.")) setText("");
    }}>
      <label className={label}>Draft package (JSON)<textarea className={`${input} font-mono`} rows={5} value={text} onChange={e => setText(e.target.value)} required /></label>
      <div className="flex flex-wrap items-center gap-2"><button className={ghost} disabled={busy}>Import as draft</button><Msg msg={bad ? { ok: false, text: "That is not a valid package (JSON). Nothing has changed." } : msg} /></div>
    </form>
  );
}

export function FrameworkMeta({ id, name, description }: { id: string; name: string; description: string | null }) {
  const { busy, msg, send } = useSend();
  const [f, setF] = useState({ name, description: description ?? "" });
  return (
    <form className="space-y-2" onSubmit={e => { e.preventDefault(); void send({ action: "update_framework", frameworkId: id, ...f }, "Saved."); }}>
      <label className={label}>Name<input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={200} /></label>
      <label className={label}>Description<textarea className={input} rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} maxLength={2000} /></label>
      <div className="flex flex-wrap items-center gap-2"><button className={ghost} disabled={busy}>Save framework</button><Msg msg={msg} /></div>
    </form>
  );
}

export function NewDomain({ frameworkId }: { frameworkId: string }) {
  const { busy, msg, send } = useSend();
  const [name, setName] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async e => { e.preventDefault(); if (await send({ action: "create_domain", frameworkId, name }, "Domain added.")) setName(""); }}>
      <label className={label}>New domain<input className={input} value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={200} /></label>
      <button className={ghost} disabled={busy}>Add domain</button><Msg msg={msg} />
    </form>
  );
}

export function DomainName({ domainId, name }: { domainId: string; name: string }) {
  const { busy, msg, send } = useSend();
  const [v, setV] = useState(name);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void send({ action: "rename_domain", domainId, name: v }, "Renamed."); }}>
      <label className={label}>Domain name<input className={input} value={v} onChange={e => setV(e.target.value)} required minLength={2} maxLength={200} /></label>
      <button className={ghost} disabled={busy || v === name}>Rename</button><Msg msg={msg} />
    </form>
  );
}

type Comp = { id?: string; code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null; riskCategory: string };

/** Create (no id, needs domainId) or edit one competency's material content. */
export function CompetencyEditor({ domainId, c, levels, approved }: { domainId?: string; c?: Comp; levels: { id: string; score: number; label: string }[]; approved?: boolean }) {
  const { busy, msg, send } = useSend();
  const blank: Comp = { code: "", name: "", description: "", learningOutcomes: [], expectedLevelId: null, riskCategory: "standard" };
  const [f, setF] = useState(() => ({ ...(c ?? blank), outcomes: (c?.learningOutcomes ?? []).join("\n") }));
  const editing = !!c?.id;
  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const body = { action: editing ? "update_competency" : "create_competency", competencyId: c?.id, domainId, code: f.code, name: f.name, description: f.description, learningOutcomes: f.outcomes, expectedLevelId: f.expectedLevelId || null, riskCategory: f.riskCategory };
      const ok = await send(body, editing ? (approved ? "Saved. It is now changed since its clinical approval and needs renewed review." : "Saved.") : "Competency added as a draft.");
      if (ok && !editing) setF({ ...blank, outcomes: "" });
    }}>
      <label className={label}>Code<input className={input} value={f.code ?? ""} onChange={e => setF({ ...f, code: e.target.value })} placeholder="CF-CR-001" required /></label>
      <label className={label}>Name<input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={300} /></label>
      <label className={`${label} sm:col-span-2`}>Description<textarea className={input} rows={2} value={f.description ?? ""} onChange={e => setF({ ...f, description: e.target.value })} maxLength={4000} /></label>
      <label className={`${label} sm:col-span-2`}>Learning outcomes, one per line<textarea className={input} rows={3} value={f.outcomes} onChange={e => setF({ ...f, outcomes: e.target.value })} /></label>
      <label className={label}>Expected level<select className={input} value={f.expectedLevelId ?? ""} onChange={e => setF({ ...f, expectedLevelId: e.target.value || null })}>
        <option value="">Not set</option>{levels.map(l => <option key={l.id} value={l.id}>{l.score}: {l.label}</option>)}
      </select></label>
      <label className={label}>Risk<select className={input} value={f.riskCategory} onChange={e => setF({ ...f, riskCategory: e.target.value })}>{RISKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {editing && approved && <p className="text-[12.5px] text-amber-900 sm:col-span-2">This content is clinically approved. Saving a change keeps that approval on record for the old content, and this competency then needs renewed review before it is approved again.</p>}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><button className={editing ? ghost : primary} disabled={busy}>{editing ? "Save changes" : "Add competency"}</button><Msg msg={msg} /></div>
    </form>
  );
}

export function SubmitReview({ competencyId }: { competencyId: string }) {
  const { busy, msg, send } = useSend();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={primary} disabled={busy} onClick={() => void send({ action: "submit_review", competencyId }, "Put forward for independent clinical review.")}>Put forward for clinical review</button>
      <Msg msg={msg} />
    </span>
  );
}
