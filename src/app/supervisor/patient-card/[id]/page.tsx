import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PatientCardClient from "./PatientCardClient";

export const dynamic = "force-dynamic";

// Patient Card (SSW-PO-001 §4) — the single operational source of truth for one
// admitted patient, opened from any Patient Operations module. Loads the whole
// operational record server-side (identity, assignment, PEWS, notes, movement
// timeline, tasks, alerts, escalations) from live op_* data; the client handles
// operational actions. Notes/movement degrade gracefully before migration 050.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PatientCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const { data: p } = await admin.from("op_patients").select("*, op_beds!bed_id(label), departments!department_id(name)").eq("id", id).maybeSingle();
  if (!p || (!isSuper && p.hospital_id !== hid)) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <p className="text-4xl mb-3">🔎</p>
        <h1 className="text-lg font-bold text-gray-900">Patient not found</h1>
        <p className="text-sm text-gray-400 mt-1">This operational record doesn&apos;t exist or is outside your unit.</p>
        <Link href="/supervisor/patient-list" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to Patient Census</Link>
      </div>
    );
  }

  const [asgRes, obsRes, notesRes, moveRes, tasksRes, alertsRes, escRes] = await Promise.all([
    admin.from("op_patient_assignments").select("assignment_type, profiles!staff_id(full_name)").eq("patient_id", id).eq("status", "active").limit(5),
    admin.from("op_observations").select("ews_score, observation_type, status, recorded_at, due_at, created_at").eq("patient_id", id).order("created_at", { ascending: false }).limit(20),
    admin.from("op_operational_notes").select("id, note, created_at, profiles!created_by(full_name)").eq("patient_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("op_movement_events").select("id, event_type, detail, created_at, profiles!created_by(full_name)").eq("patient_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("op_tasks").select("id, description, priority, status, due_at").eq("patient_id", id).not("status", "in", "(cancelled)").order("due_at", { ascending: true }).limit(30),
    admin.from("op_safety_alerts").select("id, category, severity, note, active, created_at").eq("patient_id", id).order("created_at", { ascending: false }).limit(30),
    admin.from("op_escalations").select("id, level, severity, summary, status, created_at").eq("patient_id", id).order("created_at", { ascending: false }).limit(30),
  ]);

  const obs = obsRes.data ?? [];
  const withEws = obs.filter((o: any) => o.ews_score != null);
  const latestEws = withEws.sort((a: any, b: any) => new Date(b.recorded_at ?? b.created_at ?? 0).getTime() - new Date(a.recorded_at ?? a.created_at ?? 0).getTime())[0]?.ews_score ?? null;
  const pewsTrend = withEws.slice().sort((a: any, b: any) => new Date(a.recorded_at ?? a.created_at ?? 0).getTime() - new Date(b.recorded_at ?? b.created_at ?? 0).getTime()).slice(-8).map((o: any) => o.ews_score);
  const lastObs = obs.filter((o: any) => o.recorded_at).sort((a: any, b: any) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0]?.recorded_at ?? null;
  const nextReview = obs.filter((o: any) => o.status === "due" && o.due_at).sort((a: any, b: any) => a.due_at.localeCompare(b.due_at))[0]?.due_at ?? null;
  const nurse = (asgRes.data ?? [])[0]?.profiles?.full_name ?? null;

  return (
    <PatientCardClient
      patient={{
        id: p.id, label: p.label, bed: p.op_beds?.label ?? null, unit: p.departments?.name ?? null,
        acuity: p.acuity_level, risk: p.risk_level, isolation: p.isolation_status, opStatus: p.operational_status,
        stage: p.current_stage ?? null, age: p.age_years ?? null, diagnosis: p.diagnosis ?? null, consultant: p.consultant ?? null,
      }}
      nurse={nurse}
      latestEws={latestEws}
      pewsTrend={pewsTrend}
      lastObs={lastObs}
      nextReview={nextReview}
      notes={(notesRes as any).error ? [] : (notesRes.data ?? [])}
      movement={(moveRes as any).error ? [] : (moveRes.data ?? [])}
      tasks={tasksRes.data ?? []}
      alerts={alertsRes.data ?? []}
      escalations={escRes.data ?? []}
      canEdit={roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))}
    />
  );
}
