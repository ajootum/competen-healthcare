/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { parseProfilePatch, readOwnProfile, readOwnHqPositions } from "./own-profile";

// Owner GO 2026-10-23, PR D -- My profile. The self-update allowlist, the names that are never inferred,
// and the access view that never turns a failed read into "none".

describe("self-update fields", () => {
  it("accepts only the personal fields, cleaned", () => {
    expect(parseProfilePatch({ full_name: "  Amina   Okello ", phone: "+256 700 000000", country: "Uganda", specialization: "" }))
      .toEqual({ ok: true, patch: { full_name: "Amina Okello", phone: "+256 700 000000", country: "Uganda", specialization: null } });
  });

  it("⚠ never carries an authority field or the email, whatever the body says", () => {
    const r = parseProfilePatch({ full_name: "Amina", role: "super_admin", roles: ["super_admin"], platform_role: "owner",
      hospital_id: "h", account_status: "active", email: "x@example.test", is_senior_assessor: true });
    expect(r).toEqual({ ok: true, patch: { full_name: "Amina" } });
  });

  it("refuses an empty full name, a non-text value and an over-long field", () => {
    expect(parseProfilePatch({ full_name: "   " })).toMatchObject({ ok: false });
    expect(parseProfilePatch({ phone: 12345 })).toMatchObject({ ok: false });
    expect(parseProfilePatch({ country: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(parseProfilePatch({ role: "super_admin" })).toEqual({ ok: false, error: "Nothing to update." });
  });

  it("takes given and family names as typed -- optional, blank means not recorded", () => {
    expect(parseProfilePatch({ given_name: " Amina ", family_name: "" }))
      .toEqual({ ok: true, patch: { given_name: "Amina", family_name: null } });
  });

  it("⚠ never derives a given or family name from the full name", () => {
    const r = parseProfilePatch({ full_name: "Amina Okello" });
    expect(r).toEqual({ ok: true, patch: { full_name: "Amina Okello" } });
  });
});

/** A fake client: `from(t).select(cols).eq().maybeSingle()` answers by the selected columns. */
const fakeDb = (answers: Record<string, { data: any; error: any }>) => ({
  from: () => ({
    select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => answers[cols] ?? { data: null, error: null } }) }),
  }),
});

describe("own profile", () => {
  const user = { id: "u1", email: "amina@example.test", new_email: "new@example.test" };
  const base = { data: { full_name: "Amina Okello", phone: null, country: "Uganda", specialization: null }, error: null };

  it("reads the email from Auth, with the pending change, never from the profile row", async () => {
    const r = await readOwnProfile(fakeDb({ "full_name, phone, country, specialization": base, "given_name, family_name": { data: { given_name: null, family_name: null }, error: null } }), user);
    expect(r).toMatchObject({ ok: true, value: { email: { current: "amina@example.test", pending: "new@example.test" }, phone: null } });
  });

  it("⚠ reports the 380 names as unsupported where the columns do not exist, and still shows the rest", async () => {
    const r = await readOwnProfile(fakeDb({ "full_name, phone, country, specialization": base, "given_name, family_name": { data: null, error: { code: "42703" } } }), user);
    expect(r).toMatchObject({ ok: true, value: { fullName: "Amina Okello", names: { supported: false } } });
  });

  it("a failed profile read is unreadable, not an empty profile", async () => {
    const r = await readOwnProfile(fakeDb({ "full_name, phone, country, specialization": { data: null, error: { message: "down" } } }), user);
    expect(r).toEqual({ ok: false, error: "down" });
  });
});

describe("HQ positions in 'Your access'", () => {
  const admin = (offices: any, appts: any, pos: any = { data: [] }) => ({
    from: (t: string) => ({
      select: () => {
        if (t === "ogs_offices") return { limit: async () => offices };
        if (t === "hq_position") return { in: async () => pos };
        return { in: () => ({ eq: () => ({ limit: async () => appts }) }) };
      },
    }),
  });

  it("names the positions held through an access-granting appointment only", async () => {
    const r = await readOwnHqPositions(admin(
      { data: [{ id: "o1", office_type: "hq_executive", is_active: true, status: "active" }], error: null },
      { data: [{ role: "ceo", status: "active" }, { role: "cfo", status: "suspended" }], error: null },
      { data: [{ code: "ceo", name: "Chief Executive" }] },
    ), "u1");
    expect(r).toEqual({ ok: true, value: ["Chief Executive"] });
  });

  it("⚠ a failed read is unreadable, never 'none'", async () => {
    expect(await readOwnHqPositions(admin({ data: null, error: { message: "denied" } }, null), "u1")).toEqual({ ok: false, error: "denied" });
    expect(await readOwnHqPositions(admin(
      { data: [{ id: "o1", office_type: "hq_executive", is_active: true, status: "active" }], error: null },
      { data: null, error: { message: "denied" } },
    ), "u1")).toEqual({ ok: false, error: "denied" });
  });
});
