/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { recordInviteeDetails } from "./invitee-record";
import { NO_DETAILS, type PersonDetails } from "./person-details";

// What HQ records about a person it just invited (migration 850). Best effort, only onto an identity the invitation
// created, and fail closed while 850 is absent.

type Err = { code: string } | null;
function fake(opts: { middleAbsent?: boolean; participationAbsent?: boolean } = {}) {
  const log: { t: string; op: string; row: any }[] = [];
  const from = (t: string) => {
    let row: any = null;
    const b: any = {};
    b.update = (r: any) => { row = r; return b; };
    b.eq = () => {
      let error: Err = null;
      if (t === "profiles" && opts.middleAbsent && "middle_names" in row) error = { code: "42703" };
      log.push({ t, op: "update", row });
      return Promise.resolve({ error });
    };
    b.upsert = (r: any) => {
      log.push({ t, op: "upsert", row: r });
      return Promise.resolve({ error: t === "hq_account_participation" && opts.participationAbsent ? { code: "PGRST205" } : null });
    };
    return b;
  };
  return { admin: { from } as any, log };
}
const details: PersonDetails = { ...NO_DETAILS, givenName: "Amina", middleNames: "Grace", familyName: "Okello", preferredName: "Mina", phone: "+256 700 000000", country: "Uganda" };
const p = { authUserId: "new", reusedIdentity: false, details, participation: "pilot" as const, inviterId: "inviter" };

describe("recordInviteeDetails", () => {
  it("writes the parts, composed full name, phone, country, preferred name and participation for a NEW identity", async () => {
    const f = fake();
    const r = await recordInviteeDetails(f.admin, p);
    expect(f.log.find(l => l.t === "profiles")?.row).toEqual({ full_name: "Amina Grace Okello", phone: "+256 700 000000", country: "Uganda", given_name: "Amina", family_name: "Okello", middle_names: "Grace" });
    expect(f.log.find(l => l.t === "individual_identity_profile")?.row).toEqual({ user_id: "new", preferred_name: "Mina" });
    expect(f.log.find(l => l.t === "hq_account_participation")?.row).toMatchObject({ user_id: "new", category: "pilot", reason: "Set at invitation", set_by: "inviter" });
    expect(r).toMatchObject({ details: "set", preferredName: "set", participation: { category: "pilot", status: "set" }, warnings: [] });
  });

  it("writes NOTHING to profiles or the identity profile for a reused identity, only the participation label", async () => {
    const f = fake();
    const r = await recordInviteeDetails(f.admin, { ...p, reusedIdentity: true });
    expect(f.log.map(l => l.t)).toEqual(["hq_account_participation"]);
    expect(r.preferredName).toBe("skipped");
  });

  it("⚠ middle_names absent (850 not applied): retried without it, the rest is saved, and it says so", async () => {
    const f = fake({ middleAbsent: true });
    const r = await recordInviteeDetails(f.admin, p);
    const writes = f.log.filter(l => l.t === "profiles").map(l => l.row);
    expect(writes).toHaveLength(2);
    expect("middle_names" in writes[1]).toBe(false);
    expect(writes[1]).toMatchObject({ given_name: "Amina", family_name: "Okello" });
    expect(r.details).toBe("partial");
    expect(r.warnings.join(" ")).toMatch(/not available/);
  });

  it("⚠ the participation table absent: skipped and reported as not set up, never thrown", async () => {
    const f = fake({ participationAbsent: true });
    const r = await recordInviteeDetails(f.admin, p);
    expect(r.participation.status).toBe("not_set_up");
    expect(r.warnings.join(" ")).toMatch(/not set up/);
  });

  it("⚠ with no details at all the only profile write is country null (the database defaults it to Kenya), then the label", async () => {
    const f = fake();
    const r = await recordInviteeDetails(f.admin, { ...p, details: NO_DETAILS });
    expect(f.log.map(l => l.t)).toEqual(["profiles", "hq_account_participation"]);
    expect(f.log.find(l => l.t === "profiles")?.row).toEqual({ country: null });
    expect(r.details).toBe("none");
    expect(r.warnings).toEqual([]);
  });
});
