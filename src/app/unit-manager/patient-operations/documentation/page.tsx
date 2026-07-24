import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";
import PosPlaceholder from "../PosPlaceholder";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Operational Documentation (POS-109) — tenant-configurable operational document
// templates (admission summary, shift summary, ward round, transfer note, discharge
// summary, handover summary…). Needs a documentation-template + generated-document store;
// honest next-phase. Live handover already runs in the Handover Centre (cross-linked).
export default async function OperationalDocumentation() {
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
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Operational Documentation</h1><p className="text-sm text-gray-500">Tenant-configurable operational document templates generated from live data.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />

      <PosPlaceholder
        banner="Operational Documentation (POS-109) needs a documentation-template + generated-document store to hold tenant-configurable templates and the documents produced from them. This is an honest next-phase build. Shift handover already runs live in the Handover Centre."
        cta={{ label: "Open Handover Centre", href: "/supervisor/handover" }}
        sections={[
          { heading: "Templates (POS-109)", items: ["Admission Summary", "Shift Summary", "Ward Round", "Transfer Note", "Discharge Summary", "Handover Summary", "Family Discussion", "Escalation"] },
          { heading: "Generation model", items: ["Populated from operational data", "Electronic signature (§6)", "Version history", "Tenant-configurable fields", "Export (PDF / print)"] },
          { heading: "Authoritative sources", items: ["Census & Registry (POS-102)", "Timeline (POS-110)", "Patient Card (POS-108)", "Handover Centre (live)"] },
        ]}
        footer="Operational Documentation (POS-109) — next-phase pending a document-template store. Templates are tenant-configurable and generated from the operational dataset with electronic signatures and version history (POS-001 §6). Shift-to-shift handover is live in the Handover Centre."
      />
    </div>
  );
}
