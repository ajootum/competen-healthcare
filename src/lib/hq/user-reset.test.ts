/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));
vi.mock("@/lib/notifications/dispatch", () => ({ dispatch: vi.fn(async () => ({})) }));

import { NEUTRAL_MESSAGE, RESERVE_FUNCTION, RESET_SENT, decideReset, isSuspended, redactAddresses, requestAdminReset, resetReturnUrl, responseFor, type TargetFacts } from "./user-reset";
import { isAdminInitiated } from "@/lib/auth/recovery-link";

const OK: TargetFacts = { email: "person@example.test", emailVerified: true, isOwnerAccount: false, suspended: false };
const base = { actorId: "a", actorIsOwner: false, targetId: "t", target: OK, reservation: "reserved" as const };

describe("decideReset (HQ-USERS-B)", () => {
  it("follows the rule's order", () => {
    expect(decideReset({ ...base, targetId: "a" })).toEqual({ kind: "self" });
    expect(decideReset({ ...base, reservation: "actor_limited" })).toEqual({ kind: "actor_limited" });
    // The person's limit is checked before the facts, so an over-limit unknown target reads as over-limit.
    expect(decideReset({ ...base, reservation: "target_limited", target: null })).toEqual({ kind: "refuse", reason: "target_rate_limited" });
    expect(decideReset({ ...base, target: null })).toEqual({ kind: "refuse", reason: "unknown_target" });
    expect(decideReset({ ...base, target: { ...OK, isOwnerAccount: true } })).toEqual({ kind: "refuse", reason: "owner_target" });
    expect(decideReset({ ...base, actorIsOwner: true, target: { ...OK, isOwnerAccount: true } })).toEqual({ kind: "send" });
    expect(decideReset({ ...base, target: { ...OK, suspended: true } })).toEqual({ kind: "refuse", reason: "suspended" });
    expect(decideReset({ ...base, target: { ...OK, emailVerified: false } })).toEqual({ kind: "refuse", reason: "unverified_email" });
    expect(decideReset(base)).toEqual({ kind: "send" });
  });

  it("answers every refusal of a target with the same neutral sentence", () => {
    const reasons = ["unknown_target", "owner_target", "suspended", "unverified_email", "target_rate_limited", "send_failed"] as const;
    const answers = reasons.map(reason => JSON.stringify(responseFor({ kind: "refuse", reason })));
    expect(new Set([...answers, JSON.stringify(responseFor({ kind: "sent" }))]).size).toBe(1);
    expect(responseFor({ kind: "sent" })).toEqual({ status: 202, body: { ok: true, message: NEUTRAL_MESSAGE } });
    expect(responseFor({ kind: "self" }).status).toBe(403);
    expect(responseFor({ kind: "actor_limited" }).status).toBe(429);
  });

  it("judges a ban against the database time of the attempt, and honours account_status", () => {
    expect(isSuspended("2026-10-23T12:00:01Z", null, "2026-10-23T12:00:00Z")).toBe(true);
    expect(isSuspended("2026-10-23T11:59:59Z", null, "2026-10-23T12:00:00Z")).toBe(false);
    expect(isSuspended(null, "suspended", "2026-10-23T12:00:00Z")).toBe(true);
    expect(isSuspended(null, "active", "2026-10-23T12:00:00Z")).toBe(false);
  });

  it("redacts an address the provider quotes, before it is logged", () => {
    expect(redactAddresses('Email address "person@example.test" is invalid')).toBe('Email address "[address]" is invalid');
    expect(redactAddresses("rate limit exceeded")).toBe("rate limit exceeded");
  });

  it("returns to the configured site, marked as administrator-initiated", () => {
    expect(resetReturnUrl()).toMatch(/^https?:\/\/[^/]+\/reset-password\?initiated=admin$/);
    expect(isAdminInitiated("?initiated=admin")).toBe(true);
    expect(isAdminInitiated("?code=abc")).toBe(false);
  });
});

