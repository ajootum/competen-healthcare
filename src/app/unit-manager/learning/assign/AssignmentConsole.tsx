"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Lightweight learning assignment console (LDS-001 / UMG-005). Create a course inline, assign it to an
// audience (a role or all unit staff — auto-creates one enrolment per matching staff), review recent
// assignments and mark enrolments complete/in-progress so the Learning Dashboard populates.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const input = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const STATUS_TONE: Record<string, string> = { completed: "bg-[var(--cmp-surface-success)] text-emerald-700", in_progress: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", not_started: "bg-gray-100 text-gray-600", overdue: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", exempt: "bg-gray-100 text-gray-500", failed: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" };

export default function AssignmentConsole({ courses, roles, assignments, enrolments }: { courses: any[]; roles: string[]; assignments: any[]; enrolments: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };
  const [courseId, setCourseId] = useState("");
  const [role, setRole] = useState("all");
  const [mandatory, setMandatory] = useState(true);
  const [due, setDue] = useState("");
  const [newCourse, setNewCourse] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newMandatory, setNewMandatory] = useState(true);

  async function post(body: any) {
    setBusy(true);
    const r = await fetch("/api/operations/learning-assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast("err", d?.error || "Failed"); return null; }
    return d;
  }
  async function createCourse() {
    if (!newTitle.trim()) { toast("err", "Course title required"); return; }
    const d = await post({ action: "create_course", title: newTitle, mandatory: newMandatory });
    if (d?.id) { toast("ok", "Course created"); setNewCourse(false); setNewTitle(""); setCourseId(d.id); router.refresh(); }
  }
  async function assign() {
    if (!courseId) { toast("err", "Select a course"); return; }
    const d = await post({ action: "assign", course_id: courseId, role, mandatory, due_date: due || null });
    if (d?.enrolled != null) { toast("ok", `Assigned — ${d.enrolled} staff enrolled`); setDue(""); router.refresh(); }
  }
  async function setStatus(id: string, action: string) {
    setBusy(true);
    const r = await fetch(`/api/operations/learning-assign?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(false);
    if (r.ok) { toast("ok", "Enrolment updated"); router.refresh(); }
    else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }

  return (
    <>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-[var(--cmp-color-success)] text-white" : "bg-[var(--cmp-color-error)] text-white"}`}>{msg.text}</div>}

      {/* Assign */}
      <div className={`${card} p-5`}>
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Assign learning</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="text-xs text-gray-500">Course
            <select className={input} value={courseId} onChange={e => setCourseId(e.target.value)}><option value="">— select course —</option>{courses.map(co => <option key={co.id} value={co.id}>{co.title}{co.mandatory ? " (mandatory)" : ""}</option>)}</select>
            <button type="button" onClick={() => setNewCourse(v => !v)} className="text-[11px] text-emerald-700 hover:underline mt-1">{newCourse ? "cancel" : "+ new course"}</button>
          </label>
          <label className="text-xs text-gray-500">Audience
            <select className={input} value={role} onChange={e => setRole(e.target.value)}><option value="all">All unit staff</option>{roles.map(r => <option key={r} value={r}>{tc(r)}</option>)}</select>
          </label>
          <label className="text-xs text-gray-500">Due date
            <input type="date" className={input} value={due} onChange={e => setDue(e.target.value)} />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={mandatory} onChange={e => setMandatory(e.target.checked)} /> Mandatory</label>
            <button onClick={assign} disabled={busy || !courseId} className="ml-auto text-sm rounded-lg bg-[var(--cmp-color-success)] text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">Assign</button>
          </div>
        </div>
        {newCourse && (
          <div className="mt-3 flex items-end gap-2 flex-wrap border-t border-gray-100 pt-3">
            <label className="text-xs text-gray-500 flex-1 min-w-[12rem]">New course title<input className={input} placeholder="e.g. Sepsis Management" value={newTitle} onChange={e => setNewTitle(e.target.value)} /></label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2"><input type="checkbox" checked={newMandatory} onChange={e => setNewMandatory(e.target.checked)} /> Mandatory</label>
            <button onClick={createCourse} disabled={busy || !newTitle.trim()} className="text-sm rounded-lg border border-[var(--cmp-color-success)] text-emerald-700 px-3.5 py-2 hover:bg-[var(--cmp-surface-success)] disabled:opacity-50">Create course</button>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">Assigning creates one enrolment per matching staff member (status not-started). Managers may assign approved learning (UMG-005).</p>
      </div>

      {/* Recent assignments + manage enrolments */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recent assignments</h3>
          {assignments.length === 0 ? <p className="text-sm text-gray-400">No assignments yet — assign learning above.</p> : (
            <div className="divide-y divide-gray-50">{assignments.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 py-2 text-xs"><div className="min-w-0"><p className="text-gray-800 truncate">{a.name}</p><p className="text-[10px] text-gray-400">{a.mandatory ? "Mandatory" : tc(a.type)} · {a.audience} · due {a.due ?? "—"}</p></div><span className="text-gray-500 shrink-0 tabular-nums">{a.completed}/{a.total} done</span></div>
            ))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Manage enrolments</h3>
          {enrolments.length === 0 ? <p className="text-sm text-gray-400">No enrolments yet.</p> : (
            <div className="divide-y divide-gray-50">{enrolments.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                <div className="min-w-0"><p className="text-gray-800 truncate">{e.name}</p><p className="text-[10px] text-gray-400 truncate">{e.course}</p></div>
                <div className="flex items-center gap-2 shrink-0"><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_TONE[e.status] ?? "bg-gray-100 text-gray-600"}`}>{e.status.replace(/_/g, " ")}</span>{e.status !== "completed" ? <button disabled={busy} onClick={() => setStatus(e.id, "complete")} className="text-[11px] font-medium text-emerald-700 hover:underline disabled:opacity-50">Complete</button> : <button disabled={busy} onClick={() => setStatus(e.id, "not_started")} className="text-[11px] font-medium text-gray-400 hover:underline disabled:opacity-50">Reset</button>}</div>
              </div>
            ))}</div>
          )}
        </div>
      </div>
    </>
  );
}
