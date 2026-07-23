import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ClinicalToolkit from "./ClinicalToolkit";

export const dynamic = "force-dynamic";

// Professional Toolkit (SSW-CONF-001 §3) — clinical calculators & quick reference.
// Deterministic, client-side tools from standard validated formulas (NEWS2,
// infusion, maintenance fluids, BMI, unit conversion). Protocols / policy library
// are content-dependent and shown as honest next-phase items.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function Toolkit() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Professional Toolkit</h1><p className="text-sm text-gray-500">Clinical calculators and quick-reference tools for the shift.</p></div>
        <Link href="/supervisor/config-centre" className="text-xs text-teal-700 hover:underline">← Configuration Centre</Link>
      </div>

      <ClinicalToolkit />

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-2">Reference Library</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {["Protocols & Guidelines", "Policy Library", "Competency References"].map(t => (
            <div key={t} className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3"><p className="text-xs font-medium text-gray-600">{t}</p><p className="text-[10px] text-gray-400">Content library — next phase</p></div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">The clinical calculators above are live and validated-formula based. The reference library (protocols, policies, competency documents) is content-dependent and arrives as that content is curated — shown as an honest state rather than an empty shell.</p>
      </div>
    </div>
  );
}
