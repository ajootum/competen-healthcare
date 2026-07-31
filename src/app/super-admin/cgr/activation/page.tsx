import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadActivationReadiness } from "@/lib/cgr/activation";
import { ProfileBuilder, ProfileStatus } from "./ProfileBuilder";

// CGR-028 — Service Activation Readiness (§9, over migration 151). Service profiles state what a service
// REQUIRES; the gate evaluates each active profile against every department's real workforce — current
// competent decisions at level, per-department assessor capacity — and returns READY / CONDITIONAL / NOT READY.
// Safety context stays owned by CGR-026; org-level readiness by CGR-029. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const VERDICT: Record<string, { label: string; cls: string }> = {
  ready: { label: "READY", cls: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" },
  conditional: { label: "CONDITIONAL", cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" },
  not_ready: { label: "NOT READY", cls: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]" },
};
const STATUS_META: Record<string, string> = {
  draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]", retired: "text-gray-400 bg-gray-50 border-gray-100",
};
const lvl = (l: string | null) => (l ? l.replace(/_/g, " ") : "any");

function Kpi({ label, value, sub, t }: { label: string; value: string | number; sub?: string; t?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${t ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function ActivationReadinessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [d, compRes] = await Promise.all([
    loadActivationReadiness(admin) as any,
    admin.from("framework_competencies").select("id, name, code").order("name").limit(400),
  ]);
  const competencies = ((compRes.error ? [] : compRes.data ?? []) as any[]).map((c) => ({ id: c.id, name: c.code ? `${c.name} (${c.code})` : c.name }));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-028 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Service Activation Readiness</h1>
          <p className="text-gray-400 text-sm mt-0.5">Are we ready to safely deliver this service? A profile states what the service requires; the gate evaluates every department&apos;s real workforce against it.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/cgr/executive" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Org readiness →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.ready ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5">
          <p className="text-[12px] text-amber-900"><span className="font-bold">Service profiles are not enabled.</span> Apply <span className="font-mono font-semibold">migration 151 (151-service-profiles.sql)</span> to create the requirements store — without it the activation gate has nothing to evaluate against.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Service profiles" value={d.kpis.profiles} sub={`${d.kpis.drafts} draft`} />
            <Kpi label="Active (gating)" value={d.kpis.active} sub="governed requirement sets" t={d.kpis.active ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
            <Kpi label="Requirements" value={d.kpis.requirements} sub="competency rules" />
            <Kpi label="Evaluations" value={d.kpis.evaluations} sub="profile × department" />
            <Kpi label="Ready" value={d.kpis.readyPairs} sub="all requirements met" t={d.kpis.readyPairs ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
            <Kpi label="Blocked" value={d.kpis.blockedPairs} sub="critical unmet" t={d.kpis.blockedPairs ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
          </div>

          <ProfileBuilder competencies={competencies} />

          {d.profiles.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <p className="text-[13px] text-gray-600 font-medium mb-1">No service profiles defined yet.</p>
              <p className="text-[12px] text-gray-400 leading-relaxed">Defining what a service requires is a clinical governance decision the platform cannot derive — that is exactly why this store did not exist until now. Define the first profile above (e.g. an ICU service requiring sepsis recognition for 4 staff at proficient, ventilation management for 2, critical), activate it, and every department is evaluated against it from real competency decisions.</p>
            </div>
          ) : (
            d.profiles.map((p: any) => (
              <div key={p.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{p.name}</p>
                    {p.code && <span className="text-[10px] font-mono text-gray-400">{p.code}</span>}
                    <span className={`text-[9px] font-bold uppercase border rounded px-1.5 py-0.5 ${STATUS_META[p.status] ?? STATUS_META.draft}`}>{p.status}</span>
                    {p.shared && <span className="text-[9px] font-bold text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded px-1.5 py-0.5">shared template</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400">{p.requirements.length} requirements · {p.criticalCount} critical · by {p.createdBy}</span>
                    <ProfileStatus id={p.id} status={p.status} />
                  </div>
                </div>

                <div className="px-4 py-2.5 border-b border-gray-50 flex flex-wrap gap-1.5">
                  {p.requirements.map((r: any, i: number) => (
                    <span key={i} className={`text-[10px] border rounded px-1.5 py-0.5 ${r.critical ? "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)] font-semibold" : "text-gray-600 bg-gray-50 border-gray-100"}`}>
                      {r.name} · ≥{r.minStaff} @ {lvl(r.minLevel)}{r.critical ? " · critical" : ""}
                    </span>
                  ))}
                </div>

                {p.status !== "active" ? (
                  <div className="px-4 py-3"><p className="text-[11px] text-gray-400">{p.status === "draft" ? "Draft — not evaluated. Activation is a governance act; the gate never evaluates an ungoverned requirements set." : "Retired — no longer gating."}</p></div>
                ) : p.evaluations.length === 0 ? (
                  <div className="px-4 py-3"><p className="text-[11px] text-gray-400">No departments with assigned staff to evaluate.</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px]">
                      <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                        <th className="text-left py-2 pl-4 pr-2">Department</th>
                        <th className="text-center py-2 px-2">Staff</th>
                        <th className="text-center py-2 px-2">Assessors</th>
                        <th className="text-left py-2 px-2 w-44">Requirements met</th>
                        <th className="text-left py-2 px-2">Unmet</th>
                        <th className="text-left py-2 pr-4 pl-2">Gate</th>
                      </tr></thead>
                      <tbody>
                        {p.evaluations.map((e: any) => (
                          <tr key={e.department} className="border-t border-gray-50">
                            <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{e.department}</td>
                            <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{e.staff}</td>
                            <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={e.assessors ? "text-gray-600" : "text-[var(--cmp-text-warning)] font-semibold"}>{e.assessors}</span></td>
                            <td className="py-2 px-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${e.verdict === "ready" ? "bg-[var(--cmp-color-success)]" : e.verdict === "conditional" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]"}`} style={{ width: `${e.coverage}%` }} /></div>
                                <span className="text-[11px] font-bold text-gray-600 tabular-nums w-10">{e.met}/{e.total}</span>
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              <div className="flex flex-wrap gap-1">
                                {e.unmet.length === 0 ? <span className="text-[10px] text-gray-300">—</span> : e.unmet.map((u: any, i: number) => (
                                  <span key={i} className={`text-[9px] border rounded px-1 py-0.5 ${u.critical ? "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)] font-semibold" : "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]"}`}>{u.name} {u.have}/{u.need}</span>
                                ))}
                              </div>
                            </td>
                            <td className="py-2 pr-4 pl-2"><span className={`text-[10px] font-bold border rounded px-2 py-0.5 ${VERDICT[e.verdict].cls}`}>{VERDICT[e.verdict].label}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">Every evaluation is real: a requirement is met only by staff in that department holding a <span className="font-medium">current</span> competent decision on that competency at the required level, and assessor capacity is the live authorisation register for that department&apos;s staff. Level convention, stated: a decision without recorded maturity counts as &ldquo;competent&rdquo; (the outcome asserts it) — requirements above competent therefore need recorded maturity. An unmet <span className="font-medium">critical</span> requirement blocks readiness regardless of coverage. Safety context lives in <Link href="/super-admin/cgr/clinical" className="text-[var(--cmp-text-success)] hover:underline">Clinical Intelligence</Link>; org-level assurance in the <Link href="/super-admin/cgr/executive" className="text-[var(--cmp-text-success)] hover:underline">board statement</Link>. Per the CGR mandate, this gate informs the decision — it never declares a service safe by itself, and clinical governance approval remains with accountable leaders.</p>
        </div>
      )}
    </div>
  );
}
