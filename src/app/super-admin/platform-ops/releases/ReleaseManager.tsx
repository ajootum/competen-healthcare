"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";

// Configuration Publishing Service (NCP-019) — assemble a release of config objects, target a channel with a
// rollout strategy + optional schedule, then drive it through the publishing pipeline (validate → approve →
// publish → activate) each stage gated server-side. Activation flips the objects live with a checkpoint so the
// release can be rolled back.
type ObjRow = { object_key: string; object_type: string; display_name: string };
type Release = { release_key: string; name: string; channel: string; rollout: string; scheduled_for?: string | null; objects?: string[]; status: string; validation?: any };

const CHANNELS = ["dev", "qa", "uat", "pilot", "production"];
const ROLLOUTS = ["immediate", "scheduled", "phased", "canary"];
const STAGES = ["draft", "validated", "approved", "published", "activated"];
const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const ST: Record<string, string> = { draft: "bg-gray-100 text-gray-600", validated: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", approved: "bg-indigo-100 text-indigo-700", scheduled: "bg-violet-100 text-violet-700", published: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", activated: "bg-[var(--cmp-surface-success)] text-emerald-700", rolled_back: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", failed: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" };
const stageIdx = (s: string) => s === "scheduled" ? 3 : s === "rolled_back" ? 4 : s === "failed" ? 0 : STAGES.indexOf(s);

