import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import ConfigTabs from "./ConfigTabs";

export const dynamic = "force-dynamic";

// Shared honest next-phase surface (UMW-WFM-009) for the configuration domains whose governance
// stores aren't built (structure, competency, approvals, alerts, analytics-config, AI,
// integrations, security). Renders the spec's intended config structure honestly rather than
// fabricating data. Keeps the store-less domains DRY.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

export default async function ConfigPlaceholder({ title, subtitle, banner, sections, footer }: { title: string; subtitle: string; banner: string; sections: { heading: string; note?: string; items: string[] }[]; footer: string }) {
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
        <div className="flex items-center gap-2"><span className="text-xl">⚙️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1><p className="text-sm text-gray-500">{subtitle}</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <ConfigTabs />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Next phase</p>
        <p className="text-sm text-amber-800 mt-1">{banner}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {sections.map(s => (
          <div key={s.heading} className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">{s.heading}</h3>
            <div className="flex flex-wrap gap-1.5">{s.items.map(it => (<span key={it} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{it}</span>))}</div>
            {s.note && <p className="text-[10px] text-gray-400 mt-2">{s.note}</p>}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">{footer} <Link href="/unit-manager/workforce-management/configuration" className="text-emerald-700 hover:underline">← Dashboard</Link></p>
    </div>
  );
}
