import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearnerOutcomes } from "@/lib/learner-outcomes";
import OutcomesNav from "./OutcomesNav";
import { MODULES } from "./modules";

// Learner Outcomes landing (spec §Recommended Landing Page). Summary cards,
// success/readiness widgets, AI insights and the five module cards — live.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function OutcomesLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadLearnerOutcomes(admin, hospitalId ?? "");

  const summary = [
    { icon: "🎓", tint: "bg-purple-50 text-purple-600", label: "Learning Success", value: pct(d.cards.successIndex), sub: "success index" },
    { icon: "🛡️", tint: "bg-blue-50 text-blue-600", label: "Competency Achievement", value: pct(d.cards.competencyAch), sub: `${d.competency.cards.achieved} achieved` },
    { icon: "🩺", tint: "bg-orange-50 text-orange-600", label: "Clinical Readiness", value: pct(d.cards.clinicalReadiness), sub: `${d.clinical.cards.independentSkills} independent skills` },
    { icon: "📜", tint: "bg-teal-50 text-teal-600", label: "Certification Readiness", value: pct(d.cards.certReadiness), sub: `${d.certification.cards.eligible} eligible` },
    { icon: "📈", tint: "bg-indigo-50 text-indigo-600", label: "CPD Compliance", value: pct(d.cards.cpdCompliance), sub: d.cpd.cards.note || "—" },
  ];
  const distMax = Math.max(1, ...d.success.distribution.map(x => x.n));
  const metric: Record<string, string> = {
    success: `${pct(d.success.cards.completion)} complete · ${pct(d.success.cards.avgGpa)} avg`,
    competency: `${d.competency.cards.achieved} of ${d.competency.cards.achieved + d.competency.cards.outstanding} achieved`,
    clinical: `${d.clinical.cards.independentSkills} independent · ${d.clinical.cards.casesCompleted} cases`,
    certification: `${d.certification.cards.eligible} eligible · ${d.certification.cards.certificatesIssued} certified`,
    cpd: d.cpd.cards.hours !== null ? `${d.cpd.cards.hours} CPD hrs` : "no CPD logged",
  };
  const insights = [...d.success.insights, ...d.clinical.insights, ...d.certification.insights].slice(0, 4);

  return (
    <div className="max-w-[1200px]">
      <OutcomesNav active="overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {summary.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${c.tint}`}>{c.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 leading-tight mt-2.5">{c.value}</p>
            <p className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5 items-start">
        {/* Success distribution */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Success Distribution</h2>
          {d.success.distribution.every(x => x.n === 0) ? <p className="text-xs text-gray-400 py-6 text-center">No learner outcome data yet.</p> : (
            <div className="flex flex-col gap-1.5">{d.success.distribution.map(x => (
              <div key={x.label} className="flex items-center gap-2"><span className="text-[10px] text-gray-500 w-32 truncate">{x.label}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(x.n / distMax) * 100}%`, background: x.color }} /></div><span className="text-[10px] font-bold text-gray-600 w-5 text-right">{x.n}</span></div>
            ))}</div>
          )}
        </div>

        {/* Clinical readiness levels */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Readiness by Level</h2>
          <div className="flex flex-col gap-2">{d.clinical.levels.map(x => (
            <div key={x.label} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 truncate">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>
          ))}</div>
          <Link href="/educator/analytics/outcomes/clinical" className="block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Clinical readiness →</Link>
        </div>

        {/* Certification funnel */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Certification Funnel</h2>
          {(() => { const max = d.certification.funnel[0]?.n ?? 1; return (
            <div className="flex flex-col gap-1">{d.certification.funnel.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2"><div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded flex items-center px-2 text-[9px] font-bold text-white" style={{ width: `${max ? Math.max(16, (s.n / max) * 100) : 0}%`, background: `hsl(${170 - i * 6} 60% ${48 + i * 4}%)` }}>{s.n}</div></div><span className="text-[9px] text-gray-500 w-24 shrink-0">{s.label}</span></div>
            ))}</div>
          ); })()}
        </div>
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Learner Outcome Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        {insights.length === 0 ? <p className="text-xs text-gray-400">No outcome concerns detected. ✅</p> : <ul className="grid sm:grid-cols-2 gap-1.5">{insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
      </div>

      {/* Module cards */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/outcomes/${m.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2"><span className={`w-9 h-9 rounded-lg flex items-center justify-center text-base ${m.tint}`}>{m.icon}</span><span className="text-[10px] font-bold text-gray-300">{m.n}</span></div>
            <p className="text-[12px] font-bold text-gray-800">{m.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{m.desc}</p>
            <p className="text-[11px] font-semibold text-gray-600 mt-2">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Programme results are computed live from scores, decisions, enrolments and the workplace logbook. Retention, graduation, satisfaction, clinical hours/rotations
        and CPD activity (none logged yet) have no store and are shown as honest empty or &ldquo;soon&rdquo; states rather than simulated.
      </p>
    </div>
  );
}
