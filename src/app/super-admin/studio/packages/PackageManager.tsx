"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = [
  { v: "specialty", label: "Clinical Specialty" }, { v: "orientation", label: "Orientation" }, { v: "mandatory", label: "Mandatory Training" },
  { v: "role", label: "Role-based" }, { v: "leadership", label: "Leadership" }, { v: "accreditation", label: "Accreditation" },
  { v: "simulation", label: "Simulation" }, { v: "assessment", label: "Assessment" }, { v: "learning", label: "Learning Pathway" }, { v: "deployment", label: "Deployment" },
];
const ITEM_TYPES = [
  { v: "competency", label: "Competency" }, { v: "framework", label: "Framework" }, { v: "assessment", label: "Assessment" },
  { v: "cpu", label: "CPU" }, { v: "learning_pathway", label: "Learning path" }, { v: "checklist", label: "Checklist" }, { v: "skill", label: "Skill" },
];
const typeLabel = (t: string) => TYPES.find(x => x.v === t)?.label ?? t;
const itemLabel = (t: string) => ITEM_TYPES.find(x => x.v === t)?.label ?? t;
const STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", published: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-500 bg-gray-50 border-gray-200" };

export default function PackageManager({ packages, competencyOptions }: { packages: any[]; competencyOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("specialty");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [itemType, setItemType] = useState("competency");
  const [itemComp, setItemComp] = useState("");
  const [itemText, setItemText] = useState("");

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function create() {
    if (!name.trim()) { setErr("Name the package."); return; }
    if (await call("/api/studio/packages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, package_type: type, description: desc }) })) { setName(""); setDesc(""); setType("specialty"); }
  }
  const setStatus = (id: string, status: string) => call(`/api/studio/packages?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  const del = (id: string) => call(`/api/studio/packages?id=${id}`, { method: "DELETE" });
  const removeItem = (itemId: string) => call(`/api/studio/packages/items?id=${itemId}`, { method: "DELETE" });
  async function addItem(pkgId: string) {
    const isComp = itemType === "competency";
    const label = isComp ? (competencyOptions.find(o => o.id === itemComp)?.label ?? null) : (itemText.trim() || null);
    if (isComp && !itemComp) { setErr("Pick a competency."); return; }
    if (!isComp && !itemText.trim()) { setErr("Enter an item name."); return; }
    if (await call("/api/studio/packages/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package_id: pkgId, item_type: itemType, item_id: isComp ? itemComp : null, item_label: label }) })) { setItemComp(""); setItemText(""); }
  }

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      {/* Create */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Create a package</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Package name" className={`${inp} flex-1`} />
          <select value={type} onChange={e => setType(e.target.value)} className={`${inp} sm:w-48`}>{TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}</select>
          <button onClick={create} disabled={busy} className="text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg px-4 py-2 whitespace-nowrap">{busy ? "…" : "Create"}</button>
        </div>
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" className={`${inp} w-full mt-2`} />
        {err && <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">{err}</p>}
      </div>

      {/* Package list */}
      {packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-500">No packages yet — create one above, then add competencies and other assets to it.</div>
      ) : packages.map(p => (
        <div key={p.id} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setOpen(open === p.id ? null : p.id)} className="text-sm font-bold text-gray-900 hover:text-teal-700">{open === p.id ? "▾" : "▸"} {p.name}</button>
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{typeLabel(p.package_type)}</span>
            <span className="text-[10px] text-gray-500">v{p.version}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_TONE[p.status] ?? STATUS_TONE.draft}`}>{p.status}</span>
            <span className="text-[10px] text-gray-500">{p.itemCount} item{p.itemCount === 1 ? "" : "s"}</span>
            <div className="ml-auto flex items-center gap-1.5">
              {p.status !== "published" && <button onClick={() => setStatus(p.id, "published")} disabled={busy} className="text-[10px] font-semibold text-teal-700 hover:underline">Publish</button>}
              {p.status !== "archived" && <button onClick={() => setStatus(p.id, "archived")} disabled={busy} className="text-[10px] font-semibold text-gray-500 hover:underline">Archive</button>}
              {p.status === "archived" && <button onClick={() => setStatus(p.id, "draft")} disabled={busy} className="text-[10px] font-semibold text-gray-500 hover:underline">Restore</button>}
              <button onClick={() => del(p.id)} disabled={busy} className="text-gray-500 hover:text-red-500" title="Delete package">✕</button>
            </div>
          </div>
          {p.description && <p className="text-[11px] text-gray-500 mt-1 ml-4">{p.description}</p>}

          {open === p.id && (
            <div className="mt-3 ml-4 border-l-2 border-gray-50 pl-3">
              {p.items.length === 0 ? <p className="text-[11px] text-gray-500 mb-2">No items yet.</p> : (
                <div className="flex flex-col divide-y divide-gray-50 mb-2">
                  {p.items.map((it: any) => (
                    <div key={it.id} className="flex items-center gap-2 py-1.5 text-xs">
                      <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 w-24 text-center shrink-0">{itemLabel(it.item_type)}</span>
                      <span className="text-gray-700 truncate">{it.item_label ?? "Item"}</span>
                      {!it.is_required && <span className="text-[9px] text-gray-500">optional</span>}
                      <button onClick={() => removeItem(it.id)} disabled={busy} className="ml-auto text-gray-500 hover:text-red-500 shrink-0" title="Remove">✕</button>
                    </div>
                  ))}
                </div>
              )}
              {/* add item */}
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <select value={itemType} onChange={e => setItemType(e.target.value)} className={`${inp} sm:w-36`}>{ITEM_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}</select>
                {itemType === "competency"
                  ? <select value={itemComp} onChange={e => setItemComp(e.target.value)} className={`${inp} flex-1`}><option value="">Select competency…</option>{competencyOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                  : <input value={itemText} onChange={e => setItemText(e.target.value)} placeholder={`${itemLabel(itemType)} name`} className={`${inp} flex-1`} />}
                <button onClick={() => addItem(p.id)} disabled={busy} className="text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 rounded-lg px-3 py-2 whitespace-nowrap">Add item</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
