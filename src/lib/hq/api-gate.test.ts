import { describe, it, expect, vi, beforeEach } from "vitest";

// hqApiGate's two refusals, against the refusals resolveHqContext actually returns (CONFIG-002 s8): no session
// is 401, a signed-in person without the capability is 403. The 401 branch was dead while the gate compared
// the redirect with "/login" exactly and the resolver sent "/login?next=/super-admin".

const resolve = vi.fn();
vi.mock("./context", () => ({ resolveHqContext: (cap: string, opts: unknown) => resolve(cap, opts) }));

import { hqApiGate, isHqRefusal } from "./api-gate";

beforeEach(() => resolve.mockReset());

describe("hqApiGate", () => {
  it("no session is 401 -- the resolver's real anonymous refusal, destination and all", async () => {
    resolve.mockResolvedValue({ ok: false, redirectTo: "/login?next=/super-admin", decision: "deny", reason: "not authenticated" });
    const r = await hqApiGate(["hq.individual.pilot.grant"]);
    expect(isHqRefusal(r) && r.status).toBe(401);
  });

  it("a signed-in person without the capability is 403", async () => {
    resolve.mockResolvedValue({ ok: false, redirectTo: "/dashboard", decision: "deny", reason: "capability not held" });
    const r = await hqApiGate(["hq.individual.pilot.grant"]);
    expect(isHqRefusal(r) && r.status).toBe(403);
  });

  it("enforces, and returns the context when the capability is held", async () => {
    const ctx = { userId: "u", admin: {} };
    resolve.mockResolvedValue({ ok: true, ctx });
    expect(await hqApiGate(["hq.individual.pilot.grant"])).toBe(ctx);
    expect(resolve).toHaveBeenCalledWith("hq.individual.pilot.grant", { enforce: true });
  });

  it("any-of: the second capability admits when the first refuses", async () => {
    const ctx = { userId: "u" };
    resolve.mockResolvedValueOnce({ ok: false, redirectTo: "/dashboard", decision: "deny", reason: "x" }).mockResolvedValueOnce({ ok: true, ctx });
    expect(await hqApiGate(["a", "b"])).toBe(ctx);
  });

  it("declares-nothing is 403 without asking the resolver", async () => {
    const r = await hqApiGate([]);
    expect(isHqRefusal(r) && r.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });
});
