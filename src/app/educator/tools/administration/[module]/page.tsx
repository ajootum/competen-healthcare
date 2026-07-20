import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAdminModule, ADMIN_MODULES } from "@/lib/administration";
import AdminUsers from "../AdminUsers";

// Administration — module page (dynamic route serving all eight modules). Shows
// live operational records for the backed modules (users, org structure,
// programs, reference data, audit) and an honest scaffold for the modules with
// no store yet (calendar, workload, requests).

export const dynamic = "force-dynamic";

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export function generateStaticParams() {
  return ADMIN_MODULES.map(m => ({ module: m.slug }));
}

export default async function AdminModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const { admin, hospitalId } = await requireEducatorAccess();
  const data = await loadAdminModule(admin, hospitalId ?? "", slug);
  if (!data) notFound();
  const { module: m, summary, users, structure, programs, reference, audit, roleBars, groups } = data;
  const maxBar = Math.max(1, ...(roleBars ?? []).map(b => b.count));

  return (
    <div className="max-w-[1400px]">
      <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5 flex-wrap">
        <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
        <span>›</span><Link href="/educator/tools/administration" className="hover:text-violet-600">Administration</Link>
        <span>›</span><span className="text-gray-600 font-medium">{m.title}</span>
      </nav>
      <div className="flex items-start gap-3 mb-5">
        <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${m.tint}`}>{m.icon}</span>
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">{m.title}</h1>
          <p className="text-gray-500 text-sm">{m.blurb}</p>
        </div>
        <span className={`ml-auto self-center text-[10px] font-bold uppercase tracking-wider rounded-lg px-2.5 py-1 whitespace-nowrap ${m.live ? "text-emerald-600 bg-emerald-50 border border-emerald-100" : "text-amber-600 bg-amber-50 border border-amber-100"}`}>{m.live ? "Live data" : "Scaffold · store soon"}</span>
      </div>

      <div className="flex flex-col gap-5">
        {/* Summary */}
        {summary.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {summary.map(p => (
              <div key={p.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${p.muted ? "opacity-60" : ""}`}>
                <p className={`text-lg font-extrabold leading-tight ${p.muted ? "text-gray-400 italic" : "text-gray-900"}`}>{p.value}</p>
                <p className="text-[11px] text-gray-500 leading-tight">{p.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* User directory */}
        {users && <AdminUsers users={users} />}

        {/* Org structure */}
        {structure && (
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Organisation Hierarchy <span className="normal-case font-normal text-gray-400">· live</span></p>
            <div className="flex flex-col gap-2">
              {structure.map((n, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-xl border border-gray-100 p-3 ${i === 0 ? "bg-emerald-50/40" : ""}`}>
                  <span className="text-lg shrink-0">{i === 0 ? "🏛️" : "🏥"}</span>
                  <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold text-gray-800 truncate">{n.name}</span><span className="text-[10px] text-gray-400">{n.type} · {n.sub}</span></span>
                  <span className="text-[11px] text-gray-500">{n.count} {i === 0 ? "users" : "depts"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Programs */}
        {programs && (
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 p-4 pb-2">Programs &amp; Courses <span className="normal-case font-normal text-gray-400">· live · shared course catalogue</span></p>
            {programs.length === 0 ? <p className="text-[12px] text-gray-400 p-4 pt-0">No programs on record yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead><tr className="text-[10px] font-bold uppercase tracking-wider text-gray-400 border-y border-gray-100"><th className="px-4 py-2">Program</th><th className="px-2 py-2">Category</th><th className="px-2 py-2">Level</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Enrolled</th></tr></thead>
                  <tbody>
                    {programs.map(p => (
                      <tr key={p.id} className="text-[12px] border-b border-gray-50 hover:bg-gray-50"><td className="px-4 py-2.5 font-medium text-gray-800">{p.title}</td><td className="px-2 py-2.5 text-gray-500">{p.category}</td><td className="px-2 py-2.5 text-gray-500">{p.level}</td><td className="px-2 py-2.5"><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${p.status === "Published" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{p.status}</span></td><td className="px-2 py-2.5 text-gray-600">{p.enrolled}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Reference data */}
        {reference && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reference.map(r => (
              <div key={r.title} className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-2"><p className="text-[12px] font-bold text-gray-700">{r.title}</p><span className="text-[9px] text-gray-400">{r.values.length} · {r.source}</span></div>
                {r.values.length === 0 ? <p className="text-[12px] text-gray-400">None on record.</p> : (
                  <div className="flex flex-wrap gap-1.5">{r.values.map(v => <span key={v} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">{v}</span>)}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Audit analytics + trail */}
        {roleBars && audit && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-5">
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Actions by Type <span className="normal-case font-normal text-gray-400">· live · platform-wide</span></p>
              {roleBars.length === 0 ? <p className="text-[12px] text-gray-400">No audit events yet.</p> : (
                <div className="flex flex-col gap-2">
                  {roleBars.map(b => (
                    <div key={b.label} className="flex items-center gap-3"><span className="w-40 text-[12px] text-gray-600 truncate shrink-0">{b.label}</span><div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(b.count / maxBar) * 100}%` }} /></div><span className="w-7 text-right text-[12px] font-semibold text-gray-700">{b.count}</span></div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Audit Trail <span className="normal-case font-normal text-gray-400">· live · platform-wide</span></p>
              {audit.length === 0 ? <p className="text-[12px] text-gray-400">No audit events yet.</p> : (
                <div className="flex flex-col divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
                  {audit.map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-2"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">🗒️</span><div className="min-w-0 flex-1"><p className="text-[11px] text-gray-800 leading-tight"><span className="font-medium">{a.actor}</span> {a.action}{a.entity ? <span className="text-gray-500"> — {a.entity}</span> : null}</p><p className="text-[9px] text-gray-400">{relTime(a.when)}</p></div></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scaffold groups */}
        {groups.length > 0 && (
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">What This Module Manages</p>
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">store soon</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map(g => (
                <div key={g.title} className="rounded-xl border border-gray-100 p-3.5">
                  <p className="text-[12px] font-bold text-gray-700 mb-2">{g.title}</p>
                  <ul className="flex flex-col gap-1.5">{g.items.map(it => <li key={it} className="flex items-center gap-2 text-[12px] text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-gray-200" />{it}</li>)}</ul>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">These administrative operations activate once this module&apos;s store is connected — no placeholder records are shown.</p>
          </div>
        )}
      </div>
    </div>
  );
}
