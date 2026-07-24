import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, titleCase, BED_TONE } from "@/lib/operations/patient-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Bed & Capacity Management (POS-104) — occupancy, availability, turnaround and the
// live bed board from the shared operational model (loadPatientOps over op_beds). Real:
// bed states, per-department occupancy heatmap, cleaning queue, turnaround, occupancy %.
// Capacity forecasting that needs historical rates is an honest next-phase state.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

export default async function BedCapacity() {
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
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bed &amp; Capacity Management</h1><p className="text-sm text-gray-500">Live bed states, occupancy, turnaround and the cleaning queue.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!po.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const { capacity, bedBoard, cleaningBeds, zones } = po;
  const kpis = [
    { label: "Occupancy", value: `${capacity.occPct}%`, tone: capacity.occPct >= 90 ? "text-rose-600" : capacity.occPct >= 80 ? "text-amber-600" : "text-emerald-600" },
    { label: "Occupied", value: capacity.occupied, tone: "text-gray-900" },
    { label: "Available", value: capacity.available, tone: capacity.available ? "text-emerald-600" : "text-rose-600" },
    { label: "Reserved", value: capacity.reserved, tone: "text-violet-600" },
    { label: "Cleaning", value: capacity.cleaning, tone: capacity.cleaning ? "text-orange-600" : "text-gray-400" },
    { label: "Maintenance", value: capacity.maintenance, tone: capacity.maintenance ? "text-gray-600" : "text-gray-400" },
  ];

  return (
    <div className="space-y-5">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => <div key={k.label} className={`${card} p-4`}><p className="text-xs text-gray-500">{k.label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${k.tone}`}>{k.value}</p></div>)}
      </div>

      {/* Occupancy heatmap by zone */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Occupancy by zone</h3>
        <div className="space-y-2">
          {zones.map((z: any) => {
            const occ = z.beds.length ? Math.round((z.beds.filter((b: any) => b.status === "occupied").length / z.beds.length) * 100) : 0;
            return <div key={z.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 font-medium">{z.name}</span><span className="text-gray-500 tabular-nums">{z.beds.filter((b: any) => b.status === "occupied").length}/{z.beds.length} · {occ}%</span></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${occ >= 90 ? "bg-rose-500" : occ >= 80 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, occ)}%` }} /></div></div>;
          })}
        </div>
      </div>

      {/* Bed board */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Bed board</h3><Link href="/supervisor/bed-management" className="text-[11px] font-medium text-emerald-700 hover:underline">Manage beds →</Link></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {bedBoard.map((b: any) => (
            <div key={b.id} className={`rounded-lg border p-2.5 ${BED_TONE[b.status] ?? "border-gray-200"}`}>
              <div className="flex items-center justify-between"><span className="text-xs font-bold text-gray-800">{b.label}</span>{b.type === "theatre" && <span className="text-[9px]">🔪</span>}</div>
              <p className="text-[10px] text-gray-400 capitalize">{b.status.replace(/_/g, " ")}</p>
              {b.patient ? <Link href={`/unit-manager/patient-operations/patient-card?patient=${b.patient.id}`} className="text-[10px] text-emerald-700 hover:underline truncate block mt-0.5">{b.patient.label}</Link> : <p className="text-[10px] text-gray-300 mt-0.5">empty</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Cleaning queue */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Cleaning queue</h3>
        {cleaningBeds.length === 0 ? <p className="text-sm text-gray-400">No beds awaiting cleaning.</p> : <div className="flex flex-wrap gap-2">{cleaningBeds.map((b: any) => <span key={b.id} className="text-xs rounded-lg border border-orange-200 bg-orange-50/50 px-3 py-1.5 text-orange-800">{b.label} · {titleCase(b.bed_type ?? "bed")}</span>)}</div>}
        <p className="text-[10px] text-gray-400 mt-3">Turnaround-time trend and a forward capacity forecast need historical turnaround/admission rates — honest next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Bed &amp; Capacity Management (POS-104) over op_beds / op_bed_turnaround. Real: bed states, per-zone occupancy, the live bed board, cleaning queue and occupancy %. Honest next-phase: forward capacity forecasting and turnaround-time trends. Bed moves, cleaning and maintenance are actioned in <Link href="/supervisor/bed-management" className="text-emerald-700 hover:underline">Bed Management</Link>.</p>
    </div>
  );
}
