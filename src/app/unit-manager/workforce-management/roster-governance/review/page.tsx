import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Roster Review (UMW-WFM-004 §9) — the interactive review surface for the complete roster
// before approval. Renders the real roster grid (unit × date, day/night) over
// op_roster_assignments with per-shift staff, supervisor and gaps. Interactive editing
// (add/remove/replace/drag-drop, rerun) is performed in the Scheduling Engine and triggers
// revalidation → cross-linked. Version comparison needs a version store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmtD = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
const initials = (name?: string) => (name ?? "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

export default async function RosterReview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [rw, departments] = await Promise.all([
    loadRosterForWeek(admin, hid, isSuper, mondayOf()) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Roster Review</h1><p className="text-sm text-gray-500">Review the complete roster before approval — shifts, staff, supervisors and gaps.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!rw.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!rw.roster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  const asg: any[] = rw.assignments ?? [];
  const days: string[] = rw.days ?? [];
  const units = [...new Set(asg.map(a => a.unit_name))];
  const cellAsg = (unit: string, day: string, shift: string) => asg.filter(a => a.unit_name === unit && a.shift_date === day && a.shift_type === shift);

  return (
    <div className="space-y-4">
      {header}

      <div className={`${card} p-4 flex items-center gap-4 flex-wrap text-xs`}>
        <span className="text-gray-600">Week of <b>{fmtD(rw.roster.week_start)}</b></span>
        <span className="text-gray-600">Version <b>v{rw.roster.version}</b></span>
        <span className="text-gray-600">Status <span className={`px-1.5 py-0.5 rounded ${rw.roster.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{rw.roster.status}</span></span>
        <span className="text-gray-600">{rw.roster.slots_filled}/{rw.roster.slots_total} posts filled</span>
        <Link href="/unit-manager/scheduling-engine" className="ml-auto text-[11px] font-semibold text-emerald-700 hover:underline">Edit in Scheduling Engine ↗</Link>
      </div>

      {units.map(unit => (
        <div key={unit} className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">{unit}</h3>
          <div className="overflow-x-auto"><table className="w-full text-xs border-separate" style={{ borderSpacing: "4px" }}>
            <thead><tr><th className="text-left text-gray-400 font-medium pr-2 w-14"></th>{days.map(day => <th key={day} className="text-gray-400 font-medium whitespace-nowrap">{fmtD(day)}</th>)}</tr></thead>
            <tbody>{["day", "night"].map(shift => (
              <tr key={shift}>
                <td className="text-gray-500 pr-2 align-top pt-1">{shift === "day" ? "☀️ Day" : "🌑 Night"}</td>
                {days.map(day => { const cells = cellAsg(unit, day, shift); const filled = cells.filter(c => c.status === "assigned"); const gaps = cells.length - filled.length; const sup = filled.find(c => c.is_supervisor); return (
                  <td key={day} className="align-top">
                    <div className={`rounded-lg border p-1.5 min-h-[3rem] min-w-[5rem] ${gaps ? "border-rose-200 bg-rose-50/30" : "border-gray-100"}`}>
                      {cells.length === 0 ? <span className="text-[10px] text-gray-300">—</span> : (<>
                        <div className="flex flex-wrap gap-0.5">{filled.slice(0, 6).map((c, i) => (<span key={i} title={`${c.staff_name} · ${c.role}${c.is_supervisor ? " · supervisor" : ""}${!c.competency_validated ? " · unvalidated" : ""}`} className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-bold ${c.is_supervisor ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" : !c.competency_validated ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{initials(c.staff_name)}</span>))}</div>
                        <div className="flex items-center justify-between mt-1"><span className="text-[9px] text-gray-400">{filled.length}/{cells.length}</span>{sup ? <span className="text-[8px] text-indigo-500">sup ✓</span> : <span className="text-[8px] text-rose-400">no sup</span>}{gaps > 0 && <span className="text-[8px] text-rose-500 font-semibold">{gaps} gap</span>}</div>
                      </>)}
                    </div>
                  </td>
                ); })}
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Review legend &amp; actions</h3>
        <div className="flex items-center gap-4 flex-wrap text-[11px] text-gray-500 mb-2">
          <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-emerald-100 ring-1 ring-emerald-200" /> validated</span>
          <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-amber-100 ring-1 ring-amber-200" /> unvalidated competency</span>
          <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-indigo-100 ring-1 ring-indigo-300" /> Shift Supervisor</span>
        </div>
        <p className="text-[11px] text-gray-500">Add / remove / replace / move assignments, change supervisor and rerun scheduling for selected shifts are performed in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link> — every manual change triggers immediate revalidation (BR-008). Version comparison (generated vs edited vs published vs amended) needs the version store → next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Roster Review (UMW-WFM-004 §9) renders the real roster grid over op_roster_assignments. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
