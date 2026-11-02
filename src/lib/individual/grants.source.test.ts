/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { grantIndividualAccess } from "./grants";

// Migration 850: the source an accepted invitation writes. pilot is the default and what every existing caller
// gets. hq_grant is complimentary access given through an ordinary HQ invitation.

function fake(entitlementFails = false) {
  const writes: { t: string; op: string; arg: any }[] = [];
  const from = (t: string) => {
    const b: any = {};
    const filters: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.is = () => b;
    b.limit = () => b;
    b.maybeSingle = () => Promise.resolve(t === "profiles" ? { data: { id: "u" }, error: null } : { data: null, error: null });
    b.insert = (row: any) => { writes.push({ t, op: "insert", arg: row }); return Promise.resolve({ error: t === "individual_entitlement" && entitlementFails ? { code: "XX000" } : null }); };
    b.delete = () => { const d: any = { eq: (c: string, v: unknown) => { filters[c] = v; return d; }, is: () => { writes.push({ t, op: "delete", arg: { ...filters } }); return Promise.resolve({ error: null }); } }; return d; };
    b.then = (ok: any, ko: any) => Promise.resolve({ data: [], error: null }).then(ok, ko);
    return b;
  };
  return { admin: { from } as any, writes };
}
const req = { targetUserId: "u", experiences: ["professional" as const], adultConfirmed: false, endsAt: null };

describe("grantIndividualAccess -- source", () => {
  it("defaults to a pilot grant: membership hq_pilot_grant, entitlement pilot", async () => {
    const f = fake();
    expect((await grantIndividualAccess(f.admin, req, "inviter")).ok).toBe(true);
    expect(f.writes.find(w => w.t === "individual_membership")?.arg.source).toBe("hq_pilot_grant");
    expect(f.writes.find(w => w.t === "individual_entitlement")?.arg.source).toBe("pilot");
  });
  it("hq_grant: membership hq_grant, entitlement hq_grant", async () => {
    const f = fake();
    expect((await grantIndividualAccess(f.admin, { ...req, source: "hq_grant" }, "inviter")).ok).toBe(true);
    expect(f.writes.find(w => w.t === "individual_membership")?.arg.source).toBe("hq_grant");
    expect(f.writes.find(w => w.t === "individual_entitlement")?.arg.source).toBe("hq_grant");
  });
  it("the compensating delete matches the same source", async () => {
    for (const [source, mem] of [[undefined, "hq_pilot_grant"], ["hq_grant", "hq_grant"]] as const) {
      const f = fake(true);
      const r = await grantIndividualAccess(f.admin, { ...req, source }, "inviter");
      expect(r.ok).toBe(false);
      expect(f.writes.find(w => w.op === "delete")?.arg).toMatchObject({ source: mem });
    }
  });
});
