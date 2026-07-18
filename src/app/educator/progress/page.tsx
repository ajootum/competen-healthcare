import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, passRateOf, avgScoreOf, competencyProfile } from "@/lib/analytics";
import { StatTiles, Card, PctChip } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Progress Monitoring — cohort progress from live records: weekly assessment
// trend, evidence submissions, simulation performance and per-department
// competency completion. Attendance and learning-hours tracking need stores
// that don't exist and are stated as such.

export const dynamic = "force-dynamic";

export default async function ProgressMonitoringPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const now = new Date().getTime();

  const weeks: { label: string; n: number; pct: number | null; ev: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now - (i + 1) * 7 * 86400000).toISOString();
    const end = new Date(now - i * 7 * 86400000).toISOString();
    const inW = ctx.assess.filter(a => a.assessed_at >= start && a.assessed_at < end);
    weeks.push({
      label: `W${8 - i}`, n: inW.length, pct: passRateOf(inW),
      ev: ctx.entries.filter(e => e.created_at >= start && e.created_at < end).length,
    });
  }
  const weekMax = Math.max(1, ...weeks.map(w => Math.max(w.n, w.ev)));

  const sims = ctx.assess.filter(a => a.method === "simulation");
  const comps = competencyProfile(ctx.latest);
  const completion = ctx.latest.length
    ? Math.round(ctx.latest.filter(d => d.passing && !d.expired).length / ctx.latest.length * 100) : null;

  const deptAgg = new Map<string, { pass: number; total: number }>();
  const deptOf = new Map(ctx.nurses.map(nu => [nu.id, nu.dept]));
  for (const d of ctx.latest) {
    const dep = deptOf.get(d.nurse_id) ?? "General";
    const v = deptAgg.get(dep) ?? { pass: 0, total: 0 };
    v.total++;
    if (d.passing && !d.expired) v.pass++;
    deptAgg.set(dep, v);
  }

  return (
    <div className="max-w-4xl">
      <EduHeader icon="📈" title="Progress Monitoring" sub="Cohort progress from live records — assessment trends, evidence flow, simulation performance and completion by department." />
      <StatTiles tiles={[
        { label: "Competency Completion", value: completion != null ? `${completion}%` : "—", sub: "latest decisions passing" },
        { label: "Assessments (8w)", value: String(ctx.assess.length), sub: `pass ${passRateOf(ctx.assess) ?? "—"}%` },
        { label: "Avg Score (8w)", value: avgScoreOf(ctx.assess) != null ? `${avgScoreOf(ctx.assess)}` : "—", sub: "Benner 0–6" },
        { label: "Simulation Pass (8w)", value: passRateOf(sims) != null ? `${passRateOf(sims)}%` : "—", sub: `${sims.length} sims` },
      ]} />

      <Card title="Weekly Trend" sub="assessments completed vs evidence submitted — labels show weekly pass rate">
        <div className="flex items-end gap-1.5 h-32">
          {weeks.map(w => (
            <div key={w.label} className="flex-1 flex flex-col items-center gap-1" title={`${w.label}: ${w.n} assessments (${w.pct ?? "—"}% pass), ${w.ev} evidence`}>
              <span className="text-[8px] text-gray-400">{w.pct != null ? `${w.pct}%` : ""}</span>
              <div className="w-full flex items-end justify-center gap-0.5" style={{ height: "88px" }}>
                <div className="w-2.5 bg-purple-500 rounded-t" style={{ height: `${Math.round(w.n / weekMax * 84)}px` }} />
                <div className="w-2.5 bg-teal-400 rounded-t" style={{ height: `${Math.round(w.ev / weekMax * 84)}px` }} />
              </div>
              <span className="text-[8px] text-gray-400">{w.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-gray-400 mt-2"><span className="text-purple-500">■</span> assessments · <span className="text-teal-500">■</span> evidence submissions</p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Card title="Completion by Department" sub="passing share of latest decisions">
          {[...deptAgg.entries()].sort((a, b) => b[1].total - a[1].total).map(([dep, v]) => (
            <div key={dep} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-600 flex-1">{dep}</span>
              <span className="text-gray-300">{v.total} decisions</span>
              <PctChip v={Math.round(v.pass / v.total * 100)} />
            </div>
          ))}
          {!deptAgg.size && <p className="text-xs text-gray-400">No decision data yet.</p>}
        </Card>
        <Card title="Weakest Competencies" sub="teaching priorities — ≥2 decisions">
          {comps.filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 6).map(c => (
            <div key={c.name} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-600 flex-1 truncate">{c.name}</span>
              <span className="text-gray-300">{c.total}</span>
              <PctChip v={c.pct} />
            </div>
          ))}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: attendance registers and learning-hours tracking need stores that don&apos;t exist — CPD hours (learner-logged) live in CPD &amp; Courses.
      </p>
    </div>
  );
}
