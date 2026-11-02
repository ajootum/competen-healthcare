import { describe, it, expect } from "vitest";
import { isAbsent, isParticipationCategory, loadParticipations, parseParticipationRequest } from "./account-participation";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const fake = (result: { data?: unknown; error?: { code?: string } | null }) => ({
  from: () => ({ select: () => ({ limit: async () => ({ data: result.data ?? null, error: result.error ?? null }) }) }),
});

describe("participation categories", () => {
  it("are Regular, Pilot and Staff tester, and nothing else", () => {
    expect(isParticipationCategory("pilot")).toBe(true);
    expect(isParticipationCategory("vip")).toBe(false);
    expect(isParticipationCategory(undefined)).toBe(false);
  });
});

describe("a table or column that is not there yet is not an error", () => {
  it("recognises the migration-not-applied codes", () => {
    for (const code of ["42P01", "42703", "PGRST204", "PGRST205"]) expect(isAbsent({ code })).toBe(true);
    expect(isAbsent({ code: "42501" })).toBe(false);
    expect(isAbsent(null)).toBe(false);
  });
  it("loadParticipations: absent table is unavailable (the filter hides), with no rows", async () => {
    const r = await loadParticipations(fake({ error: { code: "42P01" } }));
    expect(r.available).toBe(false);
    expect(r.byId.size).toBe(0);
  });
  it("loadParticipations: reads rows, ignoring a category it does not know", async () => {
    const r = await loadParticipations(fake({ data: [
      { user_id: "a", category: "pilot", cohort_code: "C1", valid_until: null },
      { user_id: "b", category: "bogus", cohort_code: null, valid_until: null },
    ] }));
    expect(r.available).toBe(true);
    expect([...r.byId.keys()]).toEqual(["a"]);
  });
  it("loadParticipations: a thrown read is unavailable, never a crash", async () => {
    const r = await loadParticipations({ from: () => { throw new Error("boom"); } });
    expect(r.available).toBe(false);
  });
});

describe("parseParticipationRequest", () => {
  const ok = { userId: ID, category: "pilot", reason: "  Joined the March   cohort " };
  it("accepts a person, a category and a reason, and tidies the reason", () => {
    expect(parseParticipationRequest(ok)).toEqual({ ok: true, req: { userId: ID, category: "pilot", reason: "Joined the March cohort", cohort: null, validUntil: null } });
  });
  it("needs a real person, a known category and a reason", () => {
    expect(parseParticipationRequest({ ...ok, userId: "nope" }).ok).toBe(false);
    expect(parseParticipationRequest({ ...ok, category: "vip" }).ok).toBe(false);
    expect(parseParticipationRequest({ ...ok, reason: "   " }).ok).toBe(false);
    expect(parseParticipationRequest(null).ok).toBe(false);
  });
  it("limits the reason, the cohort and checks the end date", () => {
    expect(parseParticipationRequest({ ...ok, reason: "x".repeat(601) }).ok).toBe(false);
    expect(parseParticipationRequest({ ...ok, cohort: "x".repeat(61) }).ok).toBe(false);
    expect(parseParticipationRequest({ ...ok, validUntil: "not a date" }).ok).toBe(false);
    const r = parseParticipationRequest({ ...ok, cohort: " C1 ", validUntil: "2027-01-31T23:59:59Z" });
    expect(r).toMatchObject({ ok: true, req: { cohort: "C1", validUntil: "2027-01-31T23:59:59.000Z" } });
  });
});
