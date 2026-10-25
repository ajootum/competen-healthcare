/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LCPD } from "../lcpd-config";
import { composeReflection, IMPACT_LABEL, NOT_VERIFIED_IMPACT, parseLearningReflection, saveLearningReflection } from "./learning-reflections";
import { eligibleLearning, loadSharedLearning, parseShareLearning } from "./share-learning";

// COMPETEN-PROFESSIONAL-LCPD-01 slice 2 (migration 491): reflections on learning with the impact the person reports
// (never verified), and selective Passport sharing of completed learning (never reflections, never automatic).

const USER = "00000000-0000-4000-8000-0000000000aa", OTHER = "00000000-0000-4000-8000-0000000000bb";
const CPD = "00000000-0000-4000-8000-0000000000c1", REC = "00000000-0000-4000-8000-0000000000e1", REC2 = "00000000-0000-4000-8000-0000000000e2";
const guided = DEFAULT_LCPD.reflectionTemplates.find(t => t.code === "guided")!;

const S: { calls: { table: string; op: string; args: any[] }[]; rows: Record<string, any[]>; learningOn: boolean } = { calls: [], rows: {}, learningOn: true };
function fake() {
  const from = (table: string) => {
    const f: [string, any][] = []; let write: any = null; const ins: any[] = [];
    const q: any = {};
    const rec = (op: string, args: any[]) => S.calls.push({ table, op, args });
    for (const op of ["select", "order", "limit", "in", "or"]) q[op] = (...a: any[]) => { rec(op, a); return q; };
    q.eq = (...a: any[]) => { rec("eq", a); f.push([a[0], a[1]]); return q; };
    q.insert = (row: any) => { rec("insert", [row]); ins.push(row); write = "insert"; return q; };
    q.update = (row: any) => { rec("update", [row]); write = row; return q; };
    const data = () => {
      if (table === "practice_platform_flags") return S.learningOn ? [{ enabled: true }] : [];
      return (S.rows[table] ?? []).filter(r => f.every(([k, v]) => !(k in r) || r[k] === v));
    };
    const done = () => {
      if (write === "insert") { const row = { id: `${table}-${(S.rows[table] ?? []).length + 1}`, ...ins[0] }; (S.rows[table] ??= []).push(row); return { data: row, error: null }; }
      return { data: data(), error: null };
    };
    q.maybeSingle = async () => ({ data: data()[0] ?? null, error: null });
    q.single = async () => done();
    q.then = (ok: any, ko: any) => Promise.resolve(write === "insert" ? { data: null, error: null } : { data: data(), error: null }).then(ok, ko);
    return q;
  };
  return { from };
}
const writes = () => S.calls.filter(c => c.op === "insert" || c.op === "update");

const RECORD = (id: string, cls = "platform_recorded", status = "completed") => ({
  id, user_id: USER, offering_id: "o1", version_id: "v1", delivery: "hosted", status, completed_at: "2026-03-10T09:00:00Z", completion_kind: "course_completion", evidence_class: cls,
  external_completed_on: null, external_hours: null, enrolled_at: "2026-03-01T09:00:00Z", access_kind: "free", document_path: null, course_entitlement_id: null,
  learning_offering: { code: "LRN-ECG-01", title: "ECG Interpretation" }, learning_offering_version: { version_no: 1, content: { cpd: { hours: 1.5 } }, delivery_provider_id: null },
});

beforeEach(() => {
  S.calls = []; S.learningOn = true;
  S.rows = {
    individual_professional_cpd: [{ id: CPD, user_id: USER }],
    learning_record: [RECORD(REC), RECORD(REC2, "self_declared")],
    learning_certificate: [{ record_id: REC, user_id: USER, certificate_no: "LC-AAAA", outcome: "course_completion", verification_code: "SECRETCODE".repeat(3), revoked_at: null }],
  };
});

