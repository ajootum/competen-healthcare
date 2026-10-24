/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import {
  SCHOLAR_ELIGIBILITY, activateScholar, isJoinRefusal, registerForScholar, selfRegistrationEnabled, validateDeclaration, validateRegistration,
} from "@/lib/individual/join";
import { selfActivateScholar } from "@/lib/individual/grants";
import { buildJoinOptions, contextAt, validateContextChoice, type ContextPeriod } from "@/lib/individual/scholar/context";
import { clampLevels, clampOptions, clampProgrammes, optionCode, policyDef, resolvePolicy, validateDraft, DEFAULT_POLICY,
  type LevelsPolicy, type OptionsPolicy, type ProgrammesPolicy } from "@/lib/individual/policy";

// COMPETEN-SCHOLAR-JOIN-01 Stage 1: the join's rules, one identity, the recorded declaration, governed context.

type Q = { table: string; op: string; row?: any; filters: [string, unknown][] };
function fakeAdmin(answer: (q: Q) => { data?: any; error?: any } | undefined) {
  const writes: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "select", filters: [] };
    const run = () => { if (q.op !== "select") writes.push(q); const r = answer(q) ?? {}; return { data: r.data ?? null, error: r.error ?? null }; };
    const b: any = {
      select: () => b, order: () => b, limit: () => b, is: () => b, not: () => b, in: () => b,
      eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      insert: (row: any) => { q.op = "insert"; q.row = row; return b; },
      update: (row: any) => { q.op = "update"; q.row = row; return b; },
      upsert: (row: any) => { q.op = "upsert"; q.row = row; return b; },
      delete: () => { q.op = "delete"; return b; },
      maybeSingle: async () => run(), single: async () => run(),
      then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  };
  return { admin: { from }, writes };
}
const flag = (q: Q, app: boolean, selfReg: boolean) => q.table === "practice_platform_flags"
  ? { data: { enabled: q.filters.some(([, v]) => v === "individual_app") ? app : selfReg } } : undefined;

describe("the gate -- dark unless BOTH flags are on", () => {
  it("is off with no client, either flag off, or a failed read", async () => {
    expect(await selfRegistrationEnabled(null)).toBe(false);
    expect(await selfRegistrationEnabled(fakeAdmin(q => flag(q, true, false)).admin)).toBe(false);
    expect(await selfRegistrationEnabled(fakeAdmin(q => flag(q, false, true)).admin)).toBe(false);
    expect(await selfRegistrationEnabled(fakeAdmin(() => ({ error: { message: "x" } })).admin)).toBe(false);
    expect(await selfRegistrationEnabled(fakeAdmin(q => flag(q, true, true)).admin)).toBe(true);
  });
});

describe("registration -- one identity", () => {
  const input = { email: "new@example.test", password: "longenough", fullName: "New Student" };
  const supabase = (identities: unknown[] = [{}], session: unknown = null) => {
    const calls: any[] = [];
    return { calls, auth: { signUp: async (a: any) => { calls.push(a); return { data: { user: { id: "u-new", identities }, session }, error: null }; } } };
  };

  it("validates the three minimal fields", () => {
    expect(isJoinRefusal(validateRegistration({ ...input, email: "nope" }))).toBe(true);
    expect(isJoinRefusal(validateRegistration({ ...input, password: "short" }))).toBe(true);
    expect(isJoinRefusal(validateRegistration({ ...input, fullName: " " }))).toBe(true);
    expect(validateRegistration({ ...input, email: " New@Example.TEST " })).toMatchObject({ email: "new@example.test" });
  });
  it("an existing email is offered sign-in and NO auth user is created", async () => {
    const sb = supabase();
    const r = await registerForScholar(sb, fakeAdmin(q => q.table === "profiles" ? { data: { id: "u-old" } } : undefined).admin, input, "https://app.test");
    expect(r).toMatchObject({ ok: false, code: "IDENTITY_EXISTS", nextUrl: expect.stringContaining("/login?next=") });
    expect(sb.calls).toHaveLength(0);
  });
  it("GoTrue's no-identities answer for a registered address is treated as existing too", async () => {
    const r = await registerForScholar(supabase([]), fakeAdmin(() => undefined).admin, input, null);
    expect(r).toMatchObject({ ok: false, code: "IDENTITY_EXISTS" });
  });
  it("a new identity: sign-up with confirmation back to the join, then its estate role cleared to null", async () => {
    const sb = supabase();
    const { admin, writes } = fakeAdmin(() => undefined);
    const r = await registerForScholar(sb, admin, input, "https://app.test/");
    expect(r).toEqual({ ok: true, userId: "u-new", verified: false });
    expect(sb.calls[0].options.emailRedirectTo).toBe("https://app.test/auth/callback?next=%2Findividual%2Fjoin%2Fstart");
    expect(sb.calls[0].options.data).toMatchObject({ competen_join: "scholar" });
    expect(writes).toEqual([expect.objectContaining({ table: "profiles", op: "update", row: { role: null } })]);
  });
});

