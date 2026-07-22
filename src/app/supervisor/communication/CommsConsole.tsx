"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONTEXT_TYPES, BROADCAST_PRIORITIES } from "@/lib/operations/communication-centre";

// Communication console (SSW-COM-001) — send a context-aware message or a
// ward/hospital broadcast (with priority, audience, expiry, emergency mode).
// Writes through the audited messages / broadcasts APIs.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function CommsConsole({ messagesProvisioned, broadcastsProvisioned }: { messagesProvisioned: boolean; broadcastsProvisioned: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"message" | "broadcast">("message");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [m, setM] = useState({ channel: "", context_type: "team", body: "" });
  const [bc, setBc] = useState({ title: "", audience: "All Staff", priority: "medium", body: "", emergency: false, expires_hours: "" });

  async function post(url: string, payload: any, reset: () => void, label: string) {
    setBusy(true); setErr(null); setOk(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
      reset(); setOk(label); router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";
  const gated = (tab === "message" && !messagesProvisioned) || (tab === "broadcast" && !broadcastsProvisioned);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        {(["message", "broadcast"] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setOk(null); setErr(null); }} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === t ? "bg-teal-600 text-white" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>{t === "message" ? "💬 New Message" : "📣 Send Broadcast"}</button>
        ))}
      </div>

      {gated ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center"><p className="text-sm text-gray-500">Not provisioned</p><p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">072-communication-centre</span> to enable messaging &amp; broadcasts.</p></div>
      ) : tab === "message" ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={m.channel} onChange={e => setM({ ...m, channel: e.target.value })} placeholder="Channel (e.g. Ward 3 Team)" className={`${sel} flex-1`} />
            <select value={m.context_type} onChange={e => setM({ ...m, context_type: e.target.value })} className={sel}>{CONTEXT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          </div>
          <textarea value={m.body} onChange={e => setM({ ...m, body: e.target.value })} rows={2} placeholder="Message…" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none" />
          <button onClick={() => post("/api/operations/messages", { ...m, channel: m.channel || "General" }, () => setM({ channel: "", context_type: "team", body: "" }), "Message sent")} disabled={!m.body.trim() || busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy ? "…" : "Send message"}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={bc.title} onChange={e => setBc({ ...bc, title: e.target.value })} placeholder="Broadcast title *" className={`${sel} flex-1`} />
            <select value={bc.priority} onChange={e => setBc({ ...bc, priority: e.target.value })} className={sel}>{BROADCAST_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select>
          </div>
          <div className="flex gap-2">
            <input value={bc.audience} onChange={e => setBc({ ...bc, audience: e.target.value })} placeholder="Audience" className={`${sel} flex-1`} />
            <input type="number" min={0} value={bc.expires_hours} onChange={e => setBc({ ...bc, expires_hours: e.target.value })} placeholder="Expiry (h)" className={`${sel} w-24`} />
            <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" checked={bc.emergency} onChange={e => setBc({ ...bc, emergency: e.target.checked })} /> Emergency</label>
          </div>
          <textarea value={bc.body} onChange={e => setBc({ ...bc, body: e.target.value })} rows={2} placeholder="Broadcast body…" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none" />
          <button onClick={() => post("/api/operations/broadcasts", { ...bc, expires_hours: bc.expires_hours ? Number(bc.expires_hours) : undefined }, () => setBc({ title: "", audience: "All Staff", priority: "medium", body: "", emergency: false, expires_hours: "" }), "Broadcast sent")} disabled={!bc.title.trim() || busy} className={`text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 ${bc.emergency ? "bg-rose-600 hover:bg-rose-700" : "bg-teal-600 hover:bg-teal-700"}`}>{busy ? "…" : bc.emergency ? "Send emergency broadcast" : "Send broadcast"}</button>
        </div>
      )}
      {ok && <p className="text-[11px] text-green-600 mt-2">{ok}</p>}
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
