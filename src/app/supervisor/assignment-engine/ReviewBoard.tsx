"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// AE-001 review board (spec S4 steps 6-9): generate → review each explainable
// proposal → untick to keep the current allocation → supply override reasons
// where required → publish. One bad pair never blocks the rest.
/* eslint-disable @typescript-eslint/no-explicit-any */

const btn = "px-3.5 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function ReviewBoard({ run }: { run: any | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const proposals: any[] = useMemo(() => (run?.proposals ?? []) as any[], [run]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() => Object.fromEntries(proposals.map((p: any) => [p.patient_id, true])));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  async function post(body: any) {
    setBusy(true); setErr(null); setOk(null);
    const r = await fetch("/api/operations/assignment-engine", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return null; }
    return d;
  }

  async function generate() {
    const d = await post({ action: "generate" });
    if (d) { setOk(`Generated ${d.proposals?.length ?? 0} proposals${d.migrationMissing ? " (run not persisted — apply migration 155 for the decision record)" : ""}.`); router.refresh(); }
  }

  async function publish() {
    const pairs = proposals
      .filter((p: any) => accepted[p.patient_id])
      .map((p: any) => ({ patient_id: p.patient_id, staff_id: p.staff_id, override_reason: reasons[p.patient_id] || undefined }));
    if (!pairs.length) { setErr("Nothing selected to publish."); return; }
    const missing = proposals.filter((p: any) => accepted[p.patient_id] && p.needs_override && !reasons[p.patient_id]?.trim());
    if (missing.length) { setErr(`Override reason required for: ${missing.map((p: any) => p.patient).join(", ")}`); return; }
    const d = await post({ action: "publish", run_id: run?.id ?? undefined, pairs, notes });
    if (d) { setOk(`Published ${d.published}/${pairs.length}${d.failed ? ` — ${d.failed} failed (see run record)` : ""}.`); router.refresh(); }
  }

  async function discard() {
    const d = await post({ action: "discard", run_id: run.id, notes });
    if (d) { setOk("Run discarded."); router.refresh(); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={busy} onClick={generate}>⚙️ Generate recommendation</button>
        {run?.status === "generated" && (
          <>
            <input className={`${input} flex-1 min-w-[220px]`} placeholder="Decision notes (professional judgement — recorded on the run)" value={notes} onChange={e => setNotes(e.target.value)} />
            <button className={btn} disabled={busy} onClick={publish}>✅ Publish selected</button>
            <button className={btnGhost} disabled={busy} onClick={discard}>Discard run</button>
          </>
        )}
      </div>
      {err && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{err}</p>}
      {ok && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{ok}</p>}

      {run?.status === "generated" && proposals.length > 0 && (
        <div className="divide-y divide-gray-100">
          {proposals.map((p: any) => (
            <div key={p.patient_id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input type="checkbox" checked={!!accepted[p.patient_id]} onChange={e => setAccepted({ ...accepted, [p.patient_id]: e.target.checked })} />
                <span className="font-medium text-gray-800">{p.patient}</span>
                {p.bed && <span className="text-xs text-gray-400">{p.bed}</span>}
                <span className="text-gray-400 text-sm">→</span>
                <span className="text-sm font-medium text-teal-700">{p.nurse}</span>
                {p.continuity && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Continuity</span>}
                {p.needs_override && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Override required</span>}
                {(p.flags ?? []).includes("isolation") && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">Isolation</span>}
                <span className="ml-auto text-xs tabular-nums text-gray-500">nurse load {p.load_after}%</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 pl-6">{p.explanation}</p>
              {p.needs_override && accepted[p.patient_id] && (
                <input className={`${input} mt-1 ml-6 w-full max-w-md`} placeholder="Override reason (required — nurse has no current validated competency)"
                  value={reasons[p.patient_id] ?? ""} onChange={e => setReasons({ ...reasons, [p.patient_id]: e.target.value })} />
              )}
            </div>
          ))}
          <p className="text-[11px] text-gray-400 pt-2">Unticked rows keep their current allocation. Publishing writes real assignments, notifies each nurse, and stamps this run&apos;s decision trail.</p>
        </div>
      )}
    </div>
  );
}
