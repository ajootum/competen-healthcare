"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Tenant profile (POP-001 §2) — header, lifecycle, plan assignment, seats and
// per-tenant feature toggles, with tabbed detail.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BADGE: Record<string, string> = { prospect: "bg-gray-100 text-gray-600", trial: "bg-amber-50 text-amber-700", active: "bg-green-50 text-green-700", suspended: "bg-rose-50 text-rose-700", archived: "bg-gray-100 text-gray-500", deleted: "bg-gray-100 text-gray-400" };
const HEALTH_TONE: Record<string, string> = { Healthy: "text-green-600", Trial: "text-amber-600", "Over limit": "text-orange-600", Suspended: "text-rose-600", Inactive: "text-gray-400" };
const TABS = ["Overview", "Subscription", "Usage & Features", "Facilities", "Audit"] as const;
const card = "bg-white rounded-xl border border-gray-200 p-5";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0"><span className="text-gray-500">{label}</span><span className="text-gray-800 text-right">{value ?? <span className="text-gray-300">—</span>}</span></div>;
}

export default function TenantProfileClient({ data }: { data: any }) {
  const router = useRouter();
  const { tenant, subscription, plan, plans, usage, features, orgs, facilities, userCount, audit, auditReady } = data;
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [planId, setPlanId] = useState(plan?.id ?? "");
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  async function patch(body: any, ok = "Updated") {
    setBusy(true);
    const r = await fetch(`/api/platform/tenants?id=${tenant.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast("ok", ok); router.refresh(); return true; } else { toast("err", (await r.json().catch(() => ({}))).error ?? "Failed"); return false; }
  }
  const setStatus = (status: string) => { if (status === "archived" && !confirm(`Archive "${tenant.name}"?`)) return; patch({ status }, `Tenant ${status}`); };

  const actions = [
    tenant.status !== "active" && { label: "Activate", status: "active", cls: "border-green-200 text-green-700 hover:bg-green-50" },
    tenant.status === "active" && { label: "Suspend", status: "suspended", cls: "border-rose-200 text-rose-700 hover:bg-rose-50" },
    tenant.status !== "archived" && { label: "Archive", status: "archived", cls: "border-gray-300 text-gray-600 hover:bg-gray-50" },
  ].filter(Boolean) as any[];

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/tenants" className="hover:text-teal-700">Tenants</Link><span>/</span><span className="text-gray-600 truncate">{tenant.name}</span>
      </div>

      <div className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-xl shrink-0">🏢</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-bold text-gray-900">{tenant.name}</h1>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${BADGE[tenant.status] ?? "bg-gray-100 text-gray-600"}`}>{tenant.status}</span>
              <span className={`text-[10px] font-medium ${HEALTH_TONE[tenant.health] ?? "text-gray-400"}`}>• {tenant.health}</span></div>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{(tenant.type ?? "").replace(/_/g, " ")} · {tenant.country ?? "—"}{plan ? ` · ${plan.name} plan` : " · Unplanned"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(a => <button key={a.status} onClick={() => setStatus(a.status)} disabled={busy} className={`text-xs font-medium rounded-lg border px-3 py-1.5 disabled:opacity-40 ${a.cls}`}>{a.label}</button>)}
        </div>
      </div>
      {msg && <div className={`text-sm rounded-lg px-3 py-1.5 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Users", userCount], ["Facilities", facilities.length], ["Organisations", orgs.length], ["Seats", subscription?.seats ?? "—"]].map(([l, n]) => (
          <div key={l as string} className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-2xl font-bold tabular-nums text-gray-900">{n as any}</p><p className="text-[11px] text-gray-500 mt-0.5">{l}</p></div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>)}
      </div>

      {tab === "Overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Identity</h3>
            <Row label="Slug" value={tenant.slug} /><Row label="Type" value={<span className="capitalize">{(tenant.type ?? "").replace(/_/g, " ")}</span>} /><Row label="Country" value={tenant.country} />
            <Row label="Language" value={tenant.language} /><Row label="Timezone" value={tenant.timezone} /><Row label="Currency" value={tenant.currency} /><Row label="Custom domain" value={tenant.customDomain} />
          </div>
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Health &amp; plan</h3>
            <Row label="Health" value={<span className={HEALTH_TONE[tenant.health] ?? ""}>{tenant.health}</span>} /><Row label="Plan" value={plan?.name} /><Row label="Subscription" value={subscription ? <span className="capitalize">{subscription.status}</span> : null} />
            <Row label="Seats" value={subscription?.seats} /><Row label="Renews" value={subscription?.renews ? new Date(subscription.renews).toLocaleDateString() : null} /><Row label="Created" value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : null} />
          </div>
        </div>
      )}

      {tab === "Subscription" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Subscription &amp; plan</h3>
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Plan</label>
              <select value={planId} onChange={e => setPlanId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56"><option value="">— Select plan —</option>{plans.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <button onClick={() => planId && patch({ action: "assign_plan", plan_id: planId }, "Plan assigned")} disabled={busy || !planId || planId === plan?.id} className="text-sm font-semibold bg-teal-600 text-white rounded-lg px-3.5 py-2 hover:bg-teal-700 disabled:opacity-40">Assign plan</button>
          </div>
          {plan ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[["Plan", plan.name], ["Price", `${plan.currency} ${plan.price}/mo`], ["Status", subscription?.status ?? "—"], ["Seats", subscription?.seats ?? "—"], ["Max users", plan.entitlements.max_users ?? "∞"], ["Max facilities", plan.entitlements.max_hospitals ?? "∞"]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-gray-100 p-3"><p className="text-sm font-semibold text-gray-900">{v as any}</p><p className="text-[10px] text-gray-500">{l}</p></div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No plan assigned. Select one above.</p>}
        </div>
      )}

      {tab === "Usage & Features" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className={card}><h3 className="font-semibold text-gray-900 mb-3">Usage vs entitlement</h3>
            <div className="space-y-3">
              {usage.map((u: any) => {
                const pct = u.used != null && u.limit ? Math.min(Math.round((u.used / u.limit) * 100), 100) : null;
                const over = u.used != null && u.limit != null && u.used > u.limit;
                return (
                  <div key={u.label}>
                    <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-700">{u.label}</span>
                      <span className={`tabular-nums ${over ? "text-orange-600 font-medium" : "text-gray-500"}`}>{u.used == null ? <span className="text-gray-400">{u.note}</span> : `${u.used}${u.limit != null ? ` / ${u.limit}` : ""}`}{u.limit == null && u.used != null ? " (∞)" : ""}</span></div>
                    {pct != null && <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${over ? "bg-orange-500" : "bg-teal-500"}`} style={{ width: `${pct}%` }} /></div>}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">Storage &amp; AI-credit metering activates with the monitoring agent — limits shown from the plan.</p>
          </div>
          <div className={card}><h3 className="font-semibold text-gray-900 mb-3">Feature flags</h3>
            {features.length === 0 ? <p className="text-sm text-gray-400">No feature flags registered.</p> : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {features.map((f: any) => (
                  <div key={f.key} className="flex items-center justify-between gap-2 py-1">
                    <div className="min-w-0"><p className="text-sm text-gray-800 truncate">{f.key}</p>{f.description && <p className="text-[10px] text-gray-400 truncate">{f.description}</p>}</div>
                    <button onClick={() => patch({ action: "toggle_feature", flag_key: f.key, enabled: !f.enabled }, `Feature ${f.enabled ? "disabled" : "enabled"}`)} disabled={busy}
                      className={`text-[11px] font-medium rounded-full px-2.5 py-0.5 border shrink-0 disabled:opacity-40 ${f.enabled ? "bg-green-50 border-green-200 text-green-700" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
                      {f.enabled ? "On" : "Off"}{f.overridden && <span className="text-[8px] ml-1 opacity-70">·override</span>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "Facilities" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Organisations &amp; facilities</h3>
          {orgs.length === 0 && facilities.length === 0 ? <p className="text-sm text-gray-400">No organisations or facilities under this tenant.</p> : (
            <div className="grid sm:grid-cols-2 gap-4">
              <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-1">Organisations ({orgs.length})</p>{orgs.map((o: any) => <p key={o.id} className="text-sm text-gray-700 py-1 border-b border-gray-50">🏛️ {o.name}</p>)}{orgs.length === 0 && <p className="text-sm text-gray-300">—</p>}</div>
              <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-1">Facilities ({facilities.length})</p>{facilities.map((f: any) => <p key={f.id} className="text-sm text-gray-700 py-1 border-b border-gray-50 flex justify-between">🏥 {f.name}<span className={`text-[10px] ${f.hasAdmin ? "text-green-600" : "text-amber-600"}`}>{f.hasAdmin ? "active" : "pending"}</span></p>)}{facilities.length === 0 && <p className="text-sm text-gray-300">—</p>}</div>
            </div>
          )}
        </div>
      )}

      {tab === "Audit" && (
        <div className={card}><h3 className="font-semibold text-gray-900 mb-3">Audit history</h3>
          {!auditReady || audit.length === 0 ? <p className="text-sm text-gray-400">{auditReady ? "No audit entries for this tenant yet." : "Audit log not available."}</p> : (
            <div className="space-y-2">{audit.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" /><span className="text-gray-700 capitalize">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 text-xs ml-auto">{a.actor_name ? `${a.actor_name} · ` : ""}{relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      )}
    </div>
  );
}
