import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadPlatformAdmin } from "@/lib/platform-admin-data";

export const dynamic = "force-dynamic";

// System Health (PSA-009) — honest operational status. Compute/memory/queue
// telemetry is cloud-provider-managed and not mirrored in-app.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function HealthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPlatformAdmin(admin);
  const { health, summary, ai } = d;

  const checks = [
    { name: "Database (Supabase Postgres)", ok: health.dbReachable, detail: "Primary datastore reachable — platform queries succeeding" },
    { name: "Application (Vercel)", ok: true, detail: "Serving this request" },
    { name: "AI intelligence layer", ok: ai.live, detail: ai.live ? "Model provider configured (Anthropic)" : "No operational AI provider" },
  ];
  // Surfaces the platform genuinely cannot measure in-app.
  const notMeasured = ["CPU / memory utilisation", "Container & server status", "Message queues", "Background job workers", "Cache", "Storage & bandwidth", "Uptime / availability SLA"];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
        <p className="text-sm text-gray-500 mt-1">Operational status of the components Competen can observe directly.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{checks.filter(c => c.ok).length}/{checks.length}</div><div className="text-xs text-gray-500 mt-1">Core services healthy</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.tenants}</div><div className="text-xs text-gray-500 mt-1">Tenants served</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.users}</div><div className="text-xs text-gray-500 mt-1">Users served</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Service checks</h3>
        <div className="space-y-2">
          {checks.map((c) => (
            <div key={c.name} className={`flex items-center gap-3 border rounded-lg px-4 py-3 ${c.ok ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${c.ok ? "bg-green-500" : "bg-gray-300"}`} />
              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800">{c.name}</p><p className="text-xs text-gray-500">{c.detail}</p></div>
              <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${c.ok ? "text-green-700" : "text-gray-500"}`}>{c.ok ? "Healthy" : "Off"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${card} border-dashed`}>
        <h3 className="font-semibold text-gray-900 mb-1">Managed by the cloud provider</h3>
        <p className="text-sm text-gray-500 mb-3">These are observed in the Vercel and Supabase consoles, not in Competen — so they are listed here for reference rather than shown as fabricated gauges.</p>
        <div className="flex flex-wrap gap-2">
          {notMeasured.map((n) => (
            <span key={n} className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">{n}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
