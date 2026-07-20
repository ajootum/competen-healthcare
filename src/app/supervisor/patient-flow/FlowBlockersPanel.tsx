"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Flow Blockers panel (SSW-005 Patient Flow) — logs and resolves real blockers on
// patient movement via /api/operations/flow-blockers, alongside the auto-detected
// blockers the loader derives from live bed/patient state. After each write it
// calls router.refresh() so the server component re-pulls the source of truth.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CATS: [string, string][] = [
  ["transport", "Transport unavailable"], ["discharge_meds", "Discharge meds pending"], ["family_education", "Family education incomplete"],
  ["medical_review", "Medical review pending"], ["receiving_unit", "Receiving unit not ready"], ["documentation", "Documentation incomplete"],
  ["bed_cleaning", "Bed awaiting cleaning"], ["no_bed", "No bed available"], ["isolation_room", "Isolation room unavailable"], ["equipment", "Equipment issue"], ["other", "Other"],
];
const LABEL: Record<string, string> = Object.fromEntries(CATS);
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export default function FlowBlockersPanel({ blockers, auto, patients, configReady }: {
  blockers: any[]; auto: { label: string; detail: string }[]; patients: { id: string; label: string }[]; configReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [cat, setCat] = useState("transport"); const [pid, setPid] = useState(""); const [detail, setDetail] = useState("");
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };

  async function act(fn: () => Promise<any>, okText: string) {
    setBusy(true); const r = await fn(); setBusy(false);
    if (r.ok) { toast("ok", okText); router.refresh(); } else toast("err", r.data?.error || "Failed");
    return r.ok;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Flow blockers</h3>
        <span className="text-[11px] text-gray-400">{blockers.length} logged · {auto.length} auto-detected</span>
      </div>
      {msg && <div className={`mt-2 text-sm rounded-lg px-3 py-1.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.text}</div>}

      {/* Logged blockers (resolvable) */}
      <div className="mt-3 space-y-1.5">
        {configReady && blockers.length === 0 && <p className="text-sm text-gray-400">No logged blockers.</p>}
        {blockers.map((b: any) => (
          <div key={b.id} className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2">
            <span className="text-amber-500 mt-0.5">▲</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800">{LABEL[b.category] ?? b.category}{b.op_patients?.label ? ` — ${b.op_patients.label}` : ""}</p>
              {b.detail && <p className="text-[11px] text-gray-500 truncate">{b.detail}</p>}
            </div>
            <button disabled={busy} onClick={() => act(() => call("PATCH", `/api/operations/flow-blockers?id=${b.id}`), "Blocker resolved")}
              className="text-[11px] font-medium text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 hover:bg-teal-50 shrink-0">Resolve</button>
          </div>
        ))}
      </div>

      {/* Auto-detected blockers (informational) */}
      {auto.length > 0 && (
        <div className="mt-2 space-y-1">
          {auto.map((b, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-1.5 text-sm text-gray-500">
              <span className="text-gray-300 mt-0.5">○</span>
              <span className="min-w-0"><span className="text-gray-700">{b.label}</span>{b.detail ? <span className="text-gray-400"> · {b.detail}</span> : null} <span className="text-[10px] text-gray-400 uppercase">auto</span></span>
            </div>
          ))}
        </div>
      )}

      {/* Log a blocker */}
      {configReady ? (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-end gap-2">
          <select className={input} value={cat} onChange={e => setCat(e.target.value)}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className={input} value={pid} onChange={e => setPid(e.target.value)}><option value="">Patient (optional)…</option>{patients.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          <input className={`${input} flex-1 min-w-[8rem]`} placeholder="Detail (optional)" value={detail} onChange={e => setDetail(e.target.value)} />
          <button disabled={busy} onClick={async () => { if (await act(() => call("POST", "/api/operations/flow-blockers", { category: cat, patient_id: pid || undefined, detail: detail || undefined }), "Blocker logged")) setDetail(""); }}
            className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-1.5">Log blocker</button>
        </div>
      ) : (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">Apply migration <code className="bg-amber-100 px-1 rounded font-mono">048-flow-blockers.sql</code> to log &amp; resolve blockers. Auto-detected blockers above are live now.</p>
      )}
    </div>
  );
}
