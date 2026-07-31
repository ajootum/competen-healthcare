import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceCouncil } from "@/lib/cgr/council";
import { Kpi } from "../_kit";

// CGR-010 — Competency Governance Operating Model & Council. The LIVE council structure (governance_committees +
// members + what each governs) with accountability coverage, above the office's STATED operating model (decision
// rights, RACI, meeting cadence — clearly labelled reference). Office councils cross-link to OGS. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const LEVEL_META: Record<string, string> = {
  enterprise: "text-indigo-700 bg-indigo-50 border-indigo-100",
  country: "text-blue-700 bg-blue-50 border-blue-100",
  facility: "text-teal-700 bg-teal-50 border-teal-100",
  department: "text-emerald-700 bg-emerald-50 border-emerald-100",
  specialty: "text-slate-600 bg-slate-50 border-slate-200",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Stated operating model (narrative reference, per CGR-010 §8/§9/§10) ──
const DECISION_RIGHTS = [
  { decision: "Create competency", owner: "Competency Studio (CST)" },
  { decision: "Approve competency", owner: "Governance authority" },
  { decision: "Deploy competency program", owner: "Competency Office (CMO)" },
  { decision: "Accept competency risk", owner: "Executive authority" },
];
const RACI = [
  { activity: "Competency creation", responsible: "CST", accountable: "Clinical owner" },
  { activity: "Competency approval", responsible: "Reviewers", accountable: "Governance authority" },
  { activity: "Competency deployment", responsible: "CMO", accountable: "Department leadership" },
  { activity: "Competency risk", responsible: "Quality & Practice leads", accountable: "Executive leadership" },
];
const MEETINGS = [
  { name: "Operational Review", cadence: "Monthly", focus: "Implementation issues · competency gaps · operational risks" },
  { name: "Governance Council", cadence: "Quarterly", focus: "Strategic assurance · regulatory alignment · maturity" },
  { name: "Executive Review", cadence: "Quarterly / Semiannual", focus: "Organisational readiness · workforce risk" },
];

