import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";
import PosPlaceholder from "../PosPlaceholder";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Patient Operations Centre (POS-106) — the primary operational data-entry interface.
// Admission, transfer, shift update, ward round, review, escalation, discharge planning
// etc. are entered into the single operational store via the shared SSW Patient
// Operations Centre; the UMW cross-links there rather than maintaining a second writer.
export default async function OperationsCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const departments = await loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Operations Centre</h1><p className="text-sm text-gray-500">The operational forms that capture every patient event — one-time entry into the shared store.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />

      <PosPlaceholder
        banner="This is the operational data-entry surface (POS-106). To preserve one operational source of truth (POS-001 §3.1), forms write to the shared operational store through the Shift Supervisor Workspace's Patient Operations Centre. The Unit Manager view is read/oversight — open the operational centre to admit, transfer, review or discharge."
        cta={{ label: "Open Patient Operations Centre", href: "/supervisor/patient-ops-center" }}
        sections={[
          { heading: "Admission & movement", items: ["Admission", "Transfer", "Discharge Planning", "Procedure"] },
          { heading: "Shift & review", items: ["Shift Update", "Ward Round", "Clinical Review", "Observation Summary", "Today's Goals"] },
          { heading: "Risk & communication", items: ["Risk Assessment", "Escalation", "Family Communication", "Patient Notes"] },
        ]}
        footer="Patient Operations Centre (POS-106). Every submission generates an immutable event (user · timestamp · shift · unit · previous → new value · reason · approval where required) and streams to the Patient Timeline. Entry is performed in the shared operational centre; a manager-native quick-entry surface is an honest next-phase build."
      />
    </div>
  );
}
