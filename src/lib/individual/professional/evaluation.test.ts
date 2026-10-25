/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, POLICIES, resolvePolicy } from "../policy";
import { compareEvaluations, evaluate, recommendationKey, type EvaluationInput, type StoredEvaluation } from "./evaluation";
import { parseAnnotation, parseCorrection, parseDecision, parseScope } from "./evaluation-form";
import { decideRecommendation, recordEvaluation } from "./evaluation-store";
import { parseShareEvaluations, sharedView } from "./share-evaluation";
import { aiEvaluationQuestion } from "./evaluation-ai";
import { DIMENSIONS } from "./evaluation-vocabulary";

// COMPETEN-PROFESSIONAL-EVALUATION-01 (Stage 6): six separate dimensions, no score, provenance kept, missing evidence
// never read as incompetence, verification only read, works without a catalogue and without AI, private by default.

const P = DEFAULT_POLICY.professionalEvaluation;
const USER = "00000000-0000-4000-8000-0000000000aa";
const GOAL = "00000000-0000-4000-8000-0000000000a1", NEED = "00000000-0000-4000-8000-0000000000b1";
const CPD = "00000000-0000-4000-8000-0000000000c1", CPD2 = "00000000-0000-4000-8000-0000000000c2", REC = "00000000-0000-4000-8000-0000000000e1";
const COMP = "00000000-0000-4000-8000-0000000000f1", ENTRY = "00000000-0000-4000-8000-0000000000d1", ACT = "00000000-0000-4000-8000-0000000000a9";
const TODAY = "2026-10-25";

const hrefs = { cpd: "/cpd", development: "/dev", goal: (id: string) => `/dev?goal=${id}`, need: (id: string) => `/dev?need=${id}`, competencies: "/ev", competency: (id: string) => `/ev?c=${id}`,
  learning: (c: string | null) => `/learn?c=${c}`, learningRecord: (id: string) => `/rec/${id}`, verification: "/verify-me" };

function empty(): EvaluationInput {
  return { today: TODAY, needs: [], goals: [], cpd: [], evidence: [], activities: [], activityGoals: [], milestones: [], planCompetencies: [], goalEvidence: [], reviews: [],
    needCompetencies: [], goalNeeds: [], reflections: [], learning: { enabled: true, refs: [] }, learningReflections: { available: true, bySubject: new Map() }, mappings: [],
    passport: [], stage5: { available: true, entries: [], assessments: [], links: [] }, verification: { available: true, decisions: [] }, names: new Map(), versions: new Map(), hrefs };
}

