/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-BOOK-FLOW-002 s8/s21 -- the conditional registration rules, pinned by rendering them.
 *
 * The rows of the spec's own test matrix that a render can decide: guardian visibility, DOB/age
 * exclusivity, the referral trigger, the optional-medical collapse, and the curated relationship list.
 * Each is a rule about WHEN a question is shown -- the kind that regresses silently, because a form
 * missing a section still submits and a form showing an extra one still looks fine.
 *
 * ⚠ AND ONE COPY ASSERTION THAT IS WORTH MORE THAN ALL OF THEM. The developer-facing sentences this
 * arc removed were live on a patient's screen for months, and two of them ("Nothing sends to it",
 * "Nothing in this product sends a patient a message") had become false when email was switched on.
 * The last test in this file fails if any of them returns.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import DetailsStep from "./DetailsStep";
import { BOOKING_INTAKE_FIELDS } from "@/lib/practice/booking-rule-constants";

/** The field as the wizard hands it over: the catalogue row plus the server's requirement level. */
const field = (key: string, level: "required" | "optional" = "optional") => {
  const f = BOOKING_INTAKE_FIELDS.find(x => x.field_key === key);
  if (!f) throw new Error(`no such intake field: ${key}`);
  return { ...f, _level: level } as any;
};

const ALL = [
  "given_name", "family_name", "birth_date", "age_years", "sex",
  "contact_phone", "contact_email",
  "representative_name", "representative_relationship", "representative_phone",
  "reason_for_visit", "referral_source",
  "stated_diagnosis", "stated_treatment", "stated_hospital_number",
  "consent_communication",
];

function render(opts: {
  keys?: string[];
  required?: string[];
  values?: Record<string, unknown>;
  isChild?: boolean;
} = {}) {
  const keys = opts.keys ?? ALL;
  const required = opts.required ?? ["given_name", "family_name"];
  return renderToString(
    React.createElement(DetailsStep, {
      applicable: keys.map(k => field(k, required.includes(k) ? "required" : "optional")),
      values: opts.values ?? {},
      edit: () => {},
      isChild: opts.isChild ?? false,
      consent: false,
      setConsent: () => {},
      consentRequired: true,
      consentText: null,
      privacyNotice: null,
      safetyNote: null,
    }),
  ).replace(/<!-- -->/g, "");
}

describe("CPR-BOOK-FLOW-002 details step: sections", () => {
  it("groups the questions instead of listing sixteen controls (s8/AC-08)", () => {
    const html = render();
    for (const legend of ["About the patient", "Contact details", "About this appointment", "Before you continue"])
      expect(html).toContain(legend);
  });
});

describe("guardian and representative (s8.3/AC-10)", () => {
  it("does NOT show guardian fields to an adult booking for themselves", () => {
    const html = render();
    expect(html).toContain("Who is arranging this appointment?");
    // The question is offered; the fields are not, until the answer calls for them.
    expect(html).not.toContain("Your relationship to the patient");
  });

  it("shows them for a child, without asking who is arranging it", () => {
    const html = render({ isChild: true });
    expect(html).toContain("Parent or guardian");
    expect(html).toContain("Your relationship to the patient");
    expect(html).not.toContain("I am booking for myself");
  });

  it("shows them when the practice made a representative required, whatever anyone clicks", () => {
    // ⚠ A REQUIRED QUESTION IS NEVER BEHIND A DISCLOSURE. A form that will not submit for a reason
    // nobody can see is worse than a long form.
    const html = render({ required: ["given_name", "family_name", "representative_name"] });
    expect(html).toContain("Parent or guardian");
    expect(html).toContain("Your name");
  });

  it("re-opens the section when the patient already answered it and came back (s4)", () => {
    const html = render({ values: { representative_name: "Mary Nabukeera" } });
    expect(html).toContain("Your relationship to the patient");
  });
});

