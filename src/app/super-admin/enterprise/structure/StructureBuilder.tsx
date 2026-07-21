"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Structure Builder (ENT-001 §4) — interactive Facility → Division → Department →
// Unit → Team tree with contextual create / edit / archive, plus the service
// catalogue. Not a flat list: select a node, act on it, add children.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Entity = "division" | "department" | "unit" | "team" | "service";
const ICON: Record<string, string> = { facility: "🏥", division: "🏢", department: "🗂️", unit: "🔹", team: "👥", service: "🩺" };
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

// Which fields each entity edits, so one modal serves all five.
const FIELDS: Record<Entity, string[]> = {
  division: ["name", "code", "leader"],
  department: ["name", "code", "dept_type", "cost_centre", "leader"],
  unit: ["name", "code", "unit_type", "specialty", "shift_model", "bed_count", "leader"],
  team: ["name", "code", "leader"],
  service: ["name", "category", "scope"],
};
const LEADER_LABEL: Record<Entity, string> = { division: "Director", department: "Head", unit: "Manager", team: "Lead", service: "" };
const LEADER_KEY: Record<Entity, string> = { division: "director_id", department: "head_id", unit: "manager_id", team: "lead_id", service: "" };

export default function StructureBuilder({ data }: { data: any }) {
  const router = useRouter();
  const { facilities, selected, facility, tree, services, staff, counts, ready } = data;
  const [sel, setSel] = useState<any>(null);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; entity: Entity; node?: any; parent?: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const toast = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };

  if (facilities.length === 0) return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">No facilities registered yet. Create one in the Facilities module first.</div>;

  const pickFacility = (id: string) => router.push(`/super-admin/enterprise/structure?facility=${id}`);

  async function setArchive(entity: Entity, node: any, action: "archive" | "restore") {
    if (action === "archive" && !confirm(`Archive "${node.name}"?`)) return;
    setBusy(true);
    const r = await fetch(`/api/enterprise/structure?entity=${entity}&id=${node.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(false);
    if (r.ok) { toast(action === "archive" ? "Archived" : "Restored"); setSel(null); router.refresh(); } else toast((await r.json().catch(() => ({}))).error ?? "Failed");
  }

  const Node = ({ node, entity, depth, addLabel, addEntity }: { node: any; entity: Entity; depth: number; addLabel?: string; addEntity?: Entity }) => {
    const active = sel?.id === node.id;
    return (
      <div onClick={() => setSel({ ...node, entity })}
        className={`group flex items-center gap-1.5 py-1.5 pr-2 rounded-md cursor-pointer ${active ? "bg-teal-50" : "hover:bg-gray-50"}`} style={{ paddingLeft: `${depth * 18 + 6}px` }}>
        <span className="text-sm leading-none">{ICON[entity]}</span>
        <span className={`text-sm truncate ${active ? "text-teal-800 font-medium" : "text-gray-700"}`}>{node.name}</span>
        {node.code && <span className="text-[10px] text-gray-400">{node.code}</span>}
        {node.status === "archived" && <span className="text-[9px] bg-gray-100 text-gray-500 rounded px-1">archived</span>}
        {addLabel && addEntity && (
          <button onClick={e => { e.stopPropagation(); setModal({ mode: "create", entity: addEntity, parent: node }); setErr(""); }}
            className="ml-auto opacity-0 group-hover:opacity-100 text-[11px] text-teal-600 hover:text-teal-800 shrink-0">+ {addLabel}</button>
        )}
      </div>
    );
  };

  const detail = sel && (() => {
    const e: Entity = sel.entity;
    const childBtn: Record<string, { label: string; entity: Entity } | null> = { division: { label: "Department", entity: "department" }, department: { label: "Unit", entity: "unit" }, unit: { label: "Team", entity: "team" }, team: null, service: null };
    const rows: [string, any][] = e === "division" ? [["Director", sel.director]]
      : e === "department" ? [["Type", sel.type], ["Head", sel.head], ["Cost centre", sel.costCentre]]
      : e === "unit" ? [["Type", sel.type], ["Specialty", sel.specialty], ["Manager", sel.manager], ["Beds", sel.beds], ["Shift model", sel.shiftModel]]
      : [["Lead", sel.lead]];
    const child = childBtn[e];
    return (
      <div>
        <div className="flex items-center gap-2 mb-2"><span className="text-lg">{ICON[e]}</span><h3 className="font-semibold text-gray-900 truncate">{sel.name}</h3></div>
        <p className="text-[11px] text-gray-400 mb-3 capitalize">{e}{sel.code ? ` · ${sel.code}` : ""}</p>
        <div className="text-sm space-y-1 mb-4">
          {rows.map(([l, v]) => <div key={l} className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">{l}</span><span className="text-gray-800 text-right">{v ?? <span className="text-gray-300">—</span>}</span></div>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {child && <button onClick={() => { setModal({ mode: "create", entity: child.entity, parent: sel }); setErr(""); }} className="text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 px-3 py-1.5">+ {child.label}</button>}
          <button onClick={() => { setModal({ mode: "edit", entity: e, node: sel }); setErr(""); }} className="text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5">Edit</button>
          {sel.status === "archived"
            ? <button onClick={() => setArchive(e, sel, "restore")} disabled={busy} className="text-xs font-medium rounded-lg border border-green-200 text-green-700 hover:bg-green-50 px-3 py-1.5">Restore</button>
            : <button onClick={() => setArchive(e, sel, "archive")} disabled={busy} className="text-xs font-medium rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 px-3 py-1.5">Archive</button>}
        </div>
      </div>
    );
  })();

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-gray-500">Facility</label>
        <select value={selected ?? ""} onChange={e => pickFacility(e.target.value)} className={`${input} w-64`}>
          {facilities.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <div className="flex items-center gap-3 text-[11px] text-gray-500 ml-2">
          {(["divisions", "departments", "units", "teams", "services"] as const).map(k => <span key={k}>{counts[k]} {k}</span>)}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setModal({ mode: "create", entity: "division", parent: { id: facility?.id, kind: "facility" } }); setErr(""); }} className="text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5">+ Division</button>
          <button onClick={() => { setModal({ mode: "create", entity: "department", parent: { id: facility?.id, kind: "facility" } }); setErr(""); }} className="text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 px-3 py-1.5">+ Department</button>
        </div>
      </div>
      {msg && <div className="text-sm rounded-lg px-3 py-1.5 bg-green-50 text-green-800">{msg}</div>}
      {!ready && <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900">Structure tables (divisions/teams) aren&apos;t provisioned — apply migration 052 to enable the full builder.</div>}

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Tree */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100"><span>{ICON.facility}</span><span className="font-semibold text-gray-900">{facility?.name}</span></div>
          <div className="max-h-[32rem] overflow-y-auto">
            {tree.divisions.length === 0 && tree.unassignedDepartments.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">No structure yet. Add a division or department to begin.</p>}
            {tree.divisions.map((v: any) => (
              <div key={v.id}>
                <Node node={v} entity="division" depth={0} addLabel="Dept" addEntity="department" />
                {v.departments.map((d: any) => <DeptBranch key={d.id} d={d} depth={1} NodeComp={Node} />)}
              </div>
            ))}
            {tree.unassignedDepartments.map((d: any) => <DeptBranch key={d.id} d={d} depth={0} NodeComp={Node} />)}
          </div>
        </div>

        {/* Detail */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[12rem]">
          {detail ?? <p className="text-sm text-gray-400 py-8 text-center">Select a node to view details and add children.</p>}
        </div>
      </div>

      {/* Service catalogue */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Service catalogue <span className="text-gray-400 font-normal text-sm">({services.length})</span></h3>
          <button onClick={() => { setModal({ mode: "create", entity: "service", parent: { id: facility?.id, kind: "facility" } }); setErr(""); }} className="text-xs font-semibold rounded-lg border border-teal-200 text-teal-700 hover:bg-teal-50 px-3 py-1.5">+ Service</button></div>
        {services.length === 0 ? <p className="text-sm text-gray-400">No services catalogued for this facility.</p> : (
          <div className="flex flex-wrap gap-2">{services.map((s: any) => <span key={s.id} className="text-xs bg-teal-50 text-teal-700 rounded-lg px-2.5 py-1">{s.name}{s.category ? <span className="text-teal-400"> · {s.category}</span> : null}</span>)}</div>
        )}
      </div>

      {modal && <EntityModal modal={modal} staff={staff} busy={busy} err={err}
        onClose={() => setModal(null)}
        onSave={async (payload: any) => {
          setBusy(true); setErr("");
          let r: Response;
          if (modal.mode === "create") {
            const body: any = { entity: modal.entity, ...payload };
            if (modal.entity === "division" || modal.entity === "department" || modal.entity === "service") body.hospital_id = facility?.id;
            if (modal.entity === "department" && modal.parent?.kind === "division") body.division_id = modal.parent.id;
            if (modal.entity === "unit") body.department_id = modal.parent?.id;
            if (modal.entity === "team") body.unit_id = modal.parent?.id;
            r = await fetch("/api/enterprise/structure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          } else {
            r = await fetch(`/api/enterprise/structure?entity=${modal.entity}&id=${modal.node.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          }
          setBusy(false);
          if (r.ok) { toast(modal.mode === "create" ? "Created" : "Saved"); setModal(null); setSel(null); router.refresh(); } else setErr((await r.json().catch(() => ({}))).error ?? "Failed");
        }} />}
    </div>
  );
}

