"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Risk & Internal Controls canvas (GOV-001.4) — real in-place ERM actions via
// /api/governance/risks (kind-discriminated):
//   Register Risk  → POST kind=risk   (5×5 likelihood×impact with a live
//                    inherent-score preview; treatment; review date)
//   Add Control    → POST kind=control (type/frequency/linked risk)
//   Update Risk    → PATCH kind=risk   (status, residual scoring, mitigation)
//   Rate Control   → PATCH kind=control (effectiveness + last tested)
// Tenant scope bound server-side; every write audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const CATEGORIES = ["strategic", "operational", "clinical", "workforce", "financial", "technology", "cybersecurity", "legal", "regulatory", "data_protection", "ai", "reputation", "business_continuity", "third_party"];
const TREATMENTS = ["avoid", "reduce", "transfer", "accept", "monitor", "escalate"];
const RISK_STATUSES = ["open", "mitigating", "accepted", "escalated", "closed"];
const CONTROL_TYPES = ["preventive", "detective", "corrective"];
const FREQUENCIES = ["continuous", "daily", "weekly", "monthly", "quarterly", "annual"];
const EFFECTIVENESS = ["effective", "partially_effective", "ineffective", "not_tested"];
const SCALE = [1, 2, 3, 4, 5];

const band = (s: number) => (s >= 16 ? "critical" : s >= 10 ? "high" : s >= 5 ? "medium" : "low");
const BAND_TONE: Record<string, string> = { low: "bg-green-50 text-green-700", medium: "bg-amber-50 text-amber-700", high: "bg-orange-50 text-orange-700", critical: "bg-rose-50 text-rose-700" };

type Picker = { id: string; label: string };

