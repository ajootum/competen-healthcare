/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ASSESSOR_EVIDENCE_KINDS, EMPTY_CONTENT, EVIDENCE_KINDS, METHOD_KINDS, OUTCOME_CLASSES, STARTER_OUTCOMES, checkDecision, checkMethodContent, deriveState, standingOf, type MethodContent,
} from "./verification-config";
import { ASSESSOR_AUTHORITY, SCOPE_KINDS, addRequestEvidence, listVerifications, recordDecision, refusalOf, requestVerification, verificationMethodsFor, verificationsForCompetency, withdrawRequest } from "./verification";

// COMPETEN-PROFESSIONAL-COMPETENCY-01 C5 (migration 510): the Holdings Competency Verification Studio.
const SQL = readFileSync("supabase/migrations/510-competency-verification-studio.sql", "utf8").replace(/\r\n/g, "\n");
const listInOf = (sql: string) => (constraint: string, column: string) => {
  const at = sql.indexOf(`add constraint ${constraint}`);
  const m = new RegExp(`${column} in \\(([^)]*)\\)`).exec(sql.slice(at, sql.indexOf(");", at) + 2));
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]) : [];
};
const listIn = listInOf(SQL);
// 680 redefines the method and evidence kind CHECKs: its definition is the latest, the one the code must name.
const listIn680 = listInOf(readFileSync("supabase/migrations/680-cfca-verification-components.sql", "utf8").replace(/\r\n/g, "\n"));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PERSON = U(1), ASSESSOR = U(2), OTHER = U(3), REQ = U(10), VER = U(20), APPT = U(30), EV1 = U(40), LVL = U(50), SCALE = U(60);

const content: MethodContent = {
  ...EMPTY_CONTENT, summary: "Observed ECG interpretation at the bedside.", scaleId: SCALE, levelIds: [LVL],
  outcomes: [{ code: "verified", class: "verified", label: "Verified at the level stated" }, { code: "more", class: "further_evidence", label: "Further evidence required" },
    { code: "partial", class: "partial", label: "Partially demonstrated" }],
  criteria: [{ id: "c1", text: "Identifies the rhythm", required: true }, { id: "c2", text: "Optional", required: false }],
  checklist: [{ id: "k1", text: "Leads placed correctly", critical: true }], minEvidence: 1,
};

describe("510 and the code name the same fixed vocabularies", () => {
  it("outcome classes, method kinds, scope kinds and evidence kinds", () => {
    expect(listIn("competency_verification_decision_check", "outcome_class")).toEqual([...OUTCOME_CLASSES]);
    expect(listIn680("competency_verification_method_check", "kind")).toEqual([...METHOD_KINDS]);
    expect(listIn680("competency_verification_method_check", "kind").slice(0, 7)).toEqual(listIn("competency_verification_method_check", "kind"));
    expect(listIn("competency_assessor_scope_check", "scope_kind")).toEqual([...SCOPE_KINDS]);
    expect(listIn("competency_verification_evidence_check", "kind")).toEqual([...EVIDENCE_KINDS]);
    expect(listIn680("competency_verification_evidence_check", "kind")).toEqual([...EVIDENCE_KINDS, ...ASSESSOR_EVIDENCE_KINDS]);
  });
});

