import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOperations } from "@/lib/operations/patient-operations";
import { titleCase } from "@/lib/operations/patient-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Patient Timeline Engine (POS-110) — the immutable chronological operational record.
// Real over op_movement_events (migration 050): admissions, bed changes, transfers,
// theatre, recovery, stage/status changes, escalations, notes and discharges, unit-wide.
// Per-patient timelines open from the Patient Card. Honest empty state pre-migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

// Module-level formatter (kept out of the render body for react-hooks/purity).
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString([], { day: "2-digit", month: "short" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`; };
const EVENT_ICON: Record<string, string> = { admission: "➕", bed_change: "🛏️", transfer: "🔄", theatre: "🔪", recovery: "🌡️", stage_change: "📈", status_change: "🔁", escalation: "🚨", note: "📝", discharge: "🏠" };
const EVENT_TONE: Record<string, string> = { admission: "bg-sky-100 text-sky-700", transfer: "bg-indigo-100 text-indigo-700", theatre: "bg-violet-100 text-violet-700", escalation: "bg-rose-100 text-rose-700", discharge: "bg-teal-100 text-teal-700", note: "bg-gray-100 text-gray-600" };

export default async function PatientTimeline() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [p, departments] = await Promise.all([
    loadPatientOperations(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Timeline Engine</h1><p className="text-sm text-gray-500">The immutable chronological record of every operational movement on the unit.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!p.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const { timeline, timelineReady } = p;

  return (
    <div className="space-y-5">
      {header}

      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold text-gray-900">Unit movement log <span className="text-[10px] font-normal text-gray-400">most recent {timeline.length}</span></h3><span className="text-[11px] text-gray-400">Immutable · append-only</span></div>

        {!timelineReady ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-8 text-center"><p className="text-sm text-gray-500">The movement-events store (migration 050) isn&apos;t provisioned yet.</p><p className="text-[11px] text-gray-400 mt-1">Once operational events are logged, the immutable unit timeline appears here.</p></div>
        ) : timeline.length === 0 ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-8 text-center"><p className="text-sm text-gray-500">No operational movements recorded yet.</p><p className="text-[11px] text-gray-400 mt-1">Admissions, transfers, escalations and discharges will stream here as they happen.</p></div>
        ) : (
          <div className="relative pl-5">
            <div className="absolute left-1.5 top-1 bottom-1 w-px bg-gray-100" />
            <div className="space-y-3">
              {timeline.map((e: any) => (
                <div key={e.id} className="relative">
                  <span className="absolute -left-[15px] top-1 w-3 h-3 rounded-full bg-white border-2 border-emerald-300" />
                  <div className="flex items-start gap-2.5">
                    <span className="text-sm mt-0.5">{EVENT_ICON[e.event_type] ?? "•"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${EVENT_TONE[e.event_type] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(e.event_type)}</span>
                        {e.op_patients?.label && <Link href={`/unit-manager/patient-operations/patient-card?patient=${e.patient_id}`} className="text-xs font-medium text-emerald-700 hover:underline">{e.op_patients.label}</Link>}
                        <span className="text-[11px] text-gray-400 tabular-nums ml-auto">{fmtDateTime(e.created_at)}</span>
                      </div>
                      {e.detail && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{e.detail}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Patient Timeline Engine (POS-110) over op_movement_events — an immutable, append-only operational record (admission, bed change, transfer, theatre, recovery, stage/status change, escalation, note, discharge). Per-patient timelines open from the Patient Card. This unit-wide view shows the most recent movements; full historical export is an honest next-phase build.</p>
    </div>
  );
}
