import { loadAnalytics, requireAnalyticsAccess, passRateOf, avgScoreOf } from "@/lib/analytics";
import { ModuleHeader, StatTiles, PctChip, Card } from "../ui";
import AppealsQueue, { type AppealRow } from "./AppealsQueue";

// Assessment Quality module — validation success, turnaround, per-assessor
// consistency, and inter-rater agreement computed from real multi-assessor
// overlap (shown as "insufficient overlap" when the data can't support it).

export const dynamic = "force-dynamic";

export default async function AssessmentQualityPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const [{ data: scoresRaw }, { data: appealsRaw }] = await Promise.all([
    hospitalId
      ? admin.from("competency_scores").select("educator_validated, nurse_id").limit(3000)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("appeals")
          .select("id, nurse_id, competency_name, score, reason, status, created_at, profiles!nurse_id(full_name)")
          .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
  ]);
  const hosScores = (scoresRaw ?? []).filter(s => ctx.nurseIds.has(s.nurse_id));
  const validationRate = hosScores.length
    ? Math.round(hosScores.filter(s => s.educator_validated).length / hosScores.length * 100) : null;

  // Turnaround: created → assessed, in days.
  const turns = ctx.assess
    .filter(a => a.created_at)
    .map(a => (new Date(a.assessed_at).getTime() - new Date(a.created_at!).getTime()) / 86400000)
    .filter(d => d >= 0);
  const avgTurn = turns.length ? Math.round(turns.reduce((s, d) => s + d, 0) / turns.length * 10) / 10 : null;
  const turnBuckets = [
    { label: "Same day", n: turns.filter(t => t < 1).length },
    { label: "1–2 days", n: turns.filter(t => t >= 1 && t < 3).length },
    { label: "3–6 days", n: turns.filter(t => t >= 3 && t < 7).length },
    { label: "7+ days", n: turns.filter(t => t >= 7).length },
  ];
  const turnMax = Math.max(1, ...turnBuckets.map(b => b.n));

  // Inter-rater agreement: same nurse+competency scored by ≥2 assessors (8w).
  const groups = new Map<string, { assessor: string; score: number }[]>();
  for (const a of ctx.assess) {
    if (!a.competency_id || !a.assessor_id) continue;
    const key = `${a.nurse_id}:${a.competency_id}`;
    groups.set(key, [...(groups.get(key) ?? []), { assessor: a.assessor_id, score: a.score }]);
  }
  const pairs: number[] = [];
  for (const g of groups.values()) {
    const byAssessor = new Map<string, number>();
    for (const x of g) if (!byAssessor.has(x.assessor)) byAssessor.set(x.assessor, x.score);
    const scores = [...byAssessor.values()];
    if (scores.length < 2) continue;
    for (let i = 0; i < scores.length; i++) {
      for (let j = i + 1; j < scores.length; j++) pairs.push(Math.abs(scores[i] - scores[j]));
    }
  }
  const agreement = pairs.length ? Math.round(pairs.filter(d => d <= 1).length / pairs.length * 100) : null;
  const meanDiff = pairs.length ? Math.round(pairs.reduce((s, d) => s + d, 0) / pairs.length * 100) / 100 : null;

  // Per-assessor consistency
  const byAssessor = new Map<string, { n: number; sum: number; pass: number }>();
  for (const a of ctx.assess) {
    if (!a.assessor_id) continue;
    const v = byAssessor.get(a.assessor_id) ?? { n: 0, sum: 0, pass: 0 };
    v.n++; v.sum += a.score; if (a.score >= 3) v.pass++;
    byAssessor.set(a.assessor_id, v);
  }
  const assessorRows = [...byAssessor.entries()]
    .map(([id, v]) => ({
      name: ctx.staffName.get(id) ?? "—", n: v.n,
      avg: Math.round(v.sum / v.n * 10) / 10,
      pass: Math.round(v.pass / v.n * 100),
    }))
    .sort((a, b) => b.n - a.n).slice(0, 10);

  const appeals: AppealRow[] = ((appealsRaw ?? []) as unknown as {
    id: string; competency_name: string | null; score: number | null; reason: string; status: string; created_at: string;
    profiles: { full_name: string } | null;
  }[]).map(a => ({
    id: a.id, nurse: a.profiles?.full_name ?? "—", competency: a.competency_name,
    score: a.score, reason: a.reason, status: a.status, at: a.created_at,
  }));
  const openAppeals = appeals.filter(a => ["open", "under_review"].includes(a.status));
  const resolvedAppeals = appeals.filter(a => !["open", "under_review"].includes(a.status));

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="🎖️" title="Assessment Quality" sub="Quality and consistency of assessments — validation success, turnaround, rater agreement and appeals, all from live records." />
      <StatTiles cols="grid-cols-2 md:grid-cols-5" tiles={[
        { label: "Validation Success", value: validationRate != null ? `${validationRate}%` : "—", sub: "educator-validated scores" },
        { label: "Avg Turnaround", value: avgTurn != null ? `${avgTurn}d` : "—", sub: "assignment → scored, 8w" },
        { label: "Inter-Rater Agreement", value: agreement != null ? `${agreement}%` : "—", sub: agreement != null ? `within 1 point · ${pairs.length} pairs` : "insufficient multi-assessor overlap" },
        { label: "Pass Rate (8w)", value: passRateOf(ctx.assess) != null ? `${passRateOf(ctx.assess)}%` : "—", sub: `avg score ${avgScoreOf(ctx.assess) ?? "—"}` },
        { label: "Open Appeals", value: String(openAppeals.length), sub: `${resolvedAppeals.length} resolved`, alert: openAppeals.length > 0 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Assessment Turnaround" sub="8 weeks">
          <div className="space-y-2">
            {turnBuckets.map(b => (
              <div key={b.label}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-gray-600">{b.label}</span><span className="font-bold text-gray-900">{b.n}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.round(b.n / turnMax * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Inter-Rater Detail">
          {pairs.length ? (
            <div className="text-xs text-gray-600 space-y-1.5">
              <p>{pairs.length} assessor-pair comparisons on the same learner + competency (8 weeks).</p>
              <p>Mean score difference: <span className="font-bold text-gray-900">{meanDiff}</span> points (0–6 scale).</p>
              <p>Agreement within 1 point: <span className="font-bold text-gray-900">{agreement}%</span>.</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              No competency has been scored by two assessors in the same period yet — inter-rater metrics appear automatically once overlapping assessments exist. Nothing is estimated.
            </p>
          )}
        </Card>
      </div>

      <Card title="Assessor Consistency" sub="8 weeks — scoring profile per assessor">
        {assessorRows.length ? (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                <th className="pb-1.5">Assessor</th><th className="pb-1.5 text-center">Assessments</th>
                <th className="pb-1.5 text-center">Avg score</th><th className="pb-1.5 text-center">Pass rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {assessorRows.map(r => (
                <tr key={r.name}>
                  <td className="py-1.5 text-gray-700">{r.name}</td>
                  <td className="py-1.5 text-center text-gray-600">{r.n}</td>
                  <td className="py-1.5 text-center text-gray-600">{r.avg}</td>
                  <td className="py-1.5 text-center"><PctChip v={r.pass} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-xs text-gray-400">No assessments in the last 8 weeks.</p>}
      </Card>

      <div className="mt-4">
        <Card title="Appeals" sub="learner appeals against assessment outcomes">
          <AppealsQueue rows={openAppeals} />
          {resolvedAppeals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-50">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Recently resolved</p>
              {resolvedAppeals.slice(0, 5).map(a => (
                <p key={a.id} className="text-[11px] text-gray-500 py-0.5">
                  {a.nurse} · {a.competency ?? "Assessment"} — <span className="font-semibold capitalize">{a.status}</span>
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Reliability coefficients (e.g. Cronbach&apos;s α) appear in the OSCE Centre where a stations × candidates matrix exists;
        here agreement uses direct multi-assessor overlap only. Overturned appeals lead to reassessment — historical scores are never edited.
      </p>
    </div>
  );
}
