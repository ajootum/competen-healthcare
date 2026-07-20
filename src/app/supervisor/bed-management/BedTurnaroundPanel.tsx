"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Bed Turnaround panel (SSW-005 Bed Management) — tracks each bed cycle through
// vacated -> cleaning requested -> cleaning -> inspection -> ready via
// /api/operations/bed-turnaround, and frees the bed on completion. router.refresh()
// after each write keeps the server component the source of truth.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STAGES: [string, string][] = [
  ["vacated", "Vacated"], ["cleaning_requested", "Cleaning requested"], ["cleaning", "Cleaning"], ["inspection", "Inspection"], ["ready", "Ready"],
];
const ORDER = STAGES.map(s => s[0]);
const LABEL: Record<string, string> = Object.fromEntries(STAGES);
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export default function BedTurnaroundPanel({ turnaround, cleaningBeds, configReady }: {
  turnaround: any[]; cleaningBeds: any[]; configReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [bed, setBed] = useState("");
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };
  async function act(fn: () => Promise<any>, okText: string) {
    setBusy(true); const r = await fn(); setBusy(false);
    if (r.ok) { toast("ok", okText); router.refresh(); } else toast("err", r.data?.error || "Failed");
    return r.ok;
  }

  const trackedBedIds = new Set(turnaround.map((t: any) => t.bed_id));
  const startable = cleaningBeds.filter((b: any) => !trackedBedIds.has(b.id));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">Bed turnaround</h2>
        <span className="text-xs text-gray-400 tabular-nums">{turnaround.length} active</span>
      </div>
      {msg && <div className={`mb-2 text-sm rounded-lg px-3 py-1.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.text}</div>}

      {!configReady ? (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Apply migration <code className="bg-amber-100 px-1 rounded font-mono">049-bed-turnaround.sql</code> to track turnaround stages. Beds in cleaning status: {cleaningBeds.length}.</p>
      ) : (
        <>
          {turnaround.length === 0 && <p className="text-sm text-gray-400">No beds in turnaround.</p>}
          <ul className="space-y-3">
            {turnaround.map((t: any) => {
              const idx = ORDER.indexOf(t.stage);
              const atLast = idx >= ORDER.length - 2; // 'inspection' -> next is 'ready'
              return (
                <li key={t.id} className="rounded-lg border border-orange-200 bg-orange-50/40 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{t.op_beds?.label ?? "Bed"}{t.patient_label ? <span className="text-gray-400 font-normal"> · vacated by {t.patient_label}</span> : null}</span>
                    <button disabled={busy} onClick={() => act(() => call("PATCH", `/api/operations/bed-turnaround?id=${t.id}`), atLast ? "Bed ready & available" : "Stage advanced")}
                      className="text-[11px] font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-full px-2.5 py-0.5 shrink-0">{atLast ? "Mark ready" : "Advance"}</button>
                  </div>
                  {/* stepper */}
                  <div className="flex items-center gap-1 mt-2">
                    {ORDER.map((stg, i) => (
                      <span key={stg} className="flex items-center gap-1 flex-1 last:flex-none">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${i < idx ? "bg-teal-500" : i === idx ? "bg-orange-500 ring-2 ring-orange-200" : "bg-gray-200"}`} title={LABEL[stg]} />
                        {i < ORDER.length - 1 && <span className={`h-0.5 flex-1 ${i < idx ? "bg-teal-400" : "bg-gray-200"}`} />}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">Current: <span className="font-medium text-orange-700">{LABEL[t.stage] ?? t.stage}</span></p>
                </li>
              );
            })}
          </ul>

          {startable.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-end gap-2">
              <select className={input} value={bed} onChange={e => setBed(e.target.value)}>
                <option value="">Cleaning bed to track…</option>
                {startable.map((b: any) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
              <button disabled={busy || !bed} onClick={async () => { if (await act(() => call("POST", "/api/operations/bed-turnaround", { bed_id: bed, stage: "cleaning" }), "Turnaround started")) setBed(""); }}
                className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-1.5">Start turnaround</button>
            </div>
          )}
        </>
      )}
      <p className="text-[10px] text-gray-400 mt-3">Advancing to Ready returns the bed to the available pool automatically.</p>
    </div>
  );
}