function fakeAdmin(opts: { reservation?: string; rpcError?: boolean; user?: any; profile?: any; sendError?: boolean } = {}) {
  const audit: any[] = [];
  const sends: any[] = [];
  const rpcs: any[] = [];
  const admin: any = {
    audit, sends, rpcs,
    rpc: async (fn: string, args: any) => { rpcs.push({ fn, args }); return opts.rpcError ? { data: null, error: { message: "function does not exist" } } : { data: [{ outcome: opts.reservation ?? "reserved", reserved_at: "2026-10-23T12:00:00Z" }], error: null }; },
    auth: {
      admin: { getUserById: async () => ({ data: opts.user === undefined ? { user: { email: "person@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", banned_until: null } } : opts.user }) },
      resetPasswordForEmail: async (email: string, o: any) => { sends.push({ email, o }); return { error: opts.sendError ? { message: `Email address "${email}" is invalid` } : null }; },
    },
    from(table: string) {
      const f: Record<string, any> = {};
      const b: any = {
        insert: (row: any) => { audit.push(row); return { select: () => ({ single: async () => ({ data: { created_at: "2026-10-23T12:00:00Z" }, error: null }) }) }; },
        select: () => b, gte: () => b, limit: () => b,
        eq: (k: string, v: any) => { f[k] = v; return b; },
        maybeSingle: async () => ({ data: opts.profile ?? { role: "nurse", roles: ["nurse"], platform_role: null, platform_roles: [], account_status: "active" }, error: null }),
        then: (res: any) => res({ data: null, error: null }),
      };
      return b;
    },
  };
  return admin;
}
const actor = { userId: "11111111-1111-4111-8111-111111111111", fullName: "Admin", isOwner: false };
const TARGET = "22222222-2222-4222-8222-222222222222";

describe("requestAdminReset", () => {
  it("sends through Supabase recovery to the verified address, returns no link, and audits no address", async () => {
    const admin = fakeAdmin();
    const r = await requestAdminReset(admin, actor, TARGET);
    expect(r).toEqual({ status: 202, body: { ok: true, message: NEUTRAL_MESSAGE } });
    expect(admin.sends).toHaveLength(1);
    expect(admin.sends[0].o.redirectTo).toMatch(/\/reset-password\?initiated=admin$/);
    expect(admin.rpcs).toEqual([{ fn: RESERVE_FUNCTION, args: { p_actor: actor.userId, p_target: TARGET, p_actor_name: "Admin", p_trace: "trace-test" } }]);
    expect(admin.audit.map((a: any) => a.action)).toEqual([RESET_SENT]);
    expect(JSON.stringify([r, admin.audit])).not.toMatch(/person@example\.test|token|https?:\/\//);
  });

  it("refuses yourself by name and sends nothing", async () => {
    const admin = fakeAdmin();
    const r = await requestAdminReset(admin, actor, actor.userId);
    expect(r.status).toBe(403);
    expect(admin.sends).toHaveLength(0);
  });

  it("an owner account, a suspended one and an over-limit one are refused neutrally, with the true reason audited", async () => {
    for (const [o, reason] of [
      [{ profile: { roles: ["super_admin"], account_status: "active" } }, "owner_target"],
      [{ profile: { roles: ["nurse"], account_status: "suspended" } }, "suspended"],
      [{ reservation: "target_limited" }, "target_rate_limited"],
      [{ user: null }, "unknown_target"],
    ] as const) {
      const admin = fakeAdmin(o as any);
      const r = await requestAdminReset(admin, actor, TARGET);
      expect(r).toEqual({ status: 202, body: { ok: true, message: NEUTRAL_MESSAGE } });
      expect(admin.sends).toHaveLength(0);
      expect(admin.audit.at(-1).new_value).toEqual({ reason });
    }
  });

  it("a refused send logs the reason without the address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = fakeAdmin({ sendError: true });
    expect((await requestAdminReset(admin, actor, TARGET)).body).toEqual({ ok: true, message: NEUTRAL_MESSAGE });
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/person@example.test/);
    warn.mockRestore();
  });

  it("the administrator limit answers 429 and sends nothing", async () => {
    const admin = fakeAdmin({ reservation: "actor_limited" });
    expect((await requestAdminReset(admin, actor, TARGET)).status).toBe(429);
    expect(admin.sends).toHaveLength(0);
  });

  it("a limit that cannot be applied refuses (503) and never sends unmetered", async () => {
    for (const o of [{ rpcError: true }, { reservation: "something_else" }]) {
      const admin = fakeAdmin(o);
      expect((await requestAdminReset(admin, actor, TARGET)).status).toBe(503);
      expect(admin.sends).toHaveLength(0);
    }
  });
});