/** The ECG Interpretation scenario of the focused staging journey. */
function ecg(opts: { verified?: boolean; catalogue?: boolean } = {}): EvaluationInput {
  const i = empty();
  const catalogue = opts.catalogue !== false;
  i.needs = [{ id: NEED, title: "ECG interpretation", detail: null, origin: "self_identified", status: "open", framework_id: null, framework_competency_id: null, created_at: "2026-09-01T00:00:00Z", closed_at: null }];
  i.goals = [{ id: GOAL, need_id: NEED, title: "Interpret 12-lead ECGs confidently", detail: null, target_date: "2026-12-31", status: "in_progress", completed_at: null, created_at: "2026-09-02T00:00:00Z" }];
  i.cpd = [
    { id: CPD, goal_id: GOAL, activity_type: "course", title: "ECG workshop", provider: "Hospital", hours: 3, cpd_points: null, activity_date: "2026-09-20", reflection: null, document_name: "cert.pdf", evidence_class: "source_linked", created_at: "2026-09-20T00:00:00Z" },
    { id: CPD2, goal_id: null, activity_type: "reading", title: "Arrhythmia reading", provider: null, hours: 1, cpd_points: null, activity_date: "2026-10-01", reflection: null, document_name: null, evidence_class: "self_declared", created_at: "2026-10-01T00:00:00Z" },
  ];
  i.learning = { enabled: true, refs: [{ recordId: REC, offeringId: "o1", code: "LRN-ECG", title: "ECG Interpretation", versionNo: 1, delivery: "hosted", provider: "Competen", completedOn: "2026-10-05",
    completionKind: "assessed_knowledge", outcomeLabel: "Assessed knowledge", evidenceClass: "platform_recorded", evidenceLabel: "Assessed knowledge, issued by Competen Holdings", hours: 2, cpdNote: "",
    certificates: [], competencies: catalogue ? [{ id: COMP, name: "ECG interpretation", relation: "develops", relationLabel: "Develops" }] : [] }] as any };
  i.activities = [{ id: ACT, activity_type_code: null, activity_type_label: null, title: "Course", detail: null, status: "completed", planned_start: null, planned_end: "2026-10-05", provider: null, external_url: null,
    learning_offering_id: null, learning_record_id: REC, cpd_id: null, depends_on_activity_id: null, created_at: "2026-09-02T00:00:00Z", updated_at: "2026-10-05T00:00:00Z" }];
  i.activityGoals = [{ activity_id: ACT, goal_id: GOAL, position: 1 }];
  i.learningReflections = { available: true, bySubject: new Map([[`rec:${REC}`, [{ linkId: "l1", reflectionId: "r1", impact: "applied", templateLabel: "Guided", body: "PRIVATE WORDS", createdAt: "2026-10-10T00:00:00Z" }]]]) };
  if (catalogue) {
    i.planCompetencies = [{ id: "pc1", goal_id: GOAL, activity_id: null, framework_id: "fw", framework_competency_id: COMP, framework_version: "v1.0.0", learning_outcome: null, linked_at: "2026-09-02T00:00:00Z", unlinked_at: null }];
    i.names = new Map([[COMP, "ECG interpretation"]]);
    i.versions = new Map([[COMP, "v1.0.0"]]);
    i.stage5 = { available: true,
      entries: [{ id: ENTRY, kind: "catalogue", framework_competency_id: COMP, framework_version: "v1.0.0", title: "ECG interpretation", removed_at: null, interest: true }],
      assessments: [{ id: "sa1", my_competency_id: ENTRY, learning_outcome: null, framework_version: "v1.0.0", scale_label: "Benner", level_label: "Competent", confidence_label: "Fairly sure", development_interest: false, assessed_at: "2026-10-12T00:00:00Z" }],
      links: [
        { id: "k1", my_competency_id: ENTRY, kind: "cpd", sourceId: CPD, learning_outcome: null, framework_version: "v1.0.0", relation_code: "knowledge", relation_label: "Knowledge", source: "person", linked_at: "2026-10-12T00:00:00Z", unlinked_at: null },
        { id: "k2", my_competency_id: ENTRY, kind: "learning_record", sourceId: REC, learning_outcome: null, framework_version: "v1.0.0", relation_code: "knowledge", relation_label: "Knowledge", source: "person", linked_at: "2026-10-12T00:00:00Z", unlinked_at: null },
      ] };
    if (opts.verified) i.verification = { available: true, decisions: [{ id: "v1", myCompetencyId: ENTRY, frameworkCompetencyId: COMP, title: "ECG interpretation", outcomeLabel: "Verified", current: true, verified: true, state: "verified",
      decidedOn: "2026-10-20", assessor: "A. Verifier", method: "Direct observation", frameworkVersion: "v1.0.0", learningOutcomes: [], href: "/c5/v1" }] };
  }
  return i;
}

const ALL_TEXT = (x: unknown) => JSON.stringify(x).toLowerCase();

