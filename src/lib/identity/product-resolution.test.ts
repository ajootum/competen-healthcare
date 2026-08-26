import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveProductDestinations } from "@/lib/identity/product-resolution";

// ⚠ WHY THIS FILE EXISTS: NOTHING EXECUTED THIS RESOLVER, and a real defect lived in it for nine days.
//
// access-doors-harness "covers" product-resolution.ts with a STRING check --
// `readFileSync("src/lib/identity/product-resolution.ts").includes('href: "/dashboard"')` -- which
// passes whatever the function does, as long as that literal is somewhere in the file. It was green
// throughout. The defect was that the Platform destination was offered whenever a `profiles` row
// existed, while /dashboard admits on `platform_membership`: one live account was shown a "Competen
// Platform" card that bounced it straight back to /practice/home.
//
// A test that reads source text tests the source text. These execute the function.
//
// Vitest rather than a harness because this is unit-level branch logic (TESTING.md's own taxonomy) and
// because Vitest runs on every push, while most harnesses are local-only.

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock("@/lib/platform-membership", () => ({
  admitToEstate: vi.fn(),
  NO_MEMBERSHIP_DESTINATION: "/practice/home",
}));
import { admitToEstate } from "@/lib/platform-membership";

/** PostgREST stand-in: one canned answer per table, thenable at the end of any chain. */
function stub(byTable: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const result = byTable[table] ?? { data: null, error: null };
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: any) => res(result);
          return () => chain;
        },
      });
      return chain;
    },
  };
}

const PROFILE = { data: { id: "u1", role: null, roles: [] }, error: null };
const NO_PROFILE = { data: null, error: null };
const NO_PRACTICE = { data: [], error: null };
const PRACTICE = { data: [{ id: "m1", workspace_id: "w1", status: "active" }], error: null };
const READ_FAILED = { data: null, error: { message: "timeout" } };

const admits = (yes: boolean) =>
  (admitToEstate as any).mockResolvedValue({ admitted: yes, membership: yes ? "member" : "not_member", reason: "" });

beforeEach(() => vi.clearAllMocks());

describe("resolveProductDestinations", () => {
  it("offers Platform when the estate ADMITS, not merely because a profile exists", async () => {
    admits(true);
    const r: any = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: NO_PRACTICE }), "u1");
    expect(r.state).toBe("one");
    expect(r.destination.code).toBe("platform");
  });

  // ⚠ THE REGRESSION. A profiles row exists -- it exists for EVERY authenticated person, created by the
  // on_auth_user_created trigger -- but the estate refuses. Platform must not be offered. Before the fix
  // this returned "many" and the person was handed a card that bounced.
  it("does NOT offer Platform when the estate refuses, even though a profile row exists", async () => {
    admits(false);
    const r: any = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: PRACTICE }), "u1");
    expect(r.state).toBe("one");
    expect(r.destination.code).toBe("practice");
  });

  it("renders the chooser only when BOTH entitlements are real", async () => {
    admits(true);
    const r: any = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: PRACTICE }), "u1");
    expect(r.state).toBe("many");
    expect(r.destinations.map((d: any) => d.code)).toEqual(["platform", "practice"]);
  });

  // ⚠ THE STATE THAT COULD NOT PREVIOUSLY HAPPEN. Every account had a profiles row, so `none` was
  // unreachable without deleting one. Identity without entitlement now resolves to it -- which is
  // exactly what a newly created account is until somebody grants it access.
  it("resolves to none for an identity holding no entitlement at all", async () => {
    admits(false);
    const r: any = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: NO_PRACTICE }), "u1");
    expect(r.state).toBe("none");
  });

  it("still resolves none when there is no profile row either", async () => {
    admits(false);
    const r: any = await resolveProductDestinations(stub({ profiles: NO_PROFILE, practice_membership: NO_PRACTICE }), "u1");
    expect(r.state).toBe("none");
  });

  // A failed READ is not "no access". Inferring either way is the one forbidden move (s3, s11).
  it("fails closed to unavailable when the profile read errors", async () => {
    admits(true);
    const r: any = await resolveProductDestinations(stub({ profiles: READ_FAILED, practice_membership: NO_PRACTICE }), "u1");
    expect(r.state).toBe("unavailable");
  });

  it("fails closed to unavailable when the practice read errors", async () => {
    admits(true);
    const r: any = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: READ_FAILED }), "u1");
    expect(r.state).toBe("unavailable");
  });

  // REVOKED and SUSPENDED are not access. The filter is the only thing standing between a withdrawn
  // membership and a live product card.
  it.each(["REVOKED", "SUSPENDED"])("does not count a %s practice membership", async status => {
    admits(false);
    const r: any = await resolveProductDestinations(
      stub({ profiles: PROFILE, practice_membership: { data: [{ id: "m1", workspace_id: "w1", status }], error: null } }),
      "u1",
    );
    expect(r.state).toBe("none");
  });

  // ⚠ THE RESOLVER MUST INHERIT THE ESTATE'S FAIL-OPEN, NOT INVENT ITS OWN POSTURE. An unreadable
  // membership store ADMITS and falls back to the role gate, deliberately, so an outage does not blank
  // the estate for everyone. If this side failed closed while the destination failed open, the estate
  // would be hidden from people who can in fact enter it.
  it("offers Platform when the membership store is unreadable, matching the destination", async () => {
    (admitToEstate as any).mockResolvedValue({ admitted: true, membership: "unreadable", reason: "store_unreadable" });
    const r: any = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: NO_PRACTICE }), "u1");
    expect(r.state).toBe("one");
    expect(r.destination.code).toBe("platform");
  });
});
