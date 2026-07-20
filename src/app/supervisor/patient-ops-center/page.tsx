import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AdmissionsWorkflow from "./AdmissionsWorkflow";

export const dynamic = "force-dynamic";

// Patient Operations Center (SSW-PO-001 §8) — where operational work is completed.
// The other modules provide views; this is the structured-workflow surface. The
// Admissions workflow writes the patient (which auto-creates the movement event +
// census entry); the other workflows route to their live surfaces / the Patient
// Card. The recent movement timeline is the hospital-wide operational event feed.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const card = "bg-white rounded-xl border border-gray-200 p-5";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

const WORKFLOWS = [
  { label: "Transfers", desc: "Move patients between units", icon: "🔀", href: "/supervisor/patient-flow" },
  { label: "Bed Assignment", desc: "Assign or change beds", icon: "🛏️", href: "/supervisor/bed-management" },
  { label: "Status Updates", desc: "Update operational status", icon: "🔄", href: "/supervisor/patient-list" },
  { label: "Operational Notes", desc: "Add coordination notes", icon: "🗒️", href: "/supervisor/patient-list" },
  { label: "Patient Tasks", desc: "Manage patient tasks", icon: "✅", href: "/supervisor/operations?section=care" },
  { label: "Escalations", desc: "Raise & manage escalations", icon: "🚨", href: "/supervisor/clinical-safety" },
  { label: "Discharges", desc: "Manage discharges", icon: "📤", href: "/supervisor/patient-flow" },
  { label: "Patient Card", desc: "View & update the record", icon: "🪪", href: "/supervisor/patient-list" },
];

export default async function PatientOperationsCenter() {
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

  const [deptRes, bedRes, moveRes] = await Promise.all([
    admin.from("departments").select("id, name").eq("hospital_id", hid ?? "").order("name"),
    scope(admin.from("op_beds").select("id, label, status")).eq("status", "available").order("label").limit(200),
    scope(admin.from("op_movement_events").select("id, event_type, detail, created_at, op_patients!patient_id(label)")).order("created_at", { ascending: false }).limit(20),
  ]);
  const movement = (moveRes as any).error ? [] : (moveRes.data ?? []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Patient Operations Center</h1>
        <p className="text-sm text-gray-500 mt-1">Where operational actions are completed — admissions, transfers, status, tasks and discharges</p>
      </div>

      {/* Admissions workflow */}
      <AdmissionsWorkflow departments={deptRes.data ?? []} beds={bedRes.data ?? []} />

      {/* Workflow cards */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Operational workflows</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {WORKFLOWS.map(w => (
            <Link key={w.label} href={w.href} className="rounded-lg border border-gray-200 hover:border-teal-300 hover:bg-teal-50/40 p-3 transition-colors">
              <p className="text-lg">{w.icon}</p>
              <p className="text-sm font-medium text-gray-800 mt-1">{w.label}</p>
              <p className="text-[11px] text-gray-400 leading-tight">{w.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Movement timeline */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Movement timeline</h3>
        <div className="space-y-2">
          {movement.length === 0 && <p className="text-sm text-gray-400">No operational events yet{" "}<span className="text-gray-300">(needs migration 050)</span>.</p>}
          {movement.map((m: any) => (
            <div key={m.id} className="flex items-start gap-2.5 text-sm">
              <span className="text-xs text-gray-400 tabular-nums w-24 shrink-0">{fmt(m.created_at)}</span>
              <span className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 shrink-0" />
              <span className="min-w-0"><span className="font-medium text-gray-800">{tc(m.event_type)}</span>{m.op_patients?.label ? <span className="text-gray-500"> — {m.op_patients.label}</span> : null}{m.detail ? <span className="text-gray-400"> · {m.detail}</span> : null}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
