"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Facility profile (ENT-001 §3) — header, lifecycle actions and tabbed detail.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BADGE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", onboarding: "bg-amber-50 text-amber-700", active: "bg-green-50 text-green-700", suspended: "bg-rose-50 text-rose-700", archived: "bg-gray-100 text-gray-500" };
const TABS = ["Overview", "Departments", "People", "Services", "Governance", "Audit"] as const;
const card = "bg-white rounded-xl border border-gray-200 p-5";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0"><span className="text-gray-500">{label}</span><span className="text-gray-800 text-right">{value ?? <span className="text-gray-300">—</span>}</span></div>;
}

export default function FacilityProfileClient({ data }: { data: any }) {
  const router = useRouter();
  const { facility, departments, users, userCount, services, structure, audit, auditReady } = data;
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  async function setStatus(status: string) {
    if (status === "archived" && !confirm(`Archive "${facility.name}"?`)) return;
    setBusy(true);
    const r = await fetch(`/api/enterprise/facilities?id=${facility.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    setBusy(false);
    if (r.ok) { toast("ok", `Facility ${status}`); router.refresh(); } else { toast("err", (await r.json().catch(() => ({}))).error ?? "Failed"); }
  }
  const actions = [
    facility.status !== "active" && { label: "Activate", status: "active", cls: "border-green-200 text-green-700 hover:bg-green-50" },
    facility.status === "active" && { label: "Suspend", status: "suspended", cls: "border-rose-200 text-rose-700 hover:bg-rose-50" },
    facility.status !== "archived" && { label: "Archive", status: "archived", cls: "border-gray-300 text-gray-600 hover:bg-gray-50" },
  ].filter(Boolean) as any[];

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span>
        <Link href="/super-admin/enterprise/facilities" className="hover:text-teal-700">Facilities</Link><span>/</span><span className="text-gray-600 truncate">{facility.name}</span>
      </div>

      <div className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl bg-sky-50 flex items-center justify-center text-xl shrink-0">🏥</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-bold text-gray-900">{facility.name}</h1>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${BADGE[facility.status] ?? "bg-gray-100 text-gray-600"}`}>{facility.status}</span></div>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{(facility.type ?? "").replace(/_/g, " ")} · {[facility.city, facility.country].filter(Boolean).join(", ")}{facility.org ? ` · ${facility.org.name}` : " · Unlinked"}{facility.code ? ` · ${facility.code}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/super-admin/enterprise/structure?facility=${facility.id}`} className="text-xs font-medium rounded-lg border border-teal-200 text-teal-700 hover:bg-teal-50 px-3 py-1.5">Structure builder →</Link>
          {actions.map(a => <button key={a.status} onClick={() => setStatus(a.status)} disabled={busy} className={`text-xs font-medium rounded-lg border px-3 py-1.5 disabled:opacity-40 ${a.cls}`}>{a.label}</button>)}
        </div>
      </div>
      {msg && <div className={`text-sm rounded-lg px-3 py-1.5 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[["Divisions", structure.divisions], ["Departments", structure.departments], ["Units", structure.units], ["Services", services.length], ["Users", userCount]].map(([l, n]) => (
          <div key={l as string} className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-2xl font-bold tabular-nums text-gray-900">{n as number}</p><p className="text-[11px] text-gray-500 mt-0.5">{l}</p></div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>)}
      </div>

      {tab === "Overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Identification</h3>
            <Row label="Facility code" value={facility.code} /><Row label="Type" value={<span className="capitalize">{(facility.type ?? "").replace(/_/g, " ")}</span>} />
            <Row label="Organisation" value={facility.org?.name} /><Row label="Country" value={facility.country} /><Row label="City" value={facility.city} /><Row label="Plan tier" value={<span className="capitalize">{facility.tier}</span>} />
          </div>
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Leadership</h3>
            <Row label="Facility administrator" value={facility.admin} /><Row label="Director" value={facility.director} />
            <p className="text-[11px] text-gray-400 mt-3">Medical director, nursing director, quality lead, HR and IT contacts are captured when the facility leadership module is provisioned.</p>
          </div>
        </div>
      )}

      {tab === "Departments" && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Departments ({departments.length})</h3>
            <Link href={`/super-admin/enterprise/structure?facility=${facility.id}`} className="text-xs text-teal-700 hover:underline">Open structure builder →</Link></div>
          {departments.length === 0 ? <p className="text-sm text-gray-400">No departments yet. Build them in the structure builder.</p> : (
            <div className="divide-y divide-gray-50">
              {departments.map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 py-2.5">
                  <span className="text-base">🗂️</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{d.name}</p><p className="text-[10px] text-gray-400">{[d.code, d.type, d.head ? `Head: ${d.head}` : null].filter(Boolean).join(" · ") || "—"}</p></div>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${d.status === "archived" ? "bg-gray-100 text-gray-500" : "bg-green-50 text-green-700"}`}>{d.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "People" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">People ({userCount})</h3>
          {users.length === 0 ? <p className="text-sm text-gray-400">No people assigned to this facility.</p> : (
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {userCount > 100 && <p className="text-[10px] text-gray-400 pb-1">Showing first 100 of {userCount}.</p>}
              {users.slice(0, 100).map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 py-2"><span className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-xs">{(u.name ?? "?")[0]}</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{u.name}</p><p className="text-[10px] text-gray-400 truncate">{u.email}</p></div>
                  <span className="text-[10px] text-gray-500 capitalize">{u.roles.map((r: string) => r.replace(/_/g, " ")).slice(0, 2).join(", ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "Services" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Service catalogue ({services.length})</h3>
          {services.length === 0 ? <p className="text-sm text-gray-400">No services catalogued for this facility.</p> : (
            <div className="flex flex-wrap gap-2">
              {services.map((s: any) => <span key={s.id} className="text-xs bg-teal-50 text-teal-700 rounded-lg px-2.5 py-1">{s.name}{s.category ? <span className="text-teal-400"> · {s.category}</span> : null}</span>)}
            </div>
          )}
        </div>
      )}

      {tab === "Governance" && (
        <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Governance &amp; operations</h3>
          <p className="text-sm text-gray-500 leading-relaxed">{structure.departments} department{structure.departments === 1 ? "" : "s"}, {structure.units} unit{structure.units === 1 ? "" : "s"} and {userCount} people operate under this facility.</p>
          <p className="text-[11px] text-gray-400 mt-2">Facility-level policies, workspaces, integrations, operating hours and accreditation status are provisioned with the facility configuration module.</p>
        </div>
      )}

      {tab === "Audit" && (
        <div className={card}><h3 className="font-semibold text-gray-900 mb-3">Audit history</h3>
          {!auditReady || audit.length === 0 ? <p className="text-sm text-gray-400">{auditReady ? "No audit entries for this facility yet." : "Audit log not available."}</p> : (
            <div className="space-y-2">{audit.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" /><span className="text-gray-700 capitalize">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 text-xs ml-auto">{a.actor_name} · {relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      )}
    </div>
  );
}
