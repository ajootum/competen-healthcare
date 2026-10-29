/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_CONTENT, checkAssessorRecord, checkDecision, checkMethodContent, consolidatedOutcome, methodRequirements, type MethodContent, type ScaleLevel,
} from "./verification-config";
import { componentOutcome, type ComponentRequirement } from "./studio-components";
import { listVerifications, mayPublish, publishVersion, recordAssessorEvidence, recordDecision, saveDraft } from "./verification";
import { passportVerifications } from "@/lib/individual/passport";

// CFCA verification P2 (migration 680): CCHU components in method content, independent publication of a method version,
// assessor evidence, and the consolidated component outcome of a decision.
const SQL510 = readFileSync("supabase/migrations/510-competency-verification-studio.sql", "utf8").replace(/\r\n/g, "\n");
const SQL680 = readFileSync("supabase/migrations/680-cfca-verification-components.sql", "utf8").replace(/\r\n/g, "\n");
const ROLLBACK = readFileSync("docs/evidence/CFCA-VERIFY-P2/ROLLBACK-680.sql", "utf8").replace(/\r\n/g, "\n");
const body = (sql: string, fn: string) => {
  const at = sql.indexOf(`create or replace function public.${fn}(`);
  return at < 0 ? "" : sql.slice(at, sql.indexOf("\n$$;", at) + 4);
};

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PERSON = U(1), ASSESSOR = U(2), OTHER = U(3), REQ = U(10), VER = U(20), APPT = U(30), EV1 = U(40), SCALE = U(60);
const L = (n: number) => U(100 + n);
const LEVELS: ScaleLevel[] = [0, 1, 2, 3, 4, 5, 6].map(n => ({ id: L(n), scaleId: SCALE, score: n, label: `Level ${n}` }));

const content: MethodContent = {
  ...EMPTY_CONTENT, summary: "Observed clinical skills, examined knowledge.", scaleId: SCALE,
  outcomes: [{ code: "verified", class: "verified", label: "Verified at the level stated" }, { code: "nd", class: "not_demonstrated", label: "Not demonstrated in this assessment" }],
  criteria: [{ id: "c1", text: "Performs the procedure", required: true, component: "clinical_skills" }],
  checklist: [{ id: "k1", text: "Hand hygiene", critical: true, component: "clinical_skills" }],
  components: [
    { code: "clinical_skills", passLevelId: L(4), mandatory: true, safetyCritical: true, weight: 1 },
    { code: "knowledge", passLevelId: L(3), mandatory: true, safetyCritical: false, weight: 3 },
  ],
};

describe("680 keeps every 510 rule of the four functions it replaces, and the rollback restores them verbatim", () => {
  const fns = ["competency_method_content_problem", "competency_verification_method_version_guard", "competency_verification_evidence_guard", "competency_verification_decision_guard"];
  it.each(fns)("%s: every 510 refusal is still raised by 680", fn => {
    const old = body(SQL510, fn), now = body(SQL680, fn);
    expect(old.length).toBeGreaterThan(200); expect(now.length).toBeGreaterThan(old.length);
    const said = [...old.matchAll(/(?:raise exception|return) '([^']+)'/g)].map(m => m[1]);
    expect(said.length).toBeGreaterThan(0);
    for (const s of said) expect(now).toContain(`'${s}'`);
  });
  it.each(fns)("%s: the rollback carries the 510 body exactly", fn => expect(ROLLBACK).toContain(body(SQL510, fn)));
  it("the rollback refuses when 680 data exists, and drops only what 680 added", () => {
    expect(ROLLBACK).toMatch(/ROLLBACK-680 refused/);
    for (const x of ["competency_method_components", "competency_component_outcome", "competency_assessor_record_problem"]) expect(ROLLBACK).toMatch(new RegExp(`drop function if exists public\\.${x}\\(`));
    expect(ROLLBACK).not.toMatch(/drop table/i);
  });
});