describe("C5-A/B: methods and criteria are configuration, never hard-coded", () => {
  it("nothing clinical ships: no criteria, no checklist, no scale, no method; the starter outcomes are only the five plain classes", () => {
    expect(EMPTY_CONTENT.criteria).toEqual([]); expect(EMPTY_CONTENT.checklist).toEqual([]); expect(EMPTY_CONTENT.scaleId).toBeNull();
    expect(STARTER_OUTCOMES.map(o => o.class)).toEqual([...OUTCOME_CLASSES]);
    const src = readFileSync("src/lib/competency/verification-config.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\b(nurs(e|ing)|uganda|benner|osce)\b/i);
  });

  it("publication needs outcomes, a scale for a verified outcome, criteria or a checklist, and a description", () => {
    expect(checkMethodContent({ ...EMPTY_CONTENT }, true)).toMatchObject({ ok: false });
    expect(checkMethodContent({ ...content, scaleId: null }, true)).toMatchObject({ ok: false, error: expect.stringMatching(/scale/) });
    expect(checkMethodContent(content, true)).toMatchObject({ ok: true, problems: [] });
    expect(checkMethodContent({ ...EMPTY_CONTENT })).toMatchObject({ ok: true, problems: expect.arrayContaining(["Name at least one outcome."]) });
  });

  it("an outcome says what the assessment found, never that the person is or is not competent", () => {
    for (const label of ["Competent", "Not competent", "Incompetent", "Unsafe to practise", "Fit to practise"])
      expect(checkMethodContent({ ...content, outcomes: [{ code: "nd", class: "not_demonstrated", label }] })).toMatchObject({ ok: false, error: expect.stringMatching(/not that a person is or is not competent/) });
    expect(checkMethodContent({ ...content, outcomes: [{ code: "nd", class: "not_demonstrated", label: "Not demonstrated in this simulation" }] })).toMatchObject({ ok: true });
  });

  it("the form cannot smuggle in an outcome class, a duplicate code or a malformed id", () => {
    expect(checkMethodContent({ ...content, outcomes: [{ code: "nd", class: "competent", label: "Something" }] })).toMatchObject({ ok: false, error: expect.stringMatching(/kind of outcome/) });
    expect(checkMethodContent({ ...content, outcomes: [content.outcomes[0], content.outcomes[0]] })).toMatchObject({ ok: false });
    expect(checkMethodContent({ ...content, criteria: [{ id: "Bad Id", text: "x y z" }] })).toMatchObject({ ok: false });
    const c = checkMethodContent({ ...content, applicability: { frameworkIds: ["not-a-uuid", U(7)], contexts: ["independent", "Bad Ctx"] } });
    expect(c.ok && c.content.applicability).toMatchObject({ frameworkIds: [U(7)], contexts: ["independent"] });
  });
});

describe("C5-E/F: a decision is checked against the pinned criteria before 510 checks it again", () => {
  const ok = { outcomeCode: "verified", levelId: LVL, rationale: "Observed three ECGs read correctly", criteria: [{ id: "c1", result: "met" }], checklist: [{ id: "k1", result: "done" }], evidenceReviewed: [EV1] };
  it("a complete verified decision passes", () => expect(checkDecision(ok, content, [EV1])).toMatchObject({ ok: true, outcome: { class: "verified" } }));
  it("verified states its level, and only verified does", () => {
    expect(checkDecision({ ...ok, levelId: null }, content, [EV1])).toMatchObject({ ok: false });
    expect(checkDecision({ ...ok, outcomeCode: "partial" }, content, [EV1])).toMatchObject({ ok: false });
    expect(checkDecision({ ...ok, levelId: U(99) }, content, [EV1])).toMatchObject({ ok: false });
  });
  it("every required criterion and critical item is answered, and a not-met criterion cannot be verified", () => {
    expect(checkDecision({ ...ok, criteria: [] }, content, [EV1])).toMatchObject({ ok: false, error: expect.stringMatching(/Identifies the rhythm/) });
    expect(checkDecision({ ...ok, checklist: [] }, content, [EV1])).toMatchObject({ ok: false, error: expect.stringMatching(/Leads placed/) });
    expect(checkDecision({ ...ok, criteria: [{ id: "c1", result: "not_met" }] }, content, [EV1])).toMatchObject({ ok: false });
  });
  it("only evidence of this request counts, and the method's minimum applies", () => {
    expect(checkDecision({ ...ok, evidenceReviewed: [U(77)] }, content, [EV1])).toMatchObject({ ok: false });
    expect(checkDecision({ ...ok, outcomeCode: "more", levelId: null, evidenceReviewed: [] }, content, [])).toMatchObject({ ok: true });
  });
  it("a method that decides on what was submitted cannot ask for more", () => {
    expect(checkDecision({ ...ok, outcomeCode: "more", levelId: null }, { ...content, workflow: { assignment: "administrator", allowFurtherEvidence: false, secondAssessor: false } }, [EV1])).toMatchObject({ ok: false });
  });
});

describe("C6: state and standing are derived, never stored", () => {
  const t = (n: number) => `2026-10-25T10:00:0${n}Z`;
  it("open, assigned, awaiting evidence, back with the assessor, decided, withdrawn -- as 510's function", () => {
    expect(deriveState([], [], [])).toBe("open");
    expect(deriveState([{ event: "assigned", created_at: t(1) }], [], [])).toBe("assigned");
    expect(deriveState([{ event: "assigned", created_at: t(1) }, { event: "assignment_declined", created_at: t(2) }], [], [])).toBe("open");
    expect(deriveState([{ event: "assigned", created_at: t(1) }], [{ outcome_class: "further_evidence", created_at: t(2) }], [{ created_at: t(1) }])).toBe("awaiting_evidence");
    expect(deriveState([{ event: "assigned", created_at: t(1) }], [{ outcome_class: "further_evidence", created_at: t(2) }], [{ created_at: t(3) }])).toBe("assigned");
    expect(deriveState([{ event: "assigned", created_at: t(1) }], [{ outcome_class: "verified", created_at: t(2) }], [])).toBe("decided");
    expect(deriveState([{ event: "withdrawn", created_at: t(1) }], [], [])).toBe("withdrawn");
  });
  it("a verification is current, then expired, revoked or superseded -- the decision itself never changes", () => {
    const d = { id: "d1", outcome_class: "verified", valid_until: "2027-01-01", created_at: t(1) };
    expect(standingOf(d, new Set(), [], "2026-10-25")).toBe("current");
    expect(standingOf(d, new Set(), [], "2027-01-02")).toBe("expired");
    expect(standingOf(d, new Set(["d1"]), [], "2026-10-25")).toBe("revoked");
    expect(standingOf(d, new Set(), [{ outcome_class: "verified", created_at: t(5) }], "2026-10-25")).toBe("superseded");
    expect(standingOf({ ...d, outcome_class: "not_demonstrated" }, new Set(), [], "2026-10-25")).toBe("not_a_verification");
  });
});

// ── THE STORE, with a recording client ──────────────────────────────────────────────────────────────────────────
const S: { calls: { table: string; op: string; args: any[] }[]; rows: Record<string, any[]>; rpc: { fn: string; args: any }[]; rpcError: any; absent: boolean } = { calls: [], rows: {}, rpc: [], rpcError: null, absent: false };
function fake() {
  const from = (table: string) => {
    const f: [string, any][] = []; let write: any = null;
    const q: any = {};
    const rec = (op: string, args: any[]) => S.calls.push({ table, op, args });
    for (const op of ["select", "order", "limit", "in", "is"]) q[op] = (...a: any[]) => { rec(op, a); return q; };
    q.eq = (...a: any[]) => { rec("eq", a); f.push([a[0], a[1]]); return q; };
    q.insert = (row: any) => { rec("insert", [row]); write = { insert: row }; return q; };
    q.update = (row: any) => { rec("update", [row]); write = { update: row }; return q; };
    const data = () => (S.rows[table] ?? []).filter(r => f.every(([k, v]) => !(k in r) || r[k] === v));
    q.maybeSingle = async () => ({ data: data()[0] ?? null, error: null });
    q.single = async () => ({ data: write?.insert ? { id: U(900) } : data()[0] ?? null, error: null });
    const gone = { data: null, error: { message: `relation "${table}" does not exist` } };
    q.then = (ok: any, ko: any) => Promise.resolve(S.absent && table.startsWith("competency_") ? gone : write ? { data: null, error: null } : { data: data(), error: null }).then(ok, ko);
    return q;
  };
  return { from, rpc: async (fn: string, args: any) => { S.rpc.push({ fn, args }); return S.rpcError ? { data: null, error: S.rpcError } : { data: U(500), error: null }; } };
}
const writes = () => S.calls.filter(c => c.op === "insert" || c.op === "update");

beforeEach(() => {
  S.calls = []; S.rpc = []; S.rpcError = null; S.absent = false;
  S.rows = {
    framework_competencies: [{ id: U(5), learning_outcomes: ["Assess the airway", "Escalate deterioration"], framework_domains: { frameworks: { version_major: 2, version_minor: 0, version_revision: 0 } } }],
    competency_verification_request: [{ id: REQ, user_id: PERSON, method_version_id: VER, competency_snapshot: { learning_outcomes: ["Assess the airway", "Escalate deterioration"] } }],
    competency_verification_event: [{ request_id: REQ, event: "assigned", assessor_id: ASSESSOR, appointment_id: APPT }],
    competency_verification_method_version: [{ id: VER, content }],
    competency_verification_evidence: [{ id: EV1, request_id: REQ }],
  };
});

describe("the person's side: one atomic submission, for the signed-in person only", () => {
  it("submits through 510's function with the caller's id, and only well-formed references to records", async () => {
    const r = await requestVerification(fake(), PERSON, { competencyId: U(5), methodVersionId: VER, outcomeIndexes: [0, 1, "x"], evidence: [{ kind: "cpd", id: U(6), outcomeIndexes: [0] }] });
    expect(r).toMatchObject({ ok: true, requestId: U(500) });
    expect(S.rpc[0]).toMatchObject({ fn: "competency_verification_submit", args: { p_user: PERSON, p_outcomes: [0, 1], p_context: "independent", p_evidence: [{ kind: "cpd", id: U(6), outcomeIndexes: [0] }] } });
    expect(writes()).toEqual([]);
  });
  it("an unknown kind, a malformed id or more than 50 items is refused before the database", async () => {
    expect(await requestVerification(fake(), PERSON, { competencyId: U(5), methodVersionId: VER, evidence: [{ kind: "self_assessment", id: U(6) }] })).toMatchObject({ ok: false, status: 400 });
    expect(await requestVerification(fake(), PERSON, { competencyId: U(5), methodVersionId: VER, evidence: Array.from({ length: 51 }, (_, i) => ({ kind: "cpd", id: U(100 + i) })) })).toMatchObject({ ok: false });
    expect(S.rpc).toEqual([]);
  });
  it("the portfolio's own references work: outcome WORDS resolve to the competency's outcomes, descriptive fields are ignored, the link id travels", async () => {
    const r = await requestVerification(fake(), PERSON, {
      competency: { frameworkCompetencyId: U(5), frameworkVersion: "2.0.0", title: "anything" }, methodVersionId: VER, learningOutcomes: ["Escalate deterioration"],
      evidence: [{ kind: "learning_record", sourceId: U(6), linkId: U(7), learningOutcome: "Assess the airway", title: "FORGED TITLE", evidenceClass: "independently_verified" } as any],
    });
    expect(r).toMatchObject({ ok: true });
    expect(S.rpc[0].args).toMatchObject({ p_competency: U(5), p_outcomes: [1], p_evidence: [{ kind: "learning_record", id: U(6), linkId: U(7), outcomeIndexes: [0] }] });
    expect(JSON.stringify(S.rpc[0].args)).not.toMatch(/FORGED|independently_verified/);
  });
  it("an outcome the competency does not have now, or a framework version that has moved on, is refused before the database", async () => {
    expect(await requestVerification(fake(), PERSON, { competencyId: U(5), methodVersionId: VER, learningOutcomes: ["Not an outcome"] })).toMatchObject({ ok: false, status: 409 });
    expect(await requestVerification(fake(), PERSON, { competencyId: U(5), methodVersionId: VER, evidence: [{ kind: "cpd", id: U(6), learningOutcome: "Old wording" }] })).toMatchObject({ ok: false, status: 400 });
    expect(await requestVerification(fake(), PERSON, { competency: { frameworkCompetencyId: U(5), frameworkVersion: "1.0.0" }, methodVersionId: VER })).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/framework version 2\.0\.0/) });
    expect(S.rpc).toEqual([]);
  });
  it("a version shown as v2.0.0 is the same version", async () => {
    expect(await requestVerification(fake(), PERSON, { competency: { frameworkCompetencyId: U(5), frameworkVersion: "v2.0.0" }, methodVersionId: VER })).toMatchObject({ ok: true });
  });
  it("a method named by its code resolves to its published version", async () => {
    S.rows.competency_verification_method_version = [{ id: VER, content, state: "published" }];
    await requestVerification(fake(), PERSON, { competencyId: U(5), methodCode: "ecg_obs" });
    expect(S.rpc[0].args.p_method_version).toBe(VER);
  });
  it("further evidence resolves its outcome words against the request's own snapshot", async () => {
    expect(await addRequestEvidence(fake(), PERSON, REQ, [{ kind: "cpd", sourceId: U(8), learningOutcome: "Escalate deterioration" }])).toMatchObject({ ok: true });
    expect(S.rpc[0]).toMatchObject({ fn: "competency_verification_add_evidence", args: { p_user: PERSON, p_request: REQ, p_evidence: [{ kind: "cpd", id: U(8), outcomeIndexes: [1] }] } });
    expect(await addRequestEvidence(fake(), OTHER, REQ, [{ kind: "cpd", id: U(8) }])).toMatchObject({ ok: false, status: 404 });
  });
  it("without 510: requests refuse NOT_PROVISIONED and the reader says provisioned false, so a product can gate", async () => {
    S.absent = true;
    expect(await requestVerification(fake(), PERSON, { competencyId: U(5), methodVersionId: VER })).toMatchObject({ ok: false, code: "NOT_PROVISIONED" });
    expect(await addRequestEvidence(fake(), PERSON, REQ, [{ kind: "cpd", id: U(8) }])).toMatchObject({ ok: false, code: "NOT_PROVISIONED" });
    expect(await listVerifications(fake(), PERSON)).toEqual({ provisioned: false });
    expect(await verificationMethodsFor(fake(), U(5))).toEqual({ provisioned: false });
    expect(await withdrawRequest(fake(), PERSON, REQ)).toMatchObject({ ok: false, code: "NOT_PROVISIONED" });
    expect(S.rpc).toEqual([]);
  });
  it("a refusal from 510 reaches the person in words", async () => {
    S.rpcError = { message: "competency_verification_request: only a competency of a published, shared framework can be verified" };
    expect(await requestVerification(fake(), PERSON, { competencyId: U(5), methodVersionId: VER })).toMatchObject({ ok: false, status: 409, error: "Only a competency of a published, shared framework can be verified." });
  });
  it("withdrawal is the person's own event", async () => {
    await withdrawRequest(fake(), PERSON, REQ);
    expect(writes()[0]).toMatchObject({ table: "competency_verification_event", args: [{ event: "withdrawn", actor_id: PERSON, user_id: PERSON }] });
  });
});

