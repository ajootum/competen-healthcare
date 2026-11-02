/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("react", async orig => ({ ...(await orig<typeof import("react")>()), cache: (fn: unknown) => fn }));

import { MODULE_ACCESS_CLOSED, POLICIES, clampModuleAccess, policyDef, policyPath, resolvePolicy, validateDraft, type ModuleAccess, type ModuleAccessPolicy } from "../policy";
import { moduleAllowed, requireScholarModule, scholarModulesFor } from "./module-access";
import { normaliseAccountEmail } from "./module-access-admin";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const def = policyDef("scholar_module_courses_access") as ModuleAccessPolicy;
const access = (mode: ModuleAccess["mode"], users: string[] = [], groups: ModuleAccess["groups"] = []): ModuleAccess => ({ mode, users, groups });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("clampModuleAccess fails closed", () => {
  it.each([[undefined], [null], [{}], [[]], ["public"], [42], [{ mode: "everyone" }], [{ mode: 7, users: [A] }], [{ users: [A] }]])("%j is private to nobody", v => {
    expect(clampModuleAccess(def, v)).toEqual(MODULE_ACCESS_CLOSED);
  });
  it("keeps a valid mode, drops anything that is not an id, lower-cases, dedupes and caps", () => {
    expect(clampModuleAccess(def, { mode: "private", users: [A.toUpperCase(), A, "not-an-id", 7, null, "someone-at-example"] }).users).toEqual([A]);
    expect(clampModuleAccess(def, { mode: "private", users: ids(60) }).users).toHaveLength(def.maxUsers);
  });
  it("tolerates a missing users or groups list and unknown groups", () => {
    expect(clampModuleAccess(def, { mode: "public" })).toEqual(access("public"));
    expect(clampModuleAccess(def, { mode: "pilot", users: "x", groups: ["pilot", "everyone"] })).toEqual(access("pilot", [], ["pilot"]));
  });
  it("hands a default policy a closed courses and competencies", () => {
    expect(resolvePolicy([]).scholarModuleAccess).toEqual({ courses: MODULE_ACCESS_CLOSED, competencies: MODULE_ACCESS_CLOSED });
    const p = resolvePolicy([{ config_path: policyPath("scholar_module_competencies_access"), published: { mode: "private", users: [B] } }]);
    expect(p.scholarModuleAccess.competencies.users).toEqual([B]);
    expect(p.scholarModuleAccess.courses).toEqual(MODULE_ACCESS_CLOSED);
  });
});

describe("validateDraft for module access", () => {
  const check = (v: unknown) => validateDraft("scholar_module_courses_access", v);
  it("accepts the three modes and stores ids only", () => {
    expect(check({ mode: "private", users: [A.toUpperCase(), A], groups: [] })).toMatchObject({ ok: true, settings: { mode: "private", users: [A], groups: [] } });
    expect(check({ mode: "pilot", users: [], groups: ["pilot"] })).toMatchObject({ ok: true, settings: { mode: "pilot", groups: ["pilot"] } });
    expect(check({ mode: "public", users: [], groups: [] })).toMatchObject({ ok: true });
  });
  it.each([[null], ["private"], [[]], [{ mode: "open", users: [], groups: [] }], [{ mode: "private", users: ["someone-at-example"], groups: [] }],
    [{ mode: "private", users: "x", groups: [] }], [{ mode: "pilot", users: [], groups: ["everyone"] }], [{ mode: "pilot", users: [] }]])("refuses %j", v => {
    expect(check(v)).toMatchObject({ ok: false });
  });
  it("refuses more than the limit", () => expect(check({ mode: "private", users: ids(51), groups: [] })).toMatchObject({ ok: false }));
  it("defines exactly the two module policies, for Scholar, with plain labels", () => {
    expect(POLICIES.filter(p => p.kind === "module_access").map(p => [p.key, p.label, p.product])).toEqual([
      ["scholar_module_courses_access", "Courses & Training access", "Scholar"], ["scholar_module_competencies_access", "My Competencies access", "Scholar"],
    ]);
  });
});

describe("moduleAllowed", () => {
  it("public: everyone", () => expect(moduleAllowed(access("public"), A, null)).toBe(true));
  it("private: only a listed account, whatever its category", () => {
    expect(moduleAllowed(access("private", [A], ["pilot"]), A, null)).toBe(true);
    expect(moduleAllowed(access("private", [A], ["pilot"]), B, "pilot")).toBe(false);
    expect(moduleAllowed(access("private"), A, "pilot")).toBe(false);
  });
  it("pilot: a listed account, or a listed category", () => {
    const p = access("pilot", [A], ["pilot"]);
    expect(moduleAllowed(p, A, null)).toBe(true);
    expect(moduleAllowed(p, B, "pilot")).toBe(true);
    expect(moduleAllowed(p, B, "regular")).toBe(false);
    expect(moduleAllowed(p, B, null)).toBe(false);
  });
  it("compares ids case-insensitively and refuses an empty id", () => {
    expect(moduleAllowed(access("private", [A]), A.toUpperCase(), null)).toBe(true);
    expect(moduleAllowed(access("private", [A]), "", null)).toBe(false);
  });
});

