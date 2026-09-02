/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The relationship vocabulary, pinned across every place that holds a copy of it (migration 364).
 *
 * ⚠ WHY THIS FILE EXISTS. Adding 'parent' and 'other_relative' meant touching six things: two database
 * CHECK constraints, the canonical list, the booking intake's list, the patient-facing subset, and the
 * guardian-authority set -- plus a hand-written duplicate inside RegistrationForm.tsx that nothing
 * would have failed over. That is a change where the danger is not the code you write but the copy you
 * forget, and the symptom is silent: a form offering fifteen options while another offers seventeen.
 *
 * So these tests assert AGREEMENT rather than content. They fail when the lists drift apart, which is
 * the only way this can go wrong.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { RELATIONSHIP_TYPES, GUARDIAN_TYPES } from "./relationships-constants";
import { REPRESENTATIVE_RELATIONSHIPS, PATIENT_RELATIONSHIPS } from "./booking-rule-constants";
import { RELATIONSHIP_OPTIONS } from "@/app/practice/(shell)/patients/RegistrationForm";

const canonical = RELATIONSHIP_TYPES.map(([k]) => k as string);

describe("the relationship vocabulary agrees with itself", () => {
  it("carries the two values migration 364 added", () => {
    expect(canonical).toContain("parent");
    expect(canonical).toContain("other_relative");
  });

  it("the booking intake's list is the same set as the canonical one", () => {
    // ⚠ SET EQUALITY, NOT LENGTH. Two lists of seventeen that disagree about one value would pass a
    // count and fail a patient.
    expect([...REPRESENTATIVE_RELATIONSHIPS].sort()).toEqual([...canonical].sort());
  });

  it("the patient registration form offers exactly the canonical values", () => {
    // This was a hand-written duplicate until migration 364. It is now derived, and this is the test
    // that keeps it derived.
    expect(RELATIONSHIP_OPTIONS.map(([k]) => k).sort()).toEqual([...canonical].sort());
  });

  it("every value a patient is offered is one the database accepts", () => {
    // ⚠ THE ONE THAT WOULD FAIL ON SUBMIT. A patient-facing option outside the canonical vocabulary is
    // a form whose answer the CHECK constraint refuses, and the refusal lands on the patient.
    for (const { value } of PATIENT_RELATIONSHIPS) expect(canonical).toContain(value);
  });

  it("every value has a label, and no label is a raw key", () => {
    for (const [key, label] of RELATIONSHIP_TYPES) {
      expect(label.length).toBeGreaterThan(1);
      expect(label).not.toBe(key);
      expect(label).not.toMatch(/_/);
    }
  });
});

describe("who may hold legal authority (s8.3, s8.4)", () => {
  it("includes 'parent', because a parent holds what a mother or father holds", () => {
    // Leaving it out would mean a minor with a recorded parent reading as having NO guardian.
    expect(GUARDIAN_TYPES.has("parent")).toBe(true);
    expect(GUARDIAN_TYPES.has("mother")).toBe(true);
    expect(GUARDIAN_TYPES.has("father")).toBe(true);
  });

  it("excludes 'other_relative' -- a relative is not thereby a legal guardian", () => {
    // s8.4: "do not imply verified legal status". s8.3: "Do not infer legal guardianship merely from
    // relationship selection."
    expect(GUARDIAN_TYPES.has("other_relative")).toBe(false);
  });

  it("excludes the administrative roles entirely", () => {
    for (const role of ["interpreter", "employer", "insurance_contact", "emergency_contact"])
      expect(GUARDIAN_TYPES.has(role)).toBe(false);
  });

  it("names only values that exist in the vocabulary", () => {
    for (const t of GUARDIAN_TYPES) expect(canonical).toContain(t);
  });
});

describe("the patient-facing subset (s8.4/AC-11)", () => {
  it("offers family and care relationships, and no administrative roles", () => {
    const offered = PATIENT_RELATIONSHIPS.map(p => p.value);
    for (const kept of ["mother", "father", "parent", "guardian", "other_relative", "carer"])
      expect(offered).toContain(kept);
    for (const dropped of ["interpreter", "employer", "insurance_contact", "social_worker", "emergency_contact"])
      expect(offered).not.toContain(dropped);
  });

  it("is a strict subset -- it never invents a value of its own", () => {
    expect(PATIENT_RELATIONSHIPS.length).toBeLessThan(canonical.length);
  });
});
