import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadSettingsModule, SETTINGS_MODULES } from "@/lib/workspace-settings";
import UsersTable from "../UsersTable";

// Workspace Settings — module page (dynamic route serving all eight modules).
// Shows the current configuration read from real records, the settings areas the
// module governs (read-only listings), and a scope / change-history / AI rail.
//
// Honest-UI: current-config values are live; editable controls are listed as
// "configuration coming soon" rather than rendered as working toggles.

export const dynamic = "force-dynamic";

const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export function generateStaticParams() {
  return SETTINGS_MODULES.map(m => ({ module: m.slug }));
}

export default async function SettingsModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const { admin, hospitalId, userId } = await requireEducatorAccess();
  const data = await loadSettingsModule(admin, hospitalId ?? "", userId, slug);
  if (!data) notFound();
  const { module: m, current, users, security, activity, scope, aiConfigured } = data;

  return (
    <div className="max-w-[1400px]">
      <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5 flex-wrap">
        <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
        <span>›</span><Link href="/educator/tools/settings" className="hover:text-violet-600">Workspace Settings</Link>
        <span>›</span><span className="text-gray-600 font-medium">{m.title}</span>
      </nav>
      <div className="flex items-start gap-3 mb-5">
        <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${m.tint}`}>{m.icon}</span>
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">{m.title}</h1>
          <p className="text-gray-500 text-sm">{m.blurb}</p>
        </div>
        <span className="ml-auto self-center text-[10px] font-bold uppercase tracking-wider text-gray-500 bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-1 whitespace-nowrap">Read-only preview</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        {/* Main */}
        <div className="flex flex-col gap-5 min-w-0">
          {/* Current configuration */}
          {current.length > 0 && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Current Configuration</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {current.map(p => (
                  <div key={p.label} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2">
                    <span className="text-[12px] text-gray-500">{p.label}</span>
                    <span className={`text-[12px] font-medium text-right ${p.muted ? "text-gray-400 italic" : "text-gray-800"}`}>{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live user directory */}
          {users && <UsersTable users={users} />}

          {/* Security events */}
          {security && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Access Monitoring</p>
              <p className="text-[11px] text-gray-400 mb-3">Recent privileged actions from the audit log · live.</p>
              {security.length === 0 ? <p className="text-[12px] text-gray-400">No recorded activity yet.</p> : (
                <div className="flex flex-col divide-y divide-gray-100">
                  {security.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 text-[12px]"><span className="w-6 h-6 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center text-[10px] shrink-0">🔐</span><span className="flex-1 text-gray-700"><span className="font-medium">{s.actor}</span> — {s.action}</span><span className="text-gray-400 whitespace-nowrap">{relTime(s.when)}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Settings areas (read-only listings) */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Settings Areas</p>
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">editing soon</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {m.groups.map(g => (
                <div key={g.title} className="rounded-xl border border-gray-100 p-3.5">
                  <p className="text-[12px] font-bold text-gray-700 mb-2">{g.title}</p>
                  <ul className="flex flex-col gap-1.5">
                    {g.items.map(it => (
                      <li key={it} className="flex items-center gap-2 text-[12px] text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-gray-200" />{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">These configuration areas are governed by this module. Editable controls activate once the settings store &amp; change-management workflow are connected — no placeholder toggles are shown.</p>
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">Settings Scope</p>
            <div className="flex flex-col gap-2">
              {scope.map(p => (
                <div key={p.label} className="flex items-center justify-between gap-2"><span className="text-[11px] text-gray-500">{p.label}</span><span className={`text-[11px] font-medium ${p.muted ? "text-gray-400 italic" : "text-gray-800"}`}>{p.value}</span></div>
              ))}
            </div>
            <p className="text-[9px] text-gray-400 mt-2">Every setting shows where it originates. Full inheritance (platform → tenant → org → personal) is modelled once the scope store is connected.</p>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Change History</p>
            {activity.length === 0 ? <p className="text-[12px] text-gray-400">No recorded changes yet.</p> : (
              <div className="flex flex-col gap-2.5">
                {activity.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">🕐</span><div className="min-w-0 flex-1"><p className="text-[11px] text-gray-800 leading-tight"><span className="font-medium">{a.actor}</span> {a.action}{a.entity ? <span className="text-gray-500"> — {a.entity}</span> : null}</p><p className="text-[9px] text-gray-400">{fmtDate(a.when)}</p></div></div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-violet-50/50 border border-violet-100 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">✨ AI Recommendations {!aiConfigured && <span className="text-[8px] font-normal text-gray-400">(offline)</span>}</p>
            <p className="text-[11px] text-gray-600 leading-relaxed">AI configuration review — permission cleanup, notification tuning, security and accessibility gaps — activates once this module has editable settings to analyse. AI never applies high-risk changes without authorised approval.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