// A fake admin client: policy rows from workspace_config_overrides, one participation row from hq_account_participation.
function fake(opts: { rows?: { config_path: string; published: unknown }[]; policyError?: boolean; participation?: { category: string; valid_until?: string | null } | null; participationError?: { code: string } }) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      if (table === "workspace_config_overrides") {
        const q: any = { select: () => q, eq: () => q, like: () => Promise.resolve(opts.policyError ? { data: null, error: { code: "x" } } : { data: opts.rows ?? [], error: null }) };
        return q;
      }
      const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve(opts.participationError ? { data: null, error: opts.participationError } : { data: opts.participation ?? null, error: null }) };
      return q;
    },
  };
}
const row = (key: string, published: unknown) => ({ config_path: policyPath(key as any), published });

describe("scholarModulesFor", () => {
  it("is empty when nothing is published", async () => expect([...await scholarModulesFor(fake({}), A)]).toEqual([]));
  it("is empty when the policy cannot be read", async () => expect([...await scholarModulesFor(fake({ policyError: true }), A)]).toEqual([]));
  it("is empty when the client throws", async () => expect([...await scholarModulesFor({ from() { throw new Error("down"); } }, A)]).toEqual([]));
  it("grants a listed account only its modules", async () => {
    const admin = fake({ rows: [row("scholar_module_courses_access", { mode: "private", users: [A] }), row("scholar_module_competencies_access", { mode: "private", users: [B] })] });
    expect([...await scholarModulesFor(admin, A)]).toEqual(["courses"]);
    expect([...await scholarModulesFor(admin, B)]).toEqual(["competencies"]);
    expect([...await scholarModulesFor(admin, C)]).toEqual([]);
    expect(admin.reads).not.toContain("hq_account_participation");
  });
  it("reads the participation label only for a pilot that names a category", async () => {
    const admin = fake({ rows: [row("scholar_module_courses_access", { mode: "pilot", users: [], groups: ["pilot"] })], participation: { category: "pilot" } });
    expect([...await scholarModulesFor(admin, C)]).toEqual(["courses"]);
    expect(admin.reads).toContain("hq_account_participation");
  });
  it("gives no pilot access for another category, no label, an ended label or an absent table", async () => {
    const rows = [row("scholar_module_courses_access", { mode: "pilot", users: [], groups: ["pilot"] })];
    expect([...await scholarModulesFor(fake({ rows, participation: { category: "regular" } }), C)]).toEqual([]);
    expect([...await scholarModulesFor(fake({ rows, participation: null }), C)]).toEqual([]);
    expect([...await scholarModulesFor(fake({ rows, participation: { category: "pilot", valid_until: "2020-01-01T00:00:00Z" } }), C)]).toEqual([]);
    expect([...await scholarModulesFor(fake({ rows, participationError: { code: "42P01" } }), C)]).toEqual([]);
  });
  it("fails closed when the participation label cannot be read", async () => {
    const rows = [row("scholar_module_courses_access", { mode: "pilot", users: [A], groups: ["pilot"] })];
    expect([...await scholarModulesFor(fake({ rows, participationError: { code: "XX000" } }), A)]).toEqual([]);
  });
  it("opens a public module to everyone", async () => {
    expect([...await scholarModulesFor(fake({ rows: [row("scholar_module_competencies_access", { mode: "public" })] }), C)]).toEqual(["competencies"]);
  });
  it("uses the policy it is given without reading one", async () => {
    const admin = fake({});
    const policy = { scholarModuleAccess: { courses: access("private", [A]), competencies: access("private") } };
    expect([...await scholarModulesFor(admin, A, policy)]).toEqual(["courses"]);
    expect(admin.reads).toEqual([]);
  });
});

describe("requireScholarModule", () => {
  beforeEach(() => { notFound.mockClear(); });
  it("answers the ordinary not-found for an account without the module", async () => {
    await expect(requireScholarModule(fake({}), A, "courses")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });
  it("lets a listed account through", async () => {
    await expect(requireScholarModule(fake({ rows: [row("scholar_module_courses_access", { mode: "private", users: [A] })] }), A, "courses")).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });
  it("does not let one module's grant open the other", async () => {
    await expect(requireScholarModule(fake({ rows: [row("scholar_module_courses_access", { mode: "private", users: [A] })] }), A, "competencies")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("normaliseAccountEmail", () => {
  it("trims and lower-cases an address", () => expect(normaliseAccountEmail("  Name@Example.ORG ")).toBe("name@example.org"));
  it.each([[""], ["no-at-sign"], ["a b@c.d"], [null], [42], ["x@y"]])("refuses %j", v => expect(normaliseAccountEmail(v)).toBeNull());
});
