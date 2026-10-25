"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/competencies/authoring (migration 465). Every control posts to
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

type Opt = { id: string; value: string };
type FwOpt = { id: string; name: string; code: string | null };

function IdentityFields({ f, setF, professions, specialties, frameworks }: { f: Record<string, string>; setF: (f: Record<string, string>) => void; professions: Opt[]; specialties: Opt[]; frameworks: FwOpt[] }) {
  return (
    <>
      <label className={label}>Layer<select className={input} value={f.layer} onChange={e => setF({ ...f, layer: e.target.value })}>{LAYERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {f.layer === "profession" && (
        <label className={label}>Profession<select className={input} value={f.professionTermId} onChange={e => setF({ ...f, professionTermId: e.target.value })} required>
          <option value="">Choose</option>{professions.map(p => <option key={p.id} value={p.id}>{p.value}</option>)}
        </select></label>
      )}
      <label className={label}>Specialty{f.layer === "specialty" ? "" : " (optional)"}<select className={input} value={f.specialtyTermId} onChange={e => setF({ ...f, specialtyTermId: e.target.value })} required={f.layer === "specialty"}>
        <option value="">None</option>{specialties.map(p => <option key={p.id} value={p.id}>{p.value}</option>)}
      </select></label>
      <label className={label}>Extends (optional)<select className={input} value={f.parentFrameworkId} onChange={e => setF({ ...f, parentFrameworkId: e.target.value })}>
        <option value="">Nothing</option>{frameworks.map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ""}</option>)}
      </select></label>
    </>
  );
}
const ids = (f: Record<string, string>) => ({ professionTermId: f.professionTermId || null, specialtyTermId: f.specialtyTermId || null, parentFrameworkId: f.parentFrameworkId || null });

/** Code, layer, profession, specialty and parent: a draft's identity. */
export function FrameworkIdentity({ frameworkId, initial, professions, specialties, frameworks }: { frameworkId: string; initial: Record<string, string>; professions: Opt[]; specialties: Opt[]; frameworks: FwOpt[] }) {
  const { busy, msg, send } = useSend();
  const [f, setF] = useState(initial);
  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void send({ action: "set_identity", frameworkId, code: f.code, layer: f.layer, ...ids(f) }, "Identity saved."); }}>
      <label className={label}>Code<input className={input} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} required /></label>
      <IdentityFields f={f} setF={setF} professions={professions} specialties={specialties} frameworks={frameworks.filter(x => x.id !== frameworkId)} />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><button className={ghost} disabled={busy}>Save identity</button><Msg msg={msg} /></div>
    </form>
  );
}

export function NewFramework({ professions, specialties = [], frameworks = [] }: { professions: Opt[]; specialties?: Opt[]; frameworks?: FwOpt[] }) {
  const { busy, msg, send } = useSend();
  const [f, setF] = useState<Record<string, string>>({ code: "", name: "", description: "", layer: "foundational", professionTermId: "", specialtyTermId: "", parentFrameworkId: "" });
  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); if (await send({ action: "create_framework", code: f.code, name: f.name, description: f.description, layer: f.layer, ...ids(f) }, "Framework created as a draft.")) setF({ ...f, code: "", name: "", description: "" }); }}>
      <label className={label}>Code<input className={input} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="CF-FOUND" required /></label>
      <label className={label}>Name<input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={200} /></label>
      <IdentityFields f={f} setF={setF} professions={professions} specialties={specialties} frameworks={frameworks} />
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
  const [code, setCode] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async e => { e.preventDefault(); if (await send({ action: "create_domain", frameworkId, name, code }, "Domain added.")) { setName(""); setCode(""); } }}>
      <label className={label}>New domain<input className={input} value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={200} /></label>
      <label className={label}>Code (optional)<input className={input} value={code} onChange={e => setCode(e.target.value)} /></label>
      <button className={ghost} disabled={busy}>Add domain</button><Msg msg={msg} />
    </form>
  );
}

