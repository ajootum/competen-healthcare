"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Organisation profile (ENT-001 §1) — header, lifecycle actions and tabbed
// detail. Every figure is live; thin governance fields are marked honestly.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", onboarding: "bg-amber-50 text-amber-700", active: "bg-green-50 text-green-700",
  suspended: "bg-rose-50 text-rose-700", restricted: "bg-orange-50 text-orange-700", archived: "bg-gray-100 text-gray-500", closed: "bg-gray-100 text-gray-500",
};
const TABS = ["Overview", "Structure", "Facilities", "Users", "Subscription", "Governance", "Audit"] as const;
const card = "bg-white rounded-xl border border-gray-200 p-5";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0"><span className="text-gray-500">{label}</span><span className="text-gray-800 text-right">{value ?? <span className="text-gray-300">—</span>}</span></div>;
}

export default function OrgProfileClient({ data }: { data: any }) {
  const router = useRouter();
  const { org, facilities, users, userCount, admins, structure, roleTally, subscription, audit, auditReady } = data;
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  async function setStatus(status: string) {
    if (status === "archived" && !confirm(`Archive "${org.name}"? It will be hidden from active lists.`)) return;
    setBusy(true);
    const r = await fetch(`/api/enterprise/organisations?id=${org.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    setBusy(false);
    if (r.ok) { toast("ok", `Organisation ${status}`); router.refresh(); } else { toast("err", (await r.json().catch(() => ({}))).error ?? "Failed"); }
  }

  const actions = [
    org.status !== "active" && { label: "Activate", status: "active", cls: "border-green-200 text-green-700 hover:bg-green-50" },
    org.status === "active" && { label: "Suspend", status: "suspended", cls: "border-rose-200 text-rose-700 hover:bg-rose-50" },
    org.status !== "archived" && { label: "Archive", status: "archived", cls: "border-gray-300 text-gray-600 hover:bg-gray-50" },
  ].filter(Boolean) as any[];

  return (
    <div data-wide className="space-y-4">
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span>
        <Link href="/super-admin/enterprise/organisations" className="hover:text-teal-700">Organisations</Link><span>/</span><span className="text-gray-600 truncate">{org.name}</span>
      </div>

      <div className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center text-xl shrink-0">🏛️</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{org.name}</h1>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${BADGE[org.status] ?? "bg-gray-100 text-gray-600"}`}>{org.status}</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{(org.type ?? "").replace(/_/g, " ")} · {org.country}{org.code ? ` · ${org.code}` : ""}{org.network ? ` · ${org.network.name}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(a => (
            <button key={a.status} onClick={() => setStatus(a.status)} disabled={busy} className={`text-xs font-medium rounded-lg border px-3 py-1.5 disabled:opacity-40 ${a.cls}`}>{a.label}</button>
          ))}
        </div>
      </div>
      {msg && <div className={`text-sm rounded-lg px-3 py-1.5 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Facilities", structure.facilities], ["Departments", structure.departments], ["Units", structure.units], ["Users", userCount]].map(([l, n]) => (
          <div key={l as string} className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-2xl font-bold tabular-nums text-gray-900">{n as number}</p><p className="text-[11px] text-gray-500 mt-0.5">{l}</p></div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Identity</h3>
            <Row label="Legal name" value={org.legalName} /><Row label="Organisation code" value={org.code} /><Row label="Type" value={<span className="capitalize">{(org.type ?? "").replace(/_/g, " ")}</span>} />
            <Row label="Country" value={org.country} /><Row label="Region" value={org.region} /><Row label="Network" value={org.network?.name} />
          </div>
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Contact</h3>
            <Row label="Website" value={org.website} /><Row label="Email" value={org.email} /><Row label="Phone" value={org.phone} />
            <Row label="Administrators" value={admins.length} />
            {org.description && <p className="text-sm text-gray-600 mt-3 leading-relaxed">{org.description}</p>}
          </div>
        </div>
      )}

      {tab === "Structure" && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Organisational structure</h3>
            <Link href="/super-admin/enterprise" className="text-xs text-teal-700 hover:underline">Structure builder →</Link></div>
          <div className="grid grid-cols-3 gap-3">
            {[["Facilities", structure.facilities], ["Departments", structure.departments], ["Units", structure.units]].map(([l, n]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 p-4 text-center"><p className="text-2xl font-bold text-gray-900 tabular-nums">{n as number}</p><p className="text-[11px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">The interactive department/unit/service builder for this organisation ships with the Structure Builder module (next phase).</p>
        </div>
      )}

      {tab === "Facilities" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Facilities ({facilities.length})</h3>
          {facilities.length === 0 ? <p className="text-sm text-gray-400">No facilities linked to this organisation.</p> : (
            <div className="divide-y divide-gray-50">
              {facilities.map((f: any) => (
                <Link key={f.id} href="/super-admin/hospitals" className="flex items-center gap-3 py-2.5 hover:bg-gray-50/60 -mx-2 px-2 rounded">
                  <span className="text-base">🏥</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{f.name}</p><p className="text-[10px] text-gray-400 capitalize">{(f.type ?? "").replace(/_/g, " ")} · {[f.city, f.country].filter(Boolean).join(", ")}</p></div>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${f.hasAdmin ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{f.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "Users" && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Users ({userCount})</h3>
            <div className="flex flex-wrap gap-1.5">{Object.entries(roleTally).slice(0, 6).map(([r, n]) => <span key={r} className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 capitalize">{r.replace(/_/g, " ")}: {n as number}</span>)}</div>
          </div>
          {users.length === 0 ? <p className="text-sm text-gray-400">No users in this organisation.</p> : (
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {userCount > 100 && <p className="text-[10px] text-gray-400 pb-1">Showing first 100 of {userCount}.</p>}
              {users.slice(0, 100).map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 py-2">
                  <span className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-xs">{(u.name ?? "?")[0]}</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{u.name}</p><p className="text-[10px] text-gray-400 truncate">{u.email}</p></div>
                  <span className="text-[10px] text-gray-500 capitalize">{u.roles.map((r: string) => r.replace(/_/g, " ")).slice(0, 2).join(", ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "Subscription" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2">Subscription</h3>
          {subscription ? (
            <><Row label="Status" value={<span className="capitalize">{subscription.status}</span>} /><Row label="Seats purchased" value={subscription.seats_purchased} />
              <Row label="Renews" value={subscription.renews_at ? new Date(subscription.renews_at).toLocaleDateString() : null} /><Row label="Trial ends" value={subscription.trial_ends_at ? new Date(subscription.trial_ends_at).toLocaleDateString() : null} /></>
          ) : <p className="text-sm text-gray-400">No subscription record for this organisation&apos;s tenant. Provisioning runs through the Platform Control Plane.</p>}
        </div>
      )}

      {tab === "Governance" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2">Governance</h3>
          <Row label="Organisation administrator" value={admins[0]?.name} />
          {admins.length > 1 && <Row label="Additional administrators" value={admins.slice(1).map((a: any) => a.name).join(", ")} />}
          <p className="text-[11px] text-gray-400 mt-3">Executive sponsor, data-protection, clinical-governance, quality and billing contacts are captured when the governance contacts module is provisioned.</p>
        </div>
      )}

      {tab === "Audit" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Audit history</h3>
          {!auditReady || audit.length === 0 ? <p className="text-sm text-gray-400">{auditReady ? "No audit entries for this organisation yet." : "Audit log not available."}</p> : (
            <div className="space-y-2">{audit.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
                <span className="text-gray-700 capitalize">{(a.action ?? "").replace(/_/g, " ")}</span>
                <span className="text-gray-400 text-xs ml-auto">{a.actor_name} · {relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      )}
    </div>
  );
}
