import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceMarketplace } from "@/lib/cgr/marketplace";
import { Kpi } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

// CGR-021 — Competency Governance Marketplace & External Standards Exchange. The governance-resource catalog:
// packages by domain, the shared-vs-private split, publication readiness and licensing over the real package
// store. Publishing/adoption cross-link to Studio Marketplace. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const VIS_META: Record<string, { label: string; cls: string }> = {
  public: { label: "Public", cls: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" },
  enterprise: { label: "Enterprise", cls: "text-blue-700 bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)]" },
  private: { label: "Private", cls: "text-gray-500 bg-gray-50 border-gray-200" },
};
const LICENSE_META: Record<string, string> = {
  open: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]", proprietary: "text-gray-600 bg-gray-50 border-gray-200",
  subscription: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]", enterprise: "text-blue-700 bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)]",
};
const ROLES = [
  { role: "Publisher", note: "Creates and submits resources" },
  { role: "Reviewer", note: "Validates quality and evidence" },
  { role: "Governance authority", note: "Approves publication" },
  { role: "Consumer", note: "Adopts and localises" },
];
const LIFECYCLE = ["Discovery", "Review", "Local validation", "Approval", "Deployment", "Monitoring"];
const cap = (s: string) => (s || "").replace(/^\w/, (c) => c.toUpperCase());