describe("the assessor's decision", () => {
  const body = { outcomeCode: "verified", levelId: LVL, rationale: "Observed three ECGs read correctly", criteria: [{ id: "c1", result: "met" }], checklist: [{ id: "k1", result: "done" }], evidenceReviewed: [EV1] };
  it("never on your own request", async () => {
    S.rows.competency_verification_event = [{ request_id: REQ, event: "assigned", assessor_id: PERSON, appointment_id: APPT }];
    expect(await recordDecision(fake(), PERSON, REQ, body)).toMatchObject({ ok: false, status: 403 });
    expect(writes()).toEqual([]);
  });
  it("only by the assigned assessor", async () => {
    expect(await recordDecision(fake(), OTHER, REQ, body)).toMatchObject({ ok: false, status: 403 });
    expect(writes()).toEqual([]);
  });
  it("writes one decision: the assessor and appointment from the session and assignment, the version from the request -- never from the body", async () => {
    expect(await recordDecision(fake(), ASSESSOR, REQ, { ...body, assessorId: OTHER, appointmentId: U(31), methodVersionId: U(21), outcomeClass: "verified" })).toMatchObject({ ok: true });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ table: "competency_verification_decision", args: [{ assessor_id: ASSESSOR, appointment_id: APPT, method_version_id: VER, user_id: PERSON, outcome_code: "verified", level_id: LVL }] });
    expect(writes()[0].args[0]).not.toHaveProperty("outcome_class");
    expect(writes()[0].args[0]).not.toHaveProperty("method_content_hash");
  });
});