describe("the declaration -- explicit, under the current policy version", () => {
  it("refuses no declaration, and a stale page's version", () => {
    expect(validateDeclaration({ adultDeclaration: false, policyVersion: SCHOLAR_ELIGIBILITY.policyVersion })).toMatchObject({ code: "AGE_DECLARATION_REQUIRED" });
    expect(validateDeclaration({ adultDeclaration: "yes", policyVersion: SCHOLAR_ELIGIBILITY.policyVersion })).toMatchObject({ code: "AGE_DECLARATION_REQUIRED" });
    expect(validateDeclaration({ adultDeclaration: true, policyVersion: "old" })).toMatchObject({ code: "POLICY_CHANGED" });
    expect(validateDeclaration({ adultDeclaration: true, policyVersion: SCHOLAR_ELIGIBILITY.policyVersion })).toBe(true);
  });
});

describe("selfActivateScholar -- the one writer, the declared basis", () => {
  const a = { declarationId: "d1", declaredAt: "2026-10-24T10:00:00Z" };
  it("a person with no membership: membership source signup, and a Scholar period resting on the declaration", async () => {
    const { admin, writes } = fakeAdmin(q => q.table === "individual_live_entitlement" ? { data: [] } : undefined);
    expect(await selfActivateScholar(admin, "u1", a)).toEqual({ ok: true, membership: "created", alreadyLive: false });
    expect(writes.find(w => w.table === "individual_membership")!.row).toMatchObject({ source: "signup", status: "active" });
    const e = writes.find(w => w.table === "individual_entitlement")!.row;
    expect(e).toMatchObject({ experience_code: "scholar", source: "signup", operating_entity: "scholar_operator", adult_confirmed_at: a.declaredAt, adult_declaration_id: "d1" });
    expect("adult_confirmed_by" in e).toBe(false);
    expect("plan_code" in e).toBe(false);
  });
  it("a Professional member adds Scholar to the same membership; a plan code is carried when named", async () => {
    const { admin, writes } = fakeAdmin(q => q.table === "individual_membership" ? { data: { id: "m", status: "active" } } : q.table === "individual_live_entitlement" ? { data: [] } : undefined);
    expect(await selfActivateScholar(admin, "u1", { ...a, planCode: "scholar_free" })).toMatchObject({ ok: true, membership: "existing" });
    expect(writes.some(w => w.table === "individual_membership")).toBe(false);
    expect(writes.find(w => w.table === "individual_entitlement")!.row.plan_code).toBe("scholar_free");
  });
  it("never reinstates, and leaves no stranded membership when the period fails", async () => {
    expect(await selfActivateScholar(fakeAdmin(q => q.table === "individual_membership" ? { data: { id: "m", status: "suspended" } } : undefined).admin, "u1", a))
      .toMatchObject({ ok: false, code: "MEMBERSHIP_NOT_ACTIVE" });
    const { admin, writes } = fakeAdmin(q => q.table === "individual_live_entitlement" ? { data: [] }
      : q.table === "individual_entitlement" && q.op === "insert" ? { error: { code: "23514", message: "check" } } : undefined);
    expect(await selfActivateScholar(admin, "u1", a)).toMatchObject({ ok: false, code: "WRITE_FAILED" });
    expect(writes.some(w => w.table === "individual_membership" && w.op === "delete")).toBe(true);
  });
});

describe("activateScholar -- context, then declaration, then the period", () => {
  const choice = { programmeCode: "nursing", programmeLabel: "Nursing", level: { code: "year-1", label: "Year 1" }, institution: null };
  it("writes in that order, records the policy version and the words, and sends a new member to the welcome", async () => {
    const { admin, writes } = fakeAdmin(q =>
      q.table === "individual_age_declaration" ? { data: { id: "d1", declared_at: "2026-10-24T10:00:00Z" } }
      : q.table === "individual_live_entitlement" ? { data: [] } : undefined);
    const r = await activateScholar(admin, { userId: "u1", choice, viaRegistration: true, onboarded: false });
    expect(r).toMatchObject({ ok: true, next: "/individual/welcome?for=scholar" });
    const order = writes.map(w => w.table).filter(t => t !== "audit_log");
    expect(order).toEqual(["individual_scholar_learner", "individual_age_declaration", "individual_membership", "individual_entitlement"]);
    expect(writes[0].row).toMatchObject({ programme_code: "nursing", level_code: "year-1", level_label: "Year 1", institution_code: null });
    expect(writes[1].row).toMatchObject({ policy_version: SCHOLAR_ELIGIBILITY.policyVersion, statement: SCHOLAR_ELIGIBILITY.statement, source: "self_registration" });
  });
  it("a context failure writes nothing else; an existing account declares as self_activation and, once welcomed, goes to study", async () => {
    const failing = fakeAdmin(q => q.table === "individual_scholar_learner" ? { error: { message: "x" } } : undefined);
    expect(await activateScholar(failing.admin, { userId: "u1", choice, viaRegistration: false, onboarded: true })).toMatchObject({ ok: false });
    expect(failing.writes.map(w => w.table)).toEqual(["individual_scholar_learner"]);
    const { admin, writes } = fakeAdmin(q =>
      q.table === "individual_age_declaration" ? { data: { id: "d1", declared_at: "t" } }
      : q.table === "individual_membership" && q.op === "select" ? { data: { id: "m", status: "active" } }
      : q.table === "individual_live_entitlement" ? { data: [] } : undefined);
    expect(await activateScholar(admin, { userId: "u1", choice, viaRegistration: false, onboarded: true })).toMatchObject({ ok: true, next: "/individual/scholar/study" });
    expect(writes.find(w => w.table === "individual_age_declaration")!.row.source).toBe("self_activation");
  });
});

