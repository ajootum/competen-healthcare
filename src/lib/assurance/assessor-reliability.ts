/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPA-005 — Assessor Reliability Engine. The first genuinely-new CAPA assurance engine: it measures how each
// assessor SCORES relative to their peers, over the real per-assessor grain the platform records —
// `assessments` (assessor_id, score 0-6, method) and `skill_scores` (assessor_id, score, one row per
// cycle+skill+assessor). Surfaces leniency/severity ("hawk vs dove"), internal consistency (score variance), and
// — where the same item was scored by more than one assessor — genuine inter-rater agreement. All real, no
// fabrication: assessments/skill_scores carry no hospital_id, so tenant scope is resolved via competency_cycles.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const MIN_N = 3; // below this an assessor's profile is shown but flagged low-confidence, not judged

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
const round1 = (n: number) => Math.round(n * 10) / 10;

function tendency(dev: number): { label: string; tone: string } {
  if (dev >= 0.5) return { label: "Lenient", tone: "amber" };
  if (dev <= -0.5) return { label: "Severe", tone: "rose" };
  return { label: "Balanced", tone: "emerald" };
}

// Heuristic reliability score (labelled, not a psychometric claim): full marks, penalised for scoring far from the
// peer mean (bias) and for high internal variance (inconsistency).
function reliabilityScore(dev: number, sd: number): number {
  const devPenalty = Math.min(35, Math.abs(dev) * 25);
  const sdPenalty = Math.min(25, Math.max(0, sd - 1) * 18);
  return Math.max(30, Math.round(100 - devPenalty - sdPenalty));
}

export async function loadAssessorReliability(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("assessments").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  // assessments/skill_scores have no hospital_id → scope through competency_cycles.
  const { data: cyc } = await scope(admin.from("competency_cycles").select("id").limit(20000));
  const cycleIds = (cyc ?? []).map((c: any) => c.id) as string[];
  if (!isSuper && !cycleIds.length) return emptyResult();

  // Scored assessments (real assessor + numeric score).
  let aq = admin.from("assessments").select("assessor_id, competency_id, method, score, assessed_at").not("assessor_id", "is", null).not("score", "is", null).limit(50000);
  if (!isSuper) aq = aq.in("cycle_id", cycleIds.slice(0, 5000));
  const { data: asmt } = await aq;
  const rows = (asmt ?? []) as any[];
  if (!rows.length) return emptyResult();

  const allScores = rows.map(r => Number(r.score));
  const globalMean = mean(allScores);

  // Group by assessor.
  const byAssessor = new Map<string, any[]>();
  for (const r of rows) { const k = r.assessor_id; if (!byAssessor.has(k)) byAssessor.set(k, []); byAssessor.get(k)!.push(r); }

  const ids = [...byAssessor.keys()];
  const nameById = new Map<string, string>();
  const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", ids.slice(0, 3000));
  (profs ?? []).forEach((p: any) => nameById.set(p.id, p.full_name ?? "—"));

  const assessors = ids.map(id => {
    const rs = byAssessor.get(id)!;
    const scores = rs.map(r => Number(r.score));
    const m = mean(scores), sd = stdev(scores), dev = m - globalMean;
    const methods = [...new Set(rs.map(r => r.method).filter(Boolean))];
    const competencies = new Set(rs.map(r => r.competency_id).filter(Boolean)).size;
    const last = rs.map(r => r.assessed_at).filter(Boolean).sort().slice(-1)[0] ?? null;
    const t = tendency(dev);
    return {
      id, name: nameById.get(id) ?? "—", n: rs.length, competencies,
      meanScore: round1(m), stdev: round1(sd), deviation: round1(dev),
      tendency: t.label, tendencyTone: t.tone, methods, lastAssessed: last,
      reliability: reliabilityScore(dev, sd), lowConfidence: rs.length < MIN_N,
    };
  }).sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

  const judged = assessors.filter(a => !a.lowConfidence);
  const withinTolerance = judged.filter(a => Math.abs(a.deviation) <= 0.4).length;
  const watchlist = assessors.filter(a => !a.lowConfidence && (Math.abs(a.deviation) > 0.6 || a.stdev > 1.5))
    .map(a => ({ ...a, reason: Math.abs(a.deviation) > 0.6 ? `${a.tendency.toLowerCase()} — scores ${a.deviation > 0 ? "+" : ""}${a.deviation} vs peer mean` : `inconsistent — score spread ${a.stdev}` }))
    .slice(0, 12);

  // Inter-rater agreement from skill_scores: items (cycle+skill) scored by ≥2 assessors.
  let sq = admin.from("skill_scores").select("cycle_id, skill_id, assessor_id, score").not("assessor_id", "is", null).not("score", "is", null).limit(50000);
  if (!isSuper) sq = sq.in("cycle_id", cycleIds.slice(0, 5000));
  const { data: skills } = await sq;
  const itemMap = new Map<string, number[]>();
  for (const s of (skills ?? []) as any[]) { const k = `${s.cycle_id}|${s.skill_id}`; if (!itemMap.has(k)) itemMap.set(k, []); itemMap.get(k)!.push(Number(s.score)); }
  const coScored = [...itemMap.values()].filter(v => v.length >= 2);
  const ranges = coScored.map(v => Math.max(...v) - Math.min(...v));
  const interRater = coScored.length
    ? { sampledItems: coScored.length, avgRange: round1(mean(ranges)), agreement: Math.round((coScored.filter(v => Math.max(...v) - Math.min(...v) <= 1).length / coScored.length) * 100) }
    : { sampledItems: 0, avgRange: 0, agreement: null as number | null };

  return {
    provisioned: true as const, empty: false,
    kpis: {
      assessors: assessors.length,
      assessments: rows.length,
      globalMean: round1(globalMean),
      withinTolerance,
      judged: judged.length,
      watchlist: watchlist.length,
      interRaterAgreement: interRater.agreement,
    },
    globalMean: round1(globalMean),
    assessors,
    watchlist,
    interRater,
  };
}

function emptyResult() {
  return {
    provisioned: true as const, empty: true,
    kpis: { assessors: 0, assessments: 0, globalMean: 0, withinTolerance: 0, judged: 0, watchlist: 0, interRaterAgreement: null as number | null },
    globalMean: 0, assessors: [] as any[], watchlist: [] as any[],
    interRater: { sampledItems: 0, avgRange: 0, agreement: null as number | null },
  };
}
