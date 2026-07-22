import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPolicyCenter } from "@/lib/super-admin/gov-policies";
import PolicyCenter from "./PolicyCenter";

export const dynamic = "force-dynamic";

// Policy & Standards Center (GOV-001.2) — the enterprise policy library:
// creation, review currency, scope (platform-wide vs tenant), the governed
// approval pipeline (platform engine) and the standards library (EQOS
// frameworks). The policies table has no draft/review status column and a
// single version field, so KPIs map honestly onto what IS stored;
// acknowledgements and version history show honest states until modelled.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const TYPE_BADGE: Record<string, string> = { clinical: "bg-teal-50 text-teal-700", hr: "bg-violet-50 text-violet-700", safety: "bg-rose-50 text-rose-700", governance: "bg-blue-50 text-blue-700", infection_control: "bg-amber-50 text-amber-700", quality: "bg-green-50 text-green-700" };
const PIPELINE = ["Draft", "Technical Review", "Governance Approval", "Published", "Acknowledgement", "Scheduled Review"];

export default async function PolicyStandardsCenter() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPolicyCenter(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Total Policies", value: fmt(k.total), icon: "📄", iconBg: "bg-blue-50" },
    { label: "Active", value: fmt(k.active), icon: "✅", iconBg: "bg-green-50", tone: "text-green-600" },
    { label: "Platform-wide", value: fmt(k.platformWide), icon: "🌐", iconBg: "bg-violet-50" },
    { label: "Review Due (30d)", value: fmt(k.dueSoon), icon: "🕓", iconBg: "bg-amber-50", tone: k.dueSoon ? "text-amber-600" : undefined },
    { label: "Overdue Review", value: fmt(k.overdue), icon: "⚠️", iconBg: "bg-rose-50", tone: k.overdue ? "text-rose-600" : undefined },
    { label: "Retired", value: fmt(k.retired), icon: "🗄️", iconBg: "bg-gray-50", tone: "text-gray-400" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/governance" className="hover:text-teal-700">Governance &amp; Compliance</Link><span>/</span><span className="text-gray-600">Policy &amp; Standards Center</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Policy &amp; Standards Center</h1>
        <p className="text-sm text-gray-500">Create, approve, publish and retire enterprise policies — mapped to the standards library.</p>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real in-place policy authoring + approval submission */}
      <PolicyCenter frameworks={d.pickers.frameworks} policies={d.pickers.policies} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Policy library */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Policy Library</h2>
            <Link href="/super-admin/policy-manager" className="text-xs text-teal-700 hover:underline">Full manager →</Link>
          </div>
          {d.library.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No policies yet — create the first one above.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 font-semibold">Policy</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Version</th><th className="px-3 py-2 font-semibold">Scope</th><th className="px-3 py-2 font-semibold text-right">Review</th><th className="px-3 py-2 font-semibold text-right">Status</th>
                </tr></thead>
                <tbody>
                  {d.library.map((p: any) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-800">{p.title}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TYPE_BADGE[p.type] ?? "bg-gray-100 text-gray-600"}`}>{(p.type ?? "—").replace(/_/g, " ")}</span></td>
                      <td className="px-3 py-2 text-gray-500 tabular-nums">v{p.version ?? "1.0"}</td>
                      <td className="px-3 py-2 text-gray-500">{p.scope}</td>
                      <td className={`px-3 py-2 text-right tabular-nums text-[12px] ${p.overdue ? "text-rose-600 font-medium" : "text-gray-500"}`}>{p.reviewDate ?? "—"}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${p.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"}`}>{p.active ? "active" : "retired"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Review calendar */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Review Calendar</h2>
          {d.calendar.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No review dates set.</p> : (
            <div className="space-y-2">
              {d.calendar.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums ${c.overdue ? "bg-rose-50 text-rose-700" : c.dueSoon ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>{c.date}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{c.title}</span>
                  {c.overdue && <span className="text-[9px] font-semibold text-rose-600 shrink-0">OVERDUE</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Approval pipeline */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Approval Pipeline</h2>
            <Link href="/super-admin/platform-ops/approvals" className="text-xs text-teal-700 hover:underline">{dash(d.approvals.pending)} pending →</Link>
          </div>
          <div className="flex flex-wrap items-center gap-1 mb-3">
            {PIPELINE.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <span className="text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-1">{s}</span>
                {i < PIPELINE.length - 1 && <span className="text-gray-300 text-[10px]">→</span>}
              </div>
            ))}
          </div>
          {d.approvals.recent.length === 0 ? <p className="text-xs text-gray-400">No policy approval requests yet — submit one from the Policy Center above.</p> : (
            <div className="divide-y divide-gray-50">
              {d.approvals.recent.map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <span className="text-xs text-gray-700 flex-1 truncate">{r.entity_name}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${r.status === "pending" ? "bg-amber-50 text-amber-700" : r.status === "approved" ? "bg-green-50 text-green-700" : "bg-rose-50 text-rose-700"}`}>{r.status === "pending" ? `step ${r.current_step + 1}/${r.total_steps}` : r.status}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(r.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">Digital acknowledgements land with the acknowledgement store; policy version history with the versions table.</p>
        </div>

        {/* Policies by type */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Policies by Type <span className="text-[10px] text-gray-400">active</span></h2>
          {d.byType.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No active policies.</p> : (
            <div className="space-y-2">
              {d.byType.map((t: any) => (
                <div key={t.type}>
                  <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 capitalize">{t.type.replace(/_/g, " ")}</span><span className="tabular-nums text-gray-500">{t.n}</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${(t.n / Math.max(1, k.active)) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">{dash(d.approvedCount)} polic{d.approvedCount === 1 ? "y carries" : "ies carry"} a recorded approver.</p>
        </div>

        {/* Standards library */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Standards Library</h2>
          {d.standards.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No frameworks configured.</p> : (
            <div className="space-y-2">
              {d.standards.map((f: any) => (
                <div key={f.code} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${f.type === "accreditation" ? "bg-violet-50 text-violet-700" : f.type === "regulatory" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{f.code}</span>
                  <span className="text-sm text-gray-800 flex-1 truncate">{f.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{f.mapped} refs</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">SafeCare, JCI, MOH and internal standards from EQOS. Direct policy↔standard mapping lands with the obligations register (module 3).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Policy &amp; Standards Center manages the enterprise policy estate. All counts, the library, review currency and the approval pipeline are live (policies table + the platform approval engine’s policy_publication workflow). The policies schema stores no draft/review status and a single version field — so lifecycle states beyond active/retired, digital acknowledgements and per-version history show honest states until those stores are modelled.</p>
    </div>
  );
}
