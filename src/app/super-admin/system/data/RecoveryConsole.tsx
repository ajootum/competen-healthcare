"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Data Protection & Recovery console (SYS-001.5) — real in-place resilience
// actions via /api/system/recovery. Log Event schedules a DR test / restore
// request / backup verification / privacy request / retention review (restore
// and privacy requests REQUIRE a reason, per the spec's authorization capture);
// Record Outcome closes it with pass/partial/fail and the measured RPO/RTO
// (recording a non-pending outcome forces completion). All audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const KINDS: Record<string, string> = { dr_test: "DR exercise", restore_request: "Restore request", backup_verification: "Backup verification", privacy_request: "Privacy request", retention_review: "Retention review" };
const OUTCOMES: Record<string, string> = { passed: "Passed", partial: "Partial", failed: "Failed" };

type Picker = { id: string; label: string };

const TABS = [
  { key: "log", label: "Log Event", icon: "🧪" },
  { key: "outcome", label: "Record Outcome", icon: "✅" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function RecoveryConsole({ openEvents }: { openEvents: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("log");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  const needsReason = form.kind === "restore_request" || form.kind === "privacy_request";

  async function act() {
    let url = "", method = "POST", body: any = {}, missing = "", okText = "";
    if (tab === "log") {
      if (!String(form.title ?? "").trim()) missing = "title";
      else if (needsReason && !String(form.reason ?? "").trim()) missing = "reason";
      url = "/api/system/recovery";
      body = { kind: form.kind || "dr_test", title: form.title, scope: form.scope || undefined, reason: form.reason || undefined, rpo_target_min: form.rpo_target_min || undefined, rto_target_min: form.rto_target_min || undefined };
      okText = `${KINDS[form.kind || "dr_test"]} logged`;
    } else {
      if (!form.event_id) missing = "event";
      else if (!form.outcome) missing = "outcome";
      url = `/api/system/recovery?id=${encodeURIComponent(form.event_id)}`;
      method = "PATCH";
      body = { outcome: form.outcome, rpo_actual_min: form.rpo_actual_min || undefined, rto_actual_min: form.rto_actual_min || undefined, outcome_note: form.outcome_note || undefined };
      okText = `Outcome recorded: ${OUTCOMES[form.outcome] ?? form.outcome}`;
    }
    if (missing) { toast("err", `${missing} is required`); return; }

    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) { toast("ok", okText); setForm({}); router.refresh(); }
      else toast("err", (await r.json().catch(() => ({}))).error ?? "Action failed");
    } catch { toast("err", "Network error — nothing was changed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Recovery Console</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "log" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Event type</label><select value={form.kind ?? "dr_test"} onChange={set("kind")} className={input}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Q3 full-platform restore drill" /></div>
            <div className="sm:col-span-2"><label className={label}>Scope</label><input value={form.scope ?? ""} onChange={set("scope")} className={input} placeholder="Service / dataset / tenant in scope" /></div>
            <div><label className={label}>RPO target (min)</label><input type="number" value={form.rpo_target_min ?? ""} onChange={set("rpo_target_min")} className={input} placeholder="15" /></div>
            <div><label className={label}>RTO target (min)</label><input type="number" value={form.rto_target_min ?? ""} onChange={set("rto_target_min")} className={input} placeholder="120" /></div>
            {needsReason && (
              <div className="sm:col-span-2"><label className={label}>Reason / authorization *</label><textarea value={form.reason ?? ""} onChange={set("reason")} rows={2} className={input} placeholder="Why this restore/privacy action, on whose authority, and any legal/clinical retention constraints" /></div>
            )}
          </div>
        )}

        {tab === "outcome" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Event *</label><select value={form.event_id ?? ""} onChange={set("event_id")} className={input}><option value="">— Select open event —</option>{openEvents.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select></div>
            <div><label className={label}>Outcome *</label><select value={form.outcome ?? ""} onChange={set("outcome")} className={input}><option value="">— Select outcome —</option>{Object.entries(OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>RPO actual (min)</label><input type="number" value={form.rpo_actual_min ?? ""} onChange={set("rpo_actual_min")} className={input} placeholder="12" /></div>
            <div><label className={label}>RTO actual (min)</label><input type="number" value={form.rto_actual_min ?? ""} onChange={set("rto_actual_min")} className={input} placeholder="95" /></div>
            <div className="sm:col-span-2"><label className={label}>Outcome note</label><textarea value={form.outcome_note ?? ""} onChange={set("outcome_note")} rows={2} className={input} placeholder="What was validated, any gaps, remediation" /></div>
            {openEvents.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No open events — log one first.</p>}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : TABS.find(t => t.key === tab)!.label}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real resilience evidence — audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
