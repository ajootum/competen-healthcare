/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorsOf } from "./clinical-review";
import { classifyMove, createCriterion, moveCriterion, placeCriterion, retireCriterion, restoreCriterion, updateCriterion } from "./criteria-authoring";

// FRAMEWORK-DESIGN-STUDIO-02 S1: criteria created, edited, retired and moved on screen, in DRAFT frameworks only,
// each after its authorship row (395), substantive moves classified as such (D3).

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

const ME = { userId: "00000000-0000-4000-8000-0000000000c1", name: "Author" };
const FW = "00000000-0000-4000-8000-0000000000f1", DOM = "00000000-0000-4000-8000-0000000000d1";
const C1 = "00000000-0000-4000-8000-0000000000e1", C2 = "00000000-0000-4000-8000-0000000000e2";
const K1 = "00000000-0000-4000-8000-0000000000a1", K2 = "00000000-0000-4000-8000-0000000000a2", K3 = "00000000-0000-4000-8000-0000000000a3", K4 = "00000000-0000-4000-8000-0000000000a4";

// marker: the 761 probe (competency_content_hash_covers_retirement). "absent" = before 761 (PostgREST PGRST202).
const S: { calls: { table: string; op: string; args: any[] }[]; rows: Record<string, any[]>; marker: "present" | "absent" | "error" } = { calls: [], rows: {}, marker: "present" };
function fake() {
  const from = (table: string) => {
    const f: [string, any][] = [];
    const q: any = {};
    let write: { op: string; row: any } | null = null;
    const rec = (op: string, args: any[]) => S.calls.push({ table, op, args });
    for (const op of ["select", "order", "limit", "in", "is"]) q[op] = (...a: any[]) => { rec(op, a); return q; };
    q.eq = (...a: any[]) => { rec("eq", a); f.push([a[0], a[1]]); return q; };
    q.insert = (row: any) => { rec("insert", [row]); write = { op: "insert", row }; return q; };
    q.update = (row: any) => { rec("update", [row]); write = { op: "update", row }; return q; };
    const hit = () => (S.rows[table] ?? []).filter(r => f.every(([k, v]) => !(k in r) || r[k] === v));
    const done = () => {
      if (write?.op === "insert") (S.rows[table] ??= []).push(...[].concat(write.row));
      if (write?.op === "update") for (const r of hit()) Object.assign(r, write.row);
      return { data: write ? null : hit(), error: null };
    };
    q.maybeSingle = async () => ({ data: hit()[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => Promise.resolve(done()).then(ok, ko);
    return q;
  };
  const rpc = async (fn: string) => {
    S.calls.push({ table: `rpc:${fn}`, op: "rpc", args: [] });
    if (fn !== "competency_content_hash_covers_retirement") return { data: null, error: { code: "PGRST202" } };
    return S.marker === "present" ? { data: true, error: null }
      : S.marker === "absent" ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
      : { data: null, error: { code: "08006", message: "connection failure" } };
  };
  return { from, rpc };
}
const writes = () => S.calls.filter(c => ["insert", "update"].includes(c.op));
const skill = (id: string) => S.rows.competency_skills.find(k => k.id === id);
const audits = () => S.rows.audit_log.map(a => [a.action, a.entity_id]);

beforeEach(() => {
  S.calls = [];
  S.marker = "present";
  S.rows = {
    frameworks: [{ id: FW, name: "Example", pub_status: "draft", hospital_id: null }],
    framework_domains: [{ id: DOM, framework_id: FW, name: "Communication" }],
    framework_competencies: [{ id: C1, domain_id: DOM, name: "Communicates", code: "EX-001" }, { id: C2, domain_id: DOM, name: "Records", code: "EX-002" }],
    competency_skills: [
      { id: K1, competency_id: C1, name: "Explains purpose", sort_order: 1, component_code: "clinical_skills", source_ref: null, is_active: true },
      { id: K2, competency_id: C1, name: "Knows the policy", sort_order: 2, component_code: "knowledge", source_ref: null, is_active: true },
      { id: K3, competency_id: C1, name: "Checks understanding", sort_order: 3, component_code: "clinical_skills", source_ref: null, is_active: true },
      { id: K4, competency_id: C2, name: "Writes legibly", sort_order: 1, component_code: "clinical_skills", source_ref: null, is_active: true },
    ],
    competency_assessment_component: [{ code: "clinical_skills", is_active: true }, { code: "knowledge", is_active: true }, { code: "old_section", is_active: false }],
    clinical_content_version: [],
    audit_log: [],
  };
});

describe("pure placement and classification", () => {
  it("places within the section, other sections keeping their slots", () => {
    const list = [{ id: "a", component: "s" }, { id: "b", component: "k" }, { id: "c", component: "s" }];
    expect(placeCriterion(list, { id: "n", component: "s" }, 1)).toEqual(["n", "a", "b", "c"]);
    expect(placeCriterion(list, { id: "n", component: "s" }, null)).toEqual(["a", "b", "c", "n"]);
    expect(placeCriterion(list, { id: "n", component: "k" }, null)).toEqual(["a", "b", "n", "c"]);
    expect(placeCriterion(list, { id: "n", component: "x" }, 1)).toEqual(["a", "b", "c", "n"]);
    expect(placeCriterion(list, { id: "c", component: "s" }, 1)).toEqual(["c", "a", "b"]);
  });
  it("a section or competency change is substantive; the same section is a reorder", () => {
    expect(classifyMove({ competencyId: "1", component: "s" }, { competencyId: "1", component: "s" })).toBe("reorder");
    expect(classifyMove({ competencyId: "1", component: "s" }, { competencyId: "1", component: "k" })).toBe("section");
    expect(classifyMove({ competencyId: "1", component: "s" }, { competencyId: "2", component: "s" })).toBe("competency");
  });
  it("criteria actions count as authorship for clinical review (unlike reorder_layout)", () => {
    expect(authorsOf("x", [{ actor_id: "a", action: "cfca_criterion_moved" }, { actor_id: "b", action: "reorder_layout" }])).toEqual(["x", "a"]);
  });
});

describe("criteria actions in a draft", () => {
  it("create: the authorship row first, then the row, and the competency renumbered densely", async () => {
    const r = await createCriterion(fake(), ME, { competencyId: C1, component: "clinical_skills", text: "  Introduces themself  ", position: 1 });
    expect(r).toMatchObject({ ok: true });
    expect(writes()[0]).toMatchObject({ table: "audit_log" });
    expect(audits()).toEqual([["cfca_criterion_created", C1]]);
    const id = (r as any).id;
    expect(skill(id)).toMatchObject({ name: "Introduces themself", component_code: "clinical_skills", sort_order: 1, is_active: true });
    expect([K1, K2, K3].map(k => skill(k).sort_order)).toEqual([2, 3, 4]);
  });
  it("an unknown or retired component, or a too-short text, is refused before any write", async () => {
    expect(await createCriterion(fake(), ME, { competencyId: C1, component: "old_section", text: "Valid text" })).toMatchObject({ ok: false, status: 422 });
    expect(await createCriterion(fake(), ME, { competencyId: C1, component: "nope", text: "Valid text" })).toMatchObject({ ok: false, status: 422 });
    expect(await createCriterion(fake(), ME, { competencyId: C1, component: "knowledge", text: "ab" })).toMatchObject({ ok: false, status: 422 });
    expect(writes()).toEqual([]);
  });
  it("a published (or any non-draft) framework is refused: changes go through a revision draft", async () => {
    for (const status of ["published", "in_review", "approved", "archived"]) {
      S.rows.frameworks[0].pub_status = status;
      const r = await updateCriterion(fake(), ME, { criterionId: K1, text: "New words here" });
      expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/revision draft/) });
    }
    expect(writes()).toEqual([]);
  });
  it("update: text is substantive, source only is not; unchanged writes nothing", async () => {
    expect(await updateCriterion(fake(), ME, { criterionId: K1, text: "Explains purpose" })).toMatchObject({ ok: true, unchanged: true });
    expect(writes()).toEqual([]);
    await updateCriterion(fake(), ME, { criterionId: K1, sourceRef: "Sheet!B4" });
    await updateCriterion(fake(), ME, { criterionId: K1, text: "Explains the purpose" });
    expect(S.rows.audit_log.map(a => a.new_value.substantive)).toEqual([false, true]);
    expect(skill(K1)).toMatchObject({ name: "Explains the purpose", source_ref: "Sheet!B4" });
  });
  it("retire keeps the row (is_active false), restore brings it back; never a delete", async () => {
    expect(await retireCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: true, unchanged: false });
    expect(skill(K2)).toMatchObject({ is_active: false, name: "Knows the policy" });
    expect(S.calls.some(c => c.op === "delete")).toBe(false);
    expect(await updateCriterion(fake(), ME, { criterionId: K2, text: "Edited text" })).toMatchObject({ ok: false, status: 409 });
    expect(await restoreCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: true });
    expect(skill(K2).is_active).toBe(true);
    expect(audits().map(a => a[0])).toEqual(["cfca_criterion_retired", "cfca_criterion_restored"]);
  });
  it("a competency never put forward needs no 761 probe", async () => {
    S.marker = "absent";
    expect(await retireCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: true, unchanged: false });
    expect(S.calls.some(c => c.op === "rpc")).toBe(false);
  });
  it("with 761 a reviewed competency's criterion may be retired and restored: substantive, sent back to clinical review", async () => {
    S.rows.clinical_content_version.push({ id: "v1", competency_id: C1 });
    expect(await retireCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: true, unchanged: false });
    expect(skill(K2).is_active).toBe(false);
    expect(await restoreCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: true, unchanged: false });
    expect(skill(K2).is_active).toBe(true);
    expect(S.rows.audit_log.map(a => [a.action, a.new_value.substantive, a.new_value.clinical_review]))
      .toEqual([["cfca_criterion_retired", true, true], ["cfca_criterion_restored", true, true]]);
    // Authorship first: the audit row precedes the write.
    const i = S.calls.findIndex(c => c.table === "audit_log" && c.op === "insert"), j = S.calls.findIndex(c => c.table === "competency_skills" && c.op === "update");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(j);
  });
  it("without 761 retire and restore stay refused once the competency was put forward (fail closed, 409)", async () => {
    S.marker = "absent";
    S.rows.clinical_content_version.push({ id: "v1", competency_id: C1 });
    expect(await retireCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/fingerprint does not yet cover retiring/) });
    expect(skill(K2).is_active).toBe(true);
    skill(K3).is_active = false;
    expect(await restoreCriterion(fake(), ME, { criterionId: K3 })).toMatchObject({ ok: false, status: 409 });
    expect(skill(K3).is_active).toBe(false);
    expect(writes()).toEqual([]);
  });
  it("an unreadable 761 probe changes nothing (503)", async () => {
    S.marker = "error";
    S.rows.clinical_content_version.push({ id: "v1", competency_id: C1 });
    expect(await retireCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: false, status: 503 });
    expect(skill(K2).is_active).toBe(true);
    expect(writes()).toEqual([]);
  });
  it("a published framework is refused before the probe (draft frameworks only)", async () => {
    S.rows.frameworks[0].pub_status = "published";
    S.rows.clinical_content_version.push({ id: "v1", competency_id: C1 });
    expect(await retireCriterion(fake(), ME, { criterionId: K2 })).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/revision draft/) });
    expect(S.calls.some(c => c.op === "rpc")).toBe(false);
  });
  it("move to another section: substantive, recorded, the component changes", async () => {
    const r = await moveCriterion(fake(), ME, { criterionId: K3, component: "knowledge", position: 1 });
    expect(r).toMatchObject({ ok: true, kind: "section", substantive: true });
    expect(S.rows.audit_log[0]).toMatchObject({ action: "cfca_criterion_moved", entity_id: C1, new_value: { substantive: true, kind: "section" } });
    expect(skill(K3)).toMatchObject({ component_code: "knowledge", competency_id: C1 });
    expect([K1, K3, K2].map(k => skill(k).sort_order)).toEqual([1, 2, 3]);
  });
  it("move to another competency: authorship on both, both renumbered", async () => {
    const r = await moveCriterion(fake(), ME, { criterionId: K1, competencyId: C2, position: 1 });
    expect(r).toMatchObject({ ok: true, kind: "competency", substantive: true });
    expect(audits()).toEqual([["cfca_criterion_moved", C1], ["cfca_criterion_moved", C2]]);
    expect(skill(K1)).toMatchObject({ competency_id: C2, sort_order: 1 });
    expect(skill(K4).sort_order).toBe(2);
    expect([K2, K3].map(k => skill(k).sort_order)).toEqual([1, 2]);
  });
});
