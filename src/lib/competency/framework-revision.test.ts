/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diffFramework, normalise } from "./framework-diff";
import { goesToRevision, overlayRevision, routeToRevision, type RevComp, type RevCrit } from "./framework-revision";
import { pinningMethods } from "./criteria-authoring";
import { updateCompetency } from "./authoring";

// FRAMEWORK-DESIGN-STUDIO-02 S5 (D2, migration 770): content changes to a PUBLISHED governed framework go into its revision
// draft, never the live rows, each after its authorship row on the stable competency id. Without 770: refused, nothing written.

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

const ME = { userId: "00000000-0000-4000-8000-0000000000c1", name: "Author" };
const FW = "00000000-0000-4000-8000-0000000000f1", DOM = "00000000-0000-4000-8000-0000000000d1", REV = "00000000-0000-4000-8000-0000000000b1";
const C1 = "00000000-0000-4000-8000-0000000000e1", K1 = "00000000-0000-4000-8000-0000000000a1", K2 = "00000000-0000-4000-8000-0000000000a2";

const S: { calls: { table: string; op: string; args: any[] }[]; rows: Record<string, any[]>; has770: boolean } = { calls: [], rows: {}, has770: true };
function fake() {
  const from = (table: string) => {
    const f: [string, any][] = [];
    const q: any = {};
    let write: { op: string; row: any } | null = null;
    const rec = (op: string, args: any[]) => S.calls.push({ table, op, args });
    const missing = !S.has770 && table.startsWith("framework_revision");
    for (const op of ["select", "order", "limit", "in", "is", "or"]) q[op] = (...a: any[]) => { rec(op, a); return q; };
    q.eq = (...a: any[]) => { rec("eq", a); f.push([a[0], a[1]]); return q; };
    q.insert = (row: any) => { rec("insert", [row]); write = { op: "insert", row }; return q; };
    q.update = (row: any) => { rec("update", [row]); write = { op: "update", row }; return q; };
    const hit = () => (S.rows[table] ?? []).filter(r => f.every(([k, v]) => !(k in r) || r[k] === v));
    const done = () => {
      if (missing) return { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
      if (write?.op === "insert") (S.rows[table] ??= []).push(...[].concat(write.row));
      if (write?.op === "update") for (const r of hit()) Object.assign(r, write.row);
      return { data: write ? null : hit(), error: null };
    };
    q.maybeSingle = async () => (missing ? done() : { data: hit()[0] ?? null, error: null });
    q.single = async () => (missing ? done() : { data: hit()[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => Promise.resolve(done()).then(ok, ko);
    return q;
  };
  const rpc = async (fn: string, args: any) => {
    S.calls.push({ table: `rpc:${fn}`, op: "rpc", args: [args] });
    if (!S.has770) return { data: null, error: { code: "PGRST202" } };
    if (fn === "framework_revision_open") {
      (S.rows.framework_revision ??= []).push({ id: REV, framework_id: args.p_framework, status: "open", created_by: args.p_actor, created_at: "t", updated_at: "t" });
      return { data: REV, error: null };
    }
    if (fn === "framework_revision_add_competency") {
      const c = S.rows.framework_competencies.find(x => x.id === args.p_competency);
      S.rows.framework_revision_competency.push({ id: "rc-" + c.id, revision_id: args.p_revision, competency_id: c.id, origin_competency_id: c.id, domain_id: null, sort_order: null,
        code: c.code, name: c.name, description: null, learning_outcomes: [], expected_level_id: null, practice_id: null, cpu_id: null, risk_category: "standard" });
      for (const k of S.rows.competency_skills.filter(x => x.competency_id === c.id))
        S.rows.framework_revision_criterion.push({ id: "rk-" + k.id, revision_id: args.p_revision, skill_id: k.id, origin_skill_id: k.id, competency_id: c.id, name: k.name,
          component_code: k.component_code, source_ref: null, sort_order: k.sort_order, is_active: true });
      return { data: "rc-" + c.id, error: null };
    }
    return { data: null, error: { code: "PGRST202" } };
  };
  return { from, rpc };
}
const writes = () => S.calls.filter(c => ["insert", "update"].includes(c.op) || c.op === "rpc");
const liveWrites = () => writes().filter(c => ["framework_competencies", "competency_skills"].includes(c.table));

beforeEach(() => {
  S.calls = [];
  S.has770 = true;
  S.rows = {
    frameworks: [{ id: FW, name: "Published", pub_status: "published", hospital_id: null, competency_layer: "foundational" }],
    framework_domains: [{ id: DOM, framework_id: FW, name: "D" }],
    framework_competencies: [{ id: C1, domain_id: DOM, name: "Communicates", code: "EX-001", framework_domains: { framework_id: FW } }],
    competency_skills: [
      { id: K1, competency_id: C1, name: "Explains purpose", sort_order: 1, component_code: "clinical_skills", source_ref: null, is_active: true, framework_competencies: { framework_domains: { framework_id: FW } } },
      { id: K2, competency_id: C1, name: "Knows the policy", sort_order: 2, component_code: "knowledge", source_ref: null, is_active: true, framework_competencies: { framework_domains: { framework_id: FW } } },
    ],
    competency_assessment_component: [{ code: "clinical_skills", is_active: true }, { code: "knowledge", is_active: true }],
    competency_verification_method_version: [],
    framework_revision: [], framework_revision_competency: [], framework_revision_criterion: [],
    audit_log: [],
  };
});

describe("pure", () => {
  it("only a published, centrally governed framework goes to a revision", () => {
    expect(goesToRevision({ id: FW, name: "x", pub_status: "published", hospital_id: null, competency_layer: "foundational" })).toBe(true);
    expect(goesToRevision({ id: FW, name: "x", pub_status: "draft", hospital_id: null, competency_layer: "foundational" })).toBe(false);
    expect(goesToRevision({ id: FW, name: "x", pub_status: "published", hospital_id: null, competency_layer: null })).toBe(false);
    expect(goesToRevision({ id: FW, name: "x", pub_status: "published", hospital_id: "h", competency_layer: "foundational" })).toBe(false);
  });

  it("the diff of a revision against what is published: fields, a move, a retirement, a new competency", () => {
    const live = { name: "F", description: null, component_order: null, framework_domains: [{ id: "d1", name: "D1", code: null, sort_order: 1, framework_competencies: [
      { id: "c1", code: "A", name: "One", description: null, sort_order: 1, learning_outcomes: ["o"], expected_level_id: null, risk_category: "standard", practice_id: null, cpu_id: null,
        competency_skills: [{ id: "k1", name: "K1", sort_order: 1, component_code: "knowledge", is_active: true }, { id: "k2", name: "K2", sort_order: 2, component_code: "knowledge", is_active: true }] },
      { id: "c2", code: "B", name: "Two", description: null, sort_order: 2, learning_outcomes: [], expected_level_id: null, risk_category: "standard", practice_id: null, cpu_id: null,
        competency_skills: [{ id: "k3", name: "K3", sort_order: 1, component_code: "knowledge", is_active: true }] },
    ] }] };
    const rc = (o: Partial<RevComp>): RevComp => ({ id: "x", revision_id: "r", competency_id: "c1", origin_competency_id: "c1", domain_id: null, sort_order: null, code: "A", name: "One",
      description: null, learning_outcomes: ["o"], expected_level_id: null, practice_id: null, cpu_id: null, risk_category: "standard", ...o });
    const rk = (o: Partial<RevCrit>): RevCrit => ({ id: "y", revision_id: "r", skill_id: "k1", origin_skill_id: "k1", competency_id: "c1", name: "K1", component_code: "knowledge", source_ref: null, sort_order: 1, is_active: true, ...o });
    const comps = [rc({ name: "One revised", learning_outcomes: ["o", "p"] }), rc({ competency_id: "c2", origin_competency_id: "c2", code: "B", name: "Two", learning_outcomes: [] }),
      rc({ competency_id: "n1", origin_competency_id: null, domain_id: "d1", sort_order: 3, code: "N", name: "New" })];
    const crits = [rk({}), rk({ skill_id: "k2", origin_skill_id: "k2", name: "K2", sort_order: 2, is_active: false }), rk({ skill_id: "k3", origin_skill_id: "k3", name: "K3", sort_order: 3 }),
      rk({ skill_id: "kn", origin_skill_id: null, competency_id: "n1", name: "KN", sort_order: 1 })];
    const d = diffFramework(normalise(live), normalise(overlayRevision(live, comps, crits)));
    expect(d.competencies.added.map(c => c.id)).toEqual(["n1"]);
    const c1 = d.competencies.changed.find(c => c.id === "c1")!;
    expect(c1.fields.map(f => f.field).sort()).toEqual(["learningOutcomes", "name"]);
    expect(c1.criteria.retired.map(k => k.id)).toEqual(["k2"]);
    expect(c1.criteria.moved.map(k => k.id)).toEqual(["k3"]);
    expect(d.competencies.changed.find(c => c.id === "c2")!.criteria.movedOut.map(k => k.id)).toEqual(["k3"]);
    expect(d.counts.criteriaAdded).toBe(1);
    // The live row is untouched by the overlay.
    expect(live.framework_domains[0].framework_competencies[0].name).toBe("One");
  });

  it("a criterion a published method pins, by its criterionId, in criteria or checklist", () => {
    const ms = [{ name: "OSCE", content: { criteria: [{ criterionId: K1.toUpperCase() }] } }, { name: "Obs", content: { checklist: [{ criterionId: K2 }] } }, { name: "None", content: {} }];
    expect(pinningMethods(ms, K1)).toEqual(["OSCE"]);
    expect(pinningMethods(ms, K2)).toEqual(["Obs"]);
    expect(pinningMethods(ms, C1)).toEqual([]);
  });
});

describe("routing (POST authoring on a published framework)", () => {
  it("a draft framework keeps its existing path", async () => {
    S.rows.frameworks[0].pub_status = "draft";
    expect(await routeToRevision(fake(), ME, "update_competency", { competencyId: C1, code: "EX-001", name: "Communicates well" })).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("a published shared framework with no CFCA layer keeps its existing path", async () => {
    S.rows.frameworks[0].competency_layer = null;
    expect(await routeToRevision(fake(), ME, "update_competency", { competencyId: C1, code: "EX-001", name: "Communicates well" })).toBeNull();
  });

  it("without 770 it is refused and nothing is written (fail closed)", async () => {
    S.has770 = false;
    const r: any = await routeToRevision(fake(), ME, "update_competency", { competencyId: C1, code: "EX-001", name: "Communicates well" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.error).toMatch(/migration 770/);
    expect(writes()).toEqual([]);
  });

  it("update_competency: authorship on the competency FIRST, then the revision opens and takes the copy; live untouched", async () => {
    const r: any = await routeToRevision(fake(), ME, "update_competency", { competencyId: C1, code: "EX-001", name: "Communicates well", learningOutcomes: ["Explains", "Checks"] });
    expect(r).toMatchObject({ ok: true, mode: "revision", revisionId: REV });
    const w = writes();
    expect(w[0]).toMatchObject({ table: "audit_log", op: "insert" });
    expect(w[0].args[0]).toMatchObject({ action: "cfca_revision_competency_updated", entity_id: C1 });
    expect(w.map(c => c.table)).toEqual(["audit_log", "rpc:framework_revision_open", "audit_log", "rpc:framework_revision_add_competency", "framework_revision_competency"]);
    // Opening is recorded on the revision, never the framework or a competency (not authorship).
    expect(w[2].args[0]).toMatchObject({ action: "cfca_revision_opened", entity_type: "framework_revision", entity_id: REV });
    expect(S.rows.framework_revision_competency[0]).toMatchObject({ name: "Communicates well", learning_outcomes: ["Explains", "Checks"] });
    expect(S.rows.framework_competencies[0].name).toBe("Communicates");
    expect(liveWrites()).toEqual([]);
  });

  it("create_competency: proposed in its domain with a new id, authorship on that id", async () => {
    const r: any = await routeToRevision(fake(), ME, "create_competency", { domainId: DOM, code: "EX-009", name: "Escalates concerns", riskCategory: "standard" });
    expect(r).toMatchObject({ ok: true, mode: "revision" });
    const row = S.rows.framework_revision_competency.find(x => x.competency_id === r.id);
    expect(row).toMatchObject({ domain_id: DOM, sort_order: 1, code: "EX-009" });
    expect(S.rows.audit_log[0]).toMatchObject({ action: "cfca_revision_competency_created", entity_id: r.id });
    expect(S.rows.framework_competencies).toHaveLength(1);
  });

  it("retire_criterion pinned by a published assessment method is refused: remove it from the method first", async () => {
    S.rows.competency_verification_method_version = [{ state: "published", content: { criteria: [{ criterionId: K2 }] }, competency_verification_method: { name: "Direct observation" } }];
    const r: any = await routeToRevision(fake(), ME, "retire_criterion", { criterionId: K2 });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.error).toMatch(/Direct observation.*Remove it from the method first/);
    expect(writes()).toEqual([]);
  });

  it("retire_criterion otherwise: retired in the revision only, the live criterion stays active", async () => {
    const r: any = await routeToRevision(fake(), ME, "retire_criterion", { criterionId: K2 });
    expect(r).toMatchObject({ ok: true, unchanged: false, mode: "revision" });
    expect(S.rows.framework_revision_criterion.find(k => k.skill_id === K2).is_active).toBe(false);
    expect(S.rows.competency_skills.find(k => k.id === K2).is_active).toBe(true);
    expect(S.rows.audit_log[0]).toMatchObject({ action: "cfca_revision_criterion_retired", entity_id: C1 });
    expect(liveWrites()).toEqual([]);
  });

  it("move_criterion to another section is substantive and lands in the revision", async () => {
    const r: any = await routeToRevision(fake(), ME, "move_criterion", { criterionId: K1, component: "knowledge" });
    expect(r).toMatchObject({ ok: true, kind: "section", substantive: true, mode: "revision" });
    expect(S.rows.framework_revision_criterion.find(k => k.skill_id === K1).component_code).toBe("knowledge");
    expect(S.rows.competency_skills.find(k => k.id === K1).component_code).toBe("clinical_skills");
    expect(liveWrites()).toEqual([]);
  });

  it("the live update path itself refuses a published governed framework (no live write if reached)", async () => {
    const r: any = await updateCompetency(fake(), ME, { competencyId: C1, code: "EX-001", name: "Communicates well" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(liveWrites()).toEqual([]);
  });
});