export default async function GovernanceCouncilPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceCouncil(admin) as any;
  const k = d.kpis;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-010 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Operating Model &amp; Governance Council</h1>
          <p className="text-gray-400 text-sm mt-0.5">Who governs competency systems, who makes decisions, and how accountability is maintained — the live council structure above the stated operating model.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/office-governance" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Office governance →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Kpi label="Councils" value={k.councils} sub={`${k.active} active`} />
        <Kpi label="Members" value={k.members} sub={`${k.chairs} chairs`} />
        <Kpi label="Quorum met" value={`${k.quorumMet}/${k.councils}`} sub="councils quorate" tone={k.councils && k.quorumMet === k.councils ? "text-emerald-600" : k.quorumMet < k.councils ? "text-amber-600" : "text-gray-900"} />
        <Kpi label="Frameworks governed" value={k.fwGoverned} sub={`of ${k.frameworks}`} />
        <Kpi label="Accountability coverage" value={k.coveragePct == null ? "—" : `${k.coveragePct}%`} sub="frameworks with a council" tone={k.coveragePct == null ? "text-gray-900" : k.coveragePct >= 80 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Ungoverned" value={k.fwUngoverned} sub="no accountable council" tone={k.fwUngoverned ? "text-rose-600" : "text-gray-900"} />
      </div>

      {/* Live council structure */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-800">Governance Councils <span className="text-[10px] font-normal text-emerald-600">— live</span></p>
          {d.byLevel.length > 0 && <p className="text-[10px] text-gray-400">{d.byLevel.map((l: any) => `${cap(l.level)} ${l.councils}`).join(" · ")}</p>}
        </div>
        {!d.provisioned ? (
          <div className="p-6 text-center"><p className="text-sm text-gray-400">No competency-governance councils constituted yet. Office-level governance bodies live in <Link href="/office-governance" className="text-emerald-600 hover:underline">Office Governance</Link>; the stated operating model is below.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                <th className="text-left py-2 pl-4 pr-2">Council</th>
                <th className="text-left py-2 px-2">Level</th>
                <th className="text-left py-2 px-2">Chair</th>
                <th className="text-center py-2 px-2">Members</th>
                <th className="text-center py-2 px-2">Reviewers</th>
                <th className="text-center py-2 px-2">Governs</th>
                <th className="text-left py-2 pr-4 pl-2">Quorum</th>
              </tr></thead>
              <tbody>
                {d.councils.map((c: any) => (
                  <tr key={c.id} className="border-t border-gray-50">
                    <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{c.name}{!c.active && <span className="ml-1 text-[9px] text-gray-400">(inactive)</span>}</td>
                    <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${LEVEL_META[c.level] ?? LEVEL_META.facility}`}>{cap(c.level)}</span></td>
                    <td className="py-2 px-2 text-[11px] text-gray-600">{c.chairs.length ? c.chairs.join(", ") : <span className="text-rose-500">no chair</span>}</td>
                    <td className="py-2 px-2 text-center text-[12px] text-gray-700 tabular-nums">{c.members}</td>
                    <td className="py-2 px-2 text-center text-[12px] text-gray-500 tabular-nums">{c.reviewers}</td>
                    <td className="py-2 px-2 text-center text-[12px] tabular-nums">{c.frameworksGoverned > 0 ? <span className="font-semibold text-gray-700">{c.frameworksGoverned} fw</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="py-2 pr-4 pl-2">{c.meetsQuorum ? <span className="text-[10px] font-semibold text-emerald-600">✓ {c.members}/{c.quorum}</span> : <span className="text-[10px] font-semibold text-amber-600">⚠ {c.members}/{c.quorum}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Accountability coverage gap */}
      {d.provisioned && d.ungovernedFrameworks.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Accountability gap — frameworks without a governing council</p>
          <div className="flex flex-wrap gap-1.5">
            {d.ungovernedFrameworks.map((f: any) => <span key={f.id} className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-0.5">{f.name} <span className="text-rose-300">· {f.pubStatus}</span></span>)}
            {k.fwUngoverned > d.ungovernedFrameworks.length && <span className="text-[11px] text-gray-400 px-2 py-0.5">+{k.fwUngoverned - d.ungovernedFrameworks.length} more</span>}
          </div>
        </div>
      )}

      {/* Stated operating model — narrative reference */}
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Operating model — stated framework <span className="font-normal normal-case text-gray-300">(reference, not computed)</span></p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[11px] font-semibold text-gray-500 mb-3">🗳️ Decision rights</p>
          <div className="space-y-2">
            {DECISION_RIGHTS.map((r) => (
              <div key={r.decision} className="flex items-start justify-between gap-2 border-b border-gray-50 pb-1.5 last:border-0">
                <span className="text-[12px] text-gray-700">{r.decision}</span>
                <span className="text-[11px] font-semibold text-gray-500 text-right shrink-0">{r.owner}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[11px] font-semibold text-gray-500 mb-3">📋 RACI</p>
          <div className="space-y-2">
            {RACI.map((r) => (
              <div key={r.activity} className="border-b border-gray-50 pb-1.5 last:border-0">
                <p className="text-[12px] font-medium text-gray-700">{r.activity}</p>
                <p className="text-[10px] text-gray-400">R: {r.responsible} · <span className="font-semibold text-gray-500">A: {r.accountable}</span></p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[11px] font-semibold text-gray-500 mb-3">📅 Meeting cadence</p>
          <div className="space-y-2">
            {MEETINGS.map((m) => (
              <div key={m.name} className="border-b border-gray-50 pb-1.5 last:border-0">
                <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-gray-700">{m.name}</span><span className="text-[10px] font-semibold text-emerald-600">{m.cadence}</span></div>
                <p className="text-[10px] text-gray-400 leading-snug">{m.focus}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">The council structure at the top is REAL — the governance committees, their membership and quorum, and what each governs (frameworks linked to their governing council), with the accountability coverage gap where frameworks have no council. The decision-rights matrix, RACI and meeting cadence are the office&apos;s stated operating model (reference). Office-level governance bodies, meetings, votes and e-signatures are owned by <Link href="/office-governance" className="text-emerald-600 hover:underline">Office Governance (OGS)</Link>; council appointments by the <Link href="/competency-office/membership" className="text-emerald-600 hover:underline">Competency Office</Link>. Per the CGR mandate, AI supports meeting prep and summaries but never replaces the council or makes accountability decisions.</p>
    </div>
  );
}
