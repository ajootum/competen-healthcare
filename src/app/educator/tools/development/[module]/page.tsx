import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadDevModule, DEV_MODULES } from "@/lib/professional-development";

// Professional Development — module page (dynamic route serving all eight
// modules). Shows the educator's real records for the backed modules (CPD,
// credentials, learning, competency profile) and an honest scaffold for the
// modules with no store yet (development plan, mentorship, portfolio, appraisal).

export const dynamic = "force-dynamic";

const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
const daysUntil = (iso: string | null) => iso ? Math.round((new Date(iso).getTime() - Date.now()) / 864e5) : null;

const STATUS_CLS: Record<string, string> = {
  valid: "bg-emerald-100 text-emerald-700", active: "bg-emerald-100 text-emerald-700", verified: "bg-emerald-100 text-emerald-700",
  "expiring soon": "bg-amber-100 text-amber-700", "renewal due": "bg-amber-100 text-amber-700", "under verification": "bg-blue-100 text-blue-700",
  expired: "bg-rose-100 text-rose-700", suspended: "bg-rose-100 text-rose-700", revoked: "bg-rose-100 text-rose-700",
};
const cls = (s: string) => STATUS_CLS[s.toLowerCase()] ?? "bg-gray-100 text-gray-600";

export function generateStaticParams() {
  return DEV_MODULES.map(m => ({ module: m.slug }));
}

export default async function DevModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const { admin, hospitalId, userId } = await requireEducatorAccess();
  const data = await loadDevModule(admin, userId, hospitalId ?? "", slug);
  if (!data) notFound();
  const { module: m, summary, cpd, credentials, courses, domainScores, groups, deadlines, aiConfigured } = data;

  return (
    <div className="max-w-[1400px]">
      <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5 flex-wrap">
        <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
        <span>›</span><Link href="/educator/tools/development" className="hover:text-violet-600">Professional Development</Link>
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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        {/* Main */}
        <div className="flex flex-col gap-5 min-w-0">
          {/* Summary */}
          {summary.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {summary.map(p => (
                <div key={p.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${p.muted ? "opacity-60" : ""}`}>
                  <p className="text-lg font-extrabold text-gray-900 leading-tight">{p.value}</p>
                  <p className="text-[11px] text-gray-500 leading-tight">{p.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* CPD table */}
          {cpd && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">CPD Activities <span className="normal-case font-normal text-gray-400">· live from your records</span></p>
              {cpd.length === 0 ? <p className="text-[12px] text-gray-400">No CPD activities logged yet.</p> : (
                <div className="flex flex-col divide-y divide-gray-100">
                  {cpd.map(c => (
                    <div key={c.id} className="flex items-center gap-3 py-2.5"><span className="text-base shrink-0">⏱️</span><span className="flex-1 min-w-0"><span className="block text-[13px] font-medium text-gray-800 truncate">{c.title}</span><span className="text-[10px] text-gray-400">{c.type} · {fmtDate(c.date)}</span></span><span className="text-[12px] font-semibold text-gray-700">{c.hours}h</span>{c.verified && <span className="text-[9px] font-bold uppercase text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">verified</span>}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Credentials */}
          {credentials && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Credentials &amp; Authorisations <span className="normal-case font-normal text-gray-400">· live from your records</span></p>
              {credentials.length === 0 ? <p className="text-[12px] text-gray-400">No credentials on record yet.</p> : (
                <div className="flex flex-col divide-y divide-gray-100">
                  {credentials.map(c => { const dl = daysUntil(c.expiry); return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5"><span className="text-base shrink-0">🏅</span><span className="flex-1 min-w-0"><span className="block text-[13px] font-medium text-gray-800 truncate">{c.title}</span><span className="text-[10px] text-gray-400">{c.issuer} · {c.kind}{c.expiry ? ` · exp ${fmtDate(c.expiry)}` : ""}</span></span>{dl !== null && dl >= 0 && dl <= 90 && <span className="text-[9px] font-bold uppercase text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">{dl}d</span>}<span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${cls(c.status)}`}>{c.status}</span></div>
                  ); })}
                </div>
              )}
            </div>
          )}

          {/* Courses */}
          {courses && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Your Learning <span className="normal-case font-normal text-gray-400">· live enrolments</span></p>
              {courses.length === 0 ? <p className="text-[12px] text-gray-400">No enrolments yet.</p> : (
                <div className="flex flex-col gap-3">
                  {courses.map(c => (
                    <div key={c.id}>
                      <div className="flex items-center justify-between text-[12px] mb-1"><span className="text-gray-800 font-medium truncate">{c.title}</span><span className="text-gray-400">{c.completed ? "Completed" : `${c.progress}%`}</span></div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5"><div className={`h-full rounded-full ${c.completed ? "bg-emerald-500" : "bg-violet-500"}`} style={{ width: `${c.completed ? 100 : c.progress}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Competency domain scores */}
          {domainScores && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Competency Assessment <span className="normal-case font-normal text-gray-400">· live from your records</span></p>
              {domainScores.length === 0 ? <p className="text-[12px] text-gray-400">No competency assessment recorded for your account yet.</p> : (
                <div className="flex flex-col divide-y divide-gray-100">
                  {domainScores.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 text-[12px]"><span className="flex-1 text-gray-700 truncate">{s.name}</span><span className="text-gray-500">{s.level}</span><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${s.passing ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{s.passing ? "achieved" : "developing"}</span></div>
                  ))}
                </div>
              )}
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
              <p className="text-[10px] text-gray-400 mt-3">This module&apos;s authoring &amp; tracking activate once its store is connected — no placeholder records are shown.</p>
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Credential Deadlines</p>
            {deadlines.length === 0 ? <p className="text-[12px] text-emerald-600">No credential deadlines.</p> : (
              <div className="flex flex-col gap-2.5">
                {deadlines.map((dl, i) => (
                  <div key={i} className="flex items-start gap-2.5"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">⏰</span><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{dl.title}</p><p className={`text-[10px] ${dl.tone}`}>{dl.date ? fmtDate(dl.date) + " · " : ""}{dl.sub}</p></div></div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-violet-50/50 border border-violet-100 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">✨ AI Development Assistant {!aiConfigured && <span className="text-[8px] font-normal text-gray-400">(offline)</span>}</p>
            <p className="text-[11px] text-gray-600 leading-relaxed">AI can summarise this evidence, recommend next development steps and flag renewal risk. It never approves competence, awards credentials or makes promotion decisions without authorised human review.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
