import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadPlatformAdmin } from "@/lib/platform-admin-data";

export const dynamic = "force-dynamic";

// Platform Analytics (PSA-010) — tenant/user growth, role mix and activity.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPlatformAdmin(admin);
  const { summary, growth, roleBars, audit } = d;
  const maxRole = Math.max(1, ...roleBars.map(r => r.count));
  const maxAction = Math.max(1, ...audit.actionBars.map(a => a.count));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Tenant and user growth, workforce composition and administrative activity across the platform.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.tenants}</div><div className="text-xs text-gray-500 mt-1">Tenants</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.facilities}</div><div className="text-xs text-gray-500 mt-1">Facilities</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.users}</div><div className="text-xs text-gray-500 mt-1">Users</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-rose-700">+{growth.users30d}</div><div className="text-xs text-gray-500 mt-1">New users (30d)</div></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Growth</h3>
          <div className="space-y-2 text-sm">
            {[["Tenants", growth.tenants30d, growth.tenants90d], ["Users", growth.users30d, growth.users90d], ["Facilities", growth.facilities30d, null]].map(([label, a, b]) => (
              <div key={label as string} className="flex items-center justify-between">
                <span className="text-gray-600">{label as string}</span>
                <span className="text-gray-500"><b className="text-rose-700 tabular-nums">+{a as number}</b> (30d){b != null ? <> · <b className="text-gray-700 tabular-nums">+{b as number}</b> (90d)</> : null}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Workforce by role</h3>
          <div className="space-y-1.5">
            {roleBars.map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 text-gray-600 truncate">{titleCase(r.label)}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-rose-500" style={{ width: `${(r.count / maxRole) * 100}%` }} /></div>
                <span className="w-10 text-right tabular-nums text-gray-500">{r.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`${card} lg:col-span-2`}>
          <h3 className="font-semibold text-gray-900 mb-3">Administrative activity by action</h3>
          {audit.actionBars.length === 0 && <p className="text-sm text-gray-400">No activity recorded.</p>}
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5">
            {audit.actionBars.map((a) => (
              <div key={a.label} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 text-gray-600 truncate">{titleCase(a.label)}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${(a.count / maxAction) * 100}%` }} /></div>
                <span className="w-8 text-right tabular-nums text-gray-500">{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Storage, bandwidth and cost metrics are reported by the cloud provider consoles (Vercel &amp; Supabase) and are not mirrored in-app, so they are omitted here rather than estimated.</p>
    </div>
  );
}