export function DomainName({ domainId, name, code }: { domainId: string; name: string; code?: string | null }) {
  const { busy, msg, send } = useSend();
  const [v, setV] = useState(name);
  const [c, setC] = useState(code ?? "");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void send({ action: "rename_domain", domainId, name: v, code: c }, "Saved."); }}>
      <label className={label}>Domain name<input className={input} value={v} onChange={e => setV(e.target.value)} required minLength={2} maxLength={200} /></label>
      <label className={label}>Code<input className={input} value={c} onChange={e => setC(e.target.value)} /></label>
      <button className={ghost} disabled={busy || (v === name && c === (code ?? ""))}>Save</button><Msg msg={msg} />
    </form>
  );
}

type Comp = { id?: string; code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null; riskCategory: string; cpuId?: string | null };
type CpuOpt = { id: string; label: string };

export function NewPractice({ domainId }: { domainId: string }) {
  const { busy, msg, send } = useSend();
  const [f, setF] = useState({ code: "", name: "", description: "" });
  return (
    <form className="grid gap-2 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); if (await send({ action: "create_practice", domainId, ...f }, "Practice added.")) setF({ code: "", name: "", description: "" }); }}>
      <label className={label}>Practice code<input className={input} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="PRA-OXY-001" required /></label>
      <label className={label}>Name<input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={200} /></label>
      <label className={label}>Description<input className={input} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3"><button className={ghost} disabled={busy}>Add practice</button><Msg msg={msg} /></div>
    </form>
  );
}

export function NewCpu({ practiceId }: { practiceId: string }) {
  const { busy, msg, send } = useSend();
  const [f, setF] = useState({ code: "", name: "", description: "", riskCategory: "standard", complexity: "2", reassessmentMonths: "12" });
  return (
    <form className="grid gap-2 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); if (await send({ action: "create_cpu", practiceId, ...f, complexity: Number(f.complexity), reassessmentMonths: Number(f.reassessmentMonths) }, "CPU added.")) setF({ ...f, code: "", name: "", description: "" }); }}>
      <label className={label}>CPU code<input className={input} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="CPU-OXYSAFE-001" required /></label>
      <label className={label}>Name<input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={200} /></label>
      <label className={label}>Risk<select className={input} value={f.riskCategory} onChange={e => setF({ ...f, riskCategory: e.target.value })}>{RISKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className={`${label} sm:col-span-3`}>Description<input className={input} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      <label className={label}>Complexity (1 to 5)<input className={input} type="number" min={1} max={5} value={f.complexity} onChange={e => setF({ ...f, complexity: e.target.value })} /></label>
      <label className={label}>Reassess every (months)<input className={input} type="number" min={1} max={120} value={f.reassessmentMonths} onChange={e => setF({ ...f, reassessmentMonths: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3"><button className={ghost} disabled={busy}>Add CPU</button><Msg msg={msg} /></div>
    </form>
  );
}

/** Create (no id, needs domainId) or edit one competency's material content. */
export function CompetencyEditor({ domainId, c, levels, approved, cpus = [] }: { domainId?: string; c?: Comp; levels: { id: string; score: number; label: string }[]; approved?: boolean; cpus?: CpuOpt[] }) {
  const { busy, msg, send } = useSend();
  const blank: Comp = { code: "", name: "", description: "", learningOutcomes: [], expectedLevelId: null, riskCategory: "standard", cpuId: null };
  const [f, setF] = useState(() => ({ ...(c ?? blank), outcomes: (c?.learningOutcomes ?? []).join("\n") }));
  const editing = !!c?.id;
  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const body = { action: editing ? "update_competency" : "create_competency", competencyId: c?.id, domainId, code: f.code, name: f.name, description: f.description, learningOutcomes: f.outcomes, expectedLevelId: f.expectedLevelId || null, riskCategory: f.riskCategory, cpuId: f.cpuId || null };
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
      <label className={`${label} sm:col-span-2`}>Clinical practice unit (CPU)<select className={input} value={f.cpuId ?? ""} onChange={e => setF({ ...f, cpuId: e.target.value || null })}>
        <option value="">None</option>{cpus.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
      </select></label>
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