describe("components in method content", () => {
  it("a well-formed method with components passes publication", () => {
    expect(checkMethodContent(content, true)).toMatchObject({ ok: true, problems: [] });
  });
  it("a criterion names a component that is configured, never an unconfigured one", () => {
    expect(checkMethodContent({ ...content, components: [content.components[1]] })).toMatchObject({ ok: false, error: expect.stringMatching(/c1: its component/) });
  });
  it("each component once, a weight above 0 to two decimals, and a safety-critical component always mandatory", () => {
    expect(checkMethodContent({ ...content, components: [content.components[0], content.components[0]] })).toMatchObject({ ok: false });
    for (const weight of [0, -1, 101, 1.005, "x"]) expect(checkMethodContent({ ...content, components: [{ ...content.components[0], weight }] as any })).toMatchObject({ ok: false });
    const c = checkMethodContent({ ...content, components: [{ ...content.components[0], mandatory: false, safetyCritical: true }, content.components[1]] });
    expect(c.ok && c.content.components[0]).toMatchObject({ mandatory: true, safetyCritical: true });
  });
  it("nothing is defaulted clinically: absent settings stay explicit (mandatory unless said otherwise, no pass level, weight 1)", () => {
    const c = checkMethodContent({ ...content, components: [{ code: "clinical_skills" }, { code: "knowledge" }] });
    expect(c.ok && c.content.components).toEqual([
      { code: "clinical_skills", passLevelId: null, mandatory: true, safetyCritical: false, weight: null },
      { code: "knowledge", passLevelId: null, mandatory: true, safetyCritical: false, weight: null }]);
  });
  it("content from before 680 (no components key) still reads, and decides as under 510", () => {
    const old = checkMethodContent({ ...content, components: undefined, criteria: [{ id: "c1", text: "Performs the procedure" }], checklist: [] }, true);
    expect(old.ok && old.content.components).toEqual([]);
  });
  it("the SQL names the same rules", () => {
    const p = body(SQL680, "competency_method_content_problem");
    expect(p).toMatch(/a safety-critical component is always mandatory/);
    expect(p).toMatch(/\* 100 = trunc\(/);
    expect(p).toMatch(/competency_assessment_component a where a\.code = v_k ->> 'code' and a\.is_active/);
  });
});

describe("the consolidated outcome is componentOutcome, and the database mirrors it", () => {
  const rnd = (() => { let x = 7; return (k: number) => { x = (x * 1103515245 + 12345) % 2147483648; return x % k; }; })();
  it("consolidatedOutcome equals componentOutcome over the method's requirements, the stated levels and the target", () => {
    for (let i = 0; i < 2000; i++) {
      const comps = ["clinical_skills", "knowledge", "knowledge_application"].slice(0, 1 + rnd(3)).map(code => {
        const sc = rnd(4) === 0;
        return { code, passLevelId: rnd(3) === 0 ? null : L(rnd(7)), mandatory: sc || rnd(4) !== 0, safetyCritical: sc, weight: rnd(3) === 0 ? null : [1, 2, 0.5, 33.33, 100][rnd(5)] };
      });
      const results = comps.filter(() => rnd(5) !== 0).map(k => ({ code: k.code, levelId: rnd(5) === 0 ? null : L(rnd(7)) }));
      const target = rnd(3) === 0 ? null : L(rnd(7));
      const reqs: ComponentRequirement[] = comps.map(k => ({ code: k.code, passLevel: k.passLevelId ? { id: k.passLevelId, score: Number(k.passLevelId.slice(-1)), label: "" } : null,
        mandatory: k.mandatory, safetyCritical: k.safetyCritical, weight: k.weight }));
      const expected = componentOutcome(reqs, results.map(r => ({ code: r.code, score: r.levelId ? Number(r.levelId.slice(-1)) : null })), target ? Number(target.slice(-1)) : null);
      expect(consolidatedOutcome({ components: comps }, results, LEVELS, target)).toEqual(expected);
    }
  });
  it("weights to two decimals sum exactly: 5 and 1 at 33.33 each is 3, not 2.999", () => {
    const reqs: ComponentRequirement[] = [{ code: "a", passLevel: null, mandatory: false, safetyCritical: false, weight: 33.33 }, { code: "b", passLevel: null, mandatory: false, safetyCritical: false, weight: 33.33 }];
    expect(componentOutcome(reqs, [{ code: "a", score: 5 }, { code: "b", score: 1 }], null).overall).toBe(3);
  });
  it("no components: no consolidated outcome", () => expect(consolidatedOutcome({ components: [] }, [], LEVELS, null)).toBeNull());
  it("methodRequirements reads pass levels as scores, and safety-critical as mandatory", () => {
    expect(methodRequirements({ components: [{ code: "x_y", passLevelId: L(4), mandatory: false, safetyCritical: true, weight: null }] }, LEVELS))
      .toEqual([{ code: "x_y", passLevel: { id: L(4), score: 4, label: "Level 4" }, mandatory: true, safetyCritical: true, weight: null }]);
  });
  it("the SQL rule has the same steps as componentOutcome (structural: the runtime parity is the staging harness)", () => {
    const f = body(SQL680, "competency_component_outcome");
    expect(f).toMatch(/v_pass := coalesce\(\(v_r ->> 'pass'\)::integer, p_target\)/);
    expect(f).toMatch(/v_w := coalesce\(\(v_r ->> 'weight'\)::numeric, 1\)/);
    expect(f).toMatch(/floor\(v_sum \/ v_weights\)/);
    expect(f).toMatch(/when cardinality\(v_failed\) > 0 then 'not_achieved'\s+when cardinality\(v_missing\) > 0 then 'incomplete'\s+when v_overall is null then 'incomplete'\s+when p_target is not null and v_overall < p_target then 'not_achieved'/);
    const g = body(SQL680, "competency_verification_decision_guard");
    expect(g).toMatch(/v_target := \(select l\.score from scoring_levels l where l\.id = coalesce\(new\.level_id, v_req\.target_level_id\)\)/);
    expect(g).toMatch(/new\.outcome_class = 'verified' and new\.component_outcome ->> 'status' <> 'achieved'/);
  });
});

describe("a decision with components", () => {
  const ok = { outcomeCode: "verified", levelId: L(4), rationale: "Observed and examined in full", criteria: [{ id: "c1", result: "met" }], checklist: [{ id: "k1", result: "done" }], evidenceReviewed: [] };
  const scale = { levels: LEVELS, requestTargetLevelId: null };
  it("verified when every component reaches its pass level and the weighted level reaches the level verified", () => {
    const r = checkDecision({ ...ok, componentResults: [{ code: "clinical_skills", levelId: L(4) }, { code: "knowledge", levelId: L(5) }] }, content, [], scale);
    expect(r).toMatchObject({ ok: true, components: { status: "achieved", overall: 4 }, value: { componentResults: [{ code: "clinical_skills", levelId: L(4) }, { code: "knowledge", levelId: L(5) }] } });
  });
  it("a weighted level never overrides a failed safety-critical component", () => {
    const r = checkDecision({ ...ok, componentResults: [{ code: "clinical_skills", levelId: L(3) }, { code: "knowledge", levelId: L(6) }] }, content, [], scale);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/safety-critical/) });
  });
  it("a missing mandatory component is incomplete, never a pass", () => {
    expect(checkDecision({ ...ok, componentResults: [{ code: "knowledge", levelId: L(6) }] }, content, [], scale)).toMatchObject({ ok: false });
  });
  it("the same results may still be recorded as not demonstrated, with the outcome stated", () => {
    const r = checkDecision({ ...ok, outcomeCode: "nd", levelId: null, componentResults: [{ code: "clinical_skills", levelId: L(3) }, { code: "knowledge", levelId: L(6) }] }, content, [], scale);
    expect(r).toMatchObject({ ok: true, components: { status: "not_achieved", failedSafetyCritical: ["clinical_skills"] } });
  });
  it("only the method's components, once each, at a level of its scale", () => {
    expect(checkDecision({ ...ok, componentResults: [{ code: "knowledge_application", levelId: L(4) }] }, content, [], scale)).toMatchObject({ ok: false });
    expect(checkDecision({ ...ok, componentResults: [{ code: "knowledge", levelId: L(4) }, { code: "knowledge", levelId: L(4) }] }, content, [], scale)).toMatchObject({ ok: false });
    expect(checkDecision({ ...ok, componentResults: [{ code: "knowledge", levelId: U(999) }] }, content, [], scale)).toMatchObject({ ok: false });
    expect(checkDecision({ ...ok, componentResults: [{ code: "knowledge", levelId: L(4) }] }, { ...content, components: [], criteria: [{ id: "c1", text: "Performs", required: true }], checklist: [] }, [], scale))
      .toMatchObject({ ok: false, error: expect.stringMatching(/no components/) });
  });
});

