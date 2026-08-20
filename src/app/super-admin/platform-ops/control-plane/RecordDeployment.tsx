"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/interactive";

// Records a platform release via POST /api/platform/deployments so the
// deployment / release / "Deployments Today" widgets populate. Version is
// prefilled from the running build.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CHANNELS = ["stable", "staged", "canary"];
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function RecordDeployment({ version }: { version: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ version, channel: "stable", notes: "", git_commit: "" });
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.version.trim()) { setErr("Version is required"); return; }
    setSaving(true); setErr("");
    const r = await fetch("/api/platform/deployments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    if (r.ok) { setOpen(false); router.refresh(); }
    else setErr((await r.json().catch(() => ({}))).error ?? "Failed");
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setErr(""); setForm({ version, channel: "stable", notes: "", git_commit: "" }); }}
        className="text-xs font-medium text-teal-700 hover:underline shrink-0">Record deployment</button>

      {open && (
        <Modal open title="Record deployment" onClose={() => setOpen(false)} width="sm">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Version *</label><input value={form.version} onChange={set("version")} className={input} placeholder="0.1.0" /></div>
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Channel</label><select value={form.channel} onChange={set("channel")} className={input}>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Git commit <span className="text-gray-500">(optional)</span></label><input value={form.git_commit} onChange={set("git_commit")} className={input} placeholder="short sha" /></div>
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Notes <span className="text-gray-500">(optional)</span></label><textarea value={form.notes} onChange={set("notes")} rows={2} className={input} /></div>
            {err && <p className="text-xs text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2">{err}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{saving ? "Recording…" : "Record"}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
