import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadSettingsHub, SETTINGS_MODULES } from "@/lib/workspace-settings";

// Workspace Settings — the educator workspace configuration & governance landing
// (spec + developer spec + mockup). Light-themed: a scope indicator, seven
// summary KPIs, quick actions, the eight settings-module cards, and a settings
// overview / pending-changes / activity rail.
//
// Honest-UI: Active Users, Assigned Roles and the overview come from real
// records; integrations / notification-rules / security-alert / policy metering
// have no store yet and are muted. Quick actions link to a real module page or
// are shown disabled — write actions (invite, export, restore) are never faked.

export const dynamic = "force-dynamic";

const QUICK: { ic: string; label: string; href?: string }[] = [
  { ic: "📝", label: "Edit Workspace Profile", href: "/educator/tools/settings/profile" },
  { ic: "➕", label: "Invite Team Member" },
  { ic: "👥", label: "Manage Roles", href: "/educator/tools/settings/users" },
  { ic: "🔔", label: "Configure Notifications", href: "/educator/tools/settings/notifications" },
  { ic: "🔌", label: "Connect Integration", href: "/educator/tools/settings/integrations" },
  { ic: "🔒", label: "Review Security", href: "/educator/tools/settings/security" },
  { ic: "🏛️", label: "Apply Org Defaults" },
  { ic: "📤", label: "Export Settings" },
  { ic: "↩️", label: "Restore Configuration" },
];

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default async function WorkspaceSettingsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadSettingsHub(admin, hospitalId ?? "");

  return (
    <div className="max-w-[1500px]">
      {/* Breadcrumb + header */}
      <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5">
        <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
        <span>›</span><span className="text-gray-600 font-medium">Workspace Settings</span>
      </nav>
      <div className="flex items-start gap-3 mb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">Workspace Settings</h1>
          <p className="text-gray-500 text-sm">Configure and manage your educator workspace, users, permissions, notifications and preferences.</p>
        </div>
        <span className="ml-auto self-center flex items-center gap-2 text-[12px] bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-600" title="Scope switching activates once the configuration-scope store is connected">
          🏛️ <span className="text-gray-400">Scope</span> <span className="font-semibold text-gray-800">Organization</span>
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        {d.kpis.map(k => (
          <div key={k.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${k.muted ? "opacity-60" : ""}`}>
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-1.5 ${k.tint}`}>{k.icon}</span>
            <p className="text-[11px] text-gray-500 font-medium leading-tight">{k.label}</p>
            <p className="text-2xl font-extrabold text-gray-900">{k.value === null ? "—" : typeof k.value === "number" ? k.value.toLocaleString() : k.value}</p>
            <p className="text-[10px] text-gray-400 leading-tight">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        {/* Main */}
        <div className="flex flex-col gap-5 min-w-0">
          {/* Quick actions */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Quick Actions</p>
            <div className="flex flex-wrap gap-2">
              {QUICK.map(a => a.href ? (
                <Link key={a.label} href={a.href} className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:border-violet-300 hover:bg-violet-50/40 transition-colors">
                  <span>{a.ic}</span>{a.label}
                </Link>
              ) : (
                <span key={a.label} title="Write action — activates once the settings backend is connected" className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 cursor-default select-none">
                  <span className="opacity-50">{a.ic}</span>{a.label}
                </span>
              ))}
            </div>
          </div>

          {/* Settings modules */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Settings Modules</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {SETTINGS_MODULES.map((m, i) => (
                <div key={m.slug} className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 flex flex-col hover:border-violet-200 hover:shadow-md transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${m.tint}`}>{m.icon}</span>
                    <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  </div>
                  <p className="text-[14px] font-bold text-gray-900 leading-tight">{m.title}</p>
                  <p className="text-[12px] text-gray-500 leading-snug mt-1 mb-3">{m.blurb}</p>
                  <ul className="flex flex-col gap-1.5 mb-4 flex-1">
                    {m.bullets.map(b => <li key={b} className="flex items-start gap-2 text-[11px] text-gray-600 leading-tight"><span className="w-1.5 h-1.5 rounded-full bg-violet-300 mt-1" />{b}</li>)}
                  </ul>
                  <Link href={`/educator/tools/settings/${m.slug}`} className="text-[12px] font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1 border-t border-gray-100 pt-3">Manage →</Link>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-blue-50/60 border border-blue-100 p-4 flex items-center gap-3">
            <span className="text-xl">💡</span>
            <p className="text-[12px] text-gray-600 flex-1">Tip: changes made at a higher scope (Organization or Tenant) affect settings at lower scopes. Full scope inheritance activates once the configuration store is connected.</p>
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Settings Overview</p>
            <div className="flex flex-col gap-2">
              {d.overview.map(p => (
                <div key={p.label} className="flex items-center justify-between gap-2"><span className="text-[11px] text-gray-500">{p.label}</span><span className={`text-[11px] font-medium text-right ${p.muted ? "text-gray-400 italic" : "text-gray-800"}`}>{p.value}</span></div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Pending Changes</p></div>
            <p className="text-[12px] text-emerald-600">No configuration changes pending.</p>
            <p className="text-[9px] text-gray-400 mt-1">The change-approval queue populates once editing &amp; the approval workflow are connected.</p>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Recent Activity</p>
            {d.activity.length === 0 ? <p className="text-[12px] text-gray-400">No recorded activity yet.</p> : (
              <div className="flex flex-col gap-2.5">
                {d.activity.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">🕐</span><div className="min-w-0 flex-1"><p className="text-[11px] text-gray-800 leading-tight"><span className="font-medium">{a.actor}</span> {a.action}{a.entity ? <span className="text-gray-500"> — {a.entity}</span> : null}</p><p className="text-[9px] text-gray-400">{relTime(a.when)}</p></div></div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
