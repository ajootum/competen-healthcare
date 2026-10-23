/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));
vi.mock("@/lib/notifications/dispatch", () => ({ dispatch: vi.fn(async () => ({})) }));

import { ACTOR_LIMIT, NEUTRAL_MESSAGE, RESET_SENT, TARGET_LIMIT, decideReset, isSuspended, redactAddresses, requestAdminReset, resetReturnUrl, responseFor, type TargetFacts } from "./user-reset";
import { isAdminInitiated } from "@/lib/auth/recovery-link";

const OK: TargetFacts = { email: "person@example.test", emailVerified: true, isOwnerAccount: false, suspended: false };
const base = { actorId: "a", actorIsOwner: false, targetId: "t", target: OK, sentForTarget: 0, sentByActor: 0 };

describe("decideReset (HQ-USERS-B)", () => {
  it("follows the rule's order", () => {
    expect(decideReset({ ...base, targetId: "a" })).toEqual({ kind: "self" });
    expect(decideReset({ ...base, sentByActor: ACTOR_LIMIT })).toEqual({ kind: "actor_limited" });
    expect(decideReset({ ...base, target: null })).toEqual({ kind: "refuse", reason: "unknown_target" });
    expect(decideReset({ ...base, target: { ...OK, isOwnerAccount: true } })).toEqual({ kind: "refuse", reason: "owner_target" });
    expect(decideReset({ ...base, actorIsOwner: true, target: { ...OK, isOwnerAccount: true } })).toEqual({ kind: "send" });
    expect(decideReset({ ...base, target: { ...OK, suspended: true } })).toEqual({ kind: "refuse", reason: "suspended" });
    expect(decideReset({ ...base, target: { ...OK, emailVerified: false } })).toEqual({ kind: "refuse", reason: "unverified_email" });
    expect(decideReset({ ...base, sentForTarget: TARGET_LIMIT })).toEqual({ kind: "refuse", reason: "target_rate_limited" });
    expect(decideReset({ ...base, sentForTarget: TARGET_LIMIT - 1, sentByActor: ACTOR_LIMIT - 1 })).toEqual({ kind: "send" });
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

function fakeAdmin(opts: { sentForTarget?: number; sentByActor?: number; user?: any; profile?: any; sendError?: boolean } = {}) {
  const audit: any[] = [];
  const sends: any[] = [];
  const admin: any = {
    audit, sends,
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
        then: (res: any) => res(table === "audit_log"
          ? { count: f.entity_id ? (opts.sentForTarget ?? 0) : (opts.sentByActor ?? 0), error: null }
          : { data: null, error: null }),
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
    expect(admin.audit.map((a: any) => a.action)).toEqual(["admin_password_reset_requested", RESET_SENT]);
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
      [{ sentForTarget: 3 }, "target_rate_limited"],
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
    const admin = fakeAdmin({ sentByActor: 20 });
    expect((await requestAdminReset(admin, actor, TARGET)).status).toBe(429);
    expect(admin.sends).toHaveLength(0);
  });
});
