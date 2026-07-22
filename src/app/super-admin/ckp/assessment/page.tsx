import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAssessmentCentre } from "@/lib/super-admin/ckp-assessment";
import AssessmentBuilder from "./AssessmentBuilder";

export const dynamic = "force-dynamic";

// Assessment & Validation Centre (CKP-001.4) — assessment governance. Methods,
// rubrics, blueprints, scoring, OSCE, validation and reassessment. Live counts;
// validation outcomes from competency_decisions, honest where unrecorded.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();

function Donut({ segments, total }: { segments: { label: string; n: number; color: string }[]; total: number }) {
  const C = 2 * Math.PI * 15.5;
  const arcs: { dash: number; offset: number; color: string }[] = [];
  let acc = 0;
  segments.forEach(s => { const dash = (total ? s.n / total : 0) * C; arcs.push({ dash, offset: acc, color: s.color }); acc += dash; });
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-28 h-28 shrink-0">
        <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="4" />
          {arcs.map((a, i) => <circle key={i} cx="18" cy="18" r="15.5" fill="none" stroke={a.color} strokeWidth="4" strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={-a.offset} />)}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-bold text-gray-900 tabular-nums">{fmt(total)}</span><span className="text-[9px] text-gray-400">Total</span></div>
      </div>
      <div className="flex-1 space-y-1">
        {segments.map(s => (
          <div key={s.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-gray-600"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>
            <span className="tabular-nums text-gray-700">{fmt(s.n)} <span className="text-gray-300">· {total ? Math.round((s.n / total) * 100) : 0}%</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function AssessmentValidationCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const a = await loadAssessmentCentre(admin);
  const k = a.kpis;

  const kpiCards = [
    { label: "Assessments", value: fmt(k.assessments), icon: "🎯", iconBg: "bg-orange-50" },
    { label: "Methods", value: fmt(k.methods), icon: "🧪", iconBg: "bg-blue-50", sub: `${k.methodsActive} active` },
    { label: "Rubrics & Checklists", value: fmt(k.rubrics), icon: "✅", iconBg: "bg-teal-50" },
    { label: "Blueprints", value: fmt(k.blueprints), icon: "🗺️", iconBg: "bg-violet-50" },
    { label: "Scoring Scales", value: fmt(k.scoringScales), icon: "📊", iconBg: "bg-sky-50" },
    { label: "Question Banks", value: fmt(k.questionBanks), icon: "❓", iconBg: "bg-amber-50" },
    { label: "OSCE Exams", value: fmt(k.osce), icon: "🩺", iconBg: "bg-rose-50" },
    { label: "Reassessment Rules", value: fmt(k.reassessment), icon: "🔄", iconBg: "bg-gray-50", sub: `${k.reassessmentActive} active` },
  ];

  const tools = [
    { label: "Assessment Methods", icon: "🧪", href: "/super-admin/assessment-methods" },
    { label: "Rubrics & Checklists", icon: "✅", href: "/super-admin/studio/checklists" },
    { label: "Blueprint Builder", icon: "🗺️", href: "/super-admin/studio/cpus" },
    { label: "Question Banks", icon: "❓", href: "/super-admin/studio/questions" },
    { label: "Scoring & Standards", icon: "📊", href: "/super-admin/scoring" },
    { label: "OSCE Centre", icon: "🩺", href: "/super-admin/studio/cases" },
    { label: "Reassessment Rules", icon: "🔄", href: "/super-admin/schedules" },
    { label: "Certification Rules", icon: "🎓", href: "/super-admin/scoring" },
  ];

  const VAL_TONE: Record<string, string> = { validated: "text-green-600", passed: "text-green-600", pending: "text-amber-600", in_validation: "text-amber-600", requires_review: "text-rose-600", failed: "text-rose-600" };

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ckp" className="hover:text-teal-700">Clinical Knowledge Platform</Link><span>/</span><span className="text-gray-600">Assessment &amp; Validation Centre</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Assessment &amp; Validation Centre</h1>
        <p className="text-sm text-gray-500">Design, validate and govern all assessments.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className="text-2xl font-bold mt-1.5 tabular-nums text-gray-900">{c.value}</p>
            {(c as any).sub && <p className="text-[10px] text-gray-400 mt-0.5">{(c as any).sub}</p>}
          </div>
        ))}
      </div>

      {/* Real in-place assessment builder — question banks, checklists, methods, OSCE */}
      <AssessmentBuilder cpus={a.pickers.cpus} skills={a.pickers.skills} frameworks={a.pickers.frameworks} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Assessment overview donut */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Assessment Overview</h2>
          {a.overview.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No assessment assets yet.</p> : <Donut segments={a.overview} total={a.overviewTotal} />}
        </div>

        {/* Blueprint coverage + method mix */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Blueprint Coverage</h2>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative w-16 h-16 shrink-0">
              <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="4" /><circle cx="18" cy="18" r="15.5" fill="none" stroke="#0d9488" strokeWidth="4" strokeDasharray={`${(a.coverage.blueprintCoverage ?? 0) / 100 * 2 * Math.PI * 15.5} ${2 * Math.PI * 15.5}`} /></svg>
              <div className="absolute inset-0 flex items-center justify-center"><span className="text-sm font-bold text-gray-900">{a.coverage.blueprintCoverage == null ? "—" : `${a.coverage.blueprintCoverage}%`}</span></div>
            </div>
            <div className="text-xs text-gray-500"><p><span className="font-semibold text-gray-800">{a.coverage.blueprintsDefined}</span> of {a.coverage.cpuTotal} CPUs have a blueprint</p><p className="mt-1">{a.coverage.checklistItems} checklist items · {a.coverage.scoringLevels} scoring levels</p></div>
          </div>
          {a.methodMix.length > 0 && (
            <div className="pt-2 border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Blueprint Methods</p>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {a.methodMix.map((m: any) => <div key={m.method} className="flex items-center justify-between text-xs"><span className="text-gray-600 capitalize truncate">{m.method}</span><span className="text-gray-500 tabular-nums">{m.n}</span></div>)}
              </div>
            </div>
          )}
        </div>

        {/* Validation status */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Validation Status</h2>
          {!a.validationReady ? (
            <div className="py-6 text-center"><p className="text-sm text-gray-400">No validation records yet.</p><p className="text-[11px] text-gray-400 mt-1">Outcomes populate from competency decisions.</p></div>
          ) : (
            <div className="space-y-2">
              {Object.entries(a.validation).map(([outcome, n]) => (
                <div key={outcome} className="flex items-center justify-between text-sm"><span className="text-gray-700 capitalize">{outcome.replace(/_/g, " ")}</span><span className={`tabular-nums font-medium ${VAL_TONE[outcome] ?? "text-gray-600"}`}>{fmt(n as number)}</span></div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Assessment tools */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Assessment Tools</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          {tools.map(t => (
            <Link key={t.label} href={t.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 py-3 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <span className="text-lg">{t.icon}</span><span className="text-[11px] font-semibold text-gray-700 leading-tight">{t.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Everything related to assessment quality lives here — methods, rubrics, blueprints, scoring, OSCE, validation and reassessment. Counts, blueprint coverage and method mix are live; psychometrics and standard-setting analytics activate as assessment attempts accumulate.</p>
    </div>
  );
}
