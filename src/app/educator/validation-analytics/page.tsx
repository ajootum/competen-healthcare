import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Validation Analytics — operational insight into validation performance:
// volumes, approval rate, turnaround, weekly trend, per-reviewer workload and
// CSV export. All figures from real validation timestamps.

export const dynamic = "force-dynamic";

export default async function ValidationAnalyticsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();

  const [{ data: nurses }, { data: entriesRaw }] = await Promise.all([
    hospitalId ? admin.from("profiles").select("id").eq("hospital_id", hospitalId).eq("role", "nurse") : Promise.resolve({ data: [] }),
    admin.from("skill_log_entries")
      .select("status, created_at, verified_at, verified_by_name, profiles!nurse_id(hospital_id)")
      .order("created_at", { ascending: false }).limit(1500),
  ]);
  const nurseIds = (nurses ?? []).map(n => n.id);
  const entries = (entriesRaw ?? []).filter(e =>
    !hospitalId || (e.profiles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);

  const { data: scores } = nurseIds.length
    ? await admin.from("competency_scores")
        .select("educator_validated, educator_id, assessed_at, validated_at, educator_notes, nurse_id")
        .in("nurse_id", nurseIds).limit(3000)
    : { data: [] };

  const validated = (scores ?? []).filter(s => s.educator_validated);
  const returned = (scores ?? []).filter(s => !s.educator_validated && s.educator_notes);
  const decidedScores = validated.length + returned.length;
  const decidedEntries = entries.filter(e => ["verified", "rejected", "changes_requested"].includes(e.status));
  const approvedEntries = entries.filter(e => e.status === "verified");
  const approvalRate = decidedEntries.length + decidedScores
    ? Math.round((approvedEntries.length + validated.length) / (decidedEntries.length + decidedScores) * 100) : null;

  const turns = [
    ...validated.filter(s => s.validated_at && s.assessed_at)
      .map(s => (new Date(s.validated_at!).getTime() - new Date(s.assessed_at).getTime()) / 36e5),
    ...entries.filter(e => e.verified_at)
      .map(e => (new Date(e.verified_at!).getTime() - new Date(e.created_at).getTime()) / 36e5),
  ].filter(h => h >= 0);
  const avgTurnH = turns.length ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length) : null;

  // Weekly validations trend (8 weeks): score validations + evidence verdicts.
  const weeks: { label: string; n: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now - (i + 1) * 7 * 86400000).toISOString();
    const end = new Date(now - i * 7 * 86400000).toISOString();
    weeks.push({
      label: `W${8 - i}`,
      n: validated.filter(s => s.validated_at && s.validated_at >= start && s.validated_at < end).length
        + entries.filter(e => e.verified_at && e.verified_at >= start && e.verified_at < end).length,
    });
  }
  const weekMax = Math.max(1, ...weeks.map(w => w.n));

  // Per-reviewer workload (evidence verdicts, named).
  const byReviewer = new Map<string, number>();
  for (const e of decidedEntries) {
    if (!e.verified_by_name) continue;
    byReviewer.set(e.verified_by_name, (byReviewer.get(e.verified_by_name) ?? 0) + 1);
  }
  const reviewers = [...byReviewer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const revMax = Math.max(1, ...reviewers.map(([, n]) => n));

  // Validation by type
  const types = [
    { label: "Score validations", n: validated.length },
    { label: "Evidence verified", n: approvedEntries.length },
    { label: "Evidence rejected", n: entries.filter(e => e.status === "rejected").length },
    { label: "Returned for changes", n: entries.filter(e => e.status === "changes_requested").length + returned.length },
  ];
  const typeMax = Math.max(1, ...types.map(t => t.n));

  const recent30 = validated.filter(s => (s.validated_at ?? "") >= d30).length
    + entries.filter(e => (e.verified_at ?? "") >= d30).length;

  return (
    <div className="max-w-4xl">
      <EduHeader icon="📐" title="Validation Analytics" sub="Insights into validation performance and quality — live figures with CSV export." />
      <div className="flex justify-end -mt-2 mb-3">
        <a href="/api/reports/validations" className="no-print text-xs font-semibold text-white bg-purple-600 px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">⬇ Export CSV</a>
      </div>
      <StatTiles tiles={[
        { label: "Total Validations", value: String(validated.length + decidedEntries.length), sub: "scores + evidence, all time" },
        { label: "Approval Rate", value: approvalRate != null ? `${approvalRate}%` : "—", sub: "approved ÷ decided" },
        { label: "Avg Turnaround", value: avgTurnH != null ? `${avgTurnH}h` : "—", sub: "submission → decision" },
        { label: "Last 30 Days", value: String(recent30), sub: "validation actions" },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Validations Over Time" sub="8 weeks — score validations + evidence verdicts">
          <div className="flex items-end gap-1.5 h-28">
            {weeks.map(w => (
              <div key={w.label} className="flex-1 flex flex-col items-center gap-1" title={`${w.n} validations`}>
                <span className="text-[8px] text-gray-400">{w.n || ""}</span>
                <div className="w-full bg-gray-100 rounded-t flex items-end" style={{ height: "80px" }}>
                  <div className="w-full bg-purple-500 rounded-t" style={{ height: `${Math.round(w.n / weekMax * 76)}px` }} />
                </div>
                <span className="text-[8px] text-gray-400">{w.label}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Validation by Type">
          <div className="space-y-2">
            {types.map(t => (
              <div key={t.label}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-gray-600">{t.label}</span><span className="font-bold text-gray-900">{t.n}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.round(t.n / typeMax * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Reviewer Workload" sub="evidence verdicts per reviewer">
        {reviewers.length ? (
          <div className="space-y-2">
            {reviewers.map(([name, n]) => (
              <div key={name}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-gray-700">{name}</span><span className="font-bold text-gray-900">{n}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.round(n / revMax * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No decided evidence yet.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Figures come from real validation timestamps (competency_scores + skill_log_entries). Learner-outcome correlations need longer
        longitudinal data; a &quot;quality score&quot; composite is deliberately not invented.
      </p>
    </div>
  );
}
