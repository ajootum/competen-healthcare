import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OperationsConsole from "./OperationsConsole";

export const dynamic = "force-dynamic";

// Clinical Operations Engine — Shift Operations Centre (COE-001, Phase 1).
// Live operational board + shift/ward/assignment coordination. Degrades to a
// migration notice until 038 is applied.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OperationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (roles.includes("super_admin") ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000"));

  const probe = await admin.from("op_shifts").select("id").limit(1);
  const ready = !(probe.error && /does not exist|schema cache/i.test(probe.error.message ?? ""));
  // Observations (Care tab) live in migration 039, applied separately from 038.
  const probeObs = await admin.from("op_observations").select("id").limit(1);
  const careReady = !(probeObs.error && /does not exist|schema cache/i.test(probeObs.error.message ?? ""));

  let shifts: any[] = [], shiftStaff: any[] = [], beds: any[] = [], patients: any[] = [], assignments: any[] = [], escalations: any[] = [], alerts: any[] = [], tasks: any[] = [], observations: any[] = [];
  if (ready) {
    const [sh, bd, pt, asg, esc, al, tk, ob] = await Promise.all([
      scope(admin.from("op_shifts").select("*, departments!department_id(name), profiles!supervisor_id(full_name)").order("shift_date", { ascending: false }).limit(60)),
      scope(admin.from("op_beds").select("*, departments!department_id(name)").order("label").limit(500)),
      scope(admin.from("op_patients").select("*, op_beds!bed_id(label), departments!department_id(name)").neq("operational_status", "discharged").order("created_at", { ascending: false }).limit(300)),
      scope(admin.from("op_patient_assignments").select("*, profiles!staff_id(full_name), op_patients!patient_id(label)").eq("status", "active").limit(500)),
      scope(admin.from("op_escalations").select("*, op_patients!patient_id(label), profiles!raised_by(full_name)").neq("status", "resolved").neq("status", "cancelled").order("level", { ascending: false }).limit(100)),
      scope(admin.from("op_safety_alerts").select("*, op_patients!patient_id(label)").eq("active", true).order("severity", { ascending: false }).limit(100)),
      scope(admin.from("op_tasks").select("*, op_patients!patient_id(label), profiles!assigned_to(full_name)").not("status", "in", "(completed,verified,cancelled)").order("created_at", { ascending: false }).limit(200)),
      scope(admin.from("op_observations").select("*, op_patients!patient_id(label), profiles!observer_id(full_name)").order("created_at", { ascending: false }).limit(200)),
    ]);
    shifts = sh.data ?? []; beds = bd.data ?? []; patients = pt.data ?? []; assignments = asg.data ?? []; escalations = esc.data ?? []; alerts = al.data ?? []; tasks = tk.data ?? []; observations = ob.data ?? [];
    const shiftIds = shifts.map(s => s.id);
    if (shiftIds.length) {
      const { data } = await admin.from("op_shift_staff").select("*, profiles!staff_id(full_name)").in("shift_id", shiftIds);
      shiftStaff = data ?? [];
    }
  }

  const [depts, staff] = await Promise.all([
    admin.from("departments").select("id, name").eq("hospital_id", hid ?? "").order("name"),
    admin.from("profiles").select("id, full_name, role, roles").eq("hospital_id", hid ?? "").order("full_name").limit(500),
  ]);

  return (
    <OperationsConsole
      ready={ready}
      data={{ shifts, shiftStaff, beds, patients, assignments, escalations, alerts, tasks, observations }}
      support={{ departments: depts.data ?? [], staff: staff.data ?? [], careReady }}
    />
  );
}
