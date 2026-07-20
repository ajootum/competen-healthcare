import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrgAdminDashboard } from "@/lib/org-admin-data";

export const dynamic = "force-dynamic";

// Integrations (ADM-009) — health of platform engines and external systems.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const badge: Record<string, { cls: string; label: string; dot: string }> = {
  live: { cls: "bg-green-50 border-green-200 text-green-700", label: "Live", dot: "bg-green-500" },
  native: { cls: "bg-teal-50 border-teal-200 text-teal-700", label: "Platform-native", dot: "bg-teal-400" },
  off: { cls: "bg-gray-50 border-gray-200 text-gray-500", label: "Not connected", dot: "bg-gray-300" },
};

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadOrgAdminDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { integrations, integrationHealth } = d;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-1">Platform engines are native and always on; external integrations connect here as they are provisioned.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{integrationHealth.live}</div><div className="text-xs text-gray-500 mt-1">Live</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-teal-600">{integrationHealth.native}</div><div className="text-xs text-gray-500 mt-1">Platform-native</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-400">{integrationHealth.off}</div><div className="text-xs text-gray-500 mt-1">Not connected</div></div>
      </div>

      <div className={card}>
        <div className="space-y-2">
          {integrations.map((i) => {
            const b = badge[i.status];
            return (
              <div key={i.name} className={`flex items-center gap-3 border rounded-lg px-4 py-3 ${b.cls}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${b.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{i.name}</p>
                  <p className="text-xs text-gray-500">{i.detail}</p>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide shrink-0">{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">AI status reflects whether a model provider key is configured. Configure it under <Link href="/admin/studio" className="text-teal-600 hover:underline">Studio</Link>. External integration connectors (HR/ERP, identity providers, messaging) are a later ADM phase.</p>
    </div>
  );
}
