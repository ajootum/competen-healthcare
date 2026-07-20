import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAdminHub } from "@/lib/administration";

// Administration — the educator operations & governance control-centre landing
// (spec + developer spec + mockup). Light-themed: scope header, eight summary
// KPIs, quick actions, the eight administration-module cards, and an alerts /
// deadlines / activity / team rail.
//
// Honest-UI: Active Educators, Departments, Active Programs and the audit
// activity come from real records; invitations / cohorts / requests / compliance
// / system-health metering have no store yet and are muted. Quick actions link
// to a real module or are disabled — write actions are never faked.

export const dynamic = "force-dynamic";

const QUICK: { ic: string; label: string; href?: string }[] = [
  { ic: "👤", label: "Add User", href: "/educator/tools/administration/users" },
  { ic: "🏢", label: "Create Department", href: "/educator/tools/administration/structure" },
  { ic: "🎓", label: "Create Program", href: "/educator/tools/administration/programs" },
  { ic: "👨‍👩‍👧", label: "Create Cohort" },
  { ic: "🛂", label: "Assign Administrator" },
  { ic: "📥", label: "Import Users" },
  { ic: "🧾", label: "Review Requests", href: "/educator/tools/administration/requests" },
  { ic: "🗓️", label: "Manage Calendar", href: "/educator/tools/administration/calendar" },
  { ic: "📤", label: "Export Report" },
  { ic: "🗒️", label: "Open Audit Log", href: "/educator/tools/administration/audit" },
];

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export default async function AdministrationPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadAdminHub(admin, hospitalId ?? "");
  const maxRole = Math.max(1, ...d.roleBars.map(b => b.count));

  return (
    <div className="max-w-[1500px]">
      <div className="flex items-start gap-3 mb-5">
        <div>
          <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5">
            <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
            <span>›</span><span className="text-gray-600 font-medium">Administration</span>
          </nav>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">Administration</h1>
          <p className="text-gray-500 text-sm">Manage users, structures, programs, assignments and operational records.</p>
        </div>
        <span className="ml-auto self-center flex items-center gap-2 text-[12px] bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-600" title="Scope switching activates once the admin-scope store is connected">
          🏛️ <span className="text-gray-400">Scope</span> <span className="font-semibold text-gray-800">Organization</span>
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
        {d.kpis.map(k => (
          <div key={k.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${k.muted ? "opacity-60" : ""}`}>
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-1.5 ${k.tint}`}>{k.icon}</span>
            <p className="text-[11px] text-gray-500 font-medium leading-tight">{k.label}</p>
            <p className="text-xl font-extrabold text-gray-900">{k.value === null ? "—" : typeof k.value === "number" ? k.value.toLocaleString() : k.value}</p>
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
                <Link key={a.label} href={a.href} className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"><span>{a.ic}</span>{a.label}</Link>
              ) : (
                <span key={a.label} title="Write action — activates once the admin backend is connected" className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 cursor-default select-none"><span className="opacity-50">{a.ic}</span>{a.label}</span>
              ))}
            </div>
          </div>

          {/* Modules */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Administration Modules</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {d.modules.map((m, i) => (
                <div key={m.slug} className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 flex flex-col hover:border-violet-200 hover:shadow-md transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${m.tint}`}>{m.icon}</span>
                    <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  </div>
                  <p className="text-[14px] font-bold text-gray-900 leading-tight">{m.title}</p>
                  <p className="text-[12px] text-gray-500 leading-snug mt-1 mb-3">{m.blurb}</p>
                  <ul className="flex flex-col gap-1 mb-3 flex-1">
                    {m.bullets.slice(0, 4).map(b => <li key={b} className="flex items-start gap-1.5 text-[11px] text-gray-500 leading-tight"><span className="w-1 h-1 rounded-full bg-gray-300 mt-1.5" />{b}</li>)}
                  </ul>
                  <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                    {m.live ? <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">live data</span> : <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">scaffold</span>}
                    <Link href={`/educator/tools/administration/${m.slug}`} className="text-[12px] font-semibold text-violet-600 hover:text-violet-700">Manage →</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Team / role distribution (real) */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Team Overview <span className="normal-case font-normal text-gray-400">· role distribution across {d.orgName}</span></p>
            {d.roleBars.length === 0 ? <p className="text-[12px] text-gray-400">No users on record yet.</p> : (
              <div className="flex flex-col gap-2">
                {d.roleBars.map(b => (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-40 text-[12px] text-gray-600 truncate shrink-0">{b.label}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${(b.count / maxRole) * 100}%` }} /></div>
                    <span className="w-8 text-right text-[12px] font-semibold text-gray-700">{b.count}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-3">Workload balancing (available / near-capacity / overallocated) needs the assignment store — role distribution shown from the live directory.</p>
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Administrative Alerts</p>
            <div className="flex flex-col gap-2.5">
              {d.alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5"><span className="text-sm shrink-0">{a.icon}</span><div className="min-w-0 flex-1"><p className={`text-[12px] leading-tight ${a.tone}`}>{a.text}</p>{a.sub && <p className="text-[10px] text-gray-400">{a.sub}</p>}</div></div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Upcoming Deadlines</p>
            {d.deadlines.length === 0 ? <p className="text-[12px] text-emerald-600">No credential deadlines.</p> : (
              <div className="flex flex-col gap-2.5">
                {d.deadlines.map((dl, i) => (
                  <div key={i} className="flex items-start gap-2.5"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">⏰</span><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{dl.title}</p><p className={`text-[10px] ${dl.tone}`}>{dl.date ? fmtDate(dl.date) + " · " : ""}{dl.sub}</p></div></div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Recent Administrative Activity</p>
            {d.activity.length === 0 ? <p className="text-[12px] text-gray-400">No recorded activity yet.</p> : (
              <div className="flex flex-col gap-2.5">
                {d.activity.slice(0, 6).map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">🕐</span><div className="min-w-0 flex-1"><p className="text-[11px] text-gray-800 leading-tight"><span className="font-medium">{a.actor}</span> {a.action}{a.entity ? <span className="text-gray-500"> — {a.entity}</span> : null}</p><p className="text-[9px] text-gray-400">{relTime(a.when)}</p></div></div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">System Health</p>
            <p className="text-[12px] text-gray-400 italic">Health monitoring (platform, database, integrations, storage, API) activates once the observability integration is connected — no simulated status is shown.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
