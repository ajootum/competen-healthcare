"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/individual/programmes (COMPETEN-SCHOLAR-JOIN-01). It posts to
// /api/hq/individual/programmes, which re-checks the capability and every rule itself.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "mt-1 block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";

type Link = { frameworkId: string; layer: string };
type Draft = { code: string; label: string; profession: string; country: string; level: string; active: boolean; frameworks: Link[] };

export default function ProgrammeEditor({ catalogues, layers, existing }: {
  catalogues: { id: string; name: string }[]; layers: string[]; existing: Draft | null;
}) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(existing ?? { code: "", label: "", profession: "", country: "", level: "", active: true, frameworks: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const id = existing ? `pe-${existing.code}` : "pe-new";
  const set = (k: keyof Draft, v: unknown) => setD(x => ({ ...x, [k]: v }));
  const unused = catalogues.filter(c => !d.frameworks.some(f => f.frameworkId === c.id));

  async function save(next: Draft, done: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/individual/programmes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return; }
      setMsg({ ok: true, text: done });
      if (!existing) setD({ code: "", label: "", profession: "", country: "", level: "", active: true, frameworks: [] });
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); save(d, existing ? "Saved. The change is in the audit trail." : "Programme created."); }} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-code`} className={label}>Code {existing && <span className="font-normal text-gray-500">(fixed)</span>}</label>
          <input id={`${id}-code`} value={d.code} onChange={e => set("code", e.target.value.toLowerCase())} readOnly={!!existing} required
            pattern="[a-z0-9][a-z0-9-]{1,62}" aria-describedby={`${id}-code-help`} className={`${input} font-mono ${existing ? "bg-gray-50" : ""}`} />
          <p id={`${id}-code-help`} className="mt-0.5 text-[12px] text-gray-500">Lower-case letters, digits and dashes. It cannot change later.</p>
        </div>
        <div><label htmlFor={`${id}-label`} className={label}>Name</label><input id={`${id}-label`} value={d.label} onChange={e => set("label", e.target.value)} required maxLength={120} className={input} /></div>
        <div><label htmlFor={`${id}-prof`} className={label}>Profession</label><input id={`${id}-prof`} value={d.profession} onChange={e => set("profession", e.target.value)} required maxLength={80} className={input} /></div>
        <div><label htmlFor={`${id}-country`} className={label}>Country <span className="font-normal text-gray-500">(two letters, optional)</span></label><input id={`${id}-country`} value={d.country} onChange={e => set("country", e.target.value.toUpperCase())} maxLength={2} className={input} /></div>
        <div><label htmlFor={`${id}-level`} className={label}>Qualification <span className="font-normal text-gray-500">(optional, e.g. diploma)</span></label><input id={`${id}-level`} value={d.level} onChange={e => set("level", e.target.value)} maxLength={80} className={input} /></div>
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>Catalogues this programme learns against</legend>
        {d.frameworks.length === 0 && <p className="text-[13px] text-gray-600">None linked: Scholar will propose no competencies for this programme.</p>}
        {d.frameworks.map((f, i) => (
          <div key={f.frameworkId} className="flex flex-wrap items-center gap-2 text-[13.5px]">
            <span className="min-w-0 flex-1 text-gray-800">{catalogues.find(c => c.id === f.frameworkId)?.name ?? "A catalogue no longer shared and published"}</span>
            <label className="sr-only" htmlFor={`${id}-layer-${i}`}>Layer</label>
            <select id={`${id}-layer-${i}`} value={f.layer} onChange={e => set("frameworks", d.frameworks.map((x, j) => j === i ? { ...x, layer: e.target.value } : x))} className="rounded-lg border border-gray-300 px-2 py-1 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)]">
              {layers.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <button type="button" className={ghost} onClick={() => set("frameworks", d.frameworks.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        {unused.length > 0 && (
          <div>
            <label htmlFor={`${id}-add`} className="sr-only">Add a catalogue</label>
            <select id={`${id}-add`} value="" onChange={e => { if (e.target.value) set("frameworks", [...d.frameworks, { frameworkId: e.target.value, layer: layers[0] }]); }}
              className="rounded-lg border border-gray-300 px-2 py-1 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <option value="">Add a catalogue…</option>
              {unused.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {catalogues.length === 0 && <p className="text-[13px] text-gray-600">No shared catalogue is published yet.</p>}
      </fieldset>

      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={busy}>{existing ? "Save changes" : "Create programme"}</button>
        {existing && (d.active
          ? <button type="button" className={ghost} disabled={busy} onClick={() => { if (window.confirm(`Deactivate ${d.label}? Nobody new can choose it. Students who chose it keep its name.`)) { const n = { ...d, active: false }; setD(n); save(n, "Deactivated. It is offered to nobody new."); } }}>Deactivate</button>
          : <button type="button" className={ghost} disabled={busy} onClick={() => { const n = { ...d, active: true }; setD(n); save(n, "Reactivated."); }}>Reactivate</button>)}
      </div>
    </form>
  );
}
