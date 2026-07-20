import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadPlatformAdmin } from "@/lib/platform-admin-data";

export const dynamic = "force-dynamic";

// Security Centre (PSA-008) — security-relevant events from the platform audit trail.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

export default async function SecurityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPlatformAdmin(admin);
  const { audit } = d;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Security Centre</h1>
        <p className="text-sm text-gray-500 mt-1">Security-relevant administrative events captured in the platform audit trail.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{audit.total}</div><div className="text-xs text-gray-500 mt-1">Audit events (recent)</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${audit.securityEvents ? "text-amber-600" : "text-gray-900"}`}>{audit.securityEvents}</div><div className="text-xs text-gray-500 mt-1">Security-relevant</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{audit.distinctActions}</div><div className="text-xs text-gray-500 mt-1">Distinct action types</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Security &amp; access events</h3>
        {audit.securityRecent.length === 0 && <p className="text-sm text-gray-400">No recent security-relevant events (sign-in/out, role, permission, delete, suspend, invite).</p>}
        <div className="divide-y divide-gray-100 max-h-[30rem] overflow-y-auto">
          {audit.securityRecent.map((a, i) => (
            <div key={i} className="py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 truncate">{a.actor_name ?? "Someone"}</span>
                <span className="text-gray-500">{a.action ? titleCase(a.action) : "action"}</span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleString() : ""}</span>
              </div>
              {(a.entity_name || a.entity_type) && <p className="text-xs text-gray-400 mt-0.5">{a.entity_type ? titleCase(a.entity_type) : ""}{a.entity_name ? ` · ${a.entity_name}` : ""}</p>}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Derived from recorded administrative actions. Authentication itself (sessions, MFA enforcement, login geography) is handled by Supabase Auth; deep authentication monitoring and threat detection are a later PSA phase and would draw on the auth provider&apos;s own logs.</p>
    </div>
  );
}