const TABS = [
  { key: "risk", label: "Register Risk", icon: "⚠️" },
  { key: "control", label: "Add Control", icon: "🛡️" },
  { key: "update", label: "Update Risk", icon: "✏️" },
  { key: "rate", label: "Rate Control", icon: "🧪" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function RiskCenter({ risks, controls }: { risks: Picker[]; controls: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("risk");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  const inherent = (Number(form.likelihood) || 3) * (Number(form.impact) || 3);
  const residual = form.residual_likelihood && form.residual_impact ? Number(form.residual_likelihood) * Number(form.residual_impact) : null;

  async function act() {
    let url = "/api/governance/risks", method = "POST", body: any = {}, missing = "", okText = "";
    if (tab === "risk") {
      if (!String(form.title ?? "").trim()) missing = "title";
      body = { kind: "risk", title: form.title, description: form.description || undefined, category: form.category || "operational", likelihood: Number(form.likelihood) || 3, impact: Number(form.impact) || 3, treatment: form.treatment || "reduce", mitigation: form.mitigation || undefined, review_date: form.review_date || undefined };
      okText = `Risk registered (inherent ${inherent} · ${band(inherent)})`;
    } else if (tab === "control") {
      if (!String(form.name ?? "").trim()) missing = "name";
      body = { kind: "control", name: form.name, objective: form.objective || undefined, control_type: form.control_type || "preventive", frequency: form.frequency || "continuous", risk_id: form.risk_id || undefined, testing_method: form.testing_method || undefined, evidence_required: form.evidence_required || undefined };
      okText = "Control added to the library";
    } else if (tab === "update") {
      if (!form.risk_id) missing = "risk";
      url = `/api/governance/risks?kind=risk&id=${encodeURIComponent(form.risk_id)}`;
      method = "PATCH";
      body = { status: form.status || undefined, residual_likelihood: form.residual_likelihood ? Number(form.residual_likelihood) : undefined, residual_impact: form.residual_impact ? Number(form.residual_impact) : undefined, mitigation: form.mitigation || undefined, review_date: form.review_date || undefined };
      if (!body.status && body.residual_likelihood === undefined && body.residual_impact === undefined && !body.mitigation && !body.review_date) missing = "at least one change";
      okText = residual != null ? `Risk updated (residual ${residual} · ${band(residual)})` : "Risk updated";
    } else {
      if (!form.control_id) missing = "control";
      else if (!form.effectiveness) missing = "effectiveness";
      url = `/api/governance/risks?kind=control&id=${encodeURIComponent(form.control_id)}`;
      method = "PATCH";
      body = { effectiveness: form.effectiveness, last_tested: form.last_tested || new Date().toISOString().slice(0, 10) };
      okText = `Control rated ${String(form.effectiveness ?? "").replace(/_/g, " ")}`;
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

  const scaleSelect = (k: string, lbl: string) => (
    <div><label className={label}>{lbl}</label><select value={form[k] ?? "3"} onChange={set(k)} className={input}>{SCALE.map(n => <option key={n} value={n}>{n}</option>)}</select></div>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Risk Center</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1 flex-wrap">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "risk" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Risk title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Single point of failure in ICU ventilation competence" /></div>
            <div><label className={label}>Category</label><select value={form.category ?? "operational"} onChange={set("category")} className={input}>{CATEGORIES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
            <div className="grid grid-cols-3 gap-3 items-end">
              {scaleSelect("likelihood", "Likelihood (1–5)")}
              {scaleSelect("impact", "Impact (1–5)")}
              <div className="text-center pb-1"><span className={`text-xs font-bold px-2 py-1 rounded ${BAND_TONE[band(inherent)]}`}>{inherent} · {band(inherent)}</span><p className="text-[9px] text-gray-400 mt-0.5">inherent</p></div>
            </div>
            <div><label className={label}>Treatment</label><select value={form.treatment ?? "reduce"} onChange={set("treatment")} className={input}>{TREATMENTS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={2} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Mitigation plan</label><textarea value={form.mitigation ?? ""} onChange={set("mitigation")} rows={2} className={input} /></div>
            <div><label className={label}>Review date</label><input type="date" value={form.review_date ?? ""} onChange={set("review_date")} className={input} /></div>
          </div>
        )}

        {tab === "control" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Control name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Dual sign-off on high-risk medication" /></div>
            <div><label className={label}>Linked risk</label><select value={form.risk_id ?? ""} onChange={set("risk_id")} className={input}><option value="">— None —</option>{risks.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
            <div><label className={label}>Type</label><select value={form.control_type ?? "preventive"} onChange={set("control_type")} className={input}>{CONTROL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className={label}>Frequency</label><select value={form.frequency ?? "continuous"} onChange={set("frequency")} className={input}>{FREQUENCIES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Objective</label><textarea value={form.objective ?? ""} onChange={set("objective")} rows={2} className={input} /></div>
            <div><label className={label}>Testing method</label><input value={form.testing_method ?? ""} onChange={set("testing_method")} className={input} placeholder="e.g. Quarterly sample audit" /></div>
            <div><label className={label}>Evidence required</label><input value={form.evidence_required ?? ""} onChange={set("evidence_required")} className={input} /></div>
          </div>
        )}

        {tab === "update" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Risk *</label><select value={form.risk_id ?? ""} onChange={set("risk_id")} className={input}><option value="">— Select risk —</option>{risks.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
            <div><label className={label}>Status</label><select value={form.status ?? ""} onChange={set("status")} className={input}><option value="">— Unchanged —</option>{RISK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div><label className={label}>Residual likelihood</label><select value={form.residual_likelihood ?? ""} onChange={set("residual_likelihood")} className={input}><option value="">—</option>{SCALE.map(n => <option key={n} value={n}>{n}</option>)}</select></div>
              <div><label className={label}>Residual impact</label><select value={form.residual_impact ?? ""} onChange={set("residual_impact")} className={input}><option value="">—</option>{SCALE.map(n => <option key={n} value={n}>{n}</option>)}</select></div>
              <div className="text-center pb-1">{residual != null ? <span className={`text-xs font-bold px-2 py-1 rounded ${BAND_TONE[band(residual)]}`}>{residual} · {band(residual)}</span> : <span className="text-[10px] text-gray-300">residual</span>}</div>
            </div>
            <div><label className={label}>Review date</label><input type="date" value={form.review_date ?? ""} onChange={set("review_date")} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Mitigation update</label><textarea value={form.mitigation ?? ""} onChange={set("mitigation")} rows={2} className={input} /></div>
            {risks.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No open risks yet — register one first.</p>}
          </div>
        )}

        {tab === "rate" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Control *</label><select value={form.control_id ?? ""} onChange={set("control_id")} className={input}><option value="">— Select control —</option>{controls.map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}</select></div>
            <div><label className={label}>Effectiveness *</label><select value={form.effectiveness ?? ""} onChange={set("effectiveness")} className={input}><option value="">— Select rating —</option>{EFFECTIVENESS.map(e => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}</select></div>
            <div><label className={label}>Test date</label><input type="date" value={form.last_tested ?? ""} onChange={set("last_tested")} className={input} /></div>
            {controls.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No controls in the library yet — add one first.</p>}
            <p className="sm:col-span-2 text-[11px] text-gray-400">Rating a control records the test outcome (defaults to today when no date given).</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : TABS.find(t => t.key === tab)!.label}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real ERM actions — audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
