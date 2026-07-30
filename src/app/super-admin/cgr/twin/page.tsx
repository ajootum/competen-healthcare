import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyTwin } from "@/lib/cgr/twin";

// CGR-024 — Digital Competency Twin. The §6 confidence-weighted competency state (capability + evidence
// confidence + recency + risk) at individual, team and organisational level. Distinct from COMP-019
// readiness-states, which resolves outcome + expiry into categorical states. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const tone = (v: number) => (v >= 75 ? "text-emerald-600" : v >= 55 ? "text-amber-600" : "text-rose-600");
const bar = (v: number) => (v >= 75 ? "bg-emerald-500" : v >= 55 ? "bg-amber-500" : "bg-rose-500");
const RISK_META: Record<string, string> = {
  critical: "text-rose-700 bg-rose-50 border-rose-100", high: "text-orange-700 bg-orange-50 border-orange-100",
  standard: "text-gray-600 bg-gray-50 border-gray-200", low: "text-slate-500 bg-slate-50 border-slate-200",
};

function Kpi({ label, value, sub, t }: { label: string; value: string | number; sub?: string; t?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${t ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function CompetencyTwinPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadCompetencyTwin(admin) as any;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-024 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Digital Competency Twin</h1>
          <p className="text-gray-400 text-sm mt-0.5">What is the current competency state of the workforce — not just who is signed off, but how confident that signature is. Modelled at individual, team and organisational level.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/competency-office/readiness-states" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Readiness states →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No competency decisions recorded yet — the twin models current state from real decisions, so it computes once assessments exist.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Organisational state" value={d.orgState} sub="/100 confidence-weighted" t={tone(d.orgState)} />
            <Kpi label="People modelled" value={d.totals.people} sub={`${d.totals.records} competency states`} />
            <Kpi label="Unvalidated" value={d.totals.unvalidated} sub="no independent validation" t={d.totals.unvalidated ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Stale" value={d.totals.stale} sub="late in the cert window" t={d.totals.stale ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Critical weak" value={d.totals.criticalWeak} sub="high-risk, low state" t={d.totals.criticalWeak ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="Teams" value={d.teams.length} sub="department twins" />
          </div>

          {/* State model — what the score is actually made of */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Competency state model (§6)</p>
              <span className="text-[10px] text-gray-400">Capability + Evidence confidence + Recency + Practice exposure + Risk</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {d.factors.map((f: any) => (
                <div key={f.label} className={`border rounded-lg p-3 ${f.value == null ? "border-dashed border-gray-200 bg-gray-50/50" : "border-gray-100"}`}>
                  <p className={`text-xl font-bold tabular-nums ${f.value == null ? "text-gray-300" : tone(f.value)}`}>{f.value == null ? "—" : f.value}</p>
                  <p className="text-[11px] font-medium text-gray-700 leading-tight">{f.label}</p>
                  <p className="text-[10px] text-gray-400 leading-snug mt-0.5">{f.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Team twins */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Team competency twins (§5.2)</p>
              <p className="text-[10px] text-gray-400">weakest first</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                  <th className="text-left py-2 pl-4 pr-2">Team / department</th>
                  <th className="text-center py-2 px-2">People</th>
                  <th className="text-center py-2 px-2">States</th>
                  <th className="text-center py-2 px-2">Unvalidated</th>
                  <th className="text-center py-2 px-2">Critical weak</th>
                  <th className="text-left py-2 pr-4 pl-2 w-40">Collective state</th>
                </tr></thead>
                <tbody>
                  {d.teams.map((t: any) => (
                    <tr key={t.name} className="border-t border-gray-50">
                      <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{t.name}</td>
                      <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{t.people}</td>
                      <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{t.records}</td>
                      <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={t.unvalidated ? "text-amber-600 font-semibold" : "text-gray-400"}>{t.unvalidated}</span></td>
                      <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={t.criticalWeak ? "text-rose-600 font-semibold" : "text-gray-400"}>{t.criticalWeak}</span></td>
                      <td className="py-2 pr-4 pl-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${bar(t.state)}`} style={{ width: `${t.state}%` }} /></div>
                          <span className={`text-[11px] font-bold tabular-nums w-6 ${tone(t.state)}`}>{t.state}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Individual twins */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Individual competency twins (§5.1)</p>
              <p className="text-[10px] text-gray-400">lowest state first · {d.individualsTotal} people</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                  <th className="text-left py-2 pl-4 pr-2">Person</th>
                  <th className="text-left py-2 px-2">Department</th>
                  <th className="text-center py-2 px-2">Comps</th>
                  <th className="text-center py-2 px-2">Unval.</th>
                  <th className="text-center py-2 px-2">Stale</th>
                  <th className="text-left py-2 px-2">Weakest competency</th>
                  <th className="text-left py-2 pr-4 pl-2 w-32">State</th>
                </tr></thead>
                <tbody>
                  {d.individuals.map((p: any) => (
                    <tr key={p.id} className="border-t border-gray-50">
                      <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{p.name}{p.criticalWeak > 0 && <span className="ml-1.5 text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded px-1">{p.criticalWeak} critical</span>}</td>
                      <td className="py-2 px-2 text-[11px] text-gray-500">{p.department ?? "—"}</td>
                      <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{p.competencies}</td>
                      <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={p.unvalidated ? "text-amber-600" : "text-gray-400"}>{p.unvalidated}</span></td>
                      <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={p.stale ? "text-amber-600" : "text-gray-400"}>{p.stale}</span></td>
                      <td className="py-2 px-2">
                        <span className="text-[11px] text-gray-600">{p.weakest.competency}</span>
                        <span className={`ml-1 text-[9px] font-bold border rounded px-1 capitalize ${RISK_META[p.weakest.risk] ?? RISK_META.standard}`}>{p.weakest.risk}</span>
                        <span className={`ml-1 text-[10px] font-bold tabular-nums ${tone(p.weakest.state)}`}>{p.weakest.state}</span>
                      </td>
                      <td className="py-2 pr-4 pl-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${bar(p.state)}`} style={{ width: `${p.state}%` }} /></div>
                          <span className={`text-[11px] font-bold tabular-nums w-6 ${tone(p.state)}`}>{p.state}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <p className="text-[11px] text-amber-900 leading-relaxed">
              <span className="font-bold">What this models, and what it doesn&apos;t.</span> Four of the five §6 dimensions are computed from real decision records — capability (outcome × Benner maturity), evidence confidence (independent validation + recorded evidence), recency (position in the certification window) and risk weighting (critical/high competencies are penalised harder for the same weakness). <span className="font-semibold">Practice exposure is not modelled</span>: nothing links a worker&apos;s shift or patient activity to a specific competency, so it is shown as unavailable rather than proxied by something that would look like evidence and isn&apos;t. Forecasting and scenario simulation (§7) need that link plus a trend history, and are not claimed here.
            </p>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">This is deliberately <span className="font-medium">not</span> the same view as <Link href="/competency-office/readiness-states" className="text-emerald-600 hover:underline">Readiness States (COMP-019)</Link>, which resolves outcome + expiry into seven categorical states. Two people can both read &ldquo;Ready&rdquo; there while one holds a validated expert decision on a low-risk competency and the other an unvalidated novice decision on a critical one — the twin separates them. Per the CGR mandate, AI may model and predict but never determines competence without evidence or replaces the assessment process.</p>
        </div>
      )}
    </div>
  );
}