describe("assessor evidence", () => {
  const today = "2026-10-29";
  it("an observation and an exam result, checked as the database checks them", () => {
    expect(checkAssessorRecord({ kind: "assessor_observation", summary: "Observed the full procedure", observedOn: "2026-10-20", component: "clinical_skills" }, content, today))
      .toMatchObject({ ok: true, value: { kind: "assessor_observation", record: { component: "clinical_skills" } } });
    expect(checkAssessorRecord({ kind: "exam_result", title: "Knowledge exam", score: "41", maxScore: "50", passMark: "35", takenOn: "2026-10-21" }, content, today))
      .toMatchObject({ ok: true, value: { record: { score: 41, maxScore: 50, passMark: 35 } } });
  });
  it("refuses a future day, an impossible date, a score above the maximum, an unknown component or a kind of the person", () => {
    expect(checkAssessorRecord({ kind: "assessor_observation", summary: "Observed the full procedure", observedOn: "2026-11-20" }, content, today)).toMatchObject({ ok: false });
    expect(checkAssessorRecord({ kind: "assessor_observation", summary: "Observed the full procedure", observedOn: "2026-02-30" }, content, today)).toMatchObject({ ok: false });
    expect(checkAssessorRecord({ kind: "exam_result", title: "Knowledge exam", score: 60, maxScore: 50, takenOn: "2026-10-21" }, content, today)).toMatchObject({ ok: false });
    expect(checkAssessorRecord({ kind: "assessor_observation", summary: "Observed the full procedure", observedOn: "2026-10-20", component: "nope" }, content, today)).toMatchObject({ ok: false });
    expect(checkAssessorRecord({ kind: "cpd" }, content, today)).toMatchObject({ ok: false });
  });
});