export default async function GovernanceMarketplacePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.quality.regulation.view");

  const d = await loadGovernanceMarketplace(admin) as any;
  const k = d.kpis;
  const catMax = Math.max(1, ...d.categories.map((c: any) => c.count));
  const visTotal = d.byVisibility.private + d.byVisibility.enterprise + d.byVisibility.public;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-021 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Marketplace &amp; External Standards Exchange</h1>
          <p className="text-gray-500 text-sm mt-0.5">Discover, adopt and exchange trusted competency governance resources while keeping local accountability — trusted exchange, governance before sharing, local adaptation.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/studio/marketplace" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Publish / adopt →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-500">No governance packages yet. Resources are bundled and published in the <Link href="/super-admin/studio/marketplace" className="text-[var(--cmp-text-success)] hover:underline">Studio Marketplace</Link>; once packages exist, the catalog, readiness and exchange metrics compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Packages" value={k.packages} sub="governance resources" />
            <Kpi label="Shared" value={k.shared} sub="enterprise + public" tone={k.shared ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
            <Kpi label="Public" value={k.public} sub="open exchange" />
            <Kpi label="Publish-ready" value={`${k.complete}/${k.packages}`} sub="complete manifest" tone={k.complete === k.packages && k.packages ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
            <Kpi label="Incomplete" value={k.incomplete} sub="missing dependencies" tone={k.incomplete ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
            <Kpi label="Publishers" value={k.publishers} sub="contributors" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Marketplace domains */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Marketplace domains (§5)</p>
              {d.categories.length === 0 ? (
                <p className="text-[12px] text-gray-500">No packages yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {d.categories.map((c: any) => (
                    <div key={c.category} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-24 shrink-0 capitalize">{c.category}</span>
                      <div className="flex-1 h-2 rounded bg-gray-50 overflow-hidden"><div className={`h-full rounded ${c.category === "governance" ? "bg-[var(--cmp-color-success)]" : "bg-gray-300"}`} style={{ width: `${(c.count / catMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6 text-right">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Visibility split */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Exchange visibility</p>
              <div className="flex h-4 rounded overflow-hidden bg-gray-100 mb-2.5">
                {(["public", "enterprise", "private"] as const).map((v) => {
                  const w = visTotal ? (d.byVisibility[v] / visTotal) * 100 : 0;
                  const tone = v === "public" ? "bg-[var(--cmp-color-success)]" : v === "enterprise" ? "bg-[var(--cmp-color-information)]" : "bg-gray-300";
                  return w > 0 ? <div key={v} className={tone} style={{ width: `${w}%` }} title={`${VIS_META[v].label}: ${d.byVisibility[v]}`} /> : null;
                })}
              </div>
              <div className="space-y-1">
                {(["public", "enterprise", "private"] as const).map((v) => (
                  <div key={v} className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[11px] text-gray-600"><span className={`w-2 h-2 rounded-full ${v === "public" ? "bg-[var(--cmp-color-success)]" : v === "enterprise" ? "bg-[var(--cmp-color-information)]" : "bg-gray-300"}`} />{VIS_META[v].label}</span><span className="text-[11px] font-bold text-gray-700 tabular-nums">{d.byVisibility[v]}</span></div>
                ))}
              </div>
            </div>
          </div>

          {/* Package catalog */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Resource catalog</p>
              <p className="text-[10px] text-gray-500">public first</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead><tr className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">
                  <th className="text-left py-2 pl-4 pr-2">Package</th>
                  <th className="text-left py-2 px-2">Publisher</th>
                  <th className="text-left py-2 px-2">Category</th>
                  <th className="text-left py-2 px-2">Version</th>
                  <th className="text-left py-2 px-2">License</th>
                  <th className="text-center py-2 px-2">Members</th>
                  <th className="text-left py-2 px-2">Visibility</th>
                  <th className="text-left py-2 pr-4 pl-2">Ready</th>
                </tr></thead>
                <tbody>
                  {d.packages.map((p: any) => (
                    <tr key={p.key} className="border-t border-gray-50">
                      <td className="py-2 pl-4 pr-2"><p className="text-[12px] font-medium text-gray-800">{p.name}</p><p className="text-[10px] text-gray-500 font-mono">{p.key}</p></td>
                      <td className="py-2 px-2 text-[11px] text-gray-600">{p.publisher}</td>
                      <td className="py-2 px-2 text-[11px] text-gray-500 capitalize">{p.category}</td>
                      <td className="py-2 px-2 text-[11px] font-mono text-gray-500">v{p.version}</td>
                      <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 capitalize ${LICENSE_META[p.license] ?? LICENSE_META.proprietary}`}>{p.license}</span></td>
                      <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{p.members}</td>
                      <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${(VIS_META[p.visibility] ?? VIS_META.private).cls}`}>{(VIS_META[p.visibility] ?? VIS_META.private).label}</span></td>
                      <td className="py-2 pr-4 pl-2">{p.complete ? <span className="text-[11px] font-semibold text-[var(--cmp-text-success)]">✓</span> : <span className="text-[10px] text-[var(--cmp-text-error)]">{p.missing} missing</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Governance model + lifecycle reference */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Marketplace governance (§6)</p>
              <div className="space-y-1.5">
                {ROLES.map((r) => (
                  <div key={r.role} className="flex items-start gap-2">
                    <span className="text-[11px] font-semibold text-gray-700 w-32 shrink-0">{r.role}</span>
                    <span className="text-[11px] text-gray-500 leading-snug">{r.note}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Adoption lifecycle (§7)</p>
              <div className="flex items-center flex-wrap gap-1">
                {LIFECYCLE.map((s, i) => (
                  <div key={s} className="flex items-center">
                    <span className="text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1">{cap(s)}</span>
                    {i < LIFECYCLE.length - 1 && <span className="text-gray-500 mx-0.5">→</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 leading-relaxed">Every figure is real — the resource catalog, publishers, licensing and exchange visibility come from the package store, and publication readiness is the package manifest completeness (§4.2 governance before sharing). Bundling, publishing and adopting resources happen in the <Link href="/super-admin/studio/marketplace" className="text-[var(--cmp-text-success)] hover:underline">Studio Marketplace</Link>; regulatory standards exchange is grounded in <Link href="/super-admin/cgr/standards" className="text-[var(--cmp-text-success)] hover:underline">Regulatory Intelligence</Link>. Per the CGR mandate, AI may recommend relevant resources but never approves marketplace publication or overrides local governance.</p>
        </div>
      )}
    </div>
  );
}
