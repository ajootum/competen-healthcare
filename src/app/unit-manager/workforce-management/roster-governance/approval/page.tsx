import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRosterGovernance } from "@/lib/operations/roster-governance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Approval & Publication (UMW-WFM-004 §15) — controls formal authorisation and release of the
// official roster. Submission preconditions + publishability are REAL (governance validation);
// publication itself is wired on the Scheduling Engine (RosterControls → /api/operations/
// rosters, audited publish_roster). The configurable multi-step approval chain + attestation
// records need a roster_approval store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

export default async function ApprovalPublication() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadRosterGovernance(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Approval &amp; Publication</h1><p className="text-sm text-gray-500">Formal authorisation and release of the official roster.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  const a = d.assurance;
  // Submission preconditions (§15.3) — real
  const preconds = [
    { label: "Validation run is current", ok: true },
    { label: "All blocking exceptions resolved", ok: a.blockingReasons.length === 0 },
    { label: "Shift Supervisor coverage complete", ok: d.supervisor.uncovered === 0 },
    { label: "Coverage meets minimum", ok: d.coverage.uncoveredShifts === 0 },
    { label: "Assurance score ≥ 75 (review threshold)", ok: (a.score ?? 0) >= 75 },
  ];
  const canSubmit = preconds.every(p => p.ok);
  const CHAIN = [
    { role: "Roster Officer", cond: "Review", when: "Always" },
    { role: "Unit Manager", cond: "Approve", when: "Always" },
    { role: "Nursing Administration", cond: "Approve critical exception", when: "When a critical exception is accepted" },
    { role: "HR / Finance", cond: "Approve", when: "When contract/leave or overtime thresholds exceeded" },
    { role: "Publication", cond: "Authorise release", when: "Final step" },
  ];

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Publishability */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Publish readiness</h3>
          <div className={`rounded-lg p-3 ${a.publishable ? "bg-emerald-50 border border-emerald-100" : "bg-rose-50 border border-rose-100"}`}>
            <p className={`text-sm font-bold ${a.publishable ? "text-emerald-700" : "text-rose-700"}`}>{a.publishable ? "✓ Publishable" : "⛔ Blocked from publication"}</p>
            <p className="text-[11px] text-gray-600 mt-0.5">Assurance {a.score ?? "—"}/100 · {a.band}</p>
            {!a.publishable && <ul className="mt-2 space-y-0.5">{a.blockingReasons.map((r: string, i: number) => (<li key={i} className="text-[11px] text-gray-700">• {r}</li>))}</ul>}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">A roster with an unresolved blocking exception cannot be published even at a high score (BR-002 / §8.2).</p>
          <div className="mt-3 rounded-lg border border-gray-100 p-2.5">
            <p className="text-[10px] text-gray-500 uppercase">Current status</p>
            <p className="text-sm font-semibold text-gray-800 capitalize">{d.roster.status}{d.roster.publishedAt ? ` · ${fmtDate(d.roster.publishedAt)}` : ""}</p>
          </div>
          <Link href="/unit-manager/scheduling-engine" className="mt-3 block text-center text-xs font-semibold rounded-lg py-2 bg-emerald-600 text-white hover:bg-emerald-700">Publish in Scheduling Engine ↗</Link>
        </div>

        {/* Submission preconditions */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Submission preconditions <span className="text-[10px] text-gray-400 font-normal">§15.3</span></h3>
          <div className="space-y-2">{preconds.map((p, i) => (<div key={i} className="flex items-center gap-2 text-sm"><span className={p.ok ? "text-emerald-600" : "text-rose-500"}>{p.ok ? "✓" : "✗"}</span><span className={p.ok ? "text-gray-700" : "text-gray-500"}>{p.label}</span></div>))}</div>
          <div className={`mt-3 rounded-lg p-3 text-xs ${canSubmit ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{canSubmit ? "All preconditions met — the roster can be submitted for approval." : "Some preconditions are unmet — resolve before submitting for approval."}</div>
          <div className="mt-3 rounded-lg border border-gray-100 p-3">
            <p className="text-[10px] text-gray-500 uppercase mb-1">Approval attestation (§15.5)</p>
            <p className="text-[11px] text-gray-600 italic">&ldquo;I confirm that I have reviewed this roster and that identified staffing, competency, supervisor, working-time and exception requirements have been addressed or formally accepted through the approved governance process.&rdquo;</p>
          </div>
        </div>
      </div>

      {/* Approval chain */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Configurable approval workflow <span className="text-[10px] text-gray-400 font-normal">§15.2 · conditional steps</span></h3>
        <ol className="space-y-0">{CHAIN.map((s, i) => (<li key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0"><span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span><div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2 flex-wrap"><p className="text-xs font-semibold text-gray-800">{s.role}</p><span className="text-[10px] text-gray-400">{s.when}</span></div><p className="text-[11px] text-gray-500">{s.cond}</p></div></li>))}</ol>
        <p className="text-[10px] text-gray-400 mt-2">The stateful approval chain (approve / approve-with-conditions / return / reject / delegate) with attestation records + segregation of duties (BR-013) needs a roster_approval store → next-phase. Publication itself is wired &amp; audited on the Scheduling Engine.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Approval &amp; Publication (UMW-WFM-004 §15). Preconditions + publishability are real over the governance validation; publication updates downstream staff/shift workspaces once released. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