// ── THE STORE, with a recording client ──────────────────────────────────────────────────────────────────────────
const S: { calls: { table: string; op: string; args: any[] }[]; rows: Record<string, any[]> } = { calls: [], rows: {} };
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
    q.then = (ok: any, ko: any) => Promise.resolve(write ? { data: null, error: null } : { data: data(), error: null }).then(ok, ko);
    return q;
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}
const writes = () => S.calls.filter(c => c.op === "insert" || c.op === "update");

beforeEach(() => {
  S.calls = [];
  S.rows = {
    competency_verification_request: [{ id: REQ, user_id: PERSON, method_version_id: VER, target_level_id: null }],
    competency_verification_event: [{ request_id: REQ, event: "assigned", assessor_id: ASSESSOR, appointment_id: APPT }],
    competency_verification_method_version: [{ id: VER, content, state: "draft", authored_by: OTHER, edited_by: [OTHER] }],
    competency_verification_evidence: [{ id: EV1, request_id: REQ }],
    scoring_levels: LEVELS.map(l => ({ id: l.id, scale_id: l.scaleId, score: l.score, label: l.label })),
  };
});

describe("independent publication of a method version", () => {
  it("the author or an editor never publishes, another administrator does", async () => {
    expect(mayPublish({ authored_by: OTHER, edited_by: [] }, OTHER)).toBe(false);
    expect(mayPublish({ authored_by: OTHER, edited_by: [ASSESSOR] }, ASSESSOR)).toBe(false);
    expect(mayPublish({ authored_by: OTHER, edited_by: [OTHER] }, PERSON)).toBe(true);
    expect(await publishVersion(fake(), OTHER, VER)).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/Not independent/) });
    expect(writes()).toEqual([]);
    expect(await publishVersion(fake(), PERSON, VER)).toMatchObject({ ok: true });
    expect(writes()[0]).toMatchObject({ args: [{ state: "published", published_by: PERSON }] });
    expect(writes()[0].args[0]).not.toHaveProperty("content");
  });
  it("a draft edit names its editor", async () => {
    expect(await saveDraft(fake(), ASSESSOR, VER, content)).toMatchObject({ ok: true });
    expect(writes()[0]).toMatchObject({ table: "competency_verification_method_version", args: [{ last_edited_by: ASSESSOR }] });
  });
  it("the guard refuses the author and every editor, and a content change at publication", () => {
    const g = body(SQL680, "competency_verification_method_version_guard");
    expect(g).toMatch(/new\.published_by = old\.authored_by or new\.published_by = any\(old\.edited_by\)/);
    expect(g).toMatch(/if new\.content is distinct from old\.content then\s+raise exception 'competency_verification_method_version: publishing never changes the criteria/);
    expect(g).toMatch(/new\.edited_by := old\.edited_by \|\| new\.last_edited_by/);
  });
});

