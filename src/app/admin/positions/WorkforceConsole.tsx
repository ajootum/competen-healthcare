"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WORKSPACES = [
  { key: "nurse", label: "Healthcare Worker" },
  { key: "assessor", label: "Assessor" },
  { key: "educator", label: "Educator" },
  { key: "hospital_admin", label: "Organisation Admin" },
];
const CATEGORIES = ["clinical", "education", "assessment", "leadership", "administration", "quality", "other"];
const LEVELS = ["junior", "staff", "senior", "manager", "executive"];
const CYCLE_TYPES = ["orientation", "probation", "annual", "remediation", "specialty"];
const PROGRAMMES = ["recruitment", "orientation", "probation", "annual", "specialty", "remediation", "return_to_practice", "leadership"];
const TABS = ["Assign", "Library", "Templates", "Positions", "Assignments"] as const;

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

const card = "bg-white rounded-xl border border-gray-200 p-5";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const btn = "px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50";
const btnGhost = "px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50";

type UI = { busy: boolean; setBusy: (b: boolean) => void; toast: (k: "ok" | "err", t: string) => void; refresh: () => void };
type TabProps = { data: any; support: any; ui: UI };

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-gray-300 text-gray-600 hover:border-teal-400"}`}>
      {label}
    </button>
  );
}

