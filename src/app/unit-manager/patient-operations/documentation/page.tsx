import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDocumentation } from "@/lib/operations/pos-documentation";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";
import DocumentationConsole from "./DocumentationConsole";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Operational Documentation (POS-109) — generate operational documents (shift/handover/admission/
// ward-round/transfer/discharge summaries) from the live operational dataset, then sign and version
// them (op_documents, migration 085). Real: generation from live data, electronic signature (§6),
// immutable versioning (§3.2). Honest next-phase: tenant-configurable field templates (POS-112),
// PDF export and long-term repository. Shift handover also runs live in the Handover Centre.
export default async function OperationalDocumentation() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadDocumentation(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Operational Documentation</h1><p className="text-sm text-gray-500">Generate operational documents from live data — sign and version them.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />

      {!d.provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The documents store (migration 085) isn&apos;t provisioned yet. Once applied, you can generate, sign and version operational documents here.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">Documents</p><p className="text-2xl font-bold tabular-nums mt-1 text-gray-900">{d.counts.total}</p></div>
            <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">Signed</p><p className="text-2xl font-bold tabular-nums mt-1 text-emerald-600">{d.counts.signed}</p></div>
            <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">Drafts</p><p className="text-2xl font-bold tabular-nums mt-1 text-gray-500">{d.counts.draft}</p></div>
          </div>

          <DocumentationConsole patients={d.patients} documents={d.documents} />
        </>
      )}

      <p className="text-[11px] text-gray-400 pb-4">Operational Documentation (POS-109) over op_documents (migration 085). Real: six document templates generated from the live operational record (state, observations, team, risks, and the patient&apos;s latest submitted forms), electronic signature (§6) and immutable versioning — regenerating supersedes rather than mutating (§3.2). Honest next-phase: tenant-configurable field templates (POS-112), PDF export and long-term document repository. Shift-to-shift handover also runs live in the <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">Handover Centre</Link>.</p>
    </div>
  );
}
