import { describe, expect, it } from "vitest";
import { GIVEN_NAME_NOT_STORED, personDetails, readFail, readOk, toHolder } from "./appointments";

// The HQ appointment board shows who is appointed where: full name, email and phone for every holder
// (owner request, 2026-10-23). These pin the holder mapping, including every missing-value state.

type Profile = { id: string; full_name: string | null; email: string | null; phone: string | null };
const profiles = (...rows: Profile[]) => readOk(new Map(rows.map(r => [r.id, r])));
const appt = (over: Partial<Parameters<typeof toHolder>[0]> = {}) => ({
  id: "a1", office_id: "o1", person_id: "p1", person_name: "Okaisu Mullen", role: "ceo", status: "active",
  term_start: "2026-08-10", term_end: null, scope: null, appointed_by: "Owner", created_at: "2026-08-10T00:00:00Z",
  ...over,
});

describe("holder details", () => {
  it("carries full name, email and phone from the appointed person's profile", () => {
    const h = toHolder(appt(), profiles({ id: "p1", full_name: "Okaisu Mullen", email: "okaisu@example.test", phone: "+256 700 000000" }));
    expect(h.person).toEqual({ state: "found", fullName: "Okaisu Mullen", email: "okaisu@example.test", phone: "+256 700 000000" });
    expect(h).toMatchObject({ appointmentId: "a1", personId: "p1", status: "active", grantsAccess: true });
  });

  it("⚠ keeps a missing or blank field as null, which the board renders 'Not recorded' -- never an empty string", () => {
    expect(personDetails("p1", profiles({ id: "p1", full_name: "Okaisu Mullen", email: null, phone: "   " })))
      .toEqual({ state: "found", fullName: "Okaisu Mullen", email: null, phone: null });
    expect(personDetails("p1", profiles({ id: "p1", full_name: "", email: null, phone: null })))
      .toEqual({ state: "found", fullName: null, email: null, phone: null });
  });

  it("says there is no profile when the appointment names nobody, or somebody with no profile row", () => {
    expect(toHolder(appt({ person_id: null }), profiles()).person).toEqual({ state: "no_profile" });
    expect(toHolder(appt({ person_id: "ghost" }), profiles({ id: "p1", full_name: "X", email: null, phone: null })).person).toEqual({ state: "no_profile" });
  });

  it("⚠ a failed profiles read is UNREADABLE, never 'not recorded', and the holder is still on the roster", () => {
    const h = toHolder(appt(), readFail("permission denied"));
    expect(h.person).toEqual({ state: "unreadable", error: "permission denied" });
    expect(h.personName).toBe("Okaisu Mullen");
  });

  it("never reads another person's profile into this holder", () => {
    const h = toHolder(appt({ person_id: "p2" }), profiles(
      { id: "p1", full_name: "Okaisu Mullen", email: "okaisu@example.test", phone: null },
      { id: "p2", full_name: "Second Holder", email: "second@example.test", phone: null },
    ));
    expect(h.person).toMatchObject({ fullName: "Second Holder", email: "second@example.test" });
  });

  it("states that the given name is not stored separately, rather than splitting the full name", () => {
    expect(GIVEN_NAME_NOT_STORED).toMatch(/not stored separately/i);
  });
});
