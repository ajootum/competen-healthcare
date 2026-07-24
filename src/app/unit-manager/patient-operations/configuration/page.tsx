import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";
import PosPlaceholder from "../PosPlaceholder";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Configuration & Rules (POS-112) — tenant-configurable bed/ward types, observation
// rules, escalation thresholds, forms, custom fields, permissions and AI rules that
// govern the platform. Bed/ward structure exists operationally (op_beds / ward config,
// migration 046); the governed rule engine is an honest next-phase build.
export default async function PatientOpsConfiguration() {
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
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration &amp; Rules</h1><p className="text-sm text-gray-500">The tenant-configurable rules that govern patient operations.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />

      <PosPlaceholder
        banner="Configuration & Rules (POS-112) governs bed/ward types, observation rules, escalation thresholds, forms, custom fields, permissions and AI rules. Bed and ward structure already exist operationally (op_beds + ward config); the governed rule engine — versioned, tenant-scoped, with effective dates — is an honest next-phase build. Live operational settings are managed in the Config Centre."
        cta={{ label: "Open Config Centre", href: "/supervisor/config-centre" }}
        sections={[
          { heading: "Structure (partly live)", items: ["Bed Types", "Ward Types", "Rooms & zones", "Isolation categories", "Overflow / escalation beds"] },
          { heading: "Clinical rules (next-phase)", items: ["Observation Rules (frequency by acuity)", "Escalation Thresholds (PEWS bands)", "Risk-assessment rules", "AI Rules (pressure / recommendations)"] },
          { heading: "Forms & access (next-phase)", items: ["Operational Forms", "Custom Fields", "Permissions (field-level)", "RBAC scope", "Electronic-signature policy"] },
        ]}
        footer="Configuration & Rules (POS-112) — bed/ward structure is live; the versioned rule engine (observation rules, escalation thresholds, forms, custom fields, field-level permissions, AI rules) is next-phase pending a configuration store with effective-dating and audit. Governance model per POS-001 §6 (RBAC, audit trail, version history)."
      />
    </div>
  );
}
