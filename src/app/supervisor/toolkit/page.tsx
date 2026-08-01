import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ClinicalToolkit from "./ClinicalToolkit";
import LibrarySearch from "@/app/dashboard/library/LibrarySearch";
import { loadReferenceInventory, totalAvailable } from "@/lib/ssw/reference-library";
import { cardClass } from "@/components/ui/primitives";

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
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const inventory = await loadReferenceInventory(admin, profile?.hospital_id ?? null, isSuper);
  const total = totalAvailable(inventory);
  const populated = inventory.filter(r => !r.error && r.n > 0);
  const empty = inventory.filter(r => !r.error && r.n === 0);
  const absent = inventory.filter(r => r.error);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Professional Toolkit</h1><p className="text-sm text-gray-500">Clinical calculators and quick-reference tools for the shift.</p></div>
        <Link href="/supervisor/config-centre" className="text-xs text-teal-700 hover:underline">← Configuration Centre</Link>
      </div>

      <ClinicalToolkit />

      <div className={cardClass}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Reference Library</h2>
            <p className="text-[11px] text-gray-500">Full-text search across the governed knowledge base, scoped to this hospital and platform-shared content.</p>
          </div>
          <span className="text-[11px] text-gray-500 shrink-0">{total.toLocaleString()} searchable object{total === 1 ? "" : "s"}</span>
        </div>

        <LibrarySearch />

        {/* WHAT IS ACTUALLY IN THERE. A search box over a corpus that is empty in the categories a
            supervisor reaches for mid-shift reads as broken rather than unbuilt, so the counts are shown
            instead of left to be discovered one fruitless search at a time. */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <p className="text-[11px] font-semibold text-gray-600 mb-2">Available to search</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {populated.map(r => (
              <div key={r.type} className="rounded-lg border border-gray-200 bg-white p-2.5">
                <p className="text-lg font-bold text-gray-900 leading-none tabular-nums">{r.n.toLocaleString()}</p>
                <p className="text-[11px] text-gray-600 mt-1">{r.label}</p>
                {r.tenant && <p className="text-[9px] text-gray-400">this hospital + shared</p>}
              </div>
            ))}
            {empty.map(r => (
              <div key={r.type} className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-2.5">
                <p className="text-lg font-bold text-gray-300 leading-none tabular-nums">0</p>
                <p className="text-[11px] text-gray-500 mt-1">{r.label}</p>
                <p className="text-[9px] text-gray-400">none published yet</p>
              </div>
            ))}
          </div>
          {absent.length > 0 && (
            <p className="text-[10px] text-gray-400 mt-2">
              Not available in this deployment: {absent.map(r => r.label).join(", ")} — the table is missing, which is a
              different thing from having no content, and is reported rather than shown as a zero.
            </p>
          )}
          <p className="text-[11px] text-gray-400 mt-3">
            Counts use the same filters as the search itself, so a category showing a number is a category the
            search can return. The clinical calculators above are separate: deterministic, client-side, and
            built from standard validated formulas.
          </p>
        </div>
      </div>
    </div>
  );
}
