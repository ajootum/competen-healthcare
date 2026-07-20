import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadDevHub } from "@/lib/professional-development";

// Professional Development — the educator career-growth & capability landing
// (spec + developer spec + mockup). Light-themed: development-period header,
// seven summary KPIs, a competency-domain overview + top priorities, the eight
// development-module cards, and an upcoming-deadlines / AI / activity rail.
//
// Honest-UI: CPD progress, competency status, credentials and learning come
// from the educator's OWN records; development-goal, mentorship and portfolio
// metering have no store yet and are shown muted. Quick links open a real
// module or are disabled — write actions (upload, generate) are never faked.

export const dynamic = "force-dynamic";

// Links open a real module page; pure write actions with no store stay muted —
// so labels are navigation ("CPD Tracker"), not writes ("Add CPD Activity").
const QUICK: { ic: string; label: string; href?: string }[] = [
  { ic: "⏱️", label: "CPD Tracker", href: "/educator/tools/development/cpd" },
  { ic: "📤", label: "Upload Evidence" },
  { ic: "🤝", label: "Mentorship", href: "/educator/tools/development/mentorship" },
  { ic: "📁", label: "Portfolio", href: "/educator/tools/development/portfolio" },
  { ic: "📄", label: "CPD Statement" },
];

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export default async function ProfessionalDevelopmentPage() {
  const { admin, hospitalId, userId, name } = await requireEducatorAccess();
  const d = await loadDevHub(admin, userId, hospitalId ?? "");
  const firstName = name?.split(" ")[0] ?? "Educator";

  return (
    <div className="max-w-[1500px]">
      <div className="flex items-start gap-3 mb-5">
        <div>
          <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5">
            <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
            <span>›</span><span className="text-gray-600 font-medium">Professional Development</span>
          </nav>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">Professional Development</h1>
          <p className="text-gray-500 text-sm">Plan, develop, evidence and advance your professional teaching and education career.</p>
        </div>
        <span className="ml-auto self-center flex items-center gap-2 text-[12px] bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-600" title="Development-period selection activates once the review-cycle store is connected">
          🗓️ <span className="text-gray-400">Development Period</span> <span className="font-semibold text-gray-800">Current cycle</span>
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        {d.kpis.map(k => (
          <div key={k.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${k.muted ? "opacity-60" : ""}`}>
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-1.5 ${k.tint}`}>{k.icon}</span>
            <p className="text-[11px] text-gray-500 font-medium leading-tight">{k.label}</p>
            <p className="text-lg font-extrabold text-gray-900 leading-tight">{k.value === null ? "—" : typeof k.value === "number" ? k.value.toLocaleString() : k.value}</p>
            {typeof k.pct === "number" ? <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${k.pct}%` }} /></div> : null}
            <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        {/* Main */}
        <div className="flex flex-col gap-5 min-w-0">
          {/* Development overview */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Development Overview</p>
            {d.domains.length === 0 ? (
              <p className="text-[12px] text-gray-400">No competency assessment on record for your account yet — complete a self-assessment in the Educator Competency Profile to populate your development overview.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
                {d.domains.map(dm => (
                  <div key={dm.id}>
                    <div className="flex items-center justify-between text-[12px] mb-1"><span className="text-gray-700 truncate">{dm.name}</span><span className="text-gray-400">{dm.achieved}/{dm.total} · {dm.level}</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-2"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${dm.total ? (dm.achieved / dm.total) * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
            {d.priorities.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-[11px] font-bold text-gray-600 mb-2">Top Development Priorities</p>
                <div className="flex flex-col divide-y divide-gray-100">
                  {d.priorities.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 text-[12px]"><span className="flex-1 text-gray-700 truncate">{p.area}</span><span className="text-amber-600">{p.current}</span><span className="text-gray-400 text-[11px]">{p.gap}</span></div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Development modules */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">My Development Modules</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {d.modules.map((m, i) => (
                <div key={m.slug} className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 flex flex-col hover:border-violet-200 hover:shadow-md transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${m.tint}`}>{m.icon}</span>
                    <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  </div>
                  <p className="text-[14px] font-bold text-gray-900 leading-tight">{m.title}</p>
                  <p className="text-[12px] text-gray-500 leading-snug mt-1 mb-3 flex-1">{m.blurb}</p>
                  <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                    {m.live ? <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">live data</span> : <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">scaffold</span>}
                    <Link href={`/educator/tools/development/${m.slug}`} className="text-[12px] font-semibold text-violet-600 hover:text-violet-700">Open →</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-emerald-50/60 border border-emerald-100 p-4 flex items-center gap-3">
            <span className="text-2xl">🌱</span>
            <div className="flex-1"><p className="text-[13px] font-bold text-gray-800">Your Professional Growth Journey</p><p className="text-[12px] text-gray-600">Keep building your evidence — CPD, credentials and learning all feed your development record.</p></div>
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Upcoming Deadlines</p>
            {d.deadlines.length === 0 ? <p className="text-[12px] text-emerald-600">No upcoming deadlines.</p> : (
              <div className="flex flex-col gap-2.5">
                {d.deadlines.map((dl, i) => (
                  <div key={i} className="flex items-start gap-2.5"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">⏰</span><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{dl.title}</p><p className={`text-[10px] ${dl.tone}`}>{dl.date ? fmtDate(dl.date) + " · " : ""}{dl.sub}</p></div></div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-violet-50/50 border border-violet-100 p-4">
            <div className="flex items-center gap-1.5 mb-1.5"><span>✨</span><p className="text-[12px] font-bold text-violet-700">AI Development Assistant</p></div>
            <p className="text-[11px] text-gray-600 leading-relaxed">Hi {firstName} — AI can analyse your competency gaps, recommend goals, match mentors and flag credential-renewal risk once the development-plan &amp; mentorship stores are connected. It never approves competence or awards credentials without authorised human review.{!d.aiConfigured && " (AI not configured yet.)"}</p>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Recent Activity</p>
            {d.activity.length === 0 ? <p className="text-[12px] text-gray-400">No recorded development activity yet.</p> : (
              <div className="flex flex-col gap-2.5">
                {d.activity.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5"><span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">{a.icon}</span><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight">{a.text}</p><p className="text-[10px] text-gray-400">{relTime(a.when)}</p></div></div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Quick Links</p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK.map(q => q.href ? (
                <Link key={q.label} href={q.href} className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 p-3 hover:border-violet-300 hover:bg-violet-50/40 transition-colors text-center"><span className="text-lg">{q.ic}</span><span className="text-[10px] text-gray-600 leading-tight">{q.label}</span></Link>
              ) : (
                <span key={q.label} title="Write action — activates once the store is connected" className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-gray-200 p-3 bg-gray-50/60 cursor-default select-none text-center"><span className="text-lg opacity-50">{q.ic}</span><span className="text-[10px] text-gray-400 leading-tight">{q.label}</span></span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
