"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Competency & Framework Centre builder canvas (CKP-001.2) — real in-place
// architecture authoring. The three tabs follow the competency hierarchy:
// Framework → Domain → Competency, each wired to its live content API. Creating
// one level refreshes the pickers so you can immediately build the next level
// underneath it.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const LIBRARIES = ["core", "specialty", "role"];

type Picker = { id: string; label: string };

const TABS = [
  { key: "framework", label: "Framework", icon: "📐", hint: "Top of the hierarchy" },
  { key: "domain", label: "Domain", icon: "🗂️", hint: "Groups competencies inside a framework" },
  { key: "competency", label: "Competency", icon: "🎯", hint: "The unit of clinical capability" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ArchitectureBuilder({ frameworks, domains }: { frameworks: Picker[]; domains: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("framework");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  const ENDPOINT: Record<TabKey, string> = { framework: "/api/content/frameworks", domain: "/api/content/domains", competency: "/api/content/competencies" };
  const REQUIRED: Record<TabKey, string[]> = { framework: ["name", "library"], domain: ["name", "framework_id"], competency: ["name", "domain_id"] };

  async function create() {
    for (const r of REQUIRED[tab]) if (!String(form[r] ?? "").trim()) { toast("err", `${r.replace("_id", "").replace("_", " ")} is required`); return; }
    setBusy(true);
    const r = await fetch(ENDPOINT[tab], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (r.ok) { toast("ok", `${TABS.find(t => t.key === tab)!.label} created`); setForm({}); router.refresh(); }
    else toast("err", (await r.json().catch(() => ({}))).error ?? "Failed to create");
  }

  const active = TABS.find(t => t.key === tab)!;

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Architecture Builder</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex items-center gap-1">
          {TABS.map((t, i) => (
            <div key={t.key} className="flex items-center gap-1">
              <button onClick={() => switchTab(t.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === t.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{t.icon} {t.label}</button>
              {i < TABS.length - 1 && <span className="text-gray-300 text-xs">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="p-5">
        <p className="text-[11px] text-gray-400 mb-3">{active.icon} {active.hint}.</p>

        {tab === "framework" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Critical Care Framework" /></div>
            <div><label className={label}>Library *</label><select value={form.library ?? "core"} onChange={set("library")} className={input}>{LIBRARIES.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={3} className={input} /></div>
          </div>
        )}

        {tab === "domain" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Framework *</label><select value={form.framework_id ?? ""} onChange={set("framework_id")} className={input}><option value="">— Select framework —</option>{frameworks.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
            <div><label className={label}>Domain name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Haemodynamic Monitoring" /></div>
            {frameworks.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No frameworks yet — create a framework first.</p>}
          </div>
        )}

        {tab === "competency" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Domain *</label><select value={form.domain_id ?? ""} onChange={set("domain_id")} className={input}><option value="">— Select domain —</option>{domains.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></div>
            <div><label className={label}>Competency name *</label><input value={form.name ?? ""} onChange={set("name")} className={input} placeholder="e.g. Interpret arterial blood gases" /></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={3} className={input} /></div>
            {domains.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No domains yet — create a framework and a domain first.</p>}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={create} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Creating…" : `Create ${active.label.toLowerCase()}`}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Builds real architecture via the content API.</span>
        </div>
      </div>
    </div>
  );
}
