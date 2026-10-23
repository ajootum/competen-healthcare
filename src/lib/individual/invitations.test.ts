/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import {
  validateInvitation, inviteDeliveryMode, isRefusal, createIndividualInvitation, acceptIndividualInvitation, revokeIndividualInvitation,
  INVITE_DEFAULT_DAYS,
} from "./invitations";

// COMPETEN-IND-ACCESS-001 (invitations), migration 378. The refusals that decide before anything is created,
// and the delivery mode that must never return a link outside a local dev server against non-production.

const STAGING = "https://ezhvpgtcqcdsgylrxgdb.supabase.co";

/** A query builder that answers every chain with the result registered for its table. */
function stub(tables: Record<string, { data: any; error: any }>, auth: Record<string, any> = {}) {
  const calls: string[] = [];
  const from = (t: string) => {
    const res = tables[t] ?? { data: null, error: null };
    const b: any = {};
    for (const m of ["select", "eq", "ilike", "order", "limit", "insert", "update", "single", "maybeSingle", "in", "is"]) b[m] = () => { calls.push(`${t}.${m}`); return b; };
    b.then = (ok: any, ko: any) => Promise.resolve(res).then(ok, ko);
    return b;
  };
  return { admin: { from, auth: { admin: auth, ...auth } } as any, calls };
}

describe("validateInvitation", () => {
  const base = { email: "  New.Person@Example.ORG ", experiences: ["professional"] };
  it("normalises the email and defaults the invitation to 14 days", () => {
    const r = validateInvitation(base);
    expect(isRefusal(r)).toBe(false);
    if (!isRefusal(r)) { expect(r.email).toBe("new.person@example.org"); expect(r.expiresInDays).toBe(INVITE_DEFAULT_DAYS); expect(r.endsAt).toBeNull(); }
  });
  it("D8: Scholar without the 18+ confirmation is refused", () => {
    const r = validateInvitation({ ...base, experiences: ["scholar"] });
    expect(isRefusal(r) && r.code).toBe("AGE_ELIGIBILITY_REQUIRED");
  });
  it("refuses unknown experiences, a bad email, a bad end date and an invitation window outside 1-30 days", () => {
    for (const body of [{ ...base, experiences: ["enterprise"] }, { ...base, experiences: [] }, { ...base, email: "nope" },
      { ...base, endsOn: "soon" }, { ...base, expiresInDays: 0 }, { ...base, expiresInDays: 31 }, { ...base, expiresInDays: 2.5 }])
      expect(isRefusal(validateInvitation(body))).toBe(true);
  });
});

describe("inviteDeliveryMode -- the test link mode is fenced three ways", () => {
  it("returns 'link' only when asked, under next dev, against an identifiable non-production project", () => {
    expect(inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: STAGING })).toBe("link");
    expect(inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: STAGING })).toBe("email");
    expect(inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://rnnqhlrcgvsauigxwszl.supabase.co" })).toBe("email");
    expect(inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "development" })).toBe("email");
    expect(inviteDeliveryMode({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: STAGING })).toBe("email");
  });
});

describe("createIndividualInvitation -- refusals decided before any identity exists", () => {
  const req = validateInvitation({ email: "a@example.org", experiences: ["professional"] }) as any;
  const opts = { origin: "https://staging.example", delivery: "email" as const };

  it("absent table (migration 378 not applied) is 'not set up', and nothing is created", async () => {
    const invite = vi.fn();
    const { admin } = stub({ individual_invitation: { data: null, error: { code: "PGRST205" } } }, { inviteUserByEmail: invite });
    const r = await createIndividualInvitation(admin, req, { id: "inviter" }, opts);
    expect(isRefusal(r) && r.code).toBe("NOT_SET_UP");
    expect(invite).not.toHaveBeenCalled();
  });

  it("a live invitation for the email is refused as pending", async () => {
    const invite = vi.fn();
    const { admin } = stub({ individual_invitation: { data: [{ id: "i1", status: "PENDING" }], error: null }, individual_live_invitation: { data: [{ id: "i1" }], error: null } }, { inviteUserByEmail: invite });
    const r = await createIndividualInvitation(admin, req, { id: "inviter" }, opts);
    expect(isRefusal(r) && r.code).toBe("INVITATION_PENDING");
    expect(invite).not.toHaveBeenCalled();
  });

  it("an expired, still-pending invitation must be revoked first", async () => {
    const { admin } = stub({ individual_invitation: { data: [{ id: "i1", status: "PENDING" }], error: null }, individual_live_invitation: { data: [], error: null } });
    const r = await createIndividualInvitation(admin, req, { id: "inviter" }, opts);
    expect(isRefusal(r) && r.code).toBe("INVITATION_EXPIRED_PENDING");
  });

  it("an existing account goes to the grant path -- never a second identity", async () => {
    const invite = vi.fn();
    const { admin } = stub({ individual_invitation: { data: [], error: null }, profiles: { data: [{ id: "p1" }], error: null } },
      { inviteUserByEmail: invite, getUserById: async () => ({ data: { user: { id: "p1", last_sign_in_at: "2026-10-01T00:00:00Z" } }, error: null }) });
    const r = await createIndividualInvitation(admin, req, { id: "inviter" }, opts);
    expect(isRefusal(r) && r.code).toBe("ACCOUNT_EXISTS");
    expect(isRefusal(r) && r.personId).toBe("p1");
    expect(invite).not.toHaveBeenCalled();
  });

  it("the link is never in the outcome under email delivery", async () => {
    const { admin } = stub({ individual_invitation: { data: { id: "inv", expires_at: "2026-11-06T00:00:00Z" }, error: null }, profiles: { data: [], error: null } },
      { inviteUserByEmail: async () => ({ data: { user: { id: "new" } }, error: null }) });
    // the pending check reads the same table: an object (not an array) is "no pending rows" for this stub
    const r = await createIndividualInvitation(admin, req, { id: "inviter" }, opts);
    expect(isRefusal(r)).toBe(false);
    expect((r as any).testLink).toBeUndefined();
    expect((r as any).delivery).toBe("email");
  });
});

describe("acceptIndividualInvitation", () => {
  it("no live invitation for this identity is refused", async () => {
    const { admin } = stub({ individual_live_invitation: { data: [], error: null } });
    const r = await acceptIndividualInvitation(admin, { id: "u", email: "a@example.org", emailConfirmedAt: "x" });
    expect(isRefusal(r) && r.code).toBe("NO_INVITATION");
  });
  it("an unconfirmed or mismatched email is refused before anything is granted", async () => {
    const live = { data: [{ id: "i", invited_email: "a@example.org", invite_scholar: false, invite_professional: true, created_by: "inviter" }], error: null };
    for (const user of [{ id: "u", email: "a@example.org", emailConfirmedAt: null }, { id: "u", email: "b@example.org", emailConfirmedAt: "x" }]) {
      const { admin, calls } = stub({ individual_live_invitation: live });
      const r = await acceptIndividualInvitation(admin, user);
      expect(isRefusal(r) && r.code).toBe("EMAIL_NOT_CONFIRMED");
      expect(calls.some(c => c.startsWith("individual_membership") || c.startsWith("individual_entitlement"))).toBe(false);
    }
  });
});

describe("revokeIndividualInvitation", () => {
  it("requires a reason of at least 8 characters", async () => {
    const { admin } = stub({});
    const r = await revokeIndividualInvitation(admin, "00000000-0000-4000-8000-000000000001", "actor", "no");
    expect(isRefusal(r) && r.code).toBe("REASON_REQUIRED");
  });
});
