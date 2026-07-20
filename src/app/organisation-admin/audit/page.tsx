import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadOrgAdminDashboard } from "@/lib/org-admin-data";

export const dynamic = "force-dynamic";

// Audit Logs (ADM-010) — the administrative audit trail for this organisation.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

export default async function AuditLogsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadOrgAdminDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { audit } = d;
  const maxAction = Math.max(1, ...audit.actionBars.map(a => a.count));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-sm text-gray-500 mt-1">Administrative activity across your organisation — scoped to your users&apos; actions.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{audit.total}</div><div className="text-xs text-gray-500 mt-1">Recent audit events</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{audit.distinctActions}</div><div className="text-xs text-gray-500 mt-1">Distinct action types</div></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Activity by action</h3>
          {audit.actionBars.length === 0 && <p className="text-sm text-gray-400">No audit activity yet.</p>}
          <div className="space-y-1.5">
            {audit.actionBars.map((a) => (
              <div key={a.label} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 text-gray-600 truncate">{titleCase(a.label)}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${(a.count / maxAction) * 100}%` }} /></div>
                <span className="w-8 text-right tabular-nums text-gray-500">{a.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Recent events</h3>
          {audit.recent.length === 0 && <p className="text-sm text-gray-400">No recent events.</p>}
          <div className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
            {audit.recent.map((a, i) => (
              <div key={i} className="py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800 truncate">{a.actor_name ?? "Someone"}</span>
                  <span className="text-gray-500">{a.action ? titleCase(a.action) : "updated"}</span>
                  <span className="ml-auto text-xs text-gray-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleString() : ""}</span>
                </div>
                {(a.entity_name || a.entity_type) && <p className="text-xs text-gray-400 mt-0.5">{a.entity_type ? titleCase(a.entity_type) : ""}{a.entity_name ? ` · ${a.entity_name}` : ""}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Showing up to 50 recent events attributed to users in your organisation. Full retention, filtering and export is a later ADM phase.</p>
    </div>
  );
}
