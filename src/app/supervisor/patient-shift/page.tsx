import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadPatientOps } from "@/lib/operations/patient-ops";
import ShiftManagementClient from "./ShiftManagementClient";

export const dynamic = "force-dynamic";

// Patient Shift Management (SSW-PO-001 §3) — structured per-patient shift record:
// start-of-shift review, update status and end-of-shift handover, plus the
// exceptions the supervisor oversees. Built on the shared census + the per-shift
// op_patient_shift_updates rows; degrades gracefully before migration 051.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";

export default async function PatientShiftManagement() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const po = await loadPatientOps(admin, hid, isSuper);
  if (!po.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Patient Shift Management</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );

  const { data: shifts } = await scope(admin.from("op_shifts").select("id, status, shift_type, shift_date").order("shift_date", { ascending: false })).limit(20);
  const activeShift = (shifts ?? []).find((s: any) => s.status === "active") ?? (shifts ?? []).find((s: any) => s.status === "planned") ?? null;
  const suRes = await scope(admin.from("op_patient_shift_updates").select("patient_id, reviewed, update_status, handover_status")).eq("shift_id", activeShift?.id ?? NONE);
  const configReady = !(suRes as any).error;
  const suByPatient = new Map<string, any>((configReady ? (suRes.data ?? []) : []).map((r: any) => [r.patient_id, r]));

  // Shift worklist is admitted patients only — exclude not-yet-arrived "Expected"
  // admissions so they don't pad the count or raise false nurse/review exceptions.
  const rows = po.active.filter((p: any) => p.state !== "Expected").map((p: any) => {
    const su = suByPatient.get(p.id);
    return {
      id: p.id, label: p.label, bed: p.bed, nurse: p.nurse, nurseId: p.nurseId, stage: p.stage,
      state: p.state, pews: p.pews, highRisk: p.state === "High Risk" || p.state === "Critical",
      reviewed: su?.reviewed ?? false, updateStatus: su?.update_status ?? "due", handoverStatus: su?.handover_status ?? "pending",
    };
  });

  return (
    <ShiftManagementClient
      rows={rows}
      configReady={configReady}
      shiftLabel={activeShift ? `${(activeShift.shift_type ?? "").replace(/^\w/, (m: string) => m.toUpperCase())} shift` : "No active shift"}
    />
  );
}