describe("LCPD-3: reflecting on learning, with the impact the person reports", () => {
  it("a template's prompts and the person's answers make the reflection; unanswered prompts are left out", () => {
    expect(composeReflection(guided, ["The 12-lead layout", "", "I read rhythm strips first"])).toBe(`${guided.prompts[0]}\nThe 12-lead layout\n\n${guided.prompts[2]}\nI read rhythm strips first`);
  });

  it("impact is completed, understood or applied -- 'verified' is not something a person can report", () => {
    for (const impact of ["completed", "understood", "applied"]) expect(parseLearningReflection({ cpdId: CPD, template: "guided", answers: ["Learned a lot"], impact }, DEFAULT_LCPD.reflectionTemplates)).toMatchObject({ ok: true });
    expect(parseLearningReflection({ cpdId: CPD, template: "guided", answers: ["x yz"], impact: "verified" }, DEFAULT_LCPD.reflectionTemplates)).toMatchObject({ ok: false });
    expect(Object.keys(IMPACT_LABEL)).toEqual(["completed", "understood", "applied"]);
    expect(NOT_VERIFIED_IMPACT).toMatch(/Not independently verified/);
  });

  it("the reflection goes through Stage 2's writer (470), then the link, and the course record is never written", async () => {
    const p = parseLearningReflection({ learningRecordId: REC, template: "quick", answers: ["Lead placement"], impact: "applied" }, DEFAULT_LCPD.reflectionTemplates);
    if (!p.ok) throw new Error(p.error);
    expect(await saveLearningReflection(fake(), USER, p.value)).toMatchObject({ ok: true });
    expect(writes().map(w => w.table)).toEqual(["individual_professional_reflection", "individual_professional_learning_reflection"]);
    expect(writes()[1].args[0]).toMatchObject({ user_id: USER, learning_record_id: REC, cpd_id: null, impact: "applied" });
    expect(writes().some(w => w.table === "learning_record")).toBe(false);
  });

  it("another person's CPD entry or learning record is refused, and nothing is written", async () => {
    S.rows.individual_professional_cpd = [{ id: CPD, user_id: OTHER }];
    const p = parseLearningReflection({ cpdId: CPD, template: "quick", answers: ["Something learned"], impact: "completed" }, DEFAULT_LCPD.reflectionTemplates);
    if (!p.ok) throw new Error(p.error);
    expect(await saveLearningReflection(fake(), USER, p.value)).toMatchObject({ ok: false, status: 404 });
    S.rows.learning_record = [];
    const q = parseLearningReflection({ learningRecordId: REC, template: "quick", answers: ["Something learned"], impact: "completed" }, DEFAULT_LCPD.reflectionTemplates);
    if (!q.ok) throw new Error(q.error);
    expect(await saveLearningReflection(fake(), USER, q.value)).toMatchObject({ ok: false, status: 404 });
    expect(writes()).toEqual([]);
  });
});

describe("LCPD-6: selective Passport sharing of completed learning", () => {
  it("nothing is shared unless ticked, and only learning:<id> fields count", () => {
    expect(parseShareLearning({})).toEqual([]);
    expect(parseShareLearning({ [`learning:${REC}`]: "true", [`item:${REC2}`]: "true", "learning:not-an-id": "true" })).toEqual([REC]);
  });

  it("eligibility follows configuration: by default a self-declared course is not shareable", () => {
    const refs: any[] = [{ recordId: REC, evidenceClass: "platform_recorded" }, { recordId: REC2, evidenceClass: "self_declared" }];
    expect(eligibleLearning(refs, DEFAULT_LCPD).map(r => r.recordId)).toEqual([REC]);
    expect(eligibleLearning(refs, { passportShareable: ["platform_recorded", "self_declared"] }).map(r => r.recordId)).toEqual([REC, REC2]);
  });

  it("/verify re-checks: only chosen, still-eligible learning, labelled exactly, certificate numbers but never verification codes", async () => {
    S.rows.individual_professional_share_learning = [{ share_token_id: "t1", user_id: USER, learning_record_id: REC }, { share_token_id: "t1", user_id: USER, learning_record_id: REC2 }];
    const items = await loadSharedLearning(fake(), "t1", USER, DEFAULT_LCPD);
    expect(items?.map(i => [i.recordId, i.provenance])).toEqual([[REC, "Course completion, issued by Competen Holdings"]]);
    expect(items?.[0].certificateNos).toEqual(["LC-AAAA"]);
    expect(JSON.stringify(items)).not.toMatch(/SECRETCODE|reflection|verified/i);
  });

  it("Learning switched off: an old link shows no learning", async () => {
    S.learningOn = false;
    S.rows.individual_professional_share_learning = [{ share_token_id: "t1", user_id: USER, learning_record_id: REC }];
    expect(await loadSharedLearning(fake(), "t1", USER, DEFAULT_LCPD)).toEqual([]);
  });

  it("reflections have no path to a Passport link", () => {
    const src = ["src/lib/individual/professional/share-learning.ts", "src/lib/individual/professional/share.ts"].map(f => readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "")).join("\n");
    expect(src).not.toMatch(/individual_professional_reflection|individual_professional_learning_reflection/);
  });
});