function DeptBranch({ d, depth, NodeComp }: { d: any; depth: number; NodeComp: any }) {
  return (
    <div>
      <NodeComp node={d} entity="department" depth={depth} addLabel="Unit" addEntity="unit" />
      {d.units.map((u: any) => (
        <div key={u.id}>
          <NodeComp node={u} entity="unit" depth={depth + 1} addLabel="Team" addEntity="team" />
          {u.teams.map((t: any) => <NodeComp key={t.id} node={t} entity="team" depth={depth + 2} />)}
        </div>
      ))}
    </div>
  );
}

function EntityModal({ modal, staff, busy, err, onClose, onSave }: any) {
  const entity: Entity = modal.entity;
  const node = modal.node;
  const [form, setForm] = useState<any>(() => ({
    name: node?.name ?? "", code: node?.code ?? "", dept_type: node?.type ?? "", cost_centre: node?.costCentre ?? "",
    unit_type: node?.type ?? "", specialty: node?.specialty ?? "", shift_model: node?.shiftModel ?? "", bed_count: node?.beds ?? "",
    category: node?.category ?? "", scope: node?.scope ?? "", leader: node?.directorId ?? node?.headId ?? node?.managerId ?? node?.leadId ?? "",
  }));
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const fields = FIELDS[entity];

  function submit() {
    const payload: any = {};
    const put = (k: string) => { if (form[k] !== undefined && form[k] !== "") payload[k] = form[k]; else if (modal.mode === "edit") payload[k] = form[k] === "" ? null : form[k]; };
    if (fields.includes("name")) payload.name = form.name;
    for (const f of ["code", "dept_type", "cost_centre", "unit_type", "specialty", "shift_model", "bed_count", "category", "scope"]) if (fields.includes(f)) put(f);
    if (fields.includes("leader")) {
      if (modal.mode === "create") { if (form.leader) payload[LEADER_KEY[entity]] = form.leader; }
      else payload.leader_id = form.leader || null;
    }
    onSave(payload);
  }

  const title = `${modal.mode === "create" ? "Add" : "Edit"} ${entity}`;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900 capitalize">{title}</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button></div>
        <div className="p-6 flex flex-col gap-3">
          <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Name *</label><input value={form.name} onChange={set("name")} className={input} placeholder={`${entity} name`} /></div>
          {fields.includes("code") && <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Code</label><input value={form.code} onChange={set("code")} className={input} /></div>}
          {fields.includes("dept_type") && <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Department type</label><input value={form.dept_type} onChange={set("dept_type")} className={input} placeholder="clinical / admin" /></div>}
          {fields.includes("cost_centre") && <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Cost centre</label><input value={form.cost_centre} onChange={set("cost_centre")} className={input} /></div>}
          {fields.includes("unit_type") && <div className="grid grid-cols-2 gap-3"><div><label className="text-xs font-semibold text-gray-600 mb-1 block">Unit type</label><input value={form.unit_type} onChange={set("unit_type")} className={input} placeholder="Ward / ICU / Theatre" /></div><div><label className="text-xs font-semibold text-gray-600 mb-1 block">Beds</label><input type="number" value={form.bed_count} onChange={set("bed_count")} className={input} /></div></div>}
          {fields.includes("specialty") && <div className="grid grid-cols-2 gap-3"><div><label className="text-xs font-semibold text-gray-600 mb-1 block">Specialty</label><input value={form.specialty} onChange={set("specialty")} className={input} /></div><div><label className="text-xs font-semibold text-gray-600 mb-1 block">Shift model</label><input value={form.shift_model} onChange={set("shift_model")} className={input} placeholder="3-shift" /></div></div>}
          {fields.includes("category") && <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Category</label><input value={form.category} onChange={set("category")} className={input} placeholder="emergency / inpatient / lab…" /></div>}
          {fields.includes("scope") && <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Scope</label><input value={form.scope} onChange={set("scope")} className={input} /></div>}
          {fields.includes("leader") && <div><label className="text-xs font-semibold text-gray-600 mb-1 block">{LEADER_LABEL[entity]}</label><select value={form.leader} onChange={set("leader")} className={input}><option value="">— Unassigned —</option>{staff.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
          {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={busy || !form.name.trim()} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{busy ? "Saving…" : modal.mode === "create" ? "Create" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
