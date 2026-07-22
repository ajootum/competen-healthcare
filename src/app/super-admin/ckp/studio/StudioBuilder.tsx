"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Knowledge Studio builder canvas (CKP-001.1) — real in-Studio authoring. Each
// tab is a working builder that creates a live asset through the existing
// content APIs (knowledge-objects, competencies, frameworks, policies).
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const KO_TYPES = ["anatomy", "physiology", "pathophysiology", "pharmacology", "classification", "assessment_tool", "clinical_reasoning", "procedure", "evidence", "other"];
const POLICY_TYPES = ["clinical", "hr", "safety", "governance", "infection_control", "quality"];
const LIBRARIES = ["core", "specialty", "role"];

const BUILDERS = [
  { key: "cko", label: "CKO", icon: "🧠" },
  { key: "competency", label: "Competency", icon: "🎯" },
  { key: "framework", label: "Framework", icon: "📐" },
  { key: "policy", label: "Policy", icon: "📋" },
] as const;

type BuilderKey = (typeof BUILDERS)[number]["key"];

export default function StudioBuilder({ domains }: { domains: { id: string; label: string }[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<BuilderKey>("cko");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };
  const switchTab = (k: BuilderKey) => { setTab(k); setForm({}); setMsg(null); };

  const ENDPOINT: Record<BuilderKey, string> = { cko: "/api/knowledge-objects", competency: "/api/content/competencies", framework: "/api/content/frameworks", policy: "/api/policies" };
  const REQUIRED: Record<BuilderKey, string[]> = { cko: ["title"], competency: ["name", "domain_id"], framework: ["name", "library"], policy: ["title"] };

  async function create() {
    for (const r of REQUIRED[tab]) if (!String(form[r] ?? "").trim()) { toast("err", `${r.replace("_", " ")} is required`); return; }
    setBusy(true);
    const body: any = { ...form };
    if (tab === "policy" && !body.version) body.version = "1.0";
    const r = await fetch(ENDPOINT[tab], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast("ok", `${BUILDERS.find(b => b.key === tab)!.label} created (draft)`); setForm({}); router.refresh(); }
    else toast("err", (await r.json().catch(() => ({}))).error ?? "Failed to create");
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Builder Canvas</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1">
          {BUILDERS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "cko" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Principles of Gait Assessment" /></div>
            <div><label className={label}>Knowledge type</label><select value={form.knowledge_type ?? "other"} onChange={set("knowledge_type")} className={input}>{KO_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Summary</label><textarea value={form.summary ?? ""} onChange={set("summary")} rows={2} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Content</label><textarea value={form.content ?? ""} onChange={set("content")} rows={4} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Source reference</label><input value={form.source_ref ?? ""} onChange={set("source_ref")} className={input} placeholder="Guideline / evidence citation" /></div>
          </div>
        )}

        {tab === "competency" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Safe medication administration" /></div>
            <div><label className={label}>Domain *</label><select value={form.domain_id ?? ""} onChange={set("domain_id")} className={input}><option value="">— Select domain —</option>{domains.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={3} className={input} /></div>
            {domains.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No domains yet — create a framework and add a domain first.</p>}
          </div>
        )}

        {tab === "framework" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Critical Care Framework" /></div>
            <div><label className={label}>Library *</label><select value={form.library ?? "core"} onChange={set("library")} className={input}>{LIBRARIES.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={3} className={input} /></div>
          </div>
        )}

        {tab === "policy" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Hand Hygiene Policy" /></div>
            <div><label className={label}>Policy type</label><select value={form.policy_type ?? "clinical"} onChange={set("policy_type")} className={input}>{POLICY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
            <div><label className={label}>Version</label><input value={form.version ?? ""} onChange={set("version")} className={input} placeholder="1.0" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Effective</label><input type="date" value={form.effective_date ?? ""} onChange={set("effective_date")} className={input} /></div>
              <div><label className={label}>Review</label><input type="date" value={form.review_date ?? ""} onChange={set("review_date")} className={input} /></div>
            </div>
            <div className="sm:col-span-2"><label className={label}>Content</label><textarea value={form.content ?? ""} onChange={set("content")} rows={4} className={input} /></div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={create} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Creating…" : "Create draft"}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Creates a real draft asset via the content API.</span>
        </div>
      </div>
    </div>
  );
}
