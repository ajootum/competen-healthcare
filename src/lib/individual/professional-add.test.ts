/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { addProfessionalFromScholar, professionalSelfAddEnabled, PROFESSIONAL_SELF_ADD_FLAG } from "./professional-add";

type Q = { table: string; op: string; row?: any; filters: [string, unknown][] };
function fakeAdmin(answer: (q: Q) => { data?: any; error?: any }) {
  const writes: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "select", filters: [] };
    const run = () => { if (q.op !== "select") writes.push(q); const r = answer(q) ?? {}; return { data: r.data ?? null, error: r.error ?? null }; };
    const b: any = {
      select: () => b, limit: () => b, order: () => b,
      eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      insert: (row: any) => { q.op = "insert"; q.row = row; return b; },
      maybeSingle: async () => run(), single: async () => run(),
      then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  };
  return { admin: { from }, writes };
}
const flag = (q: Q, name: string) => q.table === "practice_platform_flags" && q.filters.some(([c, v]) => c === "flag" && v === name);

describe("P5: add Competen Professional from Scholar (prepared, OFF)", () => {
  it("is OFF with no flag row, a false row or a failed read, and needs the release gate too", async () => {
    const on = (app: boolean, self: boolean | null, fail = false) => fakeAdmin(q => {
      if (flag(q, "individual_app")) return { data: { enabled: app } };
      if (flag(q, PROFESSIONAL_SELF_ADD_FLAG)) return fail ? { error: { message: "x" } } : { data: self === null ? null : { enabled: self } };
      return {};
    }).admin;
    expect(await professionalSelfAddEnabled(on(true, null))).toBe(false);
    expect(await professionalSelfAddEnabled(on(true, false))).toBe(false);
    expect(await professionalSelfAddEnabled(on(true, true, true))).toBe(false);
    expect(await professionalSelfAddEnabled(on(false, true))).toBe(false);
    expect(await professionalSelfAddEnabled(null)).toBe(false);
    expect(await professionalSelfAddEnabled(on(true, true))).toBe(true);
  });

  const world = (membership: any, live: string[]) => fakeAdmin(q => {
    if (q.table === "individual_membership") return { data: membership };
    if (q.table === "individual_live_entitlement") return { data: live.map(e => ({ experience_code: e })) };
    return {};
  });

  it("adds one Professional entitlement to a Scholar member, keeping everything else", async () => {
    const { admin, writes } = world({ status: "active" }, ["scholar"]);
    expect(await addProfessionalFromScholar(admin, "u1")).toEqual({ ok: true, alreadyLive: false, next: "/individual/professional" });
    const ent = writes.filter(w => w.table === "individual_entitlement");
    expect(ent).toHaveLength(1);
    expect(ent[0].row).toMatchObject({ user_id: "u1", experience_code: "professional", status: "active", source: "signup" });
    expect(writes.some(w => w.table === "individual_membership")).toBe(false);
  });

  it("refuses a non-member, a suspended member, or a member without Scholar; never adds twice", async () => {
    expect(await addProfessionalFromScholar(world(null, []).admin, "u")).toMatchObject({ ok: false, code: "NOT_A_MEMBER" });
    expect(await addProfessionalFromScholar(world({ status: "suspended" }, ["scholar"]).admin, "u")).toMatchObject({ ok: false, code: "MEMBERSHIP_NOT_ACTIVE" });
    expect(await addProfessionalFromScholar(world({ status: "active" }, []).admin, "u")).toMatchObject({ ok: false, code: "SCHOLAR_REQUIRED" });
    const twice = world({ status: "active" }, ["scholar", "professional"]);
    expect(await addProfessionalFromScholar(twice.admin, "u")).toMatchObject({ ok: true, alreadyLive: true });
    expect(twice.writes).toHaveLength(0);
  });
});
