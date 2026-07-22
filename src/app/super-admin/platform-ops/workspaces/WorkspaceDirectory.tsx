"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Workspace directory (POP-001 §3) — grouped registry with inline enable toggle
// and an edit modal (name, icon, description, accent, audience) per workspace.
/* eslint-disable @typescript-eslint/no-explicit-any */

const APP_ROLES = [["super_admin", "Super Admin"], ["hospital_admin", "Admin"], ["educator", "Educator"], ["assessor", "Assessor"], ["nurse", "Healthcare Worker"]] as const;
const PLATFORM_ROLES = [["platform_owner", "Owner"], ["platform_operations", "Operations"], ["customer_success", "Customer Success"], ["support", "Support"], ["product_manager", "Product"], ["engineer", "Engineering"], ["ai_operator", "AI Ops"], ["finance", "Finance"], ["content_manager", "Content"], ["quality_officer", "Quality"], ["security_operator", "Security"]] as const;
const roleLabel = (code: string) => [...APP_ROLES, ...PLATFORM_ROLES].find(([c]) => c === code)?.[1] ?? code;
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function WorkspaceDirectory({ groups, canEdit }: { groups: any[]; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 3500); };

  const filtered = useMemo(() => groups.map(g => ({
    ...g,
    items: g.items.filter((w: any) => !q || w.name.toLowerCase().includes(q.toLowerCase()) || w.route.toLowerCase().includes(q.toLowerCase()) || w.audience.some((a: string) => a.includes(q.toLowerCase()))),
  })).filter(g => g.items.length), [groups, q]);

  async function patch(key: string, body: any, ok = "Updated") {
    setBusyKey(key);
    const r = await fetch(`/api/platform/workspaces?key=${encodeURIComponent(key)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusyKey(null);
    if (r.ok) { toast("ok", ok); router.refresh(); return true; }
    toast("err", (await r.json().catch(() => ({}))).error ?? "Failed"); return false;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search workspaces…" className={`${input} w-64`} />
        {msg && <span className={`text-sm rounded-lg px-3 py-1.5 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
      </div>

      {filtered.map(g => (
        <div key={g.kind} className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm">{g.label} <span className="text-gray-400 font-normal">({g.items.length})</span></h2>
          </div>
          <div className="divide-y divide-gray-50">
            {g.items.map((w: any) => (
              <div key={w.key} className={`flex items-center gap-3 px-4 py-3 ${!w.enabled ? "opacity-55" : ""}`}>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0" style={{ backgroundColor: `${w.accent}1a` }}>{w.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">{w.name}</span>
                    {w.customized && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">customised</span>}
                    {!w.enabled && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">disabled</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 truncate">{w.route} · {w.audience.map(roleLabel).join(", ")}</p>
                </div>
                <Link href={w.route} className="text-xs text-gray-400 hover:text-teal-700 shrink-0 hidden sm:inline">Open ↗</Link>
                {canEdit ? (
                  <>
                    <button onClick={() => patch(w.key, { is_enabled: !w.enabled }, w.enabled ? "Disabled" : "Enabled")} disabled={busyKey === w.key}
                      className={`text-[11px] font-medium rounded-full px-2.5 py-0.5 border shrink-0 disabled:opacity-40 ${w.enabled ? "bg-green-50 border-green-200 text-green-700" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
                      {w.enabled ? "On" : "Off"}
                    </button>
                    <button onClick={() => setEditing(w)} className="text-xs font-medium text-teal-700 hover:underline shrink-0">Edit</button>
                  </>
                ) : (
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 ${w.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{w.enabled ? "Enabled" : "Disabled"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No workspaces match.</p>}

      {editing && <EditModal w={editing} busy={busyKey === editing.key}
        onClose={() => setEditing(null)}
        onSave={async (body: any) => { if (await patch(editing.key, body, "Workspace updated")) setEditing(null); }}
        onReset={async () => { if (await patch(editing.key, { action: "reset" }, "Reset to defaults")) setEditing(null); }} />}
    </div>
  );
}

function EditModal({ w, busy, onClose, onSave, onReset }: any) {
  const opts = w.kind === "platform" ? PLATFORM_ROLES : APP_ROLES;
  const [form, setForm] = useState<any>({ label: w.name, icon: w.icon, description: w.description, accent: w.accent, is_enabled: w.enabled, audience: [...w.audience] });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const toggleAud = (code: string) => setForm((f: any) => ({ ...f, audience: f.audience.includes(code) ? f.audience.filter((a: string) => a !== code) : [...f.audience, code] }));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Edit workspace</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-6 flex flex-col gap-3">
          <p className="text-[11px] text-gray-400 -mt-1">{w.route} · <span className="capitalize">{w.kind.replace("_", "-")}</span> plane</p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Name</label><input value={form.label} onChange={e => set("label", e.target.value)} className={input} /></div>
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Icon</label><input value={form.icon} onChange={e => set("icon", e.target.value)} maxLength={4} className={`${input} w-16 text-center`} /></div>
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Accent</label><input type="color" value={form.accent} onChange={e => set("accent", e.target.value)} className="w-11 h-[38px] border border-gray-300 rounded-lg p-0.5 cursor-pointer" /></div>
          </div>
          <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Description</label><textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} className={input} /></div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Audience (permitted roles)</label>
            <div className="flex flex-wrap gap-1.5">
              {opts.map(([code, lbl]) => (
                <button key={code} type="button" onClick={() => toggleAud(code)}
                  className={`text-[11px] font-medium rounded-full px-2.5 py-1 border ${form.audience.includes(code) ? "bg-teal-50 border-teal-300 text-teal-700" : "bg-gray-50 border-gray-200 text-gray-500"}`}>{lbl}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.is_enabled} onChange={e => set("is_enabled", e.target.checked)} /> Enabled</label>
          <div className="flex items-center gap-2 pt-1">
            {w.customized && <button onClick={onReset} disabled={busy} className="text-xs text-gray-500 hover:text-rose-600 mr-auto">Reset to defaults</button>}
            <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={() => onSave({ label: form.label, icon: form.icon, description: form.description, accent: form.accent, is_enabled: form.is_enabled, audience: form.audience })} disabled={busy || !form.label.trim()} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