export default function ReleaseManager({ releases, objects }: { releases: Release[]; objects: ObjRow[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(releases[0]?.release_key ?? null);
  const selR = releases.find(r => r.release_key === selKey) ?? null;
  const [channel, setChannel] = useState(selR?.channel ?? "dev");
  const [rollout, setRollout] = useState(selR?.rollout ?? "immediate");
  const [sched, setSched] = useState(selR?.scheduled_for ?? "");
  const [sel, setSel] = useState<Set<string>>(new Set(selR?.objects ?? []));
  const [q, setQ] = useState("");
  const [events, setEvents] = useState<any[]>([]);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [nk, setNk] = useState(""); const [nn, setNn] = useState("");

  async function pick(r: Release) {
    setSelKey(r.release_key); setChannel(r.channel); setRollout(r.rollout); setSched(r.scheduled_for ?? ""); setSel(new Set(r.objects ?? [])); setMsg(null); setEvents([]);
    const res = await fetch(`/api/config/releases?release_key=${encodeURIComponent(r.release_key)}`); const j = await res.json().catch(() => ({})); if (res.ok) setEvents(j.events ?? []);
  }
  const toggle = (k: string) => setSel(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const filtered = objects.filter(o => !q || o.display_name.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(filtered.map(o => o.object_type))].sort();

  async function save() {
    if (!selR) return; setBusy(true); setMsg(null);
    const r = await fetch("/api/config/releases", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ release_key: selR.release_key, objects: [...sel], channel, rollout, scheduled_for: sched || null }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    setMsg(r.ok ? "✓ Saved." : (j?.error || "Save failed.")); if (r.ok) router.refresh();
  }
  async function act(action: string) {
    if (!selR) return;
    if (action === "rollback" && !confirm("Roll back this release? Objects are restored to their pre-activation version.")) return;
    if (action !== "validate") { if (!(await saveQuiet())) return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/releases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, release_key: selR.release_key }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setMsg(action === "validate" ? (j.ok ? "✓ Validation passed." : "✕ Validation failed — see below.") : `✓ ${action}.`); pick(selR); router.refresh(); }
    else setMsg(j?.error || `${action} failed.`);
  }
  async function saveQuiet(): Promise<boolean> {
    if (!selR) return false;
    const r = await fetch("/api/config/releases", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ release_key: selR.release_key, objects: [...sel], channel, rollout, scheduled_for: sched || null }) });
    return r.ok;
  }
  async function create() {
    const key = nk.trim().toLowerCase(), name = nn.trim();
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(key)) { setMsg("Key must be lowercase, dot-separated (e.g. release.2026_q3)"); return; }
    if (!name) { setMsg("Release name required"); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/releases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ release_key: key, name, channel: "dev" }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setNk(""); setNn(""); setSelKey(key); setSel(new Set()); setChannel("dev"); setRollout("immediate"); setSched(""); router.refresh(); } else setMsg(j?.error || "Create failed.");
  }

  const card = "bg-white rounded-xl border border-gray-200";
  const status = selR?.status ?? "draft";
  const cur = stageIdx(status);
  const btn = "text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-40";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Releases ({releases.length})</p>
        <div className="space-y-1 max-h-[300px] overflow-y-auto mb-3">
          {releases.map(r => <button key={r.release_key} onClick={() => pick(r)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === r.release_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate flex items-center gap-1.5">{r.name}<span className={`text-[8px] px-1 py-px rounded ${ST[r.status] ?? ST.draft}`}>{r.status}</span></p><p className="text-[10px] text-gray-500 truncate">{r.channel} · {(r.objects?.length ?? 0)} object(s)</p></button>)}
          {releases.length === 0 && <p className="text-[11px] text-gray-500 py-2">No releases yet.</p>}
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-500">New release</p>
          <input className={`${input} w-full`} value={nn} onChange={e => setNn(e.target.value)} placeholder="Release name" />
          <input className={`${input} w-full font-mono`} value={nk} onChange={e => setNk(e.target.value)} placeholder="release.key" />
          <button onClick={create} disabled={busy} className="w-full text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50">+ Create</button>
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selR ? <p className="text-sm text-gray-500 py-16 text-center">Select or create a release.</p> : (
          <>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">{selR.name}<span className={`text-[10px] px-1.5 py-0.5 rounded ${ST[status] ?? ST.draft}`}>{status}</span></h3><span className="text-[10px] text-gray-500 font-mono">{selR.release_key}</span></div>

            {/* Pipeline */}
            <div className="flex items-center gap-1 mb-4">
              {STAGES.map((s, i) => <span key={s} className="flex items-center gap-1"><span className={`text-[10px] px-2 py-0.5 rounded-full ${i <= cur ? (status === "failed" && i === 0 ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : "bg-[var(--cmp-surface-success)] text-emerald-700") : "bg-gray-100 text-gray-600"}`}>{s}</span>{i < STAGES.length - 1 && <span className="text-gray-500 text-[10px]">→</span>}</span>)}
            </div>

            {/* Settings */}
            <div className="flex items-end gap-2 mb-4 flex-wrap">
              <label className="text-[10px] text-gray-500">Channel<select className={`${input} w-28 block mt-0.5`} value={channel} onChange={e => setChannel(e.target.value)}>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="text-[10px] text-gray-500">Rollout<select className={`${input} w-28 block mt-0.5`} value={rollout} onChange={e => setRollout(e.target.value)}>{ROLLOUTS.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
              {rollout === "scheduled" && <label className="text-[10px] text-gray-500">Scheduled for<input type="datetime-local" className={`${input} block mt-0.5`} value={sched ? String(sched).slice(0, 16) : ""} onChange={e => setSched(e.target.value)} /></label>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] font-semibold text-gray-500">Objects ({sel.size})</p><input className={`${input} w-28`} value={q} onChange={e => setQ(e.target.value)} placeholder="search…" /></div>
                <div className="space-y-2 max-h-56 overflow-y-auto border border-gray-100 rounded-lg p-2">
                  {groups.map(g => <div key={g}><p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">{g}</p>{filtered.filter(o => o.object_type === g).map(o => <label key={o.object_key} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer"><input type="checkbox" checked={sel.has(o.object_key)} onChange={() => toggle(o.object_key)} /><span className="text-gray-700 truncate">{o.display_name}</span></label>)}</div>)}
                </div>
              </div>
              <div>
                {selR.validation && (
                  <div className={`rounded-lg border p-3 mb-3 ${selR.validation.ok ? "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)]" : "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]"}`}>
                    <p className={`text-xs font-semibold ${selR.validation.ok ? "text-emerald-700" : "text-[var(--cmp-text-error)]"}`}>{selR.validation.ok ? "✓ Validated" : "✕ Validation issues"}</p>
                    {selR.validation.schemaErrors?.length > 0 && <div className="mt-1 space-y-0.5">{selR.validation.schemaErrors.map((e: string, i: number) => <p key={i} className="text-[10px] text-[var(--cmp-text-error)]">{e}</p>)}</div>}
                    {selR.validation.depReason && <p className="text-[10px] text-[var(--cmp-text-error)] mt-1">Dependencies: {selR.validation.depReason}</p>}
                  </div>
                )}
                {events.length > 0 && <>
                  <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Timeline</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">{events.map((e, i) => <div key={i} className="flex items-center gap-2 text-[10px]"><span className="text-gray-700 font-medium w-16">{e.event}</span><span className="text-gray-500 flex-1 truncate">{e.actor_name ?? "—"}</span><span className="text-gray-500">{(() => { try { return new Date(e.created_at).toLocaleDateString(); } catch { return ""; } })()}</span></div>)}</div>
                </>}
              </div>
            </div>

            {msg && <p className={`text-xs mb-2 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <button onClick={save} disabled={busy} className={`${btn} text-indigo-700 border border-indigo-200 hover:bg-indigo-50`}>Save</button>
              <button onClick={() => act("validate")} disabled={busy || sel.size === 0} className={`${btn} text-[var(--cmp-text-information)] border border-[var(--cmp-color-information)] hover:bg-[var(--cmp-surface-information)]`}>Validate</button>
              {status === "validated" && <button onClick={() => act("approve")} disabled={busy} className={`${btn} text-white bg-indigo-600 hover:bg-indigo-700`}>Approve</button>}
              {status === "approved" && <button onClick={() => act("publish")} disabled={busy} className={`${btn} text-white bg-[var(--cmp-color-warning)] hover:bg-amber-700`}>Publish</button>}
              {["published", "scheduled"].includes(status) && <button onClick={() => act("activate")} disabled={busy} className={`${btn} text-white bg-[var(--cmp-color-success)] hover:bg-emerald-700`}>Activate</button>}
              {status === "activated" && <button onClick={() => act("rollback")} disabled={busy} className={`${btn} text-[var(--cmp-text-warning)] border border-[var(--cmp-color-warning)] hover:bg-[var(--cmp-surface-warning)]`}>Roll back</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
