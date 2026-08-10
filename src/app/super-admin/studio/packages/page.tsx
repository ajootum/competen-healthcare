import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPackages } from "@/lib/studio/packages";
import PackageManager from "./PackageManager";
import { requireHqCapability } from "@/lib/hq/context";

// CST-109 — Competency Package Manager. Bundles competency assets into named, versioned, governed
// packages (competency_packages + competency_package_items, migration 130) that the Marketplace (CST-110)
// distributes. KPIs, type distribution and a full builder (create, add/remove items, publish/archive).

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function StudioPackagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const pkg = await loadPackages(admin, profile?.hospital_id ?? null, true);
  const { data: compData } = await admin.from("framework_competencies").select("id, name, framework_domains(name, frameworks(name))").order("name").limit(2000);
  const options = ((compData ?? []) as any[]).map(c => {
    const ctx = c.framework_domains?.frameworks?.name ?? c.framework_domains?.name ?? null;
    return { id: c.id, label: ctx ? `${c.name} · ${ctx}` : c.name };
  });

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-109 · Package Manager</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Packages</h1>
          <p className="text-gray-400 text-sm mt-0.5">Bundle competencies and assets into versioned, deployable packages — the unit the Marketplace distributes.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {!pkg.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 130 (<code className="text-[11px]">competency_packages</code>) to enable the Package Manager.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {[
              { label: "Packages", value: pkg.kpis.total, tone: "text-gray-900" },
              { label: "Published", value: pkg.kpis.published, tone: "text-teal-600" },
              { label: "Draft", value: pkg.kpis.draft, tone: "text-gray-500" },
              { label: "Archived", value: pkg.kpis.archived, tone: "text-gray-400" },
              { label: "Bundled items", value: pkg.kpis.items, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {pkg.typeDist.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">By package type</p>
              <div className="flex flex-wrap gap-1.5">
                {pkg.typeDist.map(t => <span key={t.key} className="text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">{t.label} <b className="text-gray-900">{t.n}</b></span>)}
              </div>
            </div>
          )}

          <PackageManager packages={pkg.packages} competencyOptions={options} />
        </>
      )}
    </div>
  );
}
