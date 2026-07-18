import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, passRateOf, avgScoreOf, deltaLabel } from "@/lib/analytics";
import { METHOD_LABELS, type AssessmentMethod } from "@/lib/ckcm";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Assessments — the educator's overview of live assessment activity across
// the hospital: volumes, recent results, method mix, and links to the real
// builders (knowledge tests, OSCE blueprints, simulation scenarios).

export const dynamic = "force-dynamic";

export default async function EducatorAssessmentsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const cur = ctx.assess.filter(a => a.assessed_at >= d30);
  const prev = ctx.assess.filter(a => a.assessed_at < d30);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));

  const { data: recentRaw } = await admin.from("assessments")
    .select("id, method, score, assessed_at, profiles!assessor_id(full_name), framework_competencies!competency_id(name), competency_cycles!cycle_id(hospital_id, nurse_id)")
    .eq("status", "complete").not("score", "is", null)
    .order("assessed_at", { ascending: false }).limit(60);
  const recent = (recentRaw ?? []).filter(a => {
    const c = a.competency_cycles as unknown as { hospital_id: string | null } | null;
    return !hospitalId || c?.hospital_id === hospitalId;
  }).slice(0, 12);

  const byMethod = new Map<string, number>();
  for (const a of cur.length ? cur : ctx.assess) byMethod.set(a.method, (byMethod.get(a.method) ?? 0) + 1);
  const methods = [...byMethod.entries()].sort((a, b) => b[1] - a[1]);
  const methodMax = Math.max(1, ...methods.map(([, n]) => n));

  const BUILDERS = [
    { icon: "✍️", name: "Knowledge Test Builder", desc: "MCQ banks with pass marks & validity", href: "/educator/questions" },
    { icon: "🩺", name: "OSCE Blueprint Studio", desc: "Exams, stations & circuits", href: "/assessor/osce" },
    { icon: "🧪", name: "Simulation Scenarios", desc: "Briefs, cases & AI designer", href: "/educator/simulation" },
    { icon: "📚", name: "Checklist Builder", desc: "Master checklists per skill", href: "/assessor/studio/checklists" },
  ];

  return (
    <div className="max-w-4xl">
      <EduHeader icon="📝" title="Assessments" sub="Live assessment activity across your hospital, with the builders that create assessment content." />
      <StatTiles tiles={[
        { label: "Assessments (30d)", value: String(cur.length), d: deltaLabel(cur.length, passRateOf(prev) != null ? prev.length : null) },
        { label: "Pass Rate (30d)", value: passRateOf(cur) != null ? `${passRateOf(cur)}%` : "—" },
        { label: "Avg Score (30d)", value: avgScoreOf(cur) != null ? `${avgScoreOf(cur)}` : "—", sub: "Benner 0–6" },
        { label: "Active Assessors", value: String(new Set(cur.map(a => a.assessor_id).filter(Boolean)).size) },
      ]} />

      <Card title="Create & Build" sub="the real assessment builders — all educator-accessible">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {BUILDERS.map(b => (
            <Link key={b.name} href={b.href} className="border border-gray-100 rounded-lg px-3 py-2.5 hover:border-purple-300 transition-colors">
              <p className="text-xs font-semibold text-gray-800">{b.icon} {b.name}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{b.desc}</p>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid md:grid-cols-[minmax(0,1fr)_240px] gap-4 mt-4">
        <Card title="Recent Assessments" sub="latest completed, hospital-wide">
          {recent.length ? (
            <div className="space-y-1">
              {recent.map(a => {
                const c = a.competency_cycles as unknown as { nurse_id: string };
                return (
                  <div key={a.id} className="flex items-center gap-2 text-[11px] py-1">
                    <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${(a.score as number) >= 3 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>{a.score}</span>
                    <span className="text-gray-800 font-medium truncate">{nameOf.get(c.nurse_id) ?? "—"}</span>
                    <span className="text-gray-400 truncate flex-1">{(a.framework_competencies as unknown as { name: string } | null)?.name ?? "—"}</span>
                    <span className="text-[9px] text-gray-400 shrink-0">{METHOD_LABELS[a.method as AssessmentMethod] ?? a.method}</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-gray-400">No completed assessments yet.</p>}
        </Card>
        <Card title="Method Mix" sub={cur.length ? "last 30 days" : "all records"}>
          <div className="space-y-2">
            {methods.map(([m, n]) => (
              <div key={m}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-gray-600">{METHOD_LABELS[m as AssessmentMethod] ?? m}</span>
                  <span className="font-bold text-gray-900">{n}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.round(n / methodMax * 100)}%` }} />
                </div>
              </div>
            ))}
            {!methods.length && <p className="text-xs text-gray-400">No data yet.</p>}
          </div>
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Scores flow to Pending Validation for your sign-off; validated scores feed decisions and passports. Assignment/submission tracking has no store yet.
      </p>
    </div>
  );
}