describe("the assessor's decision and evidence through the store", () => {
  it("sends the component levels only, never a consolidated outcome: the database computes and stores it", async () => {
    const r = await recordDecision(fake(), ASSESSOR, REQ, { outcomeCode: "verified", levelId: L(4), rationale: "Observed and examined in full", criteria: [{ id: "c1", result: "met" }],
      checklist: [{ id: "k1", result: "done" }], evidenceReviewed: [], componentResults: [{ code: "clinical_skills", levelId: L(5) }, { code: "knowledge", levelId: L(4) }], componentOutcome: { status: "achieved" } });
    expect(r).toMatchObject({ ok: true });
    expect(writes()[0].args[0]).toMatchObject({ component_results: [{ code: "clinical_skills", levelId: L(5) }, { code: "knowledge", levelId: L(4) }] });
    expect(writes()[0].args[0]).not.toHaveProperty("component_outcome");
  });
  it("refuses a verified outcome below a safety-critical pass level before the database does", async () => {
    expect(await recordDecision(fake(), ASSESSOR, REQ, { outcomeCode: "verified", levelId: L(4), rationale: "Observed and examined in full", criteria: [{ id: "c1", result: "met" }],
      checklist: [{ id: "k1", result: "done" }], evidenceReviewed: [], componentResults: [{ code: "clinical_skills", levelId: L(2) }, { code: "knowledge", levelId: L(6) }] })).toMatchObject({ ok: false, status: 400 });
    expect(writes()).toEqual([]);
  });
  it("assessor evidence by the assigned assessor only, never on their own request, recorded under the request's method version", async () => {
    const obs = { kind: "assessor_observation", summary: "Observed the full procedure", observedOn: "2026-10-20" };
    expect(await recordAssessorEvidence(fake(), OTHER, REQ, obs, "2026-10-29")).toMatchObject({ ok: false, status: 403 });
    S.rows.competency_verification_event = [{ request_id: REQ, event: "assigned", assessor_id: PERSON, appointment_id: APPT }];
    expect(await recordAssessorEvidence(fake(), PERSON, REQ, obs, "2026-10-29")).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/self-verification/) });
    expect(writes()).toEqual([]);
    S.rows.competency_verification_event = [{ request_id: REQ, event: "assigned", assessor_id: ASSESSOR, appointment_id: APPT }];
    expect(await recordAssessorEvidence(fake(), ASSESSOR, REQ, { ...obs, methodVersionId: U(21) }, "2026-10-29")).toMatchObject({ ok: true });
    expect(writes()[0]).toMatchObject({ table: "competency_verification_evidence", args: [{ kind: "assessor_observation", recorded_by: ASSESSOR, appointment_id: APPT, method_version_id: VER, user_id: PERSON }] });
    expect(writes()[0].args[0]).not.toHaveProperty("provenance");
  });
});