describe("date of birth and age (s8.2/AC-09)", () => {
  it("asks for date of birth and NOT age, so neither is asked twice", () => {
    const html = render();
    expect(html).toContain("Date of birth");
    expect(html).toContain("I do not know the exact date of birth");
    expect(html).not.toMatch(/>Age</);
  });

  it("offers age instead when the patient already said the date is unknown", () => {
    const html = render({ values: { age_years: 6 } });
    expect(html).toContain("Age");
  });

  it("asks age directly when the practice does not ask for a date of birth at all", () => {
    const html = render({ keys: ["given_name", "family_name", "age_years"] });
    expect(html).toContain("Age");
    expect(html).not.toContain("I do not know the exact date of birth");
  });
});

describe("referral (s8.5/AC-12)", () => {
  it("asks a yes/no question and hides the referrer field until Yes", () => {
    const html = render();
    expect(html).toContain("Were you referred for this appointment?");
    expect(html).not.toContain("Who referred you?");
  });

  it("shows the referrer field when the patient has already named one", () => {
    const html = render({ values: { referral_source: "Dr Semakula" } });
    expect(html).toContain("Who referred you?");
  });
});

describe("optional medical information (s8.6/AC-13)", () => {
  it("collapses it by default and says booking works without it", () => {
    const html = render();
    expect(html).toContain("Add medical information (optional)");
    expect(html).toContain("Booking works without it");
    expect(html).not.toContain("Existing condition or diagnosis (optional)");
  });

  it("opens it, uncollapsed, when the practice made any of it required", () => {
    const html = render({ required: ["given_name", "family_name", "stated_diagnosis"] });
    expect(html).toContain("Medical information");
    expect(html).toContain("Existing condition or diagnosis (optional)");
    expect(html).not.toContain("Add medical information (optional)");
  });
});

describe("relationship vocabulary (s8.4/AC-11)", () => {
  it("offers family and care relationships, and no administrative roles", () => {
    const html = render({ isChild: true });
    for (const kept of ["Mother", "Father", "Guardian", "Carer"]) expect(html).toContain(kept);
    // ⚠ THESE ARE REAL REPRESENTATIVE ROLES AND NONE OF THEM IS A FAMILY RELATIONSHIP. They stay in the
    // canonical vocabulary -- migration 254 still accepts them -- and out of this question.
    for (const dropped of ["interpreter", "employer", "insurance contact", "social worker"])
      expect(html.toLowerCase()).not.toContain(dropped);
  });
});

describe("consent and communications (s10/AC-14)", () => {
  it("separates the required acknowledgement from the optional update preference", () => {
    const html = render();
    expect(html).toContain("I agree to this practice using the information I have provided");
    expect(html).toContain("Send me appointment updates by email");
    // ⚠ AND SAYS WHAT ARRIVES REGARDLESS. The old copy claimed nothing was ever sent, which stopped
    // being true the day the email channel was switched on.
    expect(html).toContain("verification code and booking confirmation are sent either way");
  });
});

describe("patient-facing copy (s9/AC-03)", () => {
  it("renders none of the developer rationale the old form showed patients", () => {
    const html = render({ isChild: true, values: { referral_source: "x", stated_diagnosis: "y" } });
    const banned = [
      "nobody can call by name",
      "A rule written for children cannot apply",
      "Nothing rings it",
      "Nothing sends to it",
      "three spellings",
      "not what makes a rule apply",
      "NOT A DIAGNOSIS",
      "NOT A MEDICATION LIST",
      "never an identifier of record",
      "Recording an agreement is not a channel",
      "changes what is stored and nothing else",
    ];
    for (const phrase of banned) expect(html).not.toContain(phrase);
  });

  it("uses the patient's words for the fields that had none", () => {
    const html = render({ values: { referral_source: "Dr Semakula" } });
    expect(html).toContain("Mobile number");
    expect(html).toContain("Reason for visit");
    expect(html).toContain("Briefly tell the practitioner what you would like help with.");
    expect(html).toContain("Who referred you?");
    // The practitioner's own labels stay in the catalogue for the configuration screen, not here.
    expect(html).not.toContain("Who referred them");
    expect(html).not.toContain("Reason for the visit");
  });
});
