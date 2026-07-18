import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, passRateOf, riskBuckets } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Support Analytics — educational outcomes from live records: cohort pass
// trend, risk distribution, reviewer workload, remediation closure (learners
// whose failed competency later passed) and validation turnaround.

export const dynamic = "force-dynamic";

export default async function SupportAnalyticsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const now = new Date().getTime();

  // Remediation effectiveness: nurse+competency pairs whose HISTORY includes a
  // fail before the current passing decision (recovered gaps).
  const nurseIds = ctx.nurses.map(n => n.id);
  const { data: allDecisions } = nurseIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, created_at")
        .in("nurse_id", nurseIds).order("created_at", { ascending: true }).limit(4000)
    : { data: [] };
  const failedFirst = new Set<string>();
  let recovered = 0;
  for (const d of allDecisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    const passing = ["competent", "provisionally_competent", "competent_with_conditions"].includes(d.outcome);
    if (!passing) failedFirst.add(key);
    else if (failedFirst.has(key)) { recovered++; failedFirst.delete(key); }
  }
  const stillOpen = failedFirst.size;
  const closureRate = recovered + stillOpen ? Math.round(recovered / (recovered + stillOpen) * 100) : null;

  // Intervention effectiveness — real recorded outcomes (migration 036).
  const { data: completedIv } = hospitalId
    ? await admin.from("interventions").select("outcome").eq("hospital_id", hospitalId).eq("status", "completed").not("outcome", "is", null)
    : { data: [] };
  const ivDone = completedIv ?? [];
  const ivSuccess = ivDone.length
    ? Math.round(ivDone.filter(i => i.outcome === "successful").length / ivDone.length * 100) : null;

  // Weekly pass trend (8w)
  const weeks: { label: string; pct: number | null; n: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now - (i + 1) * 7 * 86400000).toISOString();
    const end = new Date(now - i * 7 * 86400000).toISOString();
    const inW = ctx.assess.filter(a => a.assessed_at >= start && a.assessed_at < end);
    weeks.push({ label: `W${8 - i}`, pct: passRateOf(inW), n: inW.length });
  }

  // Reviewer workload from decided evidence
  const byReviewer = new Map<string, number>();
  const { data: decidedEntries } = nurseIds.length
    ? await admin.from("skill_log_entries")
        .select("verified_by_name")
        .in("nurse_id", nurseIds).in("status", ["verified", "rejected", "changes_requested"]).limit(1500)
    : { data: [] };
  for (const e of decidedEntries ?? []) {
    if (e.verified_by_name) byReviewer.set(e.verified_by_name, (byReviewer.get(e.verified_by_name) ?? 0) + 1);
  }
  const reviewers = [...byReviewer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const revMax = Math.max(1, ...reviewers.map(([, v]) => v));

  return (
    <div className="max-w-4xl">
      <EduHeader icon="📊" title="Support Analytics" sub="Educational outcomes from live records — remediation closure, risk distribution, trends and workload." />
      <StatTiles cols="grid-cols-2 md:grid-cols-5" tiles={[
        { label: "Remediation Closure", value: closureRate != null ? `${closureRate}%` : "—", sub: `${recovered} recovered · ${stillOpen} open` },
        { label: "Intervention Success", value: ivSuccess != null ? `${ivSuccess}%` : "—", sub: `${ivDone.length} completed` },
        { label: "Risk Distribution", value: `${risk.high}/${risk.medium}/${risk.low}`, sub: "high / med / clear" },
        { label: "Cohort Pass (8w)", value: passRateOf(ctx.assess) != null ? `${passRateOf(ctx.assess)}%` : "—", sub: `${ctx.assess.length} assessments` },
        { label: "Learners", value: String(ctx.nurses.length) },
      ]} />

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Weekly Pass Rate" sub="8 weeks">
          <div className="flex items-end gap-1.5 h-28">
            {weeks.map(w => (
              <div key={w.label} className="flex-1 flex flex-col items-center gap-1" title={`${w.label}: ${w.pct ?? "—"}% of ${w.n}`}>
                <span className="text-[8px] text-gray-400">{w.pct != null ? `${w.pct}%` : ""}</span>
                <div className="w-full bg-gray-100 rounded-t flex items-end" style={{ height: "76px" }}>
                  {w.pct != null && <div className="w-full bg-purple-500 rounded-t" style={{ height: `${Math.max(3, w.pct * 0.72)}px` }} />}
                </div>
                <span className="text-[8px] text-gray-400">{w.label}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Reviewer Workload" sub="evidence verdicts per reviewer">
          {reviewers.length ? (
            <div className="space-y-2">
              {reviewers.map(([name, v]) => (
                <div key={name}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="text-gray-700">{name}</span><span className="font-bold text-gray-900">{v}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.round(v / revMax * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No decided evidence yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Remediation closure counts nurse+competency pairs that failed and later passed — a real outcome measure, richer with time.
        Deeper educator analytics live in <Link href="/educator/validation-analytics" className="text-purple-600 hover:underline">Validation Analytics</Link>{" "}
        (with CSV export). Intervention-effectiveness by plan needs an interventions store.
      </p>
    </div>
  );
}
