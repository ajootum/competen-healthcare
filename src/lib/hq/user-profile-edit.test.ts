import { describe, expect, it } from "vitest";
import { planProfileEdit, recomposedFullName } from "./user-profile-edit";

// PATCH /api/super-admin/users/profile -- the pure planning: allowlist, compare-and-set inputs, recomposition.

const ID = "00000000-0000-4000-8000-000000000001";

describe("planProfileEdit", () => {
  it("plans only the fields that differ from what the editor saw", () => {
    const r = planProfileEdit({ userId: ID, fields: { given_name: "Amina", phone: "+256 700 000000" }, expected: { given_name: null, phone: "+256 700 000000" } });
    expect(r).toEqual({ ok: true, plan: { userId: ID, changes: { given_name: "Amina" }, expected: { given_name: null }, preferredName: undefined } });
  });
  it("requires the value the editor saw for every field it changes", () => {
    expect(planProfileEdit({ userId: ID, fields: { given_name: "Amina" }, expected: {} })).toMatchObject({ ok: false, code: "EXPECTED_REQUIRED" });
  });
  it("never writes email, a role or a tenancy column, whatever the body says", () => {
    for (const key of ["email", "role", "roles", "organisation_id", "hospital_id", "account_status", "platform_role"])
      expect(planProfileEdit({ userId: ID, fields: { [key]: "x" }, expected: { [key]: null } })).toMatchObject({ ok: false, code: "FIELD_NOT_ALLOWED" });
  });
  it("applies the own-profile rules (limits, blank full name, phone)", () => {
    expect(planProfileEdit({ userId: ID, fields: { family_name: "x".repeat(101) }, expected: { family_name: null } })).toMatchObject({ ok: false });
    expect(planProfileEdit({ userId: ID, fields: { full_name: "  " }, expected: { full_name: "Old" } })).toMatchObject({ ok: false });
    expect(planProfileEdit({ userId: ID, fields: { phone: "abc" }, expected: { phone: null } })).toMatchObject({ ok: false });
  });
  it("a blank optional field is a change to null", () => {
    expect(planProfileEdit({ userId: ID, fields: { country: " " }, expected: { country: "Uganda" } }))
      .toMatchObject({ ok: true, plan: { changes: { country: null }, expected: { country: "Uganda" } } });
  });
  it("refuses a bad user id and nothing to update", () => {
    expect(planProfileEdit({ userId: "x", fields: { phone: "+256 700" }, expected: { phone: null } })).toMatchObject({ ok: false });
    expect(planProfileEdit({ userId: ID, fields: { phone: "+256 700" }, expected: { phone: "+256 700" } })).toEqual({ ok: false, status: 400, code: "VALIDATION_ERROR", error: "Nothing to update." });
  });
  it("carries a preferred name request separately from the compare-and-set fields", () => {
    expect(planProfileEdit({ userId: ID, fields: { preferred_name: " Mina " } })).toMatchObject({ ok: true, plan: { changes: {}, preferredName: "Mina" } });
    expect(planProfileEdit({ userId: ID, fields: { preferred_name: "x".repeat(81) } })).toMatchObject({ ok: false });
  });
});

describe("recomposedFullName", () => {
  const current = { full_name: "Amina Okello", given_name: "Amina", middle_names: null, family_name: "Okello" };
  it("recomposes from the parts as they will stand when a part changes", () => {
    expect(recomposedFullName(current, { middle_names: "Grace" })).toBe("Amina Grace Okello");
    expect(recomposedFullName(current, { family_name: "Atim" })).toBe("Amina Atim");
  });
  it("leaves the full name alone when the editor supplied one, or no part changed", () => {
    expect(recomposedFullName(current, { full_name: "Dr Amina Okello", given_name: "Amina B" })).toBeNull();
    expect(recomposedFullName(current, { phone: "+256 700" })).toBeNull();
  });
  it("never blanks a display name: clearing every part keeps the full name", () => {
    expect(recomposedFullName(current, { given_name: null, family_name: null })).toBeNull();
  });
  it("does not split a full name: with no recorded parts it only ever composes what was typed", () => {
    const legacy = { full_name: "Amina Grace Okello", given_name: null, middle_names: null, family_name: null };
    expect(recomposedFullName(legacy, { given_name: "Amina" })).toBeNull();
    expect(recomposedFullName(legacy, { given_name: "Amina", family_name: "Okello" })).toBe("Amina Okello");
  });
});
