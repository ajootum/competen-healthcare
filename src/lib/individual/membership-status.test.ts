/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { validateMembershipAction, setIndividualMembershipStatus } from "./grants";

// COMPETEN-LEGAL-001 s13 step 7: the membership's own lifecycle. Suspend is reversible, reinstate only from
// suspended, revoke is terminal here and needs a reason. Only the membership row is written.

const id = "00000000-0000-4000-8000-000000000001";

function stub(status: string | null, updateRows = 1) {
  const writes: any[] = [];
  const from = (t: string) => {
    const b: any = {}; let mode = "select";
    b.select = () => b; b.eq = () => b; b.maybeSingle = () => b;
    b.update = (patch: any) => { mode = "update"; writes.push({ t, patch }); return b; };
    b.then = (ok: any, ko: any) => Promise.resolve(mode === "update"
      ? { data: Array.from({ length: updateRows }, () => ({ id: "m" })), error: null }
      : { data: status ? { id: "m", status } : null, error: null }).then(ok, ko);
    return b;
  };
  return { admin: { from } as any, writes };
}

describe("validateMembershipAction", () => {
  it("revoke needs a reason of at least 8 characters; suspend and reinstate do not", () => {
    expect((validateMembershipAction({ targetUserId: id, action: "revoke", reason: "short" }) as any).code).toBe("REASON_REQUIRED");
    expect((validateMembershipAction({ targetUserId: id, action: "revoke" }) as any).code).toBe("REASON_REQUIRED");
    expect(validateMembershipAction({ targetUserId: id, action: "revoke", reason: "Left the pilot cohort" })).toMatchObject({ action: "revoke" });
    expect(validateMembershipAction({ targetUserId: id, action: "suspend" })).toMatchObject({ action: "suspend", reason: null });
  });
  it("refuses an unknown action or a bad id", () => {
    expect((validateMembershipAction({ targetUserId: id, action: "delete" }) as any).status).toBe(400);
    expect((validateMembershipAction({ targetUserId: "x", action: "suspend" }) as any).status).toBe(400);
  });
});

describe("setIndividualMembershipStatus -- the transitions", () => {
  const allowed: [string, "suspend" | "reinstate" | "revoke", string][] = [
    ["active", "suspend", "suspended"], ["suspended", "reinstate", "active"], ["active", "revoke", "revoked"], ["suspended", "revoke", "revoked"],
  ];
  for (const [from, action, to] of allowed) {
    it(`${from} --${action}--> ${to}, writing only individual_membership`, async () => {
      const { admin, writes } = stub(from);
      const r = await setIndividualMembershipStatus(admin, id, action, "actor");
      expect(r).toEqual({ ok: true, from, to });
      expect(writes.map(w => w.t)).toEqual(["individual_membership"]);
      expect(writes[0].patch.status).toBe(to);
      if (action === "revoke") expect(writes[0].patch.revoked_by).toBe("actor");
    });
  }
  const refused: [string, "suspend" | "reinstate" | "revoke"][] = [
    ["revoked", "reinstate"], ["revoked", "suspend"], ["revoked", "revoke"], ["active", "reinstate"], ["suspended", "suspend"],
  ];
  for (const [from, action] of refused) {
    it(`refuses ${action} from ${from} (revoked is terminal) and writes nothing`, async () => {
      const { admin, writes } = stub(from);
      const r = await setIndividualMembershipStatus(admin, id, action, "actor");
      expect((r as any).code).toBe("INVALID_TRANSITION");
      expect(writes).toHaveLength(0);
    });
  }
  it("no membership is 404; a status changed meanwhile is 409", async () => {
    expect(((await setIndividualMembershipStatus(stub(null).admin, id, "suspend", "a")) as any).code).toBe("NO_MEMBERSHIP");
    expect(((await setIndividualMembershipStatus(stub("active", 0).admin, id, "suspend", "a")) as any).code).toBe("CHANGED");
  });
});

describe("MEMBERSHIP_DONE", () => {
  it("names each change in the past tense, for the audit action", async () => {
    const { MEMBERSHIP_DONE } = await import("./grants");
    expect(MEMBERSHIP_DONE).toEqual({ suspend: "suspended", reinstate: "reinstated", revoke: "revoked" });
  });
});
