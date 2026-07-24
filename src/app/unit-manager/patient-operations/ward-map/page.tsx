import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, ewsColor } from "@/lib/operations/patient-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Interactive Ward Map (POS-105) — a spatial-style view of the unit grouped by zone
// (department), each bed a cell showing patient, risk colour, assigned nurse, PEWS,
// isolation and outstanding alerts. Selecting a bed opens the Patient Card. Built from
// the shared operational model (loadPatientOps). True floor-plan coordinates aren't in
// the operational schema, so zones group by department — an honest structural view.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const riskDot = (state: string) => state === "Critical" ? "bg-rose-500" : state === "High Risk" ? "bg-orange-500" : state === "Review Required" || state === "Observation" ? "bg-amber-400" : state === "Discharge Ready" ? "bg-teal-400" : state === "Theatre" ? "bg-indigo-400" : "bg-emerald-400";

export default async function WardMap() {
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
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Interactive Ward Map</h1><p className="text-sm text-gray-500">Every bed at a glance — risk, nurse, PEWS, isolation. Select a bed to open the Patient Card.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!po.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const { zones } = po;

  return (
    <div className="space-y-5">
      {header}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Critical</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> High risk</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Review / obs</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Stable</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-teal-400" /> Discharge ready</span>
        <span className="ml-auto text-gray-400">🧫 isolation · numbers = PEWS</span>
      </div>

      {zones.map((z: any) => (
        <div key={z.name} className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-gray-900">{z.name}</h3>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              <span>{z.patients} patients</span><span>·</span><span>{z.available} free</span><span>·</span>
              <span className={z.highRisk ? "text-rose-600 font-medium" : ""}>{z.highRisk} high-acuity</span><span>·</span>
              <span>{z.staff} nurse{z.staff === 1 ? "" : "s"}{z.ratio != null ? ` · ${z.ratio}:1` : ""}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10 gap-2">
            {z.beds.map((b: any) => {
              const p = b.patient;
              const cell = (
                <div className={`rounded-lg border p-2 h-[68px] flex flex-col justify-between ${p ? "border-gray-200 hover:border-emerald-300 hover:shadow-sm" : "border-dashed border-gray-200 bg-gray-50/50"} transition-all`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-gray-700 truncate">{b.label}</span>
                    {p ? <span className={`w-2 h-2 rounded-full shrink-0 ${riskDot(p.state)}`} /> : <span className="text-[9px] text-gray-300 capitalize">{b.status.replace(/_/g, " ")}</span>}
                  </div>
                  {p ? (
                    <div>
                      <div className="flex items-center justify-between"><span className="text-[10px] text-gray-500 truncate">{p.nurse ? p.nurse.split(" ")[0] : "—"}</span><span className={`text-[11px] font-bold tabular-nums ${ewsColor(p.pews)}`}>{p.pews ?? ""}</span></div>
                      {p.isolation && p.isolation !== "none" && <span className="text-[9px]">🧫</span>}
                    </div>
                  ) : <span className="text-[10px] text-gray-300">empty</span>}
                </div>
              );
              return p ? <Link key={b.id} href={`/unit-manager/patient-operations/patient-card?patient=${p.id}`}>{cell}</Link> : <div key={b.id}>{cell}</div>;
            })}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-gray-400 pb-4">Interactive Ward Map (POS-105) over the shared operational model. Real: bed occupancy, risk colour, assigned nurse, PEWS, isolation and per-zone acuity/ratio. Zones group by department because the operational schema holds no floor-plan coordinates — a true drag-and-drop spatial map is an honest next-phase build. Selecting an occupied bed opens the Patient Card.</p>
    </div>
  );
}
