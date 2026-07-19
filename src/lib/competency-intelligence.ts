import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Competency Intelligence Workspace data loader ───────────────────────────
// The flagship AI competency-reasoning view (Competency Intelligence spec v1.0 +
// mockup). One hospital-scoped pass over the live competency graph — frameworks,
// domains, CPUs, competencies, scores, decisions (validation/expiry/maturity),
// the skills logbook, assessments and evidence modalities — synthesised into: a
// health dashboard, navigator, a focus-competency digital twin, evidence
// intelligence, readiness, competency network, gap analysis, decay monitor,
// passport intelligence, framework intelligence, predictions and the AI panel.
//
// Honest-UI: every figure is computed from real records. Evidence types with no
// store (portfolio, structured reflection) are shown muted; "confidence" and
// decay are rule-derived and labelled — never fabricated.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
const REQUIRED = (risk: string | null) => (risk === "high" ? 5 : 4); // Benner 0–6 threshold
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const monthsSince = (iso: string | null): number | null => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / (30 * 86400000))) : null);

export type Tint = "green" | "amber" | "red" | "muted";
const tintOf = (v: number | null, invert = false): Tint => { if (v === null) return "muted"; const x = invert ? 100 - v : v; return x >= 75 ? "green" : x >= 50 ? "amber" : "red"; };

export type HealthKpi = { label: string; value: number | null; tint: Tint };
export type NavNode = { id: string; name: string; meta: string; tint: Tint; children: NavNode[] };
export type TwinNode = { label: string; present: boolean | null };
export type EvidenceRow = { type: string; status: "Complete" | "Partial" | "Missing" | "N/A"; quality: string; recency: string; sources: number };
export type NetNode = { id: string; label: string; count: number };
export type TimelineEvent = { label: string; date: string | null; done: boolean };
export type DecayRow = { name: string; last: string | null; risk: "High" | "Medium" | "Low"; decay: number };
export type Risk = { title: string; severity: "High" | "Medium" | "Low" };
export type Prediction = { title: string; reason: string; confidence: number };
export type StandardStatus = { name: string; coverage: number | null };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };
export type GapSlice = { label: string; n: number; color: string };

