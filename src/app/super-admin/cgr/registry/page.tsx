import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceRegistry, type GovRecord, type GovState } from "@/lib/cgr/registry";

// CGR-001 — Competency Governance Registry & Master Control. The Registry Explorer + Governance Profile:
// one governance record per competency DEFINITION, joined live from the real governance spine (risk,
// ownership, regulatory mappings, review currency, governed decisions, open change control). Derives a
// governance state + completeness score per the "governance before deployment" principle. Super-admin.
export const dynamic = "force-dynamic";

const STATE_META: Record<GovState, { label: string; cls: string; dot: string }> = {
  governed: { label: "Governed", cls: "text-emerald-700 bg-emerald-50 border-emerald-100", dot: "bg-emerald-500" },
  monitor: { label: "Monitor", cls: "text-amber-700 bg-amber-50 border-amber-100", dot: "bg-amber-500" },
  at_risk: { label: "At risk", cls: "text-rose-700 bg-rose-50 border-rose-100", dot: "bg-rose-500" },
  ungoverned: { label: "Ungoverned", cls: "text-gray-500 bg-gray-50 border-gray-200", dot: "bg-gray-400" },
};
const RISK_META: Record<string, string> = {
  critical: "text-rose-700 bg-rose-50 border-rose-100",
  high: "text-orange-700 bg-orange-50 border-orange-100",
  standard: "text-gray-600 bg-gray-50 border-gray-200",
  low: "text-slate-500 bg-slate-50 border-slate-200",
};

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function ScoreBar({ v }: { v: number }) {
  const tone = v >= 75 ? "bg-emerald-500" : v >= 45 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[11px] font-semibold text-gray-600 tabular-nums w-6">{v}</span>
    </div>
  );
}

function StatePill({ s }: { s: GovState }) {
  const m = STATE_META[s];
  return <span className={`inline-flex items-center gap-1 text-[10px] font-bold border rounded px-1.5 py-0.5 ${m.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}</span>;
}

function Row({ r }: { r: GovRecord }) {
  return (
    <tr className="border-t border-gray-50 hover:bg-gray-50/60">
      <td className="py-2 pr-3">
        <p className="text-[13px] font-semibold text-gray-900 leading-tight">{r.name}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{r.code ? `${r.code} · ` : ""}{r.domain ?? "—"}{r.framework ? ` · ${r.framework}` : ""}</p>
      </td>
      <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 capitalize ${RISK_META[r.risk] ?? RISK_META.standard}`}>{r.risk}</span></td>
      <td className="py-2 px-2">
        {r.owner ? <span className="text-[12px] text-gray-700">{r.owner}</span> : <span className="text-[11px] font-semibold text-rose-600">Unowned</span>}
        {r.governanceRoles > 0 && <span className="text-[10px] text-gray-400 ml-1">+{r.governanceRoles}</span>}
      </td>
      <td className="py-2 px-2 text-center">
        {r.standards > 0 ? <span className="text-[12px] text-gray-700 tabular-nums">{r.standards}<span className="text-gray-300">/</span><span className="text-emerald-600">{r.standardsFull}</span></span> : <span className="text-[11px] text-gray-300">—</span>}
      </td>
      <td className="py-2 px-2 text-center">
        {r.decisions > 0 ? <span className="text-[12px] text-gray-700 tabular-nums">{r.decisions}{r.latestVersion > 0 && <span className="text-[10px] text-gray-400"> ·v{r.latestVersion}</span>}</span> : <span className="text-[11px] text-gray-300">—</span>}
      </td>
      <td className="py-2 px-2">
        {r.reviewDue ? <span className={`text-[11px] tabular-nums ${r.reviewOverdue ? "font-bold text-rose-600" : "text-gray-500"}`}>{r.reviewDue}{r.reviewOverdue && " ⚠"}</span> : <span className="text-[11px] text-gray-300">not set</span>}
        {r.openChanges > 0 && <span className="ml-1 text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded px-1">{r.openChanges} CR</span>}
      </td>
      <td className="py-2 px-2"><ScoreBar v={r.score} /></td>
      <td className="py-2 pl-2"><StatePill s={r.state} /></td>
    </tr>
  );
}