// ── Assign & Provision ────────────────────────────────────────────────────────
function AssignTab({ data, support, ui }: TabProps) {
  const [employeeId, setEmployeeId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [type, setType] = useState("permanent");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pipeline, setPipeline] = useState<any | null>(null);

  async function submit() {
    if (!employeeId || !positionId) { ui.toast("err", "Pick an employee and a position"); return; }
    ui.setBusy(true); setPipeline(null);
    const r = await call("POST", "/api/workforce/assignments", {
      employee_id: employeeId, position_id: positionId, assignment_type: type,
      effective_from: from || undefined, effective_to: to || undefined,
    });
    ui.setBusy(false);
    if (r.ok) { setPipeline(r.data); ui.toast("ok", `Provisioning ${r.data.status}`); ui.refresh(); }
    else { setPipeline(r.data?.steps ? r.data : null); ui.toast("err", r.data?.error || r.data?.steps?.find((s: any) => !s.ok)?.detail || "Assignment failed"); }
  }

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-1">Assign employee to a position</h3>
        <p className="text-xs text-gray-500 mb-4">One action provisions workspaces, competencies, learning, assessments, passport &amp; notifications.</p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-gray-600">Employee</span>
            <select className={input} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Select employee…</option>
              {support.employees.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">Position</span>
            <select className={input} value={positionId} onChange={e => setPositionId(e.target.value)}>
              <option value="">Select position…</option>
              {data.positions.map((p: any) => <option key={p.id} value={p.id}>{p.title}{p.departments?.name ? ` · ${p.departments.name}` : ""}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-sm">
              <span className="text-gray-600">Type</span>
              <select className={input} value={type} onChange={e => setType(e.target.value)}>
                {["permanent", "temporary", "secondary", "acting"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">From</span>
              <input type="date" className={input} value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">To {(type === "temporary" || type === "acting") && <span className="text-red-500">*</span>}</span>
              <input type="date" className={input} value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>
          <button className={btn} disabled={ui.busy} onClick={submit}>{ui.busy ? "Provisioning…" : "Assign & provision"}</button>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Provisioning pipeline</h3>
        {!pipeline && <p className="text-sm text-gray-400">Run an assignment to see each step provision in real time.</p>}
        {pipeline && (
          <div className="space-y-1.5">
            {(pipeline.steps ?? []).map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={s.ok ? "text-green-600" : "text-red-500"}>{s.ok ? "✓" : "✕"}</span>
                <span className="font-medium text-gray-800 capitalize w-28 shrink-0">{s.step}</span>
                <span className="text-gray-500 text-xs pt-0.5">{s.detail}</span>
              </div>
            ))}
            <div className="mt-3 pt-2 border-t text-xs">
              Result: <span className={pipeline.status === "complete" ? "text-green-600 font-semibold" : pipeline.status === "partial" ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"}>{pipeline.status}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Library ───────────────────────────────────────────────────────────────────
function LibraryTab({ data, ui }: TabProps) {
  const [name, setName] = useState(""); const [category, setCategory] = useState("clinical"); const [level, setLevel] = useState("staff"); const [specialty, setSpecialty] = useState("");
  async function add() {
    if (!name.trim()) return;
    ui.setBusy(true);
    const r = await call("POST", "/api/workforce/position-library", { name, category, level, specialty });
    ui.setBusy(false);
    if (r.ok) { setName(""); setSpecialty(""); ui.toast("ok", "Role added to library"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  return (
    <div className="grid md:grid-cols-3 gap-5">
      <div className={`${card} md:col-span-1`}>
        <h3 className="font-semibold text-gray-900 mb-3">Add approved role</h3>
        <div className="space-y-3">
          <input className={input} placeholder="Role name (e.g. ICU Staff Nurse)" value={name} onChange={e => setName(e.target.value)} />
          <input className={input} placeholder="Specialty (optional)" value={specialty} onChange={e => setSpecialty(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
            <select className={input} value={level} onChange={e => setLevel(e.target.value)}>{LEVELS.map(l => <option key={l}>{l}</option>)}</select>
          </div>
          <button className={btn} disabled={ui.busy} onClick={add}>Add role</button>
        </div>
      </div>
      <div className={`${card} md:col-span-2`}>
        <h3 className="font-semibold text-gray-900 mb-3">Position library ({data.library.length})</h3>
        <div className="divide-y">
          {data.library.length === 0 && <p className="text-sm text-gray-400">No roles yet.</p>}
          {data.library.map((l: any) => (
            <div key={l.id} className="py-2.5 flex items-center gap-3">
              <span className="font-medium text-gray-800 text-sm">{l.name}</span>
              <span className="text-xs text-gray-400">{l.category} · {l.level}{l.specialty ? ` · ${l.specialty}` : ""}</span>
              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${l.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{l.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────
function TemplatesTab({ data, support, ui }: TabProps) {
  const [libId, setLibId] = useState(data.library[0]?.id ?? "");
  const [ws, setWs] = useState<string[]>(["nurse"]);
  const [fws, setFws] = useState<string[]>([]);
  const [ress, setRess] = useState<string[]>([]);
  const [cpus, setCpus] = useState<string[]>([]);
  const [assessors, setAssessors] = useState<string[]>([]);
  const [cycleType, setCycleType] = useState("orientation");
  const [programme, setProgramme] = useState("orientation");
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const versions = data.templates.filter((t: any) => t.position_library_id === libId);

  async function create() {
    if (!libId) { ui.toast("err", "Add a library role first"); return; }
    ui.setBusy(true);
    const r = await call("POST", "/api/workforce/position-templates", { position_library_id: libId, workspaces: ws, framework_ids: fws, resource_ids: ress, cpu_ids: cpus, assessor_ids: assessors, cycle_type: cycleType, assessment_programme: programme });
    ui.setBusy(false);
    if (r.ok) { ui.toast("ok", `Template v${r.data.version} created (draft)`); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function publish(id: string) {
    ui.setBusy(true);
    const r = await call("PATCH", `/api/workforce/position-templates?id=${id}&action=publish`);
    ui.setBusy(false);
    if (r.ok) { ui.toast("ok", "Template published — positions can now use it"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Build a template version</h3>
        <label className="block text-sm mb-3">
          <span className="text-gray-600">Library role</span>
          <select className={input} value={libId} onChange={e => setLibId(e.target.value)}>
            <option value="">Select role…</option>
            {data.library.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <div className="space-y-3">
          <div><p className="text-xs font-medium text-gray-600 mb-1.5">Workspaces provisioned</p><div className="flex flex-wrap gap-1.5">{WORKSPACES.map(w => <Chip key={w.key} on={ws.includes(w.key)} label={w.label} onClick={() => toggle(ws, setWs, w.key)} />)}</div></div>
          <div><p className="text-xs font-medium text-gray-600 mb-1.5">Competency frameworks</p><div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">{support.frameworks.map((f: any) => <Chip key={f.id} on={fws.includes(f.id)} label={f.name} onClick={() => toggle(fws, setFws, f.id)} />)}{support.frameworks.length === 0 && <span className="text-xs text-gray-400">No frameworks</span>}</div></div>
          <div><p className="text-xs font-medium text-gray-600 mb-1.5">Learning resources</p><div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">{support.resources.map((r: any) => <Chip key={r.id} on={ress.includes(r.id)} label={r.title} onClick={() => toggle(ress, setRess, r.id)} />)}{support.resources.length === 0 && <span className="text-xs text-gray-400">No resources</span>}</div></div>
          <div><p className="text-xs font-medium text-gray-600 mb-1.5">Assessment CPUs</p><div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">{support.cpus.map((c: any) => <Chip key={c.id} on={cpus.includes(c.id)} label={c.name} onClick={() => toggle(cpus, setCpus, c.id)} />)}{support.cpus.length === 0 && <span className="text-xs text-gray-400">No CPUs</span>}</div></div>
          <div><p className="text-xs font-medium text-gray-600 mb-1.5">Default assessors</p><div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">{support.assessors.map((a: any) => <Chip key={a.id} on={assessors.includes(a.id)} label={a.full_name} onClick={() => toggle(assessors, setAssessors, a.id)} />)}{support.assessors.length === 0 && <span className="text-xs text-gray-400">No assessors</span>}</div></div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm"><span className="text-gray-600 text-xs">Cycle type</span><select className={input} value={cycleType} onChange={e => setCycleType(e.target.value)}>{CYCLE_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
            <label className="block text-sm"><span className="text-gray-600 text-xs">Assessment programme</span><select className={input} value={programme} onChange={e => setProgramme(e.target.value)}>{PROGRAMMES.map(t => <option key={t}>{t}</option>)}</select></label>
          </div>
          <button className={btn} disabled={ui.busy} onClick={create}>Create template version</button>
        </div>
      </div>
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Versions</h3>
        <div className="divide-y">
          {versions.length === 0 && <p className="text-sm text-gray-400">No templates for this role yet.</p>}
          {versions.map((t: any) => (
            <div key={t.id} className="py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 text-sm">v{t.version}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.status === "active" ? "bg-green-100 text-green-700" : t.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{t.status}</span>
                {t.status === "draft" && <button className={`${btnGhost} ml-auto`} disabled={ui.busy} onClick={() => publish(t.id)}>Publish</button>}
              </div>
              <p className="text-xs text-gray-500 mt-1">Workspaces: {(t.workspaces ?? []).join(", ") || "none"} · {(t.framework_ids ?? []).length} framework(s) · {(t.resource_ids ?? []).length} resource(s) · {(t.cpu_ids ?? []).length} CPU(s)</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Positions ─────────────────────────────────────────────────────────────────
function PositionsTab({ data, support, ui }: TabProps) {
  const [title, setTitle] = useState(""); const [templateId, setTemplateId] = useState(""); const [deptId, setDeptId] = useState("");
  const activeTemplates = data.templates.filter((t: any) => t.status === "active");
  const libName = (t: any) => data.library.find((l: any) => l.id === t.position_library_id)?.name ?? "role";
  async function create() {
    if (!title.trim() || !templateId) { ui.toast("err", "Title and an active template are required"); return; }
    ui.setBusy(true);
    const r = await call("POST", "/api/workforce/positions", { title, template_id: templateId, department_id: deptId || undefined });
    ui.setBusy(false);
    if (r.ok) { setTitle(""); ui.toast("ok", "Position created"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  return (
    <div className="grid md:grid-cols-3 gap-5">
      <div className={`${card} md:col-span-1`}>
        <h3 className="font-semibold text-gray-900 mb-3">Create position</h3>
        <div className="space-y-3">
          <input className={input} placeholder="Position title" value={title} onChange={e => setTitle(e.target.value)} />
          <select className={input} value={templateId} onChange={e => setTemplateId(e.target.value)}>
            <option value="">Active template…</option>
            {activeTemplates.map((t: any) => <option key={t.id} value={t.id}>{libName(t)} · v{t.version}</option>)}
          </select>
          <select className={input} value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">Department (optional)…</option>
            {support.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className={btn} disabled={ui.busy} onClick={create}>Create position</button>
          {activeTemplates.length === 0 && <p className="text-xs text-amber-600">Publish a template first.</p>}
        </div>
      </div>
      <div className={`${card} md:col-span-2`}>
        <h3 className="font-semibold text-gray-900 mb-3">Positions ({data.positions.length})</h3>
        <div className="divide-y">
          {data.positions.length === 0 && <p className="text-sm text-gray-400">No positions yet.</p>}
          {data.positions.map((p: any) => (
            <div key={p.id} className="py-2.5 flex items-center gap-3">
              <span className="font-medium text-gray-800 text-sm">{p.title}</span>
              <span className="text-xs text-gray-400">{p.departments?.name ?? "—"} · template v{p.position_templates?.version} · {(p.position_templates?.workspaces ?? []).join(", ")}</span>
              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${p.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Assignments ───────────────────────────────────────────────────────────────
function AssignmentsTab({ data, ui }: TabProps) {
  async function terminate(id: string) {
    ui.setBusy(true);
    const r = await call("PATCH", `/api/workforce/assignments?id=${id}`, { action: "terminate" });
    ui.setBusy(false);
    if (r.ok) { ui.toast("ok", "Assignment ended, workspaces archived"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  return (
    <div className={card}>
      <h3 className="font-semibold text-gray-900 mb-3">Assignments ({data.assignments.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Employee</th><th className="pr-3">Position</th><th className="pr-3">Type</th><th className="pr-3">Provisioning</th><th className="pr-3">Status</th><th></th></tr></thead>
          <tbody>
            {data.assignments.length === 0 && <tr><td colSpan={6} className="py-3 text-gray-400">No assignments yet.</td></tr>}
            {data.assignments.map((a: any) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="py-2.5 pr-3 font-medium text-gray-800">{a.profiles?.full_name ?? "—"}</td>
                <td className="pr-3 text-gray-600">{a.positions?.title ?? "—"}</td>
                <td className="pr-3 text-gray-500">{a.assignment_type}</td>
                <td className="pr-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${a.provisioning_status === "complete" ? "bg-green-100 text-green-700" : a.provisioning_status === "partial" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.provisioning_status}</span></td>
                <td className="pr-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${a.status === "active" ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-500"}`}>{a.status}</span></td>
                <td className="text-right">{a.status === "active" && <button className={btnGhost} disabled={ui.busy} onClick={() => terminate(a.id)}>End</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function WorkforceConsole({ ready, data, support }: { ready: boolean; data: any; support: any }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Assign");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const ui: UI = {
    busy, setBusy,
    toast: (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 6000); },
    refresh: () => router.refresh(),
  };

  if (!ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Positions &amp; Onboarding</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ One setup step remaining</p>
          <p className="text-sm text-amber-800 mt-2">The Workforce Assignment Engine needs its database tables. Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">037-workforce-assignment.sql</code> in the Supabase SQL editor, then reload this page.</p>
        </div>
      </div>
    );
  }

  const props: TabProps = { data, support, ui };
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Positions &amp; Onboarding</h1>
        <p className="text-sm text-gray-500 mt-1">Assign employees to positions — the Workforce Assignment Engine provisions their workspaces, competencies, learning, assessments and passport automatically.</p>
      </div>

      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>{msg.text}</div>}

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Assign" && <AssignTab {...props} />}
      {tab === "Library" && <LibraryTab {...props} />}
      {tab === "Templates" && <TemplatesTab {...props} />}
      {tab === "Positions" && <PositionsTab {...props} />}
      {tab === "Assignments" && <AssignmentsTab {...props} />}
    </div>
  );
}
