import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadIam } from "@/lib/super-admin/sys-identity";
import IamConsole from "./IamConsole";

export const dynamic = "force-dynamic";

// Identity & Access Management (SYS-001.2) — the live identity directory with
// real lifecycle actions. Auth data comes straight from the Supabase Auth
// admin directory (genuine last sign-ins, ban state); suspension is a real
// auth ban. MFA enforcement, session inventory and risky-sign-in scoring have
// no store yet → honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return "never"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const ROLE_BADGE: Record<string, string> = { super_admin: "bg-rose-50 text-rose-700", hospital_admin: "bg-violet-50 text-violet-700", educator: "bg-blue-50 text-blue-700", assessor: "bg-teal-50 text-teal-700", nurse: "bg-green-50 text-green-700" };

export default async function IdentityAccessManagement() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadIam(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Total Identities", value: dash(k.total), icon: "👥", iconBg: "bg-blue-50" },
    { label: "Active (24h)", value: dash(k.active24h), icon: "🟢", iconBg: "bg-green-50", tone: "text-green-600" },
    { label: "Active (7d)", value: dash(k.active7d), icon: "📅", iconBg: "bg-teal-50" },
    { label: "Pending Invites", value: dash(k.pendingInvites), icon: "✉️", iconBg: "bg-amber-50", tone: (k.pendingInvites ?? 0) > 0 ? "text-amber-600" : undefined },
    { label: "Suspended", value: dash(k.suspended), icon: "⛔", iconBg: "bg-rose-50", tone: (k.suspended ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Active SSO Configs", value: dash(k.ssoActive), icon: "🌐", iconBg: "bg-violet-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/system" className="hover:text-teal-700">System &amp; Security</Link><span>/</span><span className="text-gray-600">Identity &amp; Access Management</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Identity &amp; Access Management</h1>
        <p className="text-sm text-gray-500">Identity lifecycle, authentication and access — live from the auth directory.</p>
      </div>

      {!d.authReady && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Auth directory unavailable.</span> Identity KPIs and the directory need the Supabase Auth admin API — check the service-role key.
        </div>
      )}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real identity lifecycle actions */}
      <IamConsole users={d.pickers.users} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Directory (recent) */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Directory <span className="text-[10px] text-gray-400">newest first</span></h2>
            <Link href="/super-admin/users" className="text-xs text-teal-700 hover:underline">Full user manager →</Link>
          </div>
          {d.recentUsers.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No identities.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 font-semibold">User</th><th className="px-3 py-2 font-semibold">Portals</th><th className="px-3 py-2 font-semibold text-right">Last sign-in</th><th className="px-3 py-2 font-semibold text-right">Status</th>
                </tr></thead>
                <tbody>
                  {d.recentUsers.map((u: any) => (
                    <tr key={u.id} className="border-b border-gray-50">
                      <td className="px-3 py-2"><p className="text-gray-800 leading-tight">{u.name ?? "—"}</p><p className="text-[10px] text-gray-400">{u.email}</p></td>
                      <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{u.roles.map((r: string) => <span key={r} className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${ROLE_BADGE[r] ?? "bg-gray-100 text-gray-600"}`}>{r.replace(/_/g, " ")}</span>)}</span></td>
                      <td className="px-3 py-2 text-right text-[11px] text-gray-500 tabular-nums">{relTime(u.lastSignIn)}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${u.banned ? "bg-rose-50 text-rose-700" : u.neverSignedIn ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>{u.banned ? "suspended" : u.neverSignedIn ? "invited" : "active"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent login activity (real) */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Recent Login Activity <span className="text-[10px] text-gray-400">live</span></h2>
          {d.recentLogins.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No sign-ins recorded.</p> : (
            <div className="divide-y divide-gray-50">
              {d.recentLogins.map((u: any) => (
                <div key={u.id} className="flex items-center gap-2.5 py-2">
                  <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">{(u.name ?? u.email ?? "?").slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-800 leading-tight truncate">{u.name ?? u.email}</p><p className="text-[9px] text-gray-400 capitalize">{(u.role ?? "").replace(/_/g, " ")}</p></div>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{relTime(u.lastSignIn)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Genuine last_sign_in_at from the auth provider. Risky-sign-in scoring lands with the SOC module.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Users by portal role */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Users by Portal Role</h2>
          <div className="space-y-2">
            {Object.entries(d.roleCounts).sort((a: any, b: any) => b[1] - a[1]).map(([role, n]: any) => (
              <div key={role}>
                <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 capitalize">{role.replace(/_/g, " ")}</span><span className="tabular-nums text-gray-500">{n}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${(n / Math.max(1, ...Object.values(d.roleCounts) as number[])) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Multi-portal users count once per portal. Org-level roles are managed in Enterprise → People.</p>
        </div>

        {/* Authentication methods */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Authentication</h2>
          <div className="space-y-2">
            {[
              ["Password sign-in", "Active — auth provider", true],
              ["Email invitations", "Active — set-password flow", true],
              ["MFA enforcement", "Config-only — not enforced yet", false],
              ["SSO federation", `${dash(k.ssoActive)} active config${k.ssoActive === 1 ? "" : "s"} — enforcement pending`, false],
              ["Session inventory", "Not tracked", false],
            ].map(([l, v, on]: any) => (
              <div key={l} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <span className="text-xs text-gray-700">{l}</span>
                <span className={`text-[10px] font-medium ${on ? "text-green-600" : "text-gray-400"}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* SSO / IdP configs */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">SSO / IdP Configurations</h2>
            <span className="text-[10px] text-gray-400">{dash(d.idpTotal)} total</span>
          </div>
          {d.idp.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No tenant IdP configurations yet.</p> : (
            <div className="space-y-2">
              {d.idp.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 uppercase shrink-0">{c.protocol}</span>
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-800 truncate">{c.tenant}</p><p className="text-[9px] text-gray-400">{c.provider}{c.mfaRequired ? " · MFA required (config)" : ""}{c.scim ? " · SCIM" : ""}</p></div>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${c.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"}`}>{c.active ? "active" : "saved"}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">Per-tenant configs managed in the Control Plane identity console; “saved” = stored but enforcement pending.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">IAM reads the live auth directory — total identities, genuine last sign-ins, real ban state — merged with portal roles and tenant scope from profiles. The console performs real lifecycle actions: invitations, one-time temporary passwords, password resets and suspensions that genuinely block sign-in, all audit-logged. MFA enforcement, session inventory, access reviews and risky-sign-in scoring show honest states until their stores exist.</p>
    </div>
  );
}
