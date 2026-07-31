import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceAdmin } from "@/lib/cgr/administration";
import { Kpi } from "../_kit";

// CGR-015 — Competency Governance Platform Administration & Configuration. The no-code governance config layer:
// configuration inventory by category, the inherit-vs-override hierarchy, and advisory AI recommendations. Deep
// platform admin cross-links to the control plane. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const CAT_TONE: Record<string, string> = {
  Scoring: "bg-indigo-400", Workflow: "bg-blue-400", Approval: "bg-emerald-500", Rules: "bg-violet-400",
  Notification: "bg-amber-400", AI: "bg-fuchsia-400", General: "bg-gray-400",
};
const IMPACT_META: Record<string, { label: string; cls: string }> = {
  high: { label: "High", cls: "text-rose-700 bg-rose-50 border-rose-100" },
  medium: { label: "Medium", cls: "text-amber-700 bg-amber-50 border-amber-100" },
  low: { label: "Low", cls: "text-slate-600 bg-slate-50 border-slate-200" },
};
const LIFECYCLE = ["Request", "Review", "Testing", "Approval", "Deployment", "Monitoring"];

export default async function GovernanceAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceAdmin(admin) as any;
  const k = d.kpis;
  const catMax = Math.max(1, ...d.categories.map((c: any) => c.count));
  const totalSource = k.local + k.inherited;
  const localPct = totalSource ? Math.round((k.local / totalSource) * 100) : 0;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-015 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Platform Administration &amp; Configuration</h1>
          <p className="text-gray-400 text-sm mt-0.5">How the governance platform is configured, maintained and operated safely — no-code governance configuration with safe defaults and controlled, traceable change.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/platform-ops/control-plane" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Control plane →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance configuration recorded yet. Governance behaviour is configured no-code in the <Link href="/super-admin/platform-ops/control-plane" className="text-emerald-600 hover:underline">control plane</Link>; once config keys exist, the inventory and inheritance hierarchy compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Config keys" value={k.configs} sub={`${k.active} active`} />
            <Kpi label="Local overrides" value={k.local} sub="tenant customisation" tone={k.local ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Inherited defaults" value={k.inherited} sub="platform safe defaults" tone="text-emerald-600" />
            <Kpi label="Tenants configured" value={k.tenants} sub="with local config" />
            <Kpi label="AI recommendations" value={k.recsOpen} sub="open / advisory" tone={k.recsOpen ? "text-fuchsia-600" : "text-gray-900"} />
            <Kpi label="Accepted" value={k.accepted} sub="recommendations actioned" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Configuration by category */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Configuration by domain (§5)</p>
              {d.categories.length === 0 ? (
                <p className="text-[12px] text-gray-400">No configuration keys recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.categories.map((c: any) => (
                    <div key={c.category} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-24 shrink-0">{c.label}</span>
                      <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className={`h-full rounded ${CAT_TONE[c.label] ?? "bg-gray-400"}`} style={{ width: `${(c.count / catMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-7 text-right">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Hierarchy — inherit vs override */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Governance hierarchy (§6)</p>
              <div className="flex h-4 rounded overflow-hidden bg-gray-100 mb-2.5">
                {k.inherited > 0 && <div className="bg-emerald-500" style={{ width: `${100 - localPct}%` }} title={`Inherited: ${k.inherited}`} />}
                {k.local > 0 && <div className="bg-amber-400" style={{ width: `${localPct}%` }} title={`Local: ${k.local}`} />}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[11px] text-gray-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />Inherited (safe defaults)</span><span className="text-[11px] font-bold text-gray-700 tabular-nums">{k.inherited}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[11px] text-gray-600"><span className="w-2 h-2 rounded-full bg-amber-400" />Local (tenant override)</span><span className="text-[11px] font-bold text-gray-700 tabular-nums">{k.local}</span></div>
              </div>
              <p className="text-[10px] text-gray-400 mt-2.5">Local customisation cannot reduce platform minimum governance controls (§4.3 / §6 inheritance).</p>
            </div>
          </div>

          {/* AI governance recommendations */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">AI governance recommendations <span className="text-[10px] font-normal text-gray-400">— advisory (§12)</span></p>
              {d.recommendations.open > 0 && <p className="text-[10px] text-gray-400">high {d.recommendations.byImpact.high} · med {d.recommendations.byImpact.medium} · low {d.recommendations.byImpact.low}</p>}
            </div>
            {d.recommendations.list.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-gray-400">No open AI recommendations. AI may suggest configuration improvements but never deploys uncontrolled changes.</p></div>
            ) : (
              <div className="divide-y divide-gray-50">
                {d.recommendations.list.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-gray-800 truncate">{r.title}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{r.category}{r.confidence != null ? ` · ${r.confidence}% confidence` : ""}</p>
                    </div>
                    <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 shrink-0 ${(IMPACT_META[r.impact] ?? IMPACT_META.low).cls}`}>{(IMPACT_META[r.impact] ?? IMPACT_META.low).label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Config lifecycle reference */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Configuration lifecycle <span className="font-normal normal-case text-gray-300">(§8, controlled change)</span></p>
            <div className="flex items-center flex-wrap gap-1">
              {LIFECYCLE.map((s, i) => (
                <div key={s} className="flex items-center">
                  <span className="text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{s}</span>
                  {i < LIFECYCLE.length - 1 && <span className="text-gray-300 mx-0.5">→</span>}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — the governance configuration keys and their inherit-vs-override source, and the advisory AI recommendations. This is the governance configuration layer; the full no-code administration console, versioning and rollback are owned by the <Link href="/super-admin/platform-ops/control-plane" className="text-emerald-600 hover:underline">Control Plane</Link>, and rule authoring &amp; testing by <Link href="/super-admin/cgr/policy-rules" className="text-emerald-600 hover:underline">Policy &amp; Rules</Link>. Per the CGR mandate, AI may recommend configuration improvements and flag unused config but never deploys uncontrolled changes or modifies governance rules without approval.</p>
        </div>
      )}
    </div>
  );
}
