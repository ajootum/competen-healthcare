import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyCentre } from "@/lib/operations/competency-centre";
import CompetencyTabs from "./CompetencyTabs";

// Competency Management (UMG-CM) command centre — the Unit Manager's lens over the unit's competency posture:
// coverage & deployability, credential expiries, pending validations and the competency assignments the CDP
// delivery engine landed on this unit. Composes the real competency system (loadCompetencyCentre); nothing
// fabricated. Deep org-wide governance lives in the Competency Office (cross-linked).
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const SEV: Record<string, string> = { critical: "border-rose-200 bg-rose-50 text-rose-700", high: "border-amber-200 bg-amber-50 text-amber-700", moderate: "border-yellow-200 bg-yellow-50 text-yellow-700" };
const TONE: Record<string, string> = { red: "border-rose-200 bg-rose-50", amber: "border-amber-200 bg-amber-50", gray: "border-gray-200 bg-gray-50", green: "border-emerald-200 bg-emerald-50" };
const barCls = (n: number) => (n >= 85 ? "bg-emerald-500" : n >= 60 ? "bg-amber-500" : "bg-rose-500");

export default async function CompetencyCommandPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const c = await loadCompetencyCentre(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const card = "bg-white rounded-xl border border-gray-200 p-5";
  const r: any = c.readiness ?? {};
  const roleCoverage: any[] = r.roleCoverage ?? [];
  const risks: any[] = r.risks ?? [];
  const expiring: any[] = [...(r.expiringStaff ?? []), ...(r.expiredStaff ?? [])];

  const KPIS = [
    { label: "Coverage", value: c.kpis.coverage != null ? `${c.kpis.coverage}%` : "—", tone: "text-gray-900", sub: `${c.kpis.fullyDeployable}/${c.kpis.total} fully deployable` },
    { label: "Credentials expiring", value: c.kpis.credentialsExpiring, tone: "text-amber-600", sub: "within 30 days" },
    { label: "Credentials expired", value: c.kpis.credentialsExpired, tone: "text-rose-600", sub: "blocks deployment" },
    { label: "Pending validations", value: c.kpis.pendingValidations, tone: "text-gray-900", sub: `${c.kpis.validationsOverdue} overdue` },
    { label: "Delivered assignments", value: c.delivered.total, tone: "text-gray-900", sub: `${c.delivered.completionPct != null ? c.delivered.completionPct + "% complete" : "—"}` },
    { label: "Deliveries overdue", value: c.kpis.deliveredOverdue, tone: c.kpis.deliveredOverdue ? "text-rose-600" : "text-gray-900", sub: "past due date" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Competency Management</h1>
        <p className="text-sm text-gray-500 mt-1">Your unit&apos;s competency posture — coverage, expiries, validations and the competencies delivery landed on your team.</p>
      </div>
      <CompetencyTabs />

      {!c.provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">Competency data isn&apos;t available for this unit yet. Once staff have competency decisions and assignments, this command centre populates automatically.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {KPIS.map(k => (
              <div key={k.label} className={card}>
                <div className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.value}</div>
                <div className="text-xs text-gray-500 mt-1 font-medium">{k.label}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* AI command insight */}
          {c.ai.length > 0 && (
            <div className={card}>
              <h3 className="font-semibold text-gray-900 mb-3 text-sm">Command insight</h3>
              <div className="space-y-2">
                {c.ai.map((a: any, i: number) => (
                  <div key={i} className={`flex items-start gap-3 rounded-lg border p-3 ${TONE[a.tone] ?? TONE.gray}`}>
                    <span className="text-sm">{a.tone === "red" ? "🔴" : a.tone === "amber" ? "🟠" : a.tone === "green" ? "🟢" : "⚪"}</span>
                    <div><p className="text-sm font-semibold text-gray-800">{a.title}</p><p className="text-xs text-gray-500 mt-0.5">{a.detail}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Role coverage */}
            <div className={card}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 text-sm">Coverage by role</h3>
                <Link href="/unit-manager/competency/coverage" className="text-xs text-teal-600 hover:underline">Coverage & gaps →</Link>
              </div>
              {roleCoverage.length === 0 ? <p className="text-sm text-gray-400">No role coverage data yet.</p> : (
                <div className="space-y-2.5">
                  {roleCoverage.slice(0, 8).map((rc: any) => (
                    <div key={rc.role} className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 w-40 truncate">{rc.label}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[160px]"><div className={`h-full ${barCls(rc.pct ?? 0)}`} style={{ width: `${rc.pct ?? 0}%` }} /></div>
                      <span className="text-xs tabular-nums text-gray-500 w-10 text-right">{rc.pct != null ? `${rc.pct}%` : "—"}</span>
                      <span className="text-[11px] text-gray-400 ml-auto">{rc.current}/{rc.total} current</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Risk & gap panel */}
            <div className={card}>
              <h3 className="font-semibold text-gray-900 text-sm mb-3">Competency risks & gaps</h3>
              {risks.length === 0 ? <p className="text-sm text-gray-400">No competency risks flagged. 🎉</p> : (
                <div className="space-y-2">
                  {risks.slice(0, 6).map((rk: any, i: number) => (
                    <div key={i} className={`rounded-lg border p-2.5 ${SEV[rk.severity] ?? SEV.moderate}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">{rk.title}</p>
                        <span className="text-[9px] font-bold uppercase tracking-wide shrink-0">{rk.severity}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">{rk.detail}</p>
                      <p className="text-[11px] text-gray-600 mt-1">→ {rk.action}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delivered assignments (CDP output) */}
            <div className={card}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 text-sm">Delivered competency assignments</h3>
                <Link href="/unit-manager/competency/assignments" className="text-xs text-teal-600 hover:underline">All deliveries →</Link>
              </div>
              {!c.deliveredProvisioned || c.delivered.total === 0 ? (
                <p className="text-sm text-gray-400">No competency assignments delivered to this unit yet. The delivery orchestrator materialises these from assignment rules and campaigns.</p>
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-3">
                    <div><div className="text-xl font-bold text-gray-900 tabular-nums">{c.delivered.total}</div><div className="text-[10px] text-gray-400">delivered</div></div>
                    <div><div className="text-xl font-bold text-emerald-600 tabular-nums">{c.delivered.completionPct ?? 0}%</div><div className="text-[10px] text-gray-400">complete</div></div>
                    <div><div className="text-xl font-bold text-rose-600 tabular-nums">{c.delivered.overdue}</div><div className="text-[10px] text-gray-400">overdue</div></div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {c.delivered.recent.map((d: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 py-1.5">
                        <span className="text-xs text-gray-700 truncate flex-1">{d.competency}</span>
                        <span className="text-[10px] text-gray-400 truncate max-w-[100px]">{d.target}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 ${d.overdue ? "bg-rose-50 text-rose-600" : d.status === "completed" ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>{d.overdue ? "overdue" : d.status}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Expiry watch + validation summary */}
            <div className={card}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 text-sm">Expiry & validation watch</h3>
                <Link href="/unit-manager/competency/recertification" className="text-xs text-teal-600 hover:underline">Recert pipeline →</Link>
              </div>
              <div className="flex items-center gap-4 mb-3">
                <div><div className="text-xl font-bold text-amber-600 tabular-nums">{c.kpis.credentialsExpiring}</div><div className="text-[10px] text-gray-400">expiring ≤30d</div></div>
                <div><div className="text-xl font-bold text-rose-600 tabular-nums">{c.kpis.credentialsExpired}</div><div className="text-[10px] text-gray-400">expired</div></div>
                <Link href="/unit-manager/competency-validations" className="ml-auto text-right hover:underline"><div className="text-xl font-bold text-gray-900 tabular-nums">{c.kpis.pendingValidations}</div><div className="text-[10px] text-gray-400">pending validation →</div></Link>
              </div>
              {expiring.length === 0 ? <p className="text-sm text-gray-400">No staff with expiring or expired competencies.</p> : (
                <div className="divide-y divide-gray-50">
                  {expiring.slice(0, 6).map((s: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1.5">
                      <span className="text-xs text-gray-700 truncate flex-1">{s.name ?? "—"}</span>
                      <span className="text-[10px] text-gray-400">{s.role ?? ""}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 ${s.status === "Expired" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
