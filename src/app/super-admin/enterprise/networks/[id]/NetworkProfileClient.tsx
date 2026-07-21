"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Network profile (ENT-001 §2) — header, tabs and member-organisation management.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TABS = ["Overview", "Member Organisations", "Countries", "Governance", "Audit"] as const;
const card = "bg-white rounded-xl border border-gray-200 p-5";
const ORG_BADGE: Record<string, string> = { active: "bg-green-50 text-green-700", onboarding: "bg-amber-50 text-amber-700", draft: "bg-gray-100 text-gray-600", suspended: "bg-rose-50 text-rose-700" };
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

export default function NetworkProfileClient({ data, available }: { data: any; available: any[] }) {
  const router = useRouter();
  const { network, members, counts, countries, audit, auditReady } = data;
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  async function member(action: "add_member" | "remove_member", orgId: string) {
    if (action === "remove_member" && !confirm("Remove this organisation from the network?")) return;
    setBusy(true);
    const r = await fetch(`/api/enterprise/networks?id=${network.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, org_id: orgId }) });
    setBusy(false);
    if (r.ok) { toast("ok", action === "add_member" ? "Organisation added" : "Organisation removed"); setAddOpen(false); setPick(""); router.refresh(); }
    else toast("err", (await r.json().catch(() => ({}))).error ?? "Failed");
  }

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span>
        <Link href="/super-admin/enterprise/networks" className="hover:text-teal-700">Networks</Link><span>/</span><span className="text-gray-600 truncate">{network.name}</span>
      </div>

      <div className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-xl shrink-0">🌐</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-bold text-gray-900">{network.name}</h1>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${network.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{network.status}</span></div>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{(network.type ?? "").replace(/_/g, " ")} · HQ {network.hq}</p>
          </div>
        </div>
      </div>
      {msg && <div className={`text-sm rounded-lg px-3 py-1.5 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Member orgs", counts.members], ["Facilities", counts.facilities], ["Users", counts.users], ["Countries", counts.countries]].map(([l, n]) => (
          <div key={l as string} className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-2xl font-bold tabular-nums text-gray-900">{n as number}</p><p className="text-[11px] text-gray-500 mt-0.5">{l}</p></div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>)}
      </div>

      {tab === "Overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Network</h3>
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">Type</span><span className="text-gray-800 capitalize">{(network.type ?? "").replace(/_/g, " ")}</span></div>
              <div className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">Headquarters</span><span className="text-gray-800">{network.hq}</span></div>
              <div className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">Member organisations</span><span className="text-gray-800">{counts.members}</span></div>
              <div className="flex justify-between py-1.5"><span className="text-gray-500">Created</span><span className="text-gray-800">{network.createdAt ? new Date(network.createdAt).toLocaleDateString() : "—"}</span></div>
            </div>
          </div>
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Inheritance &amp; shared standards</h3>
            <p className="text-sm text-gray-500 leading-relaxed">Shared competency frameworks, policies, assessment templates, branding and governance rules propagate to member organisations from here.</p>
            <p className="text-[11px] text-gray-400 mt-2">Inheritance controls (mandatory / local-override / optional) are provisioned with the Shared Governance module.</p>
          </div>
        </div>
      )}

      {tab === "Member Organisations" && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Member organisations ({members.length})</h3>
            <button onClick={() => setAddOpen(true)} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3 py-1.5">+ Add organisation</button></div>
          {members.length === 0 ? <p className="text-sm text-gray-400">No member organisations. Add one to build the network.</p> : (
            <div className="divide-y divide-gray-50">
              {members.map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 py-2.5">
                  <span className="text-base">🏛️</span>
                  <Link href={`/super-admin/enterprise/organisations/${m.id}`} className="flex-1 min-w-0 hover:text-teal-700"><p className="text-sm text-gray-800 truncate">{m.name}</p><p className="text-[10px] text-gray-400 capitalize">{(m.type ?? "").replace(/_/g, " ")} · {m.country}</p></Link>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${ORG_BADGE[m.status] ?? "bg-gray-100 text-gray-600"}`}>{m.status}</span>
                  <button onClick={() => member("remove_member", m.id)} disabled={busy} className="text-[11px] text-gray-400 hover:text-rose-600 disabled:opacity-40">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "Countries" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Countries &amp; regions</h3>
          {countries.length === 0 ? <p className="text-sm text-gray-400">No member organisations yet.</p> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {countries.map((c: any) => (
                <div key={c.country} className="rounded-lg border border-gray-100 p-3"><p className="text-sm font-medium text-gray-800">{c.country}</p><p className="text-[11px] text-gray-400">{c.orgs} organisation{c.orgs === 1 ? "" : "s"}</p></div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "Governance" && (
        <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Governance</h3>
          <p className="text-sm text-gray-500 leading-relaxed">Central governance across {counts.members} member organisation{counts.members === 1 ? "" : "s"} in {counts.countries} countr{counts.countries === 1 ? "y" : "ies"}.</p>
          <p className="text-[11px] text-gray-400 mt-2">Network owner, shared policies, shared frameworks and governance workflows are captured when the Shared Governance module is provisioned.</p>
        </div>
      )}

      {tab === "Audit" && (
        <div className={card}><h3 className="font-semibold text-gray-900 mb-3">Audit history</h3>
          {!auditReady || audit.length === 0 ? <p className="text-sm text-gray-400">{auditReady ? "No audit entries for this network yet." : "Audit log not available."}</p> : (
            <div className="space-y-2">{audit.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" /><span className="text-gray-700 capitalize">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 text-xs ml-auto">{a.actor_name} · {relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setAddOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900">Add organisation to network</h3><button onClick={() => setAddOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button></div>
            <div className="p-6 flex flex-col gap-3">
              {available.length === 0 ? <p className="text-sm text-gray-400">All organisations are already assigned to a network.</p> : (
                <>
                  <select value={pick} onChange={e => setPick(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select an organisation…</option>
                    {available.map(o => <option key={o.id} value={o.id}>{o.name} · {o.country}</option>)}
                  </select>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setAddOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                    <button onClick={() => pick && member("add_member", pick)} disabled={busy || !pick} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">Add</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
