import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, fmtTime, titleCase, ewsColor, STATE_TONE } from "@/lib/operations/patient-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Patient Census & Registry (POS-102) — the master operational patient register for
// the unit, rendered from the single source of truth (loadPatientOps over live op_*).
// This is the manager's read/oversight lens; operational data entry (admission,
// transfer, discharge) happens in the Patient Operations Centre. Identity/clinical
// fields not held operationally (name, MRN, sex, full diagnosis) render as honest "—".
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const firstName = (n: string | null) => (n ? n.split(" ").filter(Boolean)[0] ?? n : null);
const STATE_ORDER = ["Critical", "High Risk", "Review Required", "Observation", "Stable", "Theatre", "Transfer Pending", "Discharge Ready", "Expected"];

export default async function PatientCensus() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [po, departments] = await Promise.all([
    loadPatientOps(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Census &amp; Registry</h1><p className="text-sm text-gray-500">The master operational register — one active admission per patient, every change audited.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!po.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const { active, summary } = po;
  const stable = active.filter((p: any) => p.state === "Stable").length;
  const kpis = [
    { label: "Total patients", n: summary.total, tone: "text-gray-900" },
    { label: "High risk", n: summary.highRisk, tone: summary.highRisk ? "text-rose-600" : "text-gray-400" },
    { label: "Obs / review", n: summary.review, tone: summary.review ? "text-amber-600" : "text-gray-400" },
    { label: "Stable", n: stable, tone: "text-emerald-600" },
    { label: "Isolation", n: summary.isolation, tone: summary.isolation ? "text-fuchsia-600" : "text-gray-400" },
    { label: "Discharge ready", n: summary.dischargesExpected, tone: "text-teal-600" },
    { label: "Expected", n: summary.admissionsExpected, tone: "text-sky-600" },
    { label: "Unassigned", n: summary.unassigned, tone: summary.unassigned ? "text-rose-600" : "text-gray-400" },
  ];
  const stateCounts = new Map<string, number>();
  active.forEach((p: any) => stateCounts.set(p.state, (stateCounts.get(p.state) ?? 0) + 1));
  const chips = STATE_ORDER.filter(s => stateCounts.has(s)).map(s => ({ state: s, n: stateCounts.get(s) ?? 0 }));

  return (
    <div className="space-y-5">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {kpis.map(k => <div key={k.label} className={`${card} py-4 px-4`}><p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p><p className="text-[11px] text-gray-500 mt-1 leading-tight">{k.label}</p></div>)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs bg-gray-900 text-white rounded-full px-3 py-1 tabular-nums">All {active.length}</span>
        {chips.map(c => <span key={c.state} className={`text-xs rounded-full px-3 py-1 tabular-nums ${STATE_TONE[c.state] ?? "bg-gray-100 text-gray-600"}`}>{c.state} {c.n}</span>)}
        <span className="text-[11px] text-gray-400 ml-auto">Live · shared Patient Operations model</span>
      </div>

      <div className={`${card} p-0 overflow-hidden`}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
            <th className="text-left font-medium px-4 py-2.5">Bed</th><th className="text-left font-medium px-4 py-2.5">Patient</th><th className="text-left font-medium px-4 py-2.5">Age</th><th className="text-left font-medium px-4 py-2.5">Status</th><th className="text-left font-medium px-4 py-2.5">PEWS</th><th className="text-left font-medium px-4 py-2.5">Nurse</th><th className="text-left font-medium px-4 py-2.5">Consultant</th><th className="text-left font-medium px-4 py-2.5">Stage</th><th className="text-left font-medium px-4 py-2.5">Last obs</th><th className="text-left font-medium px-4 py-2.5">Next review</th><th className="text-left font-medium px-4 py-2.5">Flags</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {active.length === 0 && <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-400">No active patients on the register.</td></tr>}
            {active.map((p: any) => (
              <tr key={p.id} className="hover:bg-gray-50/60">
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 tabular-nums">{p.bed ?? "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap font-medium"><Link href={`/unit-manager/patient-operations/patient-card?patient=${p.id}`} className="text-emerald-700 hover:underline">{p.label}</Link></td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 tabular-nums">{p.age != null ? `${p.age}y` : "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap"><span className={`text-[10px] px-2 py-0.5 rounded-full ${STATE_TONE[p.state] ?? "bg-gray-100 text-gray-600"}`}>{p.state}</span></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><span className={`font-semibold tabular-nums ${ewsColor(p.pews)}`}>{p.pews ?? "—"}</span></td>
                <td className="px-4 py-2.5 whitespace-nowrap">{p.nurse ? <span className="text-gray-700">{firstName(p.nurse)}</span> : <span className="text-rose-600 font-medium">Unassigned</span>}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{p.consultant ?? "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{p.stage ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">{titleCase(p.stage)}</span> : <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 tabular-nums">{fmtTime(p.lastObs)}</td>
                <td className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${p.overdueObs ? "text-rose-600 font-medium" : "text-gray-500"}`}>{fmtTime(p.nextReview)}</td>
                <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1 max-w-[14rem]">{p.flags.length === 0 && <span className="text-[11px] text-gray-300">—</span>}{p.flags.map((f: string, i: number) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 whitespace-nowrap">{f}</span>)}</div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap"><p className="text-[11px] text-gray-400">Business rules (POS-102): one active admission per patient · no patient in two beds · every transfer timestamped · every census change is an audit event.</p><Link href="/supervisor/patient-ops-center" className="text-[11px] font-medium text-emerald-700 hover:underline shrink-0">Register / admit / transfer →</Link></div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Patient Census &amp; Registry (POS-102) — the operational master register over op_patients / op_beds / op_patient_assignments / op_observations. The registry holds no PHI: patient labels are operational ids; age is operational-lite; name, MRN, sex and the full clinical record live in the EMR and show as &ldquo;—&rdquo; until integrated. Admissions, transfers and discharges are entered in the <Link href="/supervisor/patient-ops-center" className="text-emerald-700 hover:underline">Patient Operations Centre</Link>.</p>
    </div>
  );
}