export default async function GovernanceRegistryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceRegistry(admin);
  const k = d.kpis;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-001 · Competency Governance Registry</p>
          <h1 className="text-xl font-bold text-gray-900">Governance Registry &amp; Master Control</h1>
          <p className="text-gray-400 text-sm mt-0.5">One governance record per competency — who owns it, what evidence and standards back it, when it&apos;s due for review, and its risk. The single source of truth for competency governance.</p>
        </div>
        <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← CGR Platform</Link>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400">No competency definitions found yet. Once the framework library holds competencies, each becomes a governance record here — scored on ownership, regulatory alignment, review currency and evidence.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
            <Kpi label="Competencies" value={d.total} sub={d.capped ? `showing top ${d.loaded}` : "in registry"} />
            <Kpi label="Avg governance" value={`${k.avgScore}`} sub="completeness /100" tone={k.avgScore >= 75 ? "text-emerald-600" : k.avgScore >= 45 ? "text-amber-600" : "text-rose-600"} />
            <Kpi label="With owner" value={`${k.ownerPct}%`} sub={`${k.withOwner} assigned`} tone={k.ownerPct >= 80 ? "text-emerald-600" : "text-gray-900"} />
            <Kpi label="Regulatory-mapped" value={`${k.standardsPct}%`} sub={`${k.withStandards} mapped`} tone={k.standardsPct >= 80 ? "text-emerald-600" : "text-gray-900"} />
            <Kpi label="Evidence-backed" value={`${k.evidencePct}%`} sub="have decisions" />
            <Kpi label="Overdue reviews" value={k.overdue} sub="past review date" tone={k.overdue ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="High/critical risk" value={k.highRisk} sub="need assurance" tone={k.highRisk ? "text-orange-600" : "text-gray-900"} />
          </div>

          {/* Governance state distribution */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Governance state</p>
              <p className="text-[10px] text-gray-400">across {d.loaded} records</p>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 mb-2.5">
              {(["governed", "monitor", "at_risk", "ungoverned"] as GovState[]).map((s) => {
                const w = d.loaded ? (d.states[s] / d.loaded) * 100 : 0;
                return w > 0 ? <div key={s} className={STATE_META[s].dot} style={{ width: `${w}%` }} title={`${STATE_META[s].label}: ${d.states[s]}`} /> : null;
              })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {(["governed", "monitor", "at_risk", "ungoverned"] as GovState[]).map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${STATE_META[s].dot}`} />
                  <span className="text-[11px] text-gray-600">{STATE_META[s].label}</span>
                  <span className="text-[11px] font-bold text-gray-900 tabular-nums">{d.states[s]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Registry Explorer */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Registry Explorer</p>
              <p className="text-[10px] text-gray-400">highest-risk first · {d.loaded} records</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pr-3 pl-4">Competency</th>
                    <th className="text-left py-2 px-2">Risk</th>
                    <th className="text-left py-2 px-2">Owner</th>
                    <th className="text-center py-2 px-2">Std<span className="text-gray-300">/full</span></th>
                    <th className="text-center py-2 px-2">Decisions</th>
                    <th className="text-left py-2 px-2">Review</th>
                    <th className="text-left py-2 px-2">Governance</th>
                    <th className="text-left py-2 pl-2 pr-4">State</th>
                  </tr>
                </thead>
                <tbody className="[&>tr>td:first-child]:pl-4 [&>tr>td:last-child]:pr-4">
                  {d.records.map((r) => <Row key={r.id} r={r} />)}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <p className="text-[11px] text-emerald-900 leading-relaxed">
              <span className="font-bold">Every fact here is real.</span> Risk comes from the competency library, ownership &amp; review dates from content responsibilities (CST-023), regulatory mappings from the Standards Mapping Centre (CST-108), decisions &amp; versions from governed competency decisions, and open change requests from change control. The governance <span className="font-semibold">state</span> and <span className="font-semibold">completeness score</span> are derived from those facts — a competency is &ldquo;governed&rdquo; only when it has an owner, regulatory alignment, a current review date, supporting evidence and an approved parent framework. Authoring the missing pieces happens in <Link href="/super-admin/studio/responsibilities" className="font-semibold underline">Ownership</Link>, <Link href="/super-admin/studio/standards" className="font-semibold underline">Standards Mapping</Link> and <Link href="/competency-office/review-board" className="font-semibold underline">Review &amp; Governance</Link>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
