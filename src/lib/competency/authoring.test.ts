/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorsOf } from "./clinical-review";
import { checkPackage, createCompetency, createFramework, importDraftPackage, parseCompetency, parseFramework, updateCompetency } from "./authoring";

// Owner, COMPETEN CFCA -- PRODUCTION AUTHORING AND GOVERNANCE DIRECTION: curators author shared CFCA content in
// production through a governed workflow (migration 438), with no SQL. Authorship is recorded before every write (so 395
// can bar an author from reviewing), only shared frameworks are touched, nothing is edited under governance review, and
// an import is a DRAFT, not clinically reviewed: nothing is approved, put forward or published by it.

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

const ME = { userId: "00000000-0000-4000-8000-0000000000c1", name: "Curator" };
const FW = "00000000-0000-4000-8000-0000000000f1", DOM = "00000000-0000-4000-8000-0000000000d1", COMP = "00000000-0000-4000-8000-0000000000e1", LEVEL3 = "00000000-0000-4000-8000-0000000000a3";

const S: { calls: { table: string; op: string; args: any[] }[]; rows: Record<string, any[]>; auditFails: boolean } = { calls: [], rows: {}, auditFails: false };
function fake() {
  const from = (table: string) => {
    const f: [string, any][] = [];
    const q: any = {};
    let write: { op: string; row: any } | null = null;
    const rec = (op: string, args: any[]) => S.calls.push({ table, op, args });
    for (const op of ["select", "order", "limit", "or", "in"]) q[op] = (...a: any[]) => { rec(op, a); return q; };
    q.eq = (...a: any[]) => { rec("eq", a); f.push([a[0], a[1]]); return q; };
    q.is = (...a: any[]) => { rec("is", a); f.push([a[0], a[1]]); return q; };
    q.insert = (row: any) => { rec("insert", [row]); write = { op: "insert", row }; return q; };
    q.update = (row: any) => { rec("update", [row]); write = { op: "update", row }; return q; };
    q.delete = () => { rec("delete", []); write = { op: "delete", row: null }; return q; };
    const hit = () => (S.rows[table] ?? []).filter(r => f.every(([k, v]) => !(k in r) || r[k] === v));
    const done = () => {
      if (write?.op === "insert") {
        if (table === "audit_log" && S.auditFails) return { data: null, error: { message: "down" } };
        (S.rows[table] ??= []).push(write.row);
      }
      if (write?.op === "update") for (const r of hit()) Object.assign(r, write.row);
      return { data: write ? null : hit(), error: null };
    };
    q.maybeSingle = async () => ({ data: hit()[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => Promise.resolve(done()).then(ok, ko);
    return q;
  };
  return { from };
}
const writes = () => S.calls.filter(c => ["insert", "update", "delete"].includes(c.op));
const order = () => writes().map(w => w.table);

beforeEach(() => {
  S.calls = []; S.auditFails = false;
  S.rows = {
    frameworks: [{ id: FW, name: "Competen Foundational", code: "CF-FOUND", pub_status: "draft", hospital_id: null }],
    framework_domains: [{ id: DOM, framework_id: FW, name: "Clinical reasoning", sort_order: 1 }],
    framework_competencies: [{ id: COMP, domain_id: DOM, name: "Gathers information", code: "CF-CR-001", sort_order: 1 }],
    scoring_levels: [{ id: LEVEL3, score: 3 }],
    audit_log: [],
  };
});

const comp = (over: Record<string, any> = {}) => ({ domainId: DOM, code: "CF-CR-002", name: "Recognises deterioration", description: "Identifies early warning signs.", learningOutcomes: ["Explains early warning signs"], expectedLevelId: LEVEL3, riskCategory: "standard", ...over });

describe("validation, pure", () => {
  it("a framework names its layer, and a profession framework its profession", () => {
    expect(parseFramework({ code: "cf-found", name: "Competen Foundational", layer: "foundational" })).toMatchObject({ ok: true, value: { code: "CF-FOUND" } });
    expect(parseFramework({ code: "NUR-RESP", name: "Nursing Respiratory", layer: "profession" })).toMatchObject({ ok: false });
    expect(parseFramework({ code: "x y", name: "Bad", layer: "foundational" })).toMatchObject({ ok: false });
  });
  it("a competency carries every field the 395 hash covers that authoring may set", () => {
    const p = parseCompetency({ code: "CF-CR-001", name: "Gathers information", learningOutcomes: "One\n\nTwo outcome", riskCategory: "high" });
    expect(p).toMatchObject({ ok: true, value: { learningOutcomes: ["One", "Two outcome"], riskCategory: "high", expectedLevelId: null } });
    expect(parseCompetency({ code: "CF-CR-001", name: "Gathers", riskCategory: "extreme" })).toMatchObject({ ok: false });
    expect(parseCompetency({ code: "CF-CR-001", name: "Gathers", expectedLevelId: "not-an-id" })).toMatchObject({ ok: false });
  });
});

describe("authorship is recorded BEFORE the write, so 395 can bar the author from reviewing", () => {
  it("a new competency: the audit row first, naming the new id, then the row with its full content", async () => {
    const r = await createCompetency(fake(), ME, comp());
    expect(r.ok).toBe(true);
    expect(order()).toEqual(["audit_log", "framework_competencies"]);
    const [a, row] = writes().map(w => w.args[0]);
    expect(a).toMatchObject({ actor_id: ME.userId, action: "cfca_competency_created", entity_id: row.id });
    expect(row).toMatchObject({ code: "CF-CR-002", learning_outcomes: ["Explains early warning signs"], expected_level_id: LEVEL3, risk_category: "standard", domain_id: DOM });
    // 395's own rule then counts the curator as an author of this competency.
    expect(authorsOf("someone-else", S.rows.audit_log.filter(x => x.entity_id === row.id))).toContain(ME.userId);
  });

  it("an authorship row that cannot be written stops the write", async () => {
    S.auditFails = true;
    expect(await createCompetency(fake(), ME, comp())).toMatchObject({ ok: false, status: 503 });
    expect(order()).toEqual(["audit_log"]);
    expect(await updateCompetency(fake(), ME, { ...comp({ code: "CF-CR-001" }), competencyId: COMP })).toMatchObject({ ok: false });
    expect(writes().some(w => w.table === "framework_competencies")).toBe(false);
  });
});

describe("only shared frameworks, and not while under governance review", () => {
  it("a hospital framework is refused", async () => {
    S.rows.frameworks[0].hospital_id = "00000000-0000-4000-8000-00000000ffff";
    expect(await createCompetency(fake(), ME, comp())).toMatchObject({ ok: false, status: 404 });
    expect(writes()).toEqual([]);
  });

  it("in governance review or approved: edits refused; draft and published: allowed; archived: refused", async () => {
    for (const s of ["in_review", "approved", "archived"]) {
      S.calls = []; S.rows.frameworks[0].pub_status = s;
      expect([s, (await updateCompetency(fake(), ME, { ...comp({ code: "CF-CR-001" }), competencyId: COMP })).ok]).toEqual([s, false]);
      expect(writes()).toEqual([]);
    }
    for (const s of ["draft", "published"]) {
      S.rows.frameworks[0].pub_status = s;
      expect([s, (await updateCompetency(fake(), ME, { ...comp({ code: "CF-CR-001" }), competencyId: COMP })).ok]).toEqual([s, true]);
    }
  });

  it("a code another shared competency already holds is refused", async () => {
    expect(await createCompetency(fake(), ME, comp({ code: "CF-CR-001" }))).toMatchObject({ ok: false, status: 409 });
  });

  it("a new framework is shared, master, DRAFT, with its code and layer", async () => {
    S.rows.frameworks = [];
    const r = await createFramework(fake(), ME, { code: "CF-NEW", name: "New Framework", layer: "foundational" });
    expect(r.ok).toBe(true);
    expect(S.rows.frameworks[0]).toMatchObject({ code: "CF-NEW", hospital_id: null, scope: "master", pub_status: "draft", competency_layer: "foundational" });
  });
});

describe("a draft package: DRAFT, not clinically reviewed, nothing approved or published", () => {
  const PKG = JSON.parse(readFileSync("docs/evidence/CFCA/cf-found-draft-package.json", "utf8"));

  it("the CF-FOUND package is whole and valid: one framework, four domains, eight competencies, codes preserved", () => {
    const v = checkPackage(PKG);
    expect(v.ok).toBe(true);
    expect(PKG.framework).toMatchObject({ code: "CF-FOUND", layer: "foundational" });
    expect(PKG.domains).toHaveLength(4);
    expect(PKG.domains.flatMap((d: any) => d.competencies.map((c: any) => c.code))).toEqual(["CF-CR-001", "CF-CR-002", "CF-PS-001", "CF-PS-002", "CF-CM-001", "CF-CM-002", "CF-IP-001", "CF-IP-002"]);
    expect(JSON.stringify(PKG.framework)).not.toMatch(/staging seed/i);                 // the staging wording is not carried
    expect(JSON.stringify(PKG)).not.toMatch(/"(approved|published|in_review)"/);         // no state is carried
  });

  it("importing it creates exactly the draft, resolves the level on this environment, and writes no review, version or publication", async () => {
    S.rows.frameworks = []; S.rows.framework_domains = []; S.rows.framework_competencies = [];
    const r = await importDraftPackage(fake(), ME, PKG);
    expect(r).toMatchObject({ ok: true, competencies: 8 });
    expect(S.rows.frameworks).toHaveLength(1);
    expect(S.rows.frameworks[0]).toMatchObject({ code: "CF-FOUND", pub_status: "draft", hospital_id: null });
    expect(S.rows.framework_domains).toHaveLength(4);
    expect(S.rows.framework_competencies.every(c => c.expected_level_id === LEVEL3)).toBe(true);
    expect(writes().map(w => w.table).filter(t => !["audit_log", "frameworks", "framework_domains", "framework_competencies"].includes(t))).toEqual([]);
    expect(S.rows.audit_log.find(a => a.action === "cfca_draft_imported")?.new_value.provenance).toMatchObject({ source: expect.stringMatching(/staging/) });
  });

  it("an import is refused whole when the framework code already exists, and writes nothing", async () => {
    expect(await importDraftPackage(fake(), ME, PKG)).toMatchObject({ ok: false, status: 409 });
    expect(writes()).toEqual([]);
  });

  it("a package naming a level the default scale lacks is refused before any write", async () => {
    S.rows.frameworks = []; S.rows.framework_competencies = []; S.rows.scoring_levels = [];
    expect(await importDraftPackage(fake(), ME, PKG)).toMatchObject({ ok: false, status: 422 });
    expect(writes()).toEqual([]);
  });
});

describe("the route", () => {
  it("is gated on the curator capability only, and has no publish or approve action", () => {
    // Code only: a comment naming the capability proves nothing about the gate.
    const src = readFileSync("src/app/api/hq/competency/authoring/route.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src.match(/hqApiGate\(/g)).toHaveLength(1);
    expect(src).toMatch(/await hqApiGate\(\["hq\.quality\.competency\.author"\]\)/);
    expect(src).not.toMatch(/case "(publish|approve|decide)/);
    expect(src).not.toMatch(/transitionFramework|decideReview|clinical_review_decision/);
  });
});

describe("Competency Studio: identity, CPU and publication (owner COMPLETE PRODUCTION AUTHORING CAPABILITY)", () => {
  const OTHER_FW = "00000000-0000-4000-8000-0000000000f2", PRA = "00000000-0000-4000-8000-0000000000b1", CPU = "00000000-0000-4000-8000-0000000000b2", FOREIGN_CPU = "00000000-0000-4000-8000-0000000000b3";

  it("identity (code, layer, profession, specialty, parent) is configuration, set only while a draft", async () => {
    const { setFrameworkIdentity } = await import("./authoring");
    expect(await setFrameworkIdentity(fake(), ME, { frameworkId: FW, code: "CF-FOUND-2", layer: "foundational" })).toMatchObject({ ok: true });
    expect(S.rows.frameworks[0]).toMatchObject({ code: "CF-FOUND-2", competency_layer: "foundational" });
    S.rows.frameworks[0].pub_status = "published"; S.calls = [];
    expect(await setFrameworkIdentity(fake(), ME, { frameworkId: FW, code: "CF-X", layer: "foundational" })).toMatchObject({ ok: false, status: 409 });
    expect(writes()).toEqual([]);
    expect(parseFramework({ code: "SP-1", name: "Specialty", layer: "specialty" })).toMatchObject({ ok: false });
  });

  it("a CPU is created in a practice of the framework; a competency links only a CPU of its own framework", async () => {
    const { createCpu } = await import("./authoring");
    S.rows.practices = [{ id: PRA, domain_id: DOM, code: "PRA-1", framework_domains: { framework_id: FW } }];
    expect(await createCpu(fake(), ME, { practiceId: PRA, code: "CPU-X-001", name: "A practice unit", riskCategory: "high", complexity: 3 })).toMatchObject({ ok: true });
    expect(order()).toEqual(["audit_log", "clinical_practice_units"]);
    S.rows.clinical_practice_units = [{ id: CPU, practice_id: PRA }, { id: FOREIGN_CPU, practice_id: "00000000-0000-4000-8000-0000000000b9" }];
    S.rows.practices.push({ id: "00000000-0000-4000-8000-0000000000b9", domain_id: "x", framework_domains: { framework_id: OTHER_FW } });
    expect(await createCompetency(fake(), ME, comp({ cpuId: CPU }))).toMatchObject({ ok: true });
    expect(S.rows.framework_competencies.at(-1)).toMatchObject({ cpu_id: CPU, practice_id: PRA });
    expect(await createCompetency(fake(), ME, comp({ code: "CF-CR-009", cpuId: FOREIGN_CPU }))).toMatchObject({ ok: false, status: 422 });
  });

  it("438 grants the new capability to the new position only: no existing position gains authoring", () => {
    const sql = readFileSync("supabase/migrations/438-competency-author-capability.sql", "utf8").replace(/^--.*$/gm, "");
    const grants = [...sql.matchAll(/from \(values (.*?)\) as p\(code\)/g)].map(m => m[1]);
    expect(grants).toEqual(["('competency_curator')"]);
    expect(sql).not.toMatch(/hq\.quality\.clinical\.(approve|govern)/);
  });

  it("a refused publication (466) is explained in words, never as a raw database error", async () => {
    const { transitionFramework } = await import("./framework-lifecycle");
    const admin: any = { from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: FW, name: "F", pub_status: "approved", version_num: 0 }, error: null }) };
      q.update = () => ({ eq: async () => ({ error: { message: "cfca publication: 3 of 8 competencies are not clinically approved at their current content" } }) });
      return q;
    } };
    const r = await transitionFramework(admin, FW, "publish", { id: ME.userId, name: null });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, code: 409 });
    expect(r.error).toMatch(/3 of its 8 competencies are not clinically approved/);
  });
});
