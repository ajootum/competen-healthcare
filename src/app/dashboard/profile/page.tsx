import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadProfileIdentity } from "@/lib/profile-identity";
import type { AppRole } from "@/lib/roles";
import { cardClass } from "@/components/ui/primitives";

// PW-011 Profile & Professional Identity — the user's own professional profile over real profiles /
// professional_credentials / competency_decisions. Summary cards, profile card, About Me, Professional Summary,
// identity badges, professional network, credentials + Identity & Access rail. Server-rendered, read-only.
// Fields the schema doesn't carry (bio/DOB/nationality/languages) show honestly as "Not set", never faked.
export const dynamic = "force-dynamic";

const CRED_LABEL: Record<string, string> = { professional_license: "Licence", academic_qualification: "Qualification", board_certification: "Board Cert", specialty_certification: "Specialty Cert", internal_certification: "Internal Cert", external_certification: "External Cert", cpd_certificate: "CPD Cert", instructor_certification: "Instructor", mandatory_training: "Mandatory" };

function Kpi({ icon, label, value, sub, tint }: { icon: string; label: string; value: string | number; sub: string; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg ${tint}`}>{icon}</div>
      <p className="text-xl font-bold text-gray-900 mt-2 leading-tight">{value}</p>
      <p className="text-[12px] font-medium text-gray-700">{label}</p>
      <p className="text-[11px] text-gray-400">{sub}</p>
    </div>
  );
}
function Field({ label, value }: { label: string; value: string | null }) {
  return <div className="flex items-start gap-3 py-1.5"><span className="text-[12px] text-gray-400 w-32 shrink-0">{label}</span><span className={`text-[13px] ${value ? "text-gray-800" : "text-gray-300"}`}>{value ?? "Not set"}</span></div>;
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: pr } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const userRoles: AppRole[] = (pr?.roles?.length ? pr.roles : [pr?.role]).filter(Boolean) as AppRole[];

  const d = await loadProfileIdentity(admin, user.id, user.email ?? null, userRoles);
  const p = d.profile;
  const initials = String(p.fullName).split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Profile &amp; Professional Identity</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your personal and professional information, credentials, preferences and privacy.</p>
        </div>
        <Link href="/dashboard/billing" className="text-sm font-medium text-white bg-blue-600 rounded-lg px-3 py-2 hover:bg-blue-500">Edit Profile</Link>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="✅" label="Profile Completeness" value={`${d.kpis.completeness}%`} sub={d.kpis.completeness >= 80 ? "Excellent" : "Add more detail"} tint="bg-emerald-50" />
        <Kpi icon="🛡️" label="Professional Level" value={d.kpis.professionalLevel.label} sub={`Level ${d.kpis.professionalLevel.num}`} tint="bg-violet-50" />
        <Kpi icon="🎖️" label="Active Credentials" value={d.kpis.activeCredentials} sub="Active" tint="bg-blue-50" />
        <Kpi icon="🏅" label="Certifications" value={d.kpis.certifications} sub="On record" tint="bg-amber-50" />
        <Kpi icon="🔗" label="Identities Linked" value={d.kpis.linkedIdentities} sub="Role portals" tint="bg-cyan-50" />
        <Kpi icon="📅" label="Last Updated" value={d.kpis.lastUpdated ?? "—"} sub="Profile" tint="bg-slate-50" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* Main */}
        <div className="lg:col-span-2 space-y-5">
          <div className="grid sm:grid-cols-[220px_minmax(0,1fr)] gap-5">
            {/* Profile card */}
            <div className={`${cardClass} text-center`}>
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatarUrl} alt="" className="w-24 h-24 rounded-full object-cover mx-auto border-2 border-gray-100" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-blue-500 text-white text-2xl font-bold flex items-center justify-center mx-auto">{initials}</div>
              )}
              <span className="inline-block mt-3 text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 capitalize">● {p.accountStatus}</span>
              <p className="text-lg font-bold text-gray-900 mt-2">{p.fullName}</p>
              <p className="text-[12px] text-gray-500 capitalize">{p.specialization ?? p.role}</p>
              <dl className="text-left mt-4 pt-4 border-t border-gray-100 text-[12px] space-y-1.5">
                <div className="flex justify-between"><dt className="text-gray-400">Staff No.</dt><dd className="text-gray-700 font-medium">{p.staffNumber ?? "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-400">Department</dt><dd className="text-gray-700 font-medium text-right">{p.department ?? "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-400">Employment</dt><dd className="text-gray-700 font-medium capitalize">{p.employmentType?.replace(/_/g, " ") ?? "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-400">Joined</dt><dd className="text-gray-700 font-medium">{p.joined ?? "—"}</dd></div>
              </dl>
            </div>

            {/* About + professional summary */}
            <div className="space-y-5">
              <div className={cardClass}>
                <div className="flex items-center justify-between mb-2"><h2 className="text-sm font-semibold text-gray-900">About Me</h2><Link href="/dashboard/billing" className="text-[11px] font-medium text-blue-600 hover:underline">Edit</Link></div>
                <Field label="Preferred Name" value={p.fullName.split(" ")[0]} />
                <Field label="Role" value={p.role} />
                <Field label="Specialization" value={p.specialization} />
                <Field label="Country" value={p.country} />
                <Field label="Contact" value={p.phone} />
                <Field label="Email" value={p.email} />
              </div>
              <div className={cardClass}>
                <h2 className="text-sm font-semibold text-gray-900 mb-2">Professional Summary</h2>
                <Field label="Primary Role" value={p.role} />
                <Field label="Professional Level" value={`${d.kpis.professionalLevel.label} (Level ${d.kpis.professionalLevel.num})`} />
                <Field label="Specialization" value={p.specialization} />
                <Field label="Department" value={p.department} />
                <Field label="Active Credentials" value={`${d.kpis.activeCredentials} active · ${d.verifiedCount} verified`} />
              </div>
            </div>
          </div>

          {/* Identity badges */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Professional Identity Badges</h2>
            <div className="flex flex-wrap gap-3">
              {d.badges.map((b: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={i} className="flex flex-col items-center w-24 text-center">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-bold" style={{ background: b.color }}>{b.label.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <p className="text-[10px] font-medium text-gray-600 mt-1.5 leading-tight capitalize line-clamp-2">{b.label}</p>
                  <span className="text-[9px] text-emerald-600 font-semibold">{i === 0 ? "Role" : "Verified"}</span>
                </div>
              ))}
              {d.badges.length === 1 && <p className="text-[12px] text-gray-400 self-center">Verified credentials appear here as badges.</p>}
            </div>
          </div>

          {/* Credentials & Licences */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-gray-900">Credentials &amp; Licences</h2><Link href="/dashboard/certificates" className="text-[11px] font-medium text-blue-600 hover:underline">Manage →</Link></div>
            {d.credentials.length > 0 ? (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] font-semibold text-gray-500 uppercase border-b border-gray-100"><th className="py-2">Credential</th><th className="py-2">Type</th><th className="py-2">Issuer</th><th className="py-2">Expiry</th><th className="py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {d.credentials.slice(0, 12).map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <tr key={c.id}>
                      <td className="py-2.5 font-medium text-gray-800">{c.title} {c.verified && <span className="text-emerald-500" title="Verified">✓</span>}</td>
                      <td className="py-2.5 text-gray-500 text-[12px]">{CRED_LABEL[c.credential_type] ?? c.credential_type}</td>
                      <td className="py-2.5 text-gray-500 text-[12px]">{c.issuing_body ?? "—"}</td>
                      <td className="py-2.5 text-gray-500 text-[12px]">{c.expiryLabel ?? "—"}</td>
                      <td className="py-2.5"><span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${c.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{c.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : <p className="text-sm text-gray-400 py-6 text-center">No credentials on record yet. <Link href="/dashboard/certificates" className="text-blue-600 hover:underline">Add one</Link>.</p>}
          </div>

          {/* Professional network */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Professional Network &amp; Connections</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div><p className="text-2xl font-bold text-gray-900">{d.network.teamCount}</p><p className="text-[11px] text-gray-500">Team Members</p></div>
              <div><p className="text-sm font-bold text-gray-900 leading-tight mt-1">{d.network.reportingTo?.name ?? "—"}</p><p className="text-[11px] text-gray-500">Reporting To{d.network.reportingTo?.role ? ` · ${d.network.reportingTo.role}` : ""}</p></div>
              <div><p className="text-2xl font-bold text-gray-900">{userRoles.length}</p><p className="text-[11px] text-gray-500">Role Portals</p></div>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Identity &amp; Access</h3>
            <dl className="space-y-2 text-[12px]">
              <div className="flex items-center justify-between"><dt className="text-gray-400">Login Email</dt><dd className="text-gray-700 font-medium truncate max-w-[150px]">{d.identity.email}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-gray-400">Phone</dt><dd className="text-gray-700">{d.identity.phone ?? "—"}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-gray-400">Account Status</dt><dd className="text-emerald-600 font-medium capitalize">{d.identity.accountStatus}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-gray-400">Role Portals</dt><dd className="text-gray-700 capitalize">{d.identity.roles.map(r => r.replace(/_/g, " ")).join(", ")}</dd></div>
            </dl>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/dashboard/billing" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">✏️ Edit</Link>
              <Link href="/dashboard/certificates" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">🎖️ Credentials</Link>
              <Link href="/dashboard/passport" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">🪪 Passport</Link>
              <Link href="/dashboard/preferences" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">⚙ Privacy</Link>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Activity &amp; Audit</h3>
            <p className="text-[12px] text-gray-500 mb-2">Your profile is used across Competen to personalise your experience and maintain your professional record.</p>
            <Link href="/dashboard/activity" className="text-[12px] font-medium text-blue-600 hover:underline">View activity log →</Link>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Profile reflects your real record. Demographic fields not yet captured (date of birth, nationality, languages, biography) show as &quot;Not set&quot; — add them via Edit Profile.</p>
    </div>
  );
}