describe("E2: six separate dimensions, never a score", () => {
  it("an empty record gives six findings, nothing recorded, Limited confidence, and no score anywhere", () => {
    const ev = evaluate(empty(), { kind: "development", ref: null }, P)!;
    expect(Object.keys(ev.findings).sort()).toEqual(DIMENSIONS.map(([d]) => d).sort());
    expect(ev.findings.development_activity.state).toBe("not_recorded");
    expect(ev.findings.evidence_confidence.confidence).toBe("limited");
    expect(ALL_TEXT(ev)).not.toMatch(/"score"|percent|%"|overall/);
    expect(ev.limitations.join(" ")).toMatch(/Missing evidence is not evidence of a gap/);
  });

  it("missing evidence never reads as incompetence, and areas of development come only from the person's own words", () => {
    const ev = evaluate(empty(), { kind: "development", ref: null }, P)!;
    expect(ALL_TEXT(ev)).not.toMatch(/incompeten|not competent|deficien|fail/);
    expect(ev.development).toEqual([]);
    const e2 = evaluate(ecg(), { kind: "goal", ref: GOAL }, P)!;
    expect(e2.development.map(p => p.text).join(" ")).toMatch(/You named this as a development need: ECG interpretation|Your goal is still open/);
  });

  it("ECG goal: activity, knowledge (formative), application, competency evidence and confidence kept apart, each with its sources", () => {
    const ev = evaluate(ecg(), { kind: "goal", ref: GOAL }, P)!;
    const f = ev.findings;
    expect(f.development_activity.state).toBe("supported");
    expect(f.development_activity.summary).toMatch(/1 CPD entry \(3 hours recorded\), 1 Competen Learning course/);
    expect(f.knowledge.provenance.formative).toBe(1);
    expect(f.application.sourceKeys).toContain("learning_reflection:r1");
    expect(f.competency_evidence.sourceKeys).toContain("self_assessment:sa1");
    expect(f.independent_verification.state).toBe("not_recorded");
    expect(f.independent_verification.summary).toMatch(/Self-assessment, CPD and courses are not verification/);
    expect(f.evidence_confidence.confidence).toBe("moderate");
    // Every source keeps provenance, date and framework version; the self-assessment stays self-reported.
    const sa = ev.sources.find(s => s.key === "self_assessment:sa1")!;
    expect(sa.provenance).toBe("self_reported");
    expect(sa.frameworkVersion).toBe("v1.0.0");
    expect(ev.sources.find(s => s.key === `cpd:${CPD}`)!.provenance).toBe("document_supported");
    expect(ev.frameworkVersions).toContain("v1.0.0");
    // A CPD entry not linked to the goal is not in its scope.
    expect(ev.sources.some(s => s.id === CPD2)).toBe(false);
  });

  it("a reflection's words never enter the evaluation, only its reference", () => {
    const ev = evaluate(ecg(), { kind: "goal", ref: GOAL }, P)!;
    expect(JSON.stringify(ev)).not.toContain("PRIVATE WORDS");
    expect(aiEvaluationQuestion(ev)).not.toContain("PRIVATE WORDS");
  });

  it("only a C5 decision or an organisation assessment is independent verification, and it is read as it is", () => {
    const ev = evaluate(ecg({ verified: true }), { kind: "goal", ref: GOAL }, P)!;
    expect(ev.findings.independent_verification.state).toBe("supported");
    expect(ev.sources.find(s => s.kind === "verification")!.classText).toBe("Independently verified by A. Verifier");
    expect(ev.findings.evidence_confidence.confidence).toBe("stronger");
    const notCurrent = ecg({ verified: true });
    notCurrent.verification.decisions![0] = { ...notCurrent.verification.decisions![0], current: false, verified: false, state: "expired" };
    const e2 = evaluate(notCurrent, { kind: "goal", ref: GOAL }, P)!;
    expect(e2.findings.independent_verification.state).toBe("limited");
    expect(e2.sources.find(s => s.kind === "verification")!.provenance).toBe("independent_other");
  });

  it("self-reported records alone keep confidence Limited whatever the policy", () => {
    const i = empty();
    i.cpd = [{ ...ecg().cpd![1], id: CPD2 }, { ...ecg().cpd![1], id: CPD }];
    const ev = evaluate(i, { kind: "development", ref: null }, P)!;
    expect(ev.findings.evidence_confidence.confidence).toBe("limited");
    expect(ev.strengths).toEqual([]);
  });
});

describe("s12: no catalogue, no AI", () => {
  it("evaluates a goal and a topic with no catalogue and no Stage 5", () => {
    const i = ecg({ catalogue: false });
    i.stage5 = { available: false, entries: [], assessments: [], links: [] };
    i.verification = { available: false, decisions: [] };
    const ev = evaluate(i, { kind: "goal", ref: GOAL }, P)!;
    expect(ev.findings.development_activity.state).toBe("supported");
    expect(ev.findings.competency_evidence.state).toBe("not_available");
    expect(ev.findings.independent_verification.state).toBe("not_available");
    const topic = evaluate(i, { kind: "topic", ref: "ECG" }, P)!;
    expect(topic.sources.map(s => s.kind)).toEqual(expect.arrayContaining(["cpd", "learning_record"]));
    expect(topic.competencies).toEqual([]);
  });

  it("someone else's id, or a removed record, is not evaluated", () => {
    expect(evaluate(ecg(), { kind: "goal", ref: "00000000-0000-4000-8000-000000000999" }, P)).toBeNull();
  });
});

describe("E4: recommendations, deterministic, each with its basis and its owning module", () => {
  it("nothing recorded: record CPD; a goal without activity: plan one (an activity through plan-store)", () => {
    const ev = evaluate(empty(), { kind: "development", ref: null }, P)!;
    expect(ev.recommendations.find(r => r.rule === "record_cpd")!.href).toBe("/cpd");
    const i = ecg(); i.activities = []; i.activityGoals = [];
    const g = evaluate(i, { kind: "goal", ref: GOAL }, P)!;
    const plan = g.recommendations.find(r => r.rule === "plan_activity")!;
    expect(plan.creates).toEqual(expect.objectContaining({ kind: "activity", goalId: GOAL }));
    expect(g.recommendations.every(r => r.basis.startsWith("Offered"))).toBe(true);
  });

  it("verification is suggested only as an option, through C5, never made", () => {
    const ev = evaluate(ecg(), { kind: "goal", ref: GOAL }, P)!;
    const v = ev.recommendations.find(r => r.rule === "request_verification")!;
    expect(v.href).toBe(`/ev?c=${ENTRY}`);
    expect(v.creates).toBeNull();
    expect(v.basis).toMatch(/Only a verifier can verify/);
  });

  it("a rule switched off in the policy is never offered", () => {
    const off = { ...P, rules: P.rules.filter(r => r !== "record_cpd") };
    expect(evaluate(empty(), { kind: "development", ref: null }, off)!.recommendations.some(r => r.rule === "record_cpd")).toBe(false);
    expect(recommendationKey("create_goal", { kind: "topic", ref: "ECG Interpretation" })).toBe("create_goal:topic:ecg-interpretation");
  });
});

describe("E5: history and comparison", () => {
  it("compares two snapshots by state and records, never by a score", () => {
    const a = evaluate(ecg(), { kind: "goal", ref: GOAL }, P)!, b = evaluate(ecg({ verified: true }), { kind: "goal", ref: GOAL }, P)!;
    const row = (id: string, at: string, e: typeof a): StoredEvaluation => ({ id, scope_kind: "goal", scope_ref: GOAL, scope_label: e.scope.label, evaluated_at: at, sources: e.sources, findings: e.findings, recommendations: e.recommendations });
    const cmp = compareEvaluations(row("2", "2026-10-25T00:00:00Z", b), row("1", "2026-10-21T00:00:00Z", a));
    expect(cmp.earlier.id).toBe("1");
    expect(cmp.sameScope).toBe(true);
    expect(cmp.added.map(s => s.kind)).toEqual(["verification"]);
    expect(cmp.dimensions.find(d => d.dimension === "independent_verification")).toEqual(expect.objectContaining({ before: "not_recorded", after: "supported", changed: true }));
    expect(cmp.confidence).toEqual({ before: "moderate", after: "stronger" });
  });
});

describe("E6: governed configuration", () => {
  it("every Stage 6 key is a governed WCE policy with a sane fallback", () => {
    const keys = POLICIES.filter(p => p.key.startsWith("professional_evaluation_")).map(p => p.key);
    expect(keys.length).toBe(12);
    expect(P.scopes).toContain("development");
    expect(P.aiReflections).toBe("off");
    expect(P.sharing).toBe("offer");
  });

  it("'my development as a whole' cannot be switched off, and an out-of-range value is clamped", () => {
    const p = resolvePolicy([
      { config_path: "individual.policy.professional_evaluation_scopes", published: { values: ["goal"] } },
      { config_path: "individual.policy.professional_evaluation_sufficiency", published: { value: 99 } },
    ]).professionalEvaluation;
    expect(p.scopes[0]).toBe("development");
    expect(p.sufficiency).toBeLessThanOrEqual(10);
  });
});

describe("parsers", () => {
  it("scopes, corrections, notes and decisions", () => {
    expect(parseScope({}, P)).toEqual({ ok: true, value: { kind: "development", ref: null, from: null, to: null } });
    expect(parseScope({ scope: "goal", ref: "x" }, P).ok).toBe(false);
    expect(parseScope({ scope: "appraisal" }, P).ok).toBe(false);
    expect(parseScope({ scope: "goal", ref: GOAL }, { scopes: ["development"] }).ok).toBe(false);
    expect(parseCorrection({ supersedesId: GOAL }).ok).toBe(false);
    expect(parseCorrection({ supersedesId: GOAL, correctionNote: "Wrong CPD linked" })).toEqual({ ok: true, value: { id: GOAL, note: "Wrong CPD linked" } });
    expect(parseAnnotation({ evaluationId: GOAL, body: "ok", templateCode: "" }, P.templates).ok).toBe(false);
    expect(parseAnnotation({ evaluationId: GOAL, body: "More confident now", templateCode: "nope" }, P.templates).ok).toBe(false);
    expect(parseDecision({ evaluationId: GOAL, key: "record_cpd:goal:x", decision: "verified" }, TODAY).ok).toBe(false);
    expect(parseDecision({ evaluationId: GOAL, key: "record_cpd:goal:x", decision: "dismissed", deferredUntil: "2027-01-01" }, TODAY).ok).toBe(false);
    expect(parseDecision({ evaluationId: GOAL, key: "record_cpd:goal:x", decision: "deferred", deferredUntil: "2027-01-01" }, TODAY).ok).toBe(true);
  });
});

// ── THE STAGE 6 WRITES: only 530's tables, and the owning services for anything else ──
const S: { inserts: { table: string; row: any }[] } = { inserts: [] };
function fake() {
  const from = (table: string) => {
    const q: any = {};
    let row: any = null;
    for (const op of ["select", "eq", "order", "limit", "in", "is"]) q[op] = () => q;
    q.insert = (r: any) => { row = r; S.inserts.push({ table, row: r }); return q; };
    q.single = async () => ({ data: row ? { id: `${table}-id` } : null, error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    return q;
  };
  return { from };
}

describe("Stage 6 writes", () => {
  it("a snapshot keeps references and findings, never a body, and names its AI model and policy when AI was used", async () => {
    S.inserts = [];
    const ev = evaluate(ecg(), { kind: "goal", ref: GOAL }, P)!;
    const out = await recordEvaluation(fake(), USER, ev, { context: { profession: "Nurse", role: null, specialty: null, setting: null, jurisdiction: null }, policy: P, configVersion: "cv1",
      ai: { text: "Summary", model: "m1", policyVersion: "professional_evaluation_ai:on@cv1" }, supersedes: null });
    expect(out.ok).toBe(true);
    const r = S.inserts[0];
    expect(r.table).toBe("individual_professional_evaluation");
    expect(r.row.interpretation).toBe("deterministic_and_ai");
    expect(r.row.sources.every((s: any) => !("body" in s) && !("text" in s))).toBe(true);
    expect(JSON.stringify(r.row)).not.toContain("PRIVATE WORDS");
    expect(r.row.config_version).toBe("cv1");
  });

  it("accepting a goal recommendation creates the goal through plan-store (created_from evaluation), then records the decision", async () => {
    S.inserts = [];
    const i = ecg(); i.goals = []; i.activityGoals = [];
    const ev = evaluate(i, { kind: "topic", ref: "ECG" }, P)!;
    const rec = ev.recommendations.find(r => r.rule === "create_goal")!;
    const out = await decideRecommendation(fake(), USER, { id: "e1", recommendations: ev.recommendations }, rec.key, { decision: "accepted", editedTitle: "Read ECGs on every shift", deferredUntil: null, note: null });
    expect(out.ok).toBe(true);
    expect(S.inserts.map(x => x.table)).toEqual(["individual_professional_goal", "individual_professional_evaluation_decision"]);
    expect(S.inserts[0].row).toEqual(expect.objectContaining({ title: "Read ECGs on every shift", created_from: "evaluation", user_id: USER }));
    expect(S.inserts[1].row).toEqual(expect.objectContaining({ created_kind: "goal", decision: "accepted", edited_title: "Read ECGs on every shift" }));
  });

  it("a dismissal writes only the decision; an unknown recommendation writes nothing", async () => {
    S.inserts = [];
    const ev = evaluate(empty(), { kind: "development", ref: null }, P)!;
    await decideRecommendation(fake(), USER, { id: "e1", recommendations: ev.recommendations }, ev.recommendations[0].key, { decision: "dismissed", editedTitle: null, deferredUntil: null, note: null });
    expect(S.inserts.map(x => x.table)).toEqual(["individual_professional_evaluation_decision"]);
    S.inserts = [];
    expect((await decideRecommendation(fake(), USER, { id: "e1", recommendations: [] }, "x", { decision: "accepted", editedTitle: null, deferredUntil: null, note: null })).ok).toBe(false);
    expect(S.inserts).toEqual([]);
  });

  it("Stage 6 code writes no table but 530's (the owning services write theirs) and never a C5 table", () => {
    const strip = (f: string) => readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "");
    const src = ["evaluation.ts", "evaluation-store.ts", "evaluation-sources.ts", "evaluation-stage5.ts", "share-evaluation.ts", "evaluation-ai.ts"]
      .map(f => strip(`src/lib/individual/professional/${f}`)).join("\n");
    const written = [...src.matchAll(/from\("([a-z_]+)"\)\.(insert|update|upsert|delete)/g)].map(m => m[1]);
    expect(new Set(written)).toEqual(new Set(["individual_professional_evaluation", "individual_professional_evaluation_annotation", "individual_professional_evaluation_decision", "individual_professional_share_evaluation"]));
    expect(src).not.toMatch(/competency_verification|verification_decision|verification_request/);
  });
});

describe("s13: private unless the person ticks it, and then formative with sources", () => {
  it("only ticked evaluation ids travel, and a shared view hides private sources, notes and AI text", () => {
    expect(parseShareEvaluations({ [`evaluation:${GOAL}`]: "true", "evaluation:nope": "true", [`learning:${REC}`]: "true" })).toEqual([GOAL]);
    expect(parseShareEvaluations({})).toEqual([]);
    const ev = evaluate(ecg(), { kind: "goal", ref: GOAL }, P)!;
    const v = sharedView({ id: "e1", scope_label: ev.scope.label, evaluated_at: "2026-10-25T00:00:00Z", framework_versions: ev.frameworkVersions, interpretation: "deterministic_and_ai",
      findings: ev.findings, sources: ev.sources, ai_text: "AI SAYS" });
    expect(v.privateCount).toBe(1);
    expect(v.sources.some(s => s.kind === "learning_reflection")).toBe(false);
    expect(JSON.stringify(v)).not.toContain("AI SAYS");
    expect(v.notices[0]).toMatch(/not an assessment or verification of clinical competence/);
    expect(v.findings).toHaveLength(6);
  });
});

describe("C5 read: only a current decision of outcome CLASS verified, with a level, is independently verified", () => {
  it("reads the class, never the configurable code, and a decision without its class is never verified", async () => {
    const { registerVerificationStudio } = await import("./competency-verification");
    const { loadVerification } = await import("./evaluation-stage5");
    const base = { outcomeLabel: "x", assessorName: "A", authority: "C5", criteriaVersion: "v1", decidedAt: "2026-10-20T09:00:00Z", validUntil: null, revokedAt: null, supersededBy: null };
    let requested = 0;
    registerVerificationStudio({
      listVerifications: async () => ({ provisioned: true, items: [{ requestId: "r1", status: "decided", method: "Observation", requestedAt: TODAY, evidence: [],
        competency: { frameworkId: "fw", frameworkCompetencyId: COMP, frameworkVersion: "v1", title: "ECG", learningOutcomes: [] },
        decisions: [
          { ...base, outcomeCode: "verified_at_level", outcomeClass: "verified", level: "Proficient" },
          { ...base, outcomeCode: "verified", outcomeClass: "partial", level: "Proficient", decidedAt: "2026-10-21T09:00:00Z" },
          { ...base, outcomeCode: "verified", level: "Proficient", decidedAt: "2026-10-22T09:00:00Z" },
          { ...base, outcomeCode: "verified_at_level", outcomeClass: "verified", level: "Proficient", revokedAt: "2026-10-23T00:00:00Z", decidedAt: "2026-10-23T09:00:00Z" },
        ] as any }] }),
      requestVerification: async () => { requested++; return { ok: false, status: 409, error: "no" }; },
    });
    const v = await loadVerification({} as any, USER, TODAY, "/c");
    expect(v.decisions!.map(d => d.verified)).toEqual([true, false, false, false]);
    expect(requested).toBe(0);
  });
});