describe("the Passport reads Holdings verifications by reference", () => {
  const setRows = (extra: Record<string, any[]> = {}) => {
    S.rows = {
      competency_verification_method_version: [{ id: VER, method_id: U(70), version_no: 2, content, content_hash: "abc12345", competency_verification_method: { code: "cchu_obs", name: "CCHU observed", kind: "direct_observation" } }],
      competency_verification_request: [{ id: REQ, user_id: PERSON, competency_id: U(5), method_version_id: VER, outcome_indexes: [-1], target_level_id: null, context: "independent", note: null,
        competency_snapshot: { name: "Safe medication", code: "NUR-7", learning_outcomes: [] }, framework_version: "1.2.0", framework_id: U(80), created_at: "2026-10-25T09:00:00Z" }],
      competency_verification_evidence: [],
      competency_verification_event: [{ id: U(90), request_id: REQ, event: "assigned", assessor_id: ASSESSOR, appointment_id: APPT, decision_id: null, reason: null, created_at: "2026-10-25T09:00:02Z" }],
      competency_verification_decision: [{ id: U(91), request_id: REQ, user_id: PERSON, assessor_id: ASSESSOR, appointment_id: APPT, method_version_id: VER, method_content_hash: "abc12345", competency_hash: "h1",
        outcome_code: "verified", outcome_class: "verified", outcome_label: "Verified at the level stated", level_id: L(4), criteria_results: [], checklist_results: [], evidence_reviewed: [],
        rationale: "Observed", valid_from: "2026-10-25", valid_until: "2028-10-24", created_at: "2026-10-25T09:00:03Z",
        component_results: [{ code: "clinical_skills", levelId: L(4), score: 4, label: "Level 4" }, { code: "knowledge", levelId: L(5), score: 5, label: "Level 5" }],
        component_outcome: { status: "achieved", overall: 4, target: 4, failedMandatory: [], failedSafetyCritical: [], missingMandatory: [] } }],
      scoring_levels: [{ id: L(4), score: 4, label: "Level 4" }],
      profiles: [],
      ...extra,
    };
  };
  it("one item per competency: method name and version, framework version, standing and the consolidated component outcome", async () => {
    setRows();
    const out = await listVerifications(fake(), PERSON, { today: "2026-10-29" });
    const items = passportVerifications((out as any).items);
    expect(items).toEqual([expect.objectContaining({
      competencyId: U(5), title: "Safe medication", code: "NUR-7", frameworkVersion: "1.2.0",
      method: { name: "CCHU observed", code: "cchu_obs", versionNo: 2, criteriaHash: "abc12345" },
      outcomeLabel: "Verified at the level stated", level: { score: 4, label: "Level 4" }, standing: "current", current: true, validUntil: "2028-10-24",
      components: { status: "achieved", overall: 4, results: [{ code: "clinical_skills", score: 4, label: "Level 4" }, { code: "knowledge", score: 5, label: "Level 5" }] },
    })]);
  });
  it("expired and revoked verifications stay, labelled by their standing; an outcome that did not verify is not a Passport item", async () => {
    setRows();
    const expired = passportVerifications(((await listVerifications(fake(), PERSON, { today: "2029-01-01" })) as any).items);
    expect(expired[0]).toMatchObject({ standing: "expired", current: false });
    setRows({ competency_verification_event: [
      { id: U(90), request_id: REQ, event: "assigned", assessor_id: ASSESSOR, appointment_id: APPT, decision_id: null, reason: null, created_at: "2026-10-25T09:00:02Z" },
      { id: U(92), request_id: REQ, event: "revoked", actor_id: OTHER, decision_id: U(91), reason: "Evidence withdrawn", created_at: "2026-10-26T09:00:00Z" }] });
    expect(passportVerifications(((await listVerifications(fake(), PERSON, { today: "2026-10-29" })) as any).items)[0]).toMatchObject({ standing: "revoked", current: false });
    setRows();
    S.rows.competency_verification_decision = [{ ...S.rows.competency_verification_decision[0], outcome_code: "nd", outcome_class: "not_demonstrated", level_id: null }];
    expect(passportVerifications(((await listVerifications(fake(), PERSON, { today: "2026-10-29" })) as any).items)).toEqual([]);
  });
  it("a decision made before 680 (no component columns) reads with no component outcome", async () => {
    setRows();
    const { component_results: _r, component_outcome: _o, ...old } = S.rows.competency_verification_decision[0];
    void _r; void _o;
    S.rows.competency_verification_decision = [old];
    expect(passportVerifications(((await listVerifications(fake(), PERSON, { today: "2026-10-29" })) as any).items)[0].components).toBeNull();
  });
  it("loadIndividualPassport adds the section and leaves competency_decisions items as they were", () => {
    const src = readFileSync("src/lib/individual/passport.ts", "utf8");
    expect(src).toMatch(/listVerifications\(admin, userId, \{ today \}\)/);
    expect(src).toMatch(/competencies: decRows === null \? null : latestDecisions\(decRows, today, issuerName\)/);
  });
});
