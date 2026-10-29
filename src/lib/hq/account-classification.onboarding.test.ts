import { describe, expect, it, vi } from "vitest";
import { classifyAtOnboarding, onboardingType } from "./account-classification";

// Owner 29 Oct 2026: an account HQ creates is classified in the same step, through migration 650's owner-only,
// audited hq_account_classify. Human by default. A refusal never undoes the onboarding: it is reported.

const OWNER = { id: "00000000-0000-4000-8000-0000000000a1", name: "Owner", isOwner: true };
const NEW = "00000000-0000-4000-8000-0000000000b2";

describe("the account type chosen at onboarding", () => {
  it("defaults to Human, accepts every type, refuses anything else", () => {
    expect(onboardingType(undefined)).toEqual({ ok: true, type: "human" });
    expect(onboardingType("")).toEqual({ ok: true, type: "human" });
    for (const t of ["human", "demo", "test", "system", "unclassified"]) expect(onboardingType(t)).toEqual({ ok: true, type: t });
    expect(onboardingType("admin").ok).toBe(false);
  });

  it("classifies the new account through hq_account_classify, as the owner, with a reason", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    expect(await classifyAtOnboarding({ rpc }, OWNER, NEW, "human", "HQ Add User", "t")).toEqual({ ok: true, type: "human" });
    expect(rpc).toHaveBeenCalledWith("hq_account_classify", expect.objectContaining({
      p_actor: OWNER.id, p_profile_ids: [NEW], p_account_type: "human", p_reason: expect.stringMatching(/Set at onboarding \(HQ Add User\)/),
    }));
  });

  it("leaves Unclassified alone, refuses a non-owner, and reports a database refusal instead of throwing", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "owner_required" } }));
    expect(await classifyAtOnboarding({ rpc }, OWNER, NEW, "unclassified", "x", null)).toEqual({ ok: true, type: "unclassified" });
    expect((await classifyAtOnboarding({ rpc }, { ...OWNER, isOwner: false }, NEW, "human", "x", null)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect((await classifyAtOnboarding({ rpc }, OWNER, NEW, "demo", "x", null)).ok).toBe(false);
  });
});