describe("refusals in words, with the status they deserve", () => {
  it("authority and independence are 403, order is 409, absence is 409 'not set up'", () => {
    expect(refusalOf({ message: "competency_verification_decision: no self-verification. A person can never decide their own request" }, "decision")).toMatchObject({ status: 403 });
    expect(refusalOf({ message: "competency_verification_decision: the request is decided and cannot be decided now" }, "decision")).toMatchObject({ status: 409 });
    expect(refusalOf({ message: 'relation "competency_verification_request" does not exist' }, "request")).toMatchObject({ status: 409, error: expect.stringMatching(/not set up/) });
  });
});

describe("two doors, two authorities", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "");
  it("the assessor route reaches no Studio writer, and the Studio route records no decision", () => {
    const assess = strip("src/app/api/hq/competency-assessment/route.ts"), studio = strip("src/app/api/hq/competency-verification/route.ts");
    expect(assess).toMatch(/hqApiGate\(\["hq\.competency\.verification\.assess"\]\)/);
    expect(studio).toMatch(/hqApiGate\(\["hq\.competency\.verification\.manage"\]\)/);
    expect(assess).not.toMatch(/createMethod|saveDraft|publishVersion|grantScope|endScope|revokeDecision/);
    expect(studio).not.toMatch(/recordDecision/);
  });
  it("the Holdings module reads no Professional table and writes no portfolio table", () => {
    const src = strip("src/lib/competency/verification.ts");
    expect(src).not.toMatch(/from\("individual_professional_/);
    expect(src).not.toMatch(/from\("(individual_professional_portfolio|individual_professional_self_assessment)/);
  });
});

describe("the framework version is the governed major.minor.revision", () => {
  it("no code or SQL reads a frameworks.version column, which does not exist", () => {
    const sql = SQL.replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/\bf\.version\b(?!_)/);
    expect(readFileSync("src/lib/competency/verification.ts", "utf8")).not.toMatch(/frameworks!inner\(version\)/);
    expect(sql).toMatch(/concat\(coalesce\(f\.version_major, 1\), '\.', coalesce\(f\.version_minor, 0\), '\.', coalesce\(f\.version_revision, 0\)\)/);
  });
});

describe("the read contract: listVerifications", () => {
  it("one item per request, with the outcome words asked about, the method, the assessor authority, and what stands today", async () => {
    S.rows = {
      competency_verification_method_version: [{ id: VER, method_id: U(70), version_no: 3, content, content_hash: "abc12345", competency_verification_method: { code: "ecg_obs", name: "ECG observed", kind: "direct_observation" } }],
      competency_verification_request: [{ id: REQ, user_id: PERSON, competency_id: U(5), method_version_id: VER, outcome_indexes: [1], target_level_id: LVL, context: "independent", note: null,
        competency_snapshot: { name: "ECG interpretation", code: "CF-ECG-1", learning_outcomes: ["Identify rhythm", "Escalate"] }, framework_version: "2.0", framework_id: U(80), created_at: "2026-10-25T09:00:00Z" }],
      competency_verification_evidence: [{ id: EV1, request_id: REQ, kind: "cpd", outcome_indexes: [0], provenance: { title: "ECG workshop", evidence_class: "source_linked", date: "2026-10-01" }, cpd_id: U(6), portfolio_link_id: U(7), created_at: "2026-10-25T09:00:01Z" }],
      competency_verification_event: [{ id: U(90), request_id: REQ, event: "assigned", assessor_id: ASSESSOR, appointment_id: APPT, decision_id: null, reason: null, created_at: "2026-10-25T09:00:02Z" }],
      competency_verification_decision: [{ id: U(91), request_id: REQ, user_id: PERSON, assessor_id: ASSESSOR, appointment_id: APPT, method_version_id: VER, method_content_hash: "abc12345", competency_hash: "h1",
        outcome_code: "verified", outcome_class: "verified", outcome_label: "Verified at the level stated", level_id: LVL, criteria_results: [], checklist_results: [], evidence_reviewed: [EV1],
        rationale: "Observed", valid_from: "2026-10-25", valid_until: "2028-10-24", created_at: "2026-10-25T09:00:03Z" }],
      scoring_levels: [{ id: LVL, score: 4, label: "Proficient" }],
      profiles: [{ id: ASSESSOR, full_name: "Synthetic Assessor" }],
    };
    const out = await listVerifications(fake(), PERSON, { today: "2026-10-26" });
    expect(out).toMatchObject({ provisioned: true });
    const item = (out as any).items[0];
    expect(item).toMatchObject({
      requestId: REQ, status: "decided", competency: { frameworkCompetencyId: U(5), frameworkVersion: "2.0", title: "ECG interpretation", learningOutcomes: ["Escalate"] },
      method: { code: "ecg_obs", versionNo: 3, criteriaHash: "abc12345" },
      evidence: [{ evidenceId: EV1, linkId: U(7), kind: "cpd", title: "ECG workshop", evidenceClass: "source_linked", learningOutcomes: ["Identify rhythm"] }],
    });
    expect(item.current).toMatchObject({ outcomeLabel: "Verified at the level stated", level: { score: 4 }, assessorName: "Synthetic Assessor", authority: ASSESSOR_AUTHORITY,
      criteriaVersion: { versionNo: 3, hash: "abc12345" }, standing: "current", validUntil: "2028-10-24", revokedAt: null });
    expect(verificationsForCompetency((out as any).items, U(5))).toHaveLength(1);
    expect(verificationsForCompetency((out as any).items, U(6))).toHaveLength(0);
  });
});
