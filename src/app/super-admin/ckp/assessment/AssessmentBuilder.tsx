"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Assessment & Validation Centre builder canvas (CKP-001.4) — real in-place
// assessment authoring. Four tabs map onto the page's own KPIs, each wired to
// its live API: Question Bank + Skill Checklist (POST /api/studio, the studio
// authoring endpoint), Method Config (POST /api/content/methods, per-framework
// assessment_method_configs) and OSCE Exam (POST /api/osce/exams). New assets
// flow straight into the KPI counts and overview donut via router.refresh().
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

// assessment_method_configs.method is constrained to these 7 values (migration
// 007 CHECK) — deliberately NOT the wider 12-method ckcm METHOD_LABELS, which is
// the blueprint_methods vocabulary. Mirrors MethodsManager's option list.
const METHOD_OPTIONS: Record<string, string> = {
  knowledge: "Knowledge Assessment",
  direct_observation: "Direct Observation",
  simulation: "Simulation",
  osce: "OSCE",
  concurrent_audit: "Concurrent Audit",
  retrospective_audit: "Retrospective Audit",
  logbook: "Logbook",
};

// Send a number only when the field was actually filled (so an explicit 0 is
// kept and an empty field falls back to the server default).
const numOr = (v: any, fallback?: number) => (v === undefined || v === "" ? fallback : Number(v));

type Picker = { id: string; label: string };

const TABS = [
  { key: "bank", label: "Question Bank", icon: "🗂️" },
  { key: "checklist", label: "Skill Checklist", icon: "✅" },
  { key: "method", label: "Method Config", icon: "⚖️" },
  { key: "osce", label: "OSCE Exam", icon: "🩺" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function AssessmentBuilder({ cpus, skills, frameworks }: { cpus: Picker[]; skills: Picker[]; frameworks: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("bank");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  async function create() {
    let url = "", body: any = {}, missing = "";
    if (tab === "bank") {
      if (!String(form.name ?? "").trim()) missing = "name";
      url = "/api/studio";
      body = { kind: "question_bank", name: form.name, description: form.description || undefined, cpu_id: form.cpu_id || undefined, pass_mark: numOr(form.pass_mark), validity_months: numOr(form.validity_months) };
    } else if (tab === "checklist") {
      if (!String(form.name ?? "").trim()) missing = "name";
      else if (!form.skill_id) missing = "skill";
      url = "/api/studio";
      body = { kind: "checklist", name: form.name, skill_id: form.skill_id, description: form.description || undefined, assessor_instructions: form.assessor_instructions || undefined };
    } else if (tab === "method") {
      if (!form.framework_id) missing = "framework";
      else if (!form.method) missing = "method";
      url = "/api/content/methods";
      body = { framework_id: form.framework_id, method: form.method, is_required: (form.is_required ?? "yes") === "yes", min_assessors: numOr(form.min_assessors, 1), weight: numOr(form.weight, 1) };
    } else {
      if (!String(form.title ?? "").trim()) missing = "title";
      url = "/api/osce/exams";
      body = { title: form.title, programme: form.programme || undefined, exam_date: form.exam_date || undefined, notes: form.notes || undefined };
    }
    if (missing) { toast("err", `${missing} is required`); return; }

    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) { toast("ok", `${TABS.find(t => t.key === tab)!.label} created`); setForm({}); router.refresh(); }
      else toast("err", (await r.json().catch(() => ({}))).error ?? "Failed to create");
    } catch { toast("err", "Network error — nothing was created"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Assessment Builder</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1 flex-wrap">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "bank" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Airway Management MCQ Bank" /></div>
            <div><label className={label}>Linked CPU</label><select value={form.cpu_id ?? ""} onChange={set("cpu_id")} className={input}><option value="">— None —</option>{cpus.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            <div><label className={label}>Pass mark %</label><input type="number" value={form.pass_mark ?? ""} onChange={set("pass_mark")} className={input} placeholder="80" /></div>
            <div><label className={label}>Validity (months)</label><input type="number" value={form.validity_months ?? ""} onChange={set("validity_months")} className={input} placeholder="24" /></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={2} className={input} /></div>
          </div>
        )}

        {tab === "checklist" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Central Line Insertion Checklist" /></div>
            <div><label className={label}>Skill *</label><select value={form.skill_id ?? ""} onChange={set("skill_id")} className={input}><option value="">— Select skill —</option>{skills.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={2} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Assessor instructions</label><textarea value={form.assessor_instructions ?? ""} onChange={set("assessor_instructions")} rows={2} className={input} /></div>
            {skills.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No active skills yet — attach skills to competencies in the Skills studio first.</p>}
          </div>
        )}

        {tab === "method" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Framework *</label><select value={form.framework_id ?? ""} onChange={set("framework_id")} className={input}><option value="">— Select framework —</option>{frameworks.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
            <div><label className={label}>Method *</label><select value={form.method ?? ""} onChange={set("method")} className={input}><option value="">— Select method —</option>{Object.entries(METHOD_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Required</label><select value={form.is_required ?? "yes"} onChange={set("is_required")} className={input}><option value="yes">Required</option><option value="no">Optional</option></select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Min assessors</label><input type="number" value={form.min_assessors ?? ""} onChange={set("min_assessors")} className={input} placeholder="1" /></div>
              <div><label className={label}>Weight</label><input type="number" value={form.weight ?? ""} onChange={set("weight")} className={input} placeholder="1" /></div>
            </div>
          </div>
        )}

        {tab === "osce" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Critical Care OSCE — Q3" /></div>
            <div><label className={label}>Programme</label><input value={form.programme ?? ""} onChange={set("programme")} className={input} placeholder="e.g. ICU Orientation" /></div>
            <div><label className={label}>Exam date</label><input type="date" value={form.exam_date ?? ""} onChange={set("exam_date")} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Notes</label><textarea value={form.notes ?? ""} onChange={set("notes")} rows={2} className={input} /></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Creates the exam as a draft — add stations and candidates in the OSCE workspace.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={create} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Creating…" : `Create ${TABS.find(t => t.key === tab)!.label.toLowerCase()}`}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Creates a real assessment asset via the live APIs.</span>
        </div>
      </div>
    </div>
  );
}
