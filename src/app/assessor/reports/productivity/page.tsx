import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, passRateOf, deltaLabel } from "@/lib/analytics";
import { ModuleHeader, StatTiles, PctChip, Card } from "../ui";

// Productivity & Workload module — assessor throughput, daily activity,
// per-assessor workload and the review queues. Per-assessment durations are
// only timed inside cockpit sessions, so no invented "productivity score".

export const dynamic = "force-dynamic";

export default async function ProductivityPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const d60 = new Date(now - 60 * 86400000).toISOString();
  const cur = ctx.assess.filter(a => a.assessed_at >= d30);
  const prev = ctx.assess.filter(a => a.assessed_at >= d60 && a.assessed_at < d30);
  const activeAssessors = new Set(cur.map(a => a.assessor_id).filter(Boolean)).size;
  const pending = ctx.entries.filter(e => e.status === "pending").length;
  const overdue = ctx.sched.filter(s => s.status === "scheduled" && s.scheduled_for < new Date(now).toISOString()).length;

  const reviews = ctx.entries.filter(e => e.status === "verified" && e.verified_at && e.verified_at >= d30);
  const avgReviewH = reviews.length
    ? Math.round(reviews.reduce((s, e) => s + (new Date(e.verified_at!).getTime() - new Date(e.created_at).getTime()), 0) / reviews.length / 36e5)
    : null;

  // Daily activity (14 days)
  const days: { label: string; n: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    days.push({ label: day.slice(8), n: ctx.assess.filter(a => a.assessed_at.startsWith(day)).length });
  }
  const dayMax = Math.max(1, ...days.map(d => d.n));

  // Per-assessor workload (30d)
  const byAssessor = new Map<string, { n: number; pass: number; learners: Set<string> }>();
  for (const a of cur) {
    if (!a.assessor_id) continue;
    const v = byAssessor.get(a.assessor_id) ?? { n: 0, pass: 0, learners: new Set<string>() };
    v.n++; if (a.score >= 3) v.pass++;
    v.learners.add(a.nurse_id);
    byAssessor.set(a.assessor_id, v);
  }
  const workload = [...byAssessor.entries()]
    .map(([id, v]) => ({ name: ctx.staffName.get(id) ?? "—", n: v.n, learners: v.learners.size, pass: Math.round(v.pass / v.n * 100) }))
    .sort((a, b) => b.n - a.n).slice(0, 10);
  const workMax = Math.max(1, ...workload.map(w => w.n));

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="⚡" title="Productivity & Workload" sub="Assessor throughput and the review queues — live, hospital-scoped, 30-day deltas." />
      <StatTiles cols="grid-cols-2 md:grid-cols-5" tiles={[
        { label: "Assessments (30d)", value: String(cur.length), d: deltaLabel(cur.length, prev.length) },
        { label: "Per Day", value: (cur.length / 30).toFixed(1) },
        { label: "Active Assessors", value: String(activeAssessors) },
        { label: "Evidence Review Time", value: avgReviewH != null ? `${avgReviewH}h` : "—", sub: "avg, 30d" },
        { label: "Queues", value: String(pending + overdue), sub: `${pending} evidence · ${overdue} overdue sessions`, alert: overdue > 0 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Daily Activity" sub="last 14 days">
          <div className="flex items-end gap-1 h-24">
            {days.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.n} assessments`}>
                <div className="w-full bg-gray-100 rounded-t flex items-end" style={{ height: "70px" }}>
                  <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${Math.round(d.n / dayMax * 68)}px` }} />
                </div>
                <span className="text-[7px] text-gray-400">{d.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-2">Pass rate over the window: {passRateOf(cur) != null ? `${passRateOf(cur)}%` : "—"}.</p>
        </Card>
        <Card title="Assessor Workload" sub="30 days">
          {workload.length ? (
            <div className="space-y-2">
              {workload.map(w => (
                <div key={w.name}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="text-gray-700">{w.name} <span className="text-gray-300">· {w.learners} learner{w.learners === 1 ? "" : "s"}</span></span>
                    <span className="flex items-center gap-1.5"><span className="font-bold text-gray-900">{w.n}</span><PctChip v={w.pass} /></span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.round(w.n / workMax * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No assessments in the last 30 days.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400">
        Your personal breakdown lives in <Link href="/assessor/analytics" className="text-indigo-500 hover:underline">My Analytics</Link>.
        Per-assessment durations are only timed in cockpit sessions, so no composite productivity score is shown.
      </p>
    </div>
  );
}