describe("educational context, governed in the Individual policy", () => {
  it("option codes are derived from labels", () => {
    expect(optionCode("Year 1")).toBe("year-1");
    expect(optionCode("  Makerere University, Kampala ")).toBe("makerere-university-kampala");
    expect(optionCode("!!!")).toBe("");
  });
  it("drafts: programmes, institutions and per-programme levels -- with their refusals", () => {
    expect(validateDraft("scholar_onboarding_programmes", ["nursing-ug-diploma"])).toMatchObject({ ok: true, settings: { codes: ["nursing-ug-diploma"] } });
    expect(validateDraft("scholar_onboarding_programmes", ["Not A Code"])).toMatchObject({ ok: false });
    expect(validateDraft("scholar_institutions", ["Makerere University", "Mulago School of Nursing"]))
      .toMatchObject({ ok: true, settings: { options: [{ code: "makerere-university", label: "Makerere University" }, { code: "mulago-school-of-nursing" }] } });
    expect(validateDraft("scholar_institutions", ["A", "a"])).toMatchObject({ ok: false });
    expect(validateDraft("scholar_programme_levels", { "nursing-ug-diploma": ["Year 1", "Year 2"] }))
      .toMatchObject({ ok: true, settings: { byProgramme: { "nursing-ug-diploma": [{ code: "year-1" }, { code: "year-2" }] } } });
    expect(validateDraft("scholar_programme_levels", { "nursing-ug-diploma": Array.from({ length: 21 }, (_, i) => `Year ${i}`) })).toMatchObject({ ok: false });
  });
  it("reads clamp, and nothing published means every active programme, no levels, no institutions, both fields", () => {
    expect(clampProgrammes(policyDef("scholar_onboarding_programmes") as ProgrammesPolicy, null)).toBeNull();
    expect(clampOptions(policyDef("scholar_institutions") as OptionsPolicy, { options: [{ code: "BAD CODE", label: "x" }, { code: "ok", label: "Ok" }] })).toEqual([{ code: "ok", label: "Ok" }]);
    expect(clampLevels(policyDef("scholar_programme_levels") as LevelsPolicy, { byProgramme: { "Bad Code": [{ code: "a", label: "A" }] } })).toEqual({});
    expect(DEFAULT_POLICY).toMatchObject({ scholarOnboardingProgrammes: null, scholarProgrammeLevels: {}, scholarInstitutions: [], scholarOnboardingFields: ["level", "institution"] });
  });
  it("the join offers only offered, active programmes, asks a level only where one exists, and an institution only when listed", () => {
    const policy = resolvePolicy([
      { config_path: "individual.policy.scholar_onboarding_programmes", published: { codes: ["nursing", "gone"] } },
      { config_path: "individual.policy.scholar_programme_levels", published: { byProgramme: { nursing: [{ code: "year-1", label: "Year 1" }] } } },
    ]);
    const opts = buildJoinOptions([{ code: "nursing", label: "Nursing" }, { code: "midwifery", label: "Midwifery" }], policy);
    expect(opts.programmes).toEqual([{ code: "nursing", label: "Nursing", levels: [{ code: "year-1", label: "Year 1" }] }]);
    expect(opts.asksInstitution).toBe(false);
    expect(validateContextChoice(opts, { programme: "midwifery" })).toMatchObject({ ok: false });
    expect(validateContextChoice(opts, { programme: "nursing" })).toMatchObject({ ok: false, error: "Choose your level." });
    expect(validateContextChoice(opts, { programme: "nursing", level: "year-1", institution: "anywhere" })).toMatchObject({ ok: false });
    expect(validateContextChoice(opts, { programme: "nursing", level: "year-1" })).toMatchObject({ ok: true, choice: { level: { label: "Year 1" }, institution: null } });
  });
  it("a record keeps the context it was made in -- never the current one by default", () => {
    const periods: ContextPeriod[] = [
      { programmeCode: "midwifery", levelLabel: null, institutionLabel: null, effectiveFrom: "2026-10-20T00:00:00Z", effectiveTo: null },
      { programmeCode: "nursing", levelLabel: "Year 1", institutionLabel: null, effectiveFrom: "2026-10-01T00:00:00Z", effectiveTo: "2026-10-20T00:00:00Z" },
    ];
    expect(contextAt(periods, "2026-10-10T12:00:00Z")?.programmeCode).toBe("nursing");
    expect(contextAt(periods, "2026-10-20T00:00:00Z")?.programmeCode).toBe("midwifery");
    expect(contextAt(periods, "2026-09-01T00:00:00Z")).toBeNull();
  });
});
