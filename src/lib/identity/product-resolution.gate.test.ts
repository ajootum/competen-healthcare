import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveProductDestinations } from "@/lib/identity/product-resolution";
import { individualAppEnabled } from "@/lib/individual/gate";

// ── THE INDIVIDUAL RELEASE GATE, AGAINST THE NEUTRAL SIGN-IN RESOLVER ── owner GO, release-gate item 5 ──
//
// The claim this file proves: with Competen Individual's gate OFF (the default -- no flag row, a failed
// flag read, a throwing client), /login's product resolution for Platform and Practice is EXACTLY what it
// was before Individual existed: the individual_membership table is never queried, and every answer in
// the Platform x Practice x estate matrix is unchanged. And with the gate ON but migration 370 absent
// (PostgREST PGRST205, Postgres 42P01), the answers are still those same answers -- quiet, closed, no
// Individual card, never "unavailable".

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock("@/lib/platform-membership", () => ({ admitToEstate: vi.fn(), NO_MEMBERSHIP_DESTINATION: "/practice/home" }));
import { admitToEstate } from "@/lib/platform-membership";

type R = { data: unknown; error: unknown } | "throw";
/** PostgREST stand-in that RECORDS which tables were read. "throw" makes that table's read reject. */
function stub(byTable: Record<string, R>) {
  const reads: string[] = [];
  const admin = {
    from(table: string) {
      reads.push(table);
      const result = byTable[table] ?? { data: null, error: null };
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: any, rej: any) => (result === "throw" ? rej(new Error("network")) : res(result));
          return () => chain;
        },
      });
      return chain;
    },
  };
  return { admin, reads };
}

const ok = (data: unknown) => ({ data, error: null });
const PROFILE = ok({ id: "u1", role: null, roles: [] });
const PRACTICE = { none: ok([]), active: ok([{ id: "m1", workspace_id: "w1", status: "active" }]), revoked: ok([{ id: "m1", workspace_id: "w1", status: "REVOKED" }]), failed: { data: null, error: { message: "timeout" } } };
const ESTATE = { admitted: { admitted: true, membership: "member", reason: "" }, refused: { admitted: false, membership: "not_member", reason: "" }, unreadable: { admitted: true, membership: "unreadable", reason: "store_unreadable" } };
const MISSING_42P01 = { data: null, error: { code: "42P01", message: 'relation "individual_membership" does not exist' } };
const MISSING_PGRST205 = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.individual_membership' in the schema cache" } };
const GATE = { absent: ok(null), off: ok({ enabled: false }), on: ok({ enabled: true }), failed: { data: null, error: { message: "permission denied" } }, thrown: "throw" as const };

beforeEach(() => vi.clearAllMocks());

describe("individualAppEnabled", () => {
  it.each([["absent row", GATE.absent], ["enabled=false", GATE.off], ["a failed read", GATE.failed], ["a throwing client", GATE.thrown]] as const)(
    "is OFF for %s, and never throws", async (_label, gate) => {
      expect(await individualAppEnabled(stub({ practice_platform_flags: gate }).admin)).toBe(false);
    });
  it("is OFF with no client at all", async () => {
    expect(await individualAppEnabled(null)).toBe(false);
  });
  it("is ON only for an enabled row", async () => {
    expect(await individualAppEnabled(stub({ practice_platform_flags: GATE.on }).admin)).toBe(true);
  });
});

describe("resolveProductDestinations with the Individual gate OFF", () => {
  const matrix = (Object.keys(ESTATE) as (keyof typeof ESTATE)[]).flatMap(e =>
    (Object.keys(PRACTICE) as (keyof typeof PRACTICE)[]).map(p => [e, p] as const));

  // ⚠ THE CLAIM. For every gate-off variant, the table is not read -- so a missing table, a member row or a
  // broken read there cannot change anything -- and the answer equals the answer with no Individual at all.
  it.each(matrix)("estate %s x practice %s: individual_membership is never read, and the answer is unchanged", async (e, p) => {
    (admitToEstate as any).mockResolvedValue(ESTATE[e]);
    const baseline = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: PRACTICE[p] }).admin, "u1");
    for (const gate of [GATE.absent, GATE.off, GATE.failed, GATE.thrown]) {
      for (const store of [MISSING_42P01, MISSING_PGRST205, ok({ status: "active" }), { data: null, error: { message: "boom" } }]) {
        const s = stub({ profiles: PROFILE, practice_membership: PRACTICE[p], practice_platform_flags: gate, individual_membership: store });
        const r = await resolveProductDestinations(s.admin, "u1");
        expect(s.reads).not.toContain("individual_membership");
        expect(r).toEqual(baseline);
      }
    }
  });

  it("the baseline itself never offers Individual", async () => {
    (admitToEstate as any).mockResolvedValue(ESTATE.admitted);
    const r: any = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: PRACTICE.active }).admin, "u1");
    expect(JSON.stringify(r)).not.toContain("individual");
  });
});

describe("resolveProductDestinations with the gate ON but migration 370 absent", () => {
  it.each([["42P01", MISSING_42P01], ["PGRST205", MISSING_PGRST205]] as const)(
    "%s: quiet and closed -- the same answer as gate OFF, no Individual card, never unavailable", async (_code, missing) => {
      for (const e of Object.keys(ESTATE) as (keyof typeof ESTATE)[]) {
        for (const p of ["none", "active", "revoked"] as const) {
          (admitToEstate as any).mockResolvedValue(ESTATE[e]);
          const off = await resolveProductDestinations(stub({ profiles: PROFILE, practice_membership: PRACTICE[p] }).admin, "u1");
          const on = await resolveProductDestinations(
            stub({ profiles: PROFILE, practice_membership: PRACTICE[p], practice_platform_flags: GATE.on, individual_membership: missing }).admin, "u1");
          expect(on).toEqual(off);
          expect(JSON.stringify(on)).not.toContain("individual");
        }
      }
    });
});
