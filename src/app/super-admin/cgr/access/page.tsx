import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceAccess } from "@/lib/cgr/access";

// CGR-014 — Competency Governance Security, Privacy & Access Control. The governance access map, the
// separation-of-duties check (author AND approver of the same object), assessor independence and permission
// review. Identity/RLS/encryption are the platform's — cross-linked to System. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const INDEP_META: Record<string, { label: string; cls: string }> = {
  independent: { label: "Independent", cls: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  supervised: { label: "Supervised", cls: "text-amber-700 bg-amber-50 border-amber-100" },
  countersigned: { label: "Countersigned", cls: "text-blue-700 bg-blue-50 border-blue-100" },
};
const CONTROLS = [
  { name: "Role-based access", note: "Governance roles via content responsibilities + platform roles" },
  { name: "Row-level security", note: "RLS enforced on every governance table (authenticated read, service-role writes)" },
  { name: "Full audit logging", note: "Every governance action recorded (audit_log + domain events)" },
  { name: "Tenant isolation", note: "Hospital / tenant scoping on governed data" },
];

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function GovernanceAccessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceAccess(admin) as any;
  const k = d.kpis;
  const roleMax = Math.max(1, ...d.roles.map((r: any) => r.count));
  const ass = d.assessor;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-014 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Security, Privacy &amp; Access Control</h1>
          <p className="text-gray-400 text-sm mt-0.5">Who can access governance information, what they can do, and how it&apos;s controlled — least privilege, separation of duties and full auditability.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/system/identity" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Identity &amp; access →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance responsibilities or assessor authorisations recorded yet. Once ownership and approval roles are assigned (in <Link href="/super-admin/studio/responsibilities" className="text-emerald-600 hover:underline">Ownership</Link>), the access map and separation-of-duties checks compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Role holders" value={k.holders} sub="distinct users" />
            <Kpi label="Governance approvers" value={k.approvers} sub="approval authority" />
            <Kpi label="Publishers" value={k.publishers} sub="publication authority" />
            <Kpi label="SoD conflicts" value={k.sodViolations} sub="author = approver" tone={k.sodViolations ? "text-rose-600" : "text-emerald-600"} />
            <Kpi label="Independent assessors" value={k.independentAssessors} sub="unsupervised authority" />
            <Kpi label="Reviews overdue" value={k.dueReview} sub="permission review" tone={k.dueReview ? "text-amber-600" : "text-gray-900"} />
          </div>

          {/* Separation of duties — flagship */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Separation of Duties <span className="text-[10px] font-normal text-gray-400">— §6: creators cannot approve their own submissions</span></p>
              <p className="text-[10px] text-gray-400">{k.sodViolations} conflict{k.sodViolations === 1 ? "" : "s"}</p>
            </div>
            {d.violations.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-emerald-600 font-medium">✓ No separation-of-duties conflicts — no user both authors and approves the same competency object.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Content object</th>
                    <th className="text-left py-2 px-2">User</th>
                    <th className="text-left py-2 pr-4 pl-2">Conflicting roles</th>
                  </tr></thead>
                  <tbody>
                    {d.violations.map((v: any, i: number) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2"><p className="text-[12px] font-medium text-gray-800">{v.content}</p><p className="text-[10px] text-gray-400">{v.type}</p></td>
                        <td className="py-2 px-2 text-[12px] text-gray-700">{v.user}</td>
                        <td className="py-2 pr-4 pl-2">
                          <div className="flex flex-wrap gap-1">
                            {v.roles.map((r: string) => <span key={r} className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded px-1.5 py-0.5">{r}</span>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Governance RBAC */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Governance access map (RBAC)</p>
              {d.roles.length === 0 ? (
                <p className="text-[12px] text-gray-400">No governance responsibilities assigned.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.roles.map((r: any) => (
                    <div key={r.role} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-36 shrink-0 truncate">{r.label}{r.isApproval && <span className="ml-1 text-[8px] font-bold text-emerald-600 uppercase">approve</span>}</span>
                      <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className={`h-full rounded ${r.isApproval ? "bg-emerald-500" : r.isAuthor ? "bg-blue-400" : "bg-gray-300"}`} style={{ width: `${(r.count / roleMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-7 text-right">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Assessor authorization */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Assessor authorisation <span className="font-normal normal-case text-gray-300">— {ass.total} grants</span></p>
              {ass.total === 0 ? (
                <p className="text-[12px] text-gray-400">No assessor authorisations recorded.</p>
              ) : (
                <>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Independence level</p>
                  <div className="flex gap-2 mb-3">
                    {(["independent", "supervised", "countersigned"] as const).map((lv) => (
                      <div key={lv} className={`flex-1 border rounded-lg p-2 text-center ${INDEP_META[lv].cls}`}>
                        <p className="text-lg font-bold tabular-nums">{ass.byIndep[lv]}</p>
                        <p className="text-[9px] font-semibold">{INDEP_META[lv].label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500">Active <span className="font-bold text-emerald-600">{ass.byStatus.active}</span> · suspended <span className="font-bold text-amber-600">{ass.byStatus.suspended}</span> · revoked <span className="font-bold text-rose-600">{ass.byStatus.revoked}</span></span>
                    {ass.expiring > 0 && <span className="text-rose-600 font-semibold">{ass.expiring} expiring ≤30d</span>}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Access controls posture */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Access controls posture <span className="font-normal normal-case text-gray-300">— platform-enforced</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {CONTROLS.map((c) => (
                <div key={c.name} className="border border-gray-100 rounded-lg p-3">
                  <p className="text-[12px] font-semibold text-gray-700 flex items-center gap-1"><span className="text-emerald-500">✓</span>{c.name}</p>
                  <p className="text-[10px] text-gray-400 leading-snug mt-0.5">{c.note}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — governance roles and assessor authorisations from the scoped-authority stores, and the separation-of-duties check computed by cross-referencing who authors and who approves each competency object. Identity management, authentication, encryption and RLS enforcement are owned by the <Link href="/super-admin/system" className="text-emerald-600 hover:underline">System &amp; Security platform</Link>; emergency (break-glass) access is tracked in <Link href="/super-admin/cgr/risk" className="text-emerald-600 hover:underline">Exceptions &amp; Risk</Link>. Per the CGR mandate, AI analyses approved governance data only and cannot bypass security controls or approve governance decisions.</p>
        </div>
      )}
    </div>
  );
}