export type CompetencyIntelligence = {
  scope: { institution: string; frameworks: number; competencies: number; cpus: number; learners: number };
  health: HealthKpi[];
  risk: { level: "Low" | "Medium" | "High"; confidence: "High" | "Medium" | "Low" };
  navigator: NavNode;
  focus: {
    name: string; domain: string; code: string | null;
    twin: TwinNode[];
    evidence: EvidenceRow[]; evidenceScore: number | null; evidenceRec: string;
    readiness: number | null; readinessConfidence: "High" | "Medium" | "Low"; independentPractice: boolean; readinessRec: string;
    network: NetNode[];
    timeline: TimelineEvent[];
  } | null;
  readinessDist: { label: string; n: number; color: string }[];
  gaps: { total: number; slices: GapSlice[] };
  decay: DecayRow[];
  passport: { active: number; fullyValidated: number; expiringSoon: number; updatesNeeded: number; integrity: number | null };
  framework: { rows: { label: string; n: number }[]; note: string };
  predictions: Prediction[];
  risks: Risk[];
  panel: {
    summary: { highRisks: number; evidenceGaps: number; readyForPractice: number | null; pendingValidation: number; recommendations: number };
    reasoning: string[];
    standards: StandardStatus[];
    actions: PanelAction[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

export async function loadCompetencyIntelligence(admin: Admin, hospitalId: string): Promise<CompetencyIntelligence> {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: comps }, { data: domains }, { data: cpus }, { data: frameworks },
    { data: scores }, { data: decisions }, { data: logbook },
    { data: knowledge }, { data: cases }, { data: assessments },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("framework_competencies").select("id, name, domain_id, cpu_id, code, risk_category").limit(5000),
    admin.from("framework_domains").select("id, name, framework_id, frameworks(name)").limit(2000),
    admin.from("clinical_practice_units").select("id, reassessment_months").limit(2000),
    admin.from("frameworks").select("id, name").limit(200),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, domain_id, score, is_passing, assessed_at, educator_validated").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("nurse_id, competency_id, outcome, maturity, expiry_date, validated_at, created_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("skill_log_entries").select("competency_id, supervision_level, status, performed_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("assessments").select("competency_id, method").limit(10000),
  ]);

  type Comp = { id: string; name: string; domain_id: string | null; cpu_id: string | null; code: string | null; risk_category: string | null };
  const fc = (comps ?? []) as Comp[];
  const domName = new Map((domains ?? []).map(d => [d.id, d.name as string]));
  const domFramework = new Map((domains ?? []).map(d => [d.id, (d.frameworks as unknown as { name: string } | null)?.name ?? "Framework"]));
  const cpuReassess = new Map((cpus ?? []).map(c => [c.id, c.reassessment_months as number | null]));
  const fw = (frameworks ?? []) as { id: string; name: string }[];
  const sc = (scores ?? []) as { nurse_id: string; competency_id: string; domain_id: string | null; score: number; is_passing: boolean; assessed_at: string; educator_validated: boolean }[];
  const dec = (decisions ?? []) as { nurse_id: string; competency_id: string; outcome: string; maturity: string | null; expiry_date: string | null; validated_at: string | null; created_at: string }[];
  const log = (logbook ?? []) as { competency_id: string | null; supervision_level: string; status: string; performed_at: string | null }[];

  const knowledgeCpus = new Set((knowledge ?? []).map(k => k.cpu_id).filter(Boolean));
  const simCpus = new Set((cases ?? []).map(c => c.cpu_id).filter(Boolean));
  const methodsByComp = new Map<string, Set<string>>();
  for (const a of (assessments ?? []) as { competency_id: string; method: string }[]) { const s = methodsByComp.get(a.competency_id) ?? new Set<string>(); s.add(a.method); methodsByComp.set(a.competency_id, s); }
  const scoredComps = new Set(sc.map(s => s.competency_id));
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const validatedComps = new Set(dec.filter(d => d.validated_at).map(d => d.competency_id));
  const recordedComps = new Set([...scoredComps, ...evidenceComps]);
  const expiredComps = new Set(dec.filter(d => d.expiry_date && d.expiry_date < today).map(d => d.competency_id));
  const wbaComps = new Set([...methodsByComp.entries()].filter(([, m]) => m.has("workplace") || m.has("direct_observation")).map(([id]) => id));
  const osceComps = new Set([...methodsByComp.entries()].filter(([, m]) => m.has("osce")).map(([id]) => id));
  const skillComps = new Set(log.map(l => l.competency_id).filter(Boolean));
  const compScoreAvg = new Map<string, number>();
  { const acc = new Map<string, number[]>(); for (const s of sc) { const a = acc.get(s.competency_id) ?? []; a.push(s.score); acc.set(s.competency_id, a); } for (const [k, v] of acc) compScoreAvg.set(k, v.reduce((x, y) => x + y, 0) / v.length); }
  const compLastAt = new Map<string, string>();
  for (const s of sc) { const c = compLastAt.get(s.competency_id); if (!c || s.assessed_at > c) compLastAt.set(s.competency_id, s.assessed_at); }

  const total = fc.length;

  // ── Health KPIs ──────────────────────────────────────────────────────────
  const evidenceSufficient = (c: Comp) => evidenceComps.has(c.id) && (methodsByComp.has(c.id) || scoredComps.has(c.id)) && (!!c.cpu_id && (knowledgeCpus.has(c.cpu_id) || simCpus.has(c.cpu_id)));
  const validatedPct = pct(fc.filter(c => validatedComps.has(c.id)).length, recordedComps.size || total);
  const evidenceSufficiency = pct(fc.filter(evidenceSufficient).length, total);
  const assessmentAlignment = pct(fc.filter(c => methodsByComp.has(c.id) || scoredComps.has(c.id)).length, total);
  const readinessOf = (c: Comp): number | null => { const a = compScoreAvg.get(c.id); return a === undefined ? null : Math.min(100, Math.round((a / REQUIRED(c.risk_category)) * 100)); };
  const readinessScore = mean(fc.map(readinessOf));
  const overall = mean([validatedPct, evidenceSufficiency, assessmentAlignment, readinessScore]);

  const health: HealthKpi[] = [
    { label: "Overall Competency Health", value: overall, tint: tintOf(overall) },
    { label: "Validated Competencies", value: validatedPct, tint: tintOf(validatedPct) },
    { label: "Evidence Sufficiency", value: evidenceSufficiency, tint: tintOf(evidenceSufficiency) },
    { label: "Assessment Alignment", value: assessmentAlignment, tint: tintOf(assessmentAlignment) },
    { label: "Readiness Score", value: readinessScore, tint: tintOf(readinessScore) },
  ];

  // ── Navigator: Framework → Domain → CPU → Competency ─────────────────────
  const compHealth = (cs: Comp[]): number | null => { if (!cs.length) return null; const ev = cs.filter(c => evidenceComps.has(c.id)).length; const va = cs.filter(c => validatedComps.has(c.id)).length; return Math.round(((ev + va) / (cs.length * 2)) * 100); };
  const cpuNodesFor = (domId: string): NavNode[] => {
    const inDom = fc.filter(c => c.domain_id === domId);
    const cids = [...new Set(inDom.map(c => c.cpu_id).filter(Boolean))] as string[];
    return cids.map(cid => {
      const cs = inDom.filter(c => c.cpu_id === cid);
      const code = cs.find(c => c.code)?.code ?? null;
      return { id: cid, name: `${code ? code + " · " : ""}${cs[0]?.name ?? "CPU"}`.slice(0, 40), meta: `${cs.length} comp`, tint: tintOf(compHealth(cs)), children: [] };
    });
  };
  const navigator: NavNode = {
    id: "root", name: (hospital as { name: string } | null)?.name ?? "Your institution", meta: `${fw.length} frameworks`, tint: tintOf(overall),
    children: fw.map(f => {
      const domIds = (domains ?? []).filter(d => d.framework_id === f.id).map(d => d.id);
      return {
        id: f.id, name: f.name, meta: `${domIds.length} domains`, tint: tintOf(compHealth(fc.filter(c => domIds.includes(c.domain_id ?? "")))),
        children: domIds.map(did => ({ id: did, name: domName.get(did) ?? "Domain", meta: `${fc.filter(c => c.domain_id === did).length} comp`, tint: tintOf(compHealth(fc.filter(c => c.domain_id === did))), children: cpuNodesFor(did) })),
      };
    }),
  };

  // ── Focus competency (richest high-value competency to model) ────────────
  const focusComp = [...fc].map(c => ({ c, data: (compScoreAvg.has(c.id) ? 2 : 0) + (evidenceComps.has(c.id) ? 2 : 0) + (methodsByComp.get(c.id)?.size ?? 0) + (c.risk_category === "high" ? 1 : 0) }))
    .sort((a, b) => b.data - a.data)[0]?.c ?? null;

  let focus: CompetencyIntelligence["focus"] = null;
  if (focusComp) {
    const c = focusComp;
    const hasKnow = (!!c.cpu_id && knowledgeCpus.has(c.cpu_id)) || scoredComps.has(c.id);
    const hasSim = !!c.cpu_id && simCpus.has(c.cpu_id);
    const hasOsce = osceComps.has(c.id);
    const hasWba = wbaComps.has(c.id);
    const hasSkill = skillComps.has(c.id);
    const hasEvidence = evidenceComps.has(c.id);
    const isValidated = validatedComps.has(c.id);
    const lastAt = compLastAt.get(c.id) ?? null;
    const rec = (b: boolean) => (b ? (monthsSince(lastAt) !== null ? `${monthsSince(lastAt)} mo` : "—") : "—");
    const qual = (b: boolean, strong: boolean) => (!b ? "—" : strong ? "High" : "Medium");
    const evidence: EvidenceRow[] = [
      { type: "Knowledge Test", status: hasKnow ? "Complete" : "Missing", quality: qual(hasKnow, scoredComps.has(c.id)), recency: rec(hasKnow), sources: hasKnow ? 1 : 0 },
      { type: "Simulation", status: hasSim ? "Complete" : "Missing", quality: qual(hasSim, hasSim), recency: rec(hasSim), sources: hasSim ? 1 : 0 },
      { type: "OSCE", status: hasOsce ? "Complete" : "Missing", quality: qual(hasOsce, hasOsce), recency: rec(hasOsce), sources: hasOsce ? 1 : 0 },
      { type: "Workplace Observation", status: hasWba || hasSkill ? "Complete" : "Missing", quality: qual(hasWba || hasSkill, hasWba), recency: rec(hasWba || hasSkill), sources: (hasWba ? 1 : 0) + (hasSkill ? 1 : 0) },
      { type: "Portfolio", status: "N/A", quality: "—", recency: "—", sources: 0 },
      { type: "Reflection", status: "N/A", quality: "—", recency: "—", sources: 0 },
    ];
    const present = [hasKnow, hasSim, hasOsce, hasWba || hasSkill, hasEvidence].filter(Boolean).length;
    const evidenceScore = Math.round((present / 5) * 100);
    const readiness = readinessOf(c);
    const dataPoints = (compScoreAvg.has(c.id) ? 1 : 0) + present + (isValidated ? 1 : 0);
    const readinessConfidence: "High" | "Medium" | "Low" = dataPoints >= 5 ? "High" : dataPoints >= 3 ? "Medium" : "Low";
    const independentPractice = (readiness ?? 0) >= 85 && isValidated && (hasWba || hasSkill);
    focus = {
      name: c.name, domain: domName.get(c.domain_id ?? "") ?? "—", code: c.code,
      twin: [
        { label: "Knowledge", present: hasKnow }, { label: "Skills", present: hasSkill || hasWba },
        { label: "Simulation", present: hasSim }, { label: "OSCE", present: hasOsce },
        { label: "Workplace", present: hasWba || hasSkill }, { label: "Portfolio", present: null },
        { label: "Evidence", present: hasEvidence }, { label: "Validation", present: isValidated },
      ],
      evidence, evidenceScore,
      evidenceRec: hasWba || hasSkill ? (isValidated ? "Evidence base is multi-modal and validated." : "Add validated assessor sign-off to strengthen the decision.") : "Add workplace observation evidence to reach a defensible decision.",
      readiness, readinessConfidence, independentPractice,
      readinessRec: independentPractice ? "Learner cohort is ready for independent practice with routine monitoring." : (readiness ?? 0) >= 60 ? "Approaching readiness — requires supervised practice and further evidence." : "Not yet ready — needs additional assessment and observed practice.",
      network: [
        { id: "knowledge", label: "Knowledge", count: c.cpu_id && knowledgeCpus.has(c.cpu_id) ? 1 : 0 },
        { id: "skills", label: "Skills", count: log.filter(l => l.competency_id === c.id).length },
        { id: "assessments", label: "Assessments", count: methodsByComp.get(c.id)?.size ?? 0 },
        { id: "evidence", label: "Evidence", count: dec.filter(d => d.competency_id === c.id).length },
        { id: "learners", label: "Learners", count: new Set(sc.filter(s => s.competency_id === c.id).map(s => s.nurse_id)).size },
        { id: "standards", label: "Standards", count: domFramework.get(c.domain_id ?? "") ? 1 : 0 },
      ],
      timeline: (() => {
        const firstScore = [...sc].filter(s => s.competency_id === c.id).sort((a, b) => a.assessed_at.localeCompare(b.assessed_at))[0]?.assessed_at ?? null;
        const validatedAt = dec.filter(d => d.competency_id === c.id && d.validated_at).sort((a, b) => (a.validated_at! < b.validated_at! ? -1 : 1))[0]?.validated_at ?? null;
        return [
          { label: "Introduced", date: firstScore?.slice(0, 10) ?? null, done: !!firstScore },
          { label: "Simulation", date: null, done: hasSim },
          { label: "OSCE", date: null, done: hasOsce },
          { label: "Workplace", date: null, done: hasWba || hasSkill },
          { label: "Validated", date: validatedAt?.slice(0, 10) ?? null, done: isValidated },
          { label: "Passport", date: validatedAt?.slice(0, 10) ?? null, done: isValidated },
        ];
      })(),
    };
  }

  // ── Readiness distribution (over learners) ───────────────────────────────
  const learnerReadiness = nurseIds.map(id => {
    const mine = sc.filter(s => s.nurse_id === id);
    const assigned = new Set([...mine.map(s => s.competency_id), ...dec.filter(d => d.nurse_id === id).map(d => d.competency_id)]).size;
    const achieved = new Set([...mine.filter(s => s.is_passing).map(s => s.competency_id), ...dec.filter(d => d.nurse_id === id && PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id)]).size;
    return assigned ? Math.round((achieved / assigned) * 100) : null;
  }).filter((v): v is number => v !== null);
  const readinessDist = [
    { label: "Ready", n: learnerReadiness.filter(v => v >= 85).length, color: "#22c55e" },
    { label: "Nearly Ready", n: learnerReadiness.filter(v => v >= 70 && v < 85).length, color: "#84cc16" },
    { label: "Requires Support", n: learnerReadiness.filter(v => v >= 50 && v < 70).length, color: "#f59e0b" },
    { label: "Not Ready", n: learnerReadiness.filter(v => v < 50).length, color: "#ef4444" },
  ];

  // ── Gap analysis (institution-wide categories) ───────────────────────────
  const missingEvidence = fc.filter(c => !evidenceComps.has(c.id)).length;
  const weakEvidence = fc.filter(c => (compScoreAvg.get(c.id) ?? 6) < 3).length;
  const expiringEvidence = dec.filter(d => d.expiry_date && d.expiry_date >= today && d.expiry_date <= soon).length;
  const outdated = expiredComps.size;
  const noAssessment = fc.filter(c => !methodsByComp.has(c.id) && !scoredComps.has(c.id)).length;
  const nameCounts = new Map<string, number>();
  for (const c of fc) nameCounts.set(c.name.trim().toLowerCase(), (nameCounts.get(c.name.trim().toLowerCase()) ?? 0) + 1);
  const duplicate = [...nameCounts.values()].filter(n => n > 1).length;
  const gapSlices: GapSlice[] = [
    { label: "Missing evidence", n: missingEvidence, color: "#ef4444" },
    { label: "Weak evidence", n: weakEvidence, color: "#f59e0b" },
    { label: "Expiring evidence", n: expiringEvidence, color: "#eab308" },
    { label: "Outdated assessment", n: outdated, color: "#f97316" },
    { label: "Alignment gaps", n: noAssessment, color: "#8b5cf6" },
    { label: "Duplicate", n: duplicate, color: "#3b82f6" },
  ].filter(s => s.n > 0);
  const gapTotal = gapSlices.reduce((s, x) => s + x.n, 0);

  // ── Decay monitor (competencies overdue for demonstration) ───────────────
  const decay: DecayRow[] = fc
    .map(c => { const last = compLastAt.get(c.id) ?? null; const m = monthsSince(last); const reassess = (c.cpu_id && cpuReassess.get(c.cpu_id)) || 12; const decayPct = m === null ? 0 : Math.min(100, Math.round((m / reassess) * 100)); return { c, last, m, decayPct }; })
    .filter(x => x.m !== null && x.decayPct >= 40)
    .sort((a, b) => b.decayPct - a.decayPct).slice(0, 6)
    .map(x => ({ name: x.c.name, last: x.last?.slice(0, 10) ?? null, risk: (x.decayPct >= 80 ? "High" : x.decayPct >= 60 ? "Medium" : "Low") as DecayRow["risk"], decay: x.decayPct }));

  // ── Passport intelligence (from decisions) ───────────────────────────────
  const learnersWithDec = new Set(dec.map(d => d.nurse_id));
  const fullyValidatedLearners = [...learnersWithDec].filter(id => { const mine = dec.filter(d => d.nurse_id === id); return mine.length > 0 && mine.every(d => d.validated_at); }).length;
  const passport = {
    active: learnersWithDec.size,
    fullyValidated: fullyValidatedLearners,
    expiringSoon: dec.filter(d => d.expiry_date && d.expiry_date >= today && d.expiry_date <= soon).length,
    updatesNeeded: new Set(dec.filter(d => (d.expiry_date && d.expiry_date < today) || !d.validated_at).map(d => d.nurse_id)).size,
    integrity: pct(dec.filter(d => d.validated_at).length, dec.length),
  };

  // ── Framework intelligence (rule-derived integrity signals) ──────────────
  const unused = fc.filter(c => !recordedComps.has(c.id)).length;
  const noEvidenceReq = fc.filter(c => !c.cpu_id).length;
  const framework = {
    rows: [
      { label: "Duplicate competency names", n: duplicate },
      { label: "Unused competencies (no activity)", n: unused },
      { label: "No CPU / evidence requirement", n: noEvidenceReq },
      { label: "No assessment method", n: noAssessment },
    ].filter(r => r.n > 0),
    note: "Framework integrity is analysed from the live competency structure. Cross-framework conflicts need a framework-mapping store.",
  };

  // ── Predictions & risk centre ────────────────────────────────────────────
  const highRiskComps = fc.filter(c => c.risk_category === "high" && (!evidenceComps.has(c.id) || (compScoreAvg.get(c.id) ?? 6) < REQUIRED(c.risk_category))).length;
  const predictions: Prediction[] = [];
  if (decay.length) predictions.push({ title: `${decay[0].name} likely competence loss`, reason: `Last demonstrated ${decay[0].last ?? "long ago"}; past its reassessment window`, confidence: Math.min(93, 60 + decay[0].decay / 4) });
  if (missingEvidence > 0) predictions.push({ title: `${missingEvidence} competencies at decay risk`, reason: "No captured workplace evidence to sustain the decision", confidence: 78 });
  if (expiringEvidence > 0) predictions.push({ title: `${expiringEvidence} decisions expiring within 60 days`, reason: "Evidence approaching its expiry date", confidence: 88 });
  if (!predictions.length) predictions.push({ title: "Stable competency base", reason: "No decay or evidence-expiry signals detected", confidence: 60 });

  const risks: Risk[] = [];
  if (missingEvidence) risks.push({ title: `Insufficient workplace evidence for ${missingEvidence} competencies`, severity: "High" });
  if (expiringEvidence) risks.push({ title: `Evidence expiring within 60 days (${expiringEvidence})`, severity: "High" });
  if (outdated) risks.push({ title: `${outdated} assessments outdated (>reassessment window)`, severity: "Medium" });
  if (decay.length) risks.push({ title: "Competency decay risk detected", severity: "Medium" });
  if (passport.updatesNeeded) risks.push({ title: `Validation overdue for ${passport.updatesNeeded} passports`, severity: "Low" });

  // ── Right panel ──────────────────────────────────────────────────────────
  const pendingValidation = new Set(dec.filter(d => !d.validated_at).map(d => d.competency_id)).size;
  const readyForPractice = pct(readinessDist[0].n, learnerReadiness.length);
  const reasoning: string[] = [];
  if (missingEvidence) reasoning.push(`${missingEvidence} competencies have no captured workplace evidence.`);
  if (expiringEvidence) reasoning.push(`${expiringEvidence} decisions expire within 60 days — schedule reassessment.`);
  if (highRiskComps) reasoning.push(`${highRiskComps} high-risk competencies are below their required standard.`);
  if (pendingValidation) reasoning.push(`${pendingValidation} competencies await educator validation.`);
  if (!reasoning.length) reasoning.push("No material competency risks detected in the current evidence base.");

  const standards: StandardStatus[] = fw.slice(0, 5).map(f => {
    const domIds = (domains ?? []).filter(d => d.framework_id === f.id).map(d => d.id);
    const cs = fc.filter(c => domIds.includes(c.domain_id ?? ""));
    return { name: f.name, coverage: pct(cs.filter(c => validatedComps.has(c.id)).length, cs.length) };
  });

  const actions: PanelAction[] = [];
  if (missingEvidence) actions.push({ title: "Assign workplace observation", priority: "High", href: "/educator/validations" });
  if (highRiskComps) actions.push({ title: "Schedule workplace assessment", priority: "High", href: "/educator/simulation" });
  if (outdated) actions.push({ title: "Update expired evidence", priority: "Medium", href: "/educator/validations" });
  if (pendingValidation) actions.push({ title: "Validate outstanding evidence", priority: "Medium", href: "/educator/validations" });
  if (decay.length) actions.push({ title: "Create reassessment plan", priority: "Medium", href: "/educator/analytics/competency/gaps" });
  actions.push({ title: "Generate improvement report", priority: "Low", href: "/educator/analytics/competency" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));
  const backedCount = [validatedPct, evidenceSufficiency, assessmentAlignment, readinessScore].filter(v => v !== null).length;

  return {
    scope: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      frameworks: fw.length, competencies: total, cpus: (cpus ?? []).length, learners: nurseIds.length,
    },
    health,
    risk: {
      level: overall === null ? "Medium" : highRiskComps > 0 && missingEvidence > total * 0.3 ? "High" : overall < 70 ? "Medium" : "Low",
      confidence: backedCount >= 4 ? "High" : backedCount >= 2 ? "Medium" : "Low",
    },
    navigator, focus, readinessDist,
    gaps: { total: gapTotal, slices: gapSlices },
    decay, passport, framework, predictions, risks,
    panel: {
      summary: { highRisks: risks.filter(r => r.severity === "High").length + highRiskComps, evidenceGaps: missingEvidence + weakEvidence, readyForPractice, pendingValidation, recommendations: actions.length + predictions.length },
      reasoning, standards, actions,
      outputs: [
        { label: "Competency Gap Analysis", href: "/educator/analytics/competency/gaps" },
        { label: "Competency Coverage", href: "/educator/analytics/competency" },
        { label: "Evidence & Validation", href: "/educator/validations" },
        { label: "Curriculum Intelligence", href: "/educator/ai/curriculum" },
      ],
      aiConfigured: configured,
    },
  };
}
