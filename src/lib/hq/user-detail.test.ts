import { describe, it, expect } from "vitest";
import { parseProfilePatch } from "@/lib/account/own-profile";
import {
  AUDIT_PAGE_SIZE, DETAIL_SECTIONS, EDITABLE_FIELDS, FIELD_LIMIT, RESTRICTED_RECORDS, basisLabel, buildProfilePatch, entitlementLine,
  fieldState, formatDay, invitationStatus, parseAuditPage, patchErrorMessage, prefillRows, productSummary, validateField, type FieldValues,
} from "./user-detail";

// HQ users directory (2 Nov 2026): the labels, states and validation the directory and the profile depend on.

describe("basisLabel", () => {
  it("says how an entitlement began, in the words HQ uses", () => {
    expect(basisLabel("pilot")).toBe("Pilot access");
    expect(basisLabel("hq_grant")).toBe("Complimentary, granted by Competen");
    expect(basisLabel("payment", "scholar_monthly")).toBe("Paid · plan scholar_monthly");
    expect(basisLabel("payment")).toBe("Paid");
    expect(basisLabel("signup")).toBe("Self sign-up");
  });
  it("never invents a basis for a source it does not recognise or that is missing", () => {
    expect(basisLabel(null)).toBe("Source not recorded");
    expect(basisLabel("unknown")).toBe("Source not recorded");
    expect(basisLabel("some_new_source")).toBe("some new source");
  });
});

describe("entitlementLine and formatDay", () => {
  it("prints the end date, formatted in UTC so server and browser agree", () => {
    expect(entitlementLine("scholar", "2027-01-31T23:59:59Z")).toBe("Scholar · until 31 Jan 2027");
    expect(entitlementLine("professional", null)).toBe("Professional · no end date");
    expect(formatDay("2026-11-02T00:00:00Z")).toBe("2 Nov 2026");
    expect(formatDay(null)).toBe("—");
    expect(formatDay("nonsense")).toBe("—");
  });
});

describe("productSummary: actual entitlements, never inferred from a role", () => {
  const readable = { platform: true, enterprise: true, practice: true, individual: true };
  const empty = { platform: null, enterprise: [], practice: [], individual: { membership: null, liveDetail: [] } };
  it("lists live periods with their end dates, then the active seats", () => {
    const s = productSummary({ ...empty, platform: "active", practice: [{ status: "active" }], individual: { membership: "active", liveDetail: [{ experience: "scholar", endsAt: "2027-01-31T00:00:00Z" }] } }, readable);
    expect(s.lines).toEqual(["Scholar · until 31 Jan 2027", "Platform", "Practice"]);
    expect(s.none).toBe(false);
  });
  it("says None only when every source answered and there is nothing", () => {
    expect(productSummary(empty, readable)).toEqual({ lines: [], none: true, unreadable: [] });
  });
  it("a source that did not answer is named, and is not None", () => {
    const s = productSummary(empty, { ...readable, individual: false });
    expect(s.none).toBe(false);
    expect(s.unreadable).toEqual(["Individual"]);
  });
  it("an inactive seat is not access", () => {
    expect(productSummary({ ...empty, platform: "suspended", enterprise: [{ status: "suspended" }] }, readable).none).toBe(true);
  });
  it("a live period on a suspended membership says so", () => {
    const s = productSummary({ ...empty, individual: { membership: "suspended", liveDetail: [{ experience: "scholar", endsAt: null }] } }, readable);
    expect(s.lines[0]).toContain("membership suspended");
  });
});

describe("fieldState: Missing, Not applicable and Restricted are different things", () => {
  it("a value is a value, blank is the state the caller names", () => {
    expect(fieldState("Amina")).toBe("value");
    expect(fieldState("  ")).toBe("missing");
    expect(fieldState(null, "not_applicable")).toBe("not_applicable");
    expect(fieldState(undefined, "not_set_up")).toBe("not_set_up");
  });
});

describe("the seven sections and the private records", () => {
  it("are the seven the owner named, in order", () => {
    expect(DETAIL_SECTIONS.map(s => s.label)).toEqual([
      "Personal & Contact", "Education & Professional Context", "Products & Entitlements", "Roles & Organisations",
      "Account & Security", "Audit & History", "Competency & Passport",
    ]);
  });
  it("the Restricted list names the private records HQ never reads", () => {
    expect(RESTRICTED_RECORDS).toEqual(expect.arrayContaining(["Notes", "Learning history", "Personal AI conversations", "Formative assessments"]));
  });
});

describe("field validation mirrors the person's own profile", () => {
  it("uses the same limits as own-profile.ts for every field it shares", () => {
    for (const k of ["full_name", "phone", "country", "given_name", "family_name"] as const) {
      const over = "x".repeat(FIELD_LIMIT[k] + 1);
      expect(validateField(k, over).ok).toBe(false);
      expect(parseProfilePatch({ [k]: over }).ok).toBe(false);
      const at = "x".repeat(FIELD_LIMIT[k]);
      // the phone pattern is stricter than the self-service rule, so the at-limit phone is digits
      const fits = k === "phone" ? "1".repeat(FIELD_LIMIT[k]) : at;
      expect(validateField(k, fits).ok).toBe(true);
      expect(parseProfilePatch({ [k]: fits }).ok).toBe(true);
    }
  });
  it("collapses whitespace, and a blank is null except for the full name", () => {
    expect(validateField("given_name", "  Amina   Okello ")).toEqual({ ok: true, value: "Amina Okello" });
    expect(validateField("middle_names", "   ")).toEqual({ ok: true, value: null });
    expect(validateField("full_name", " ")).toEqual({ ok: false, error: "Full name cannot be empty." });
  });
  it("refuses a phone that is not a number", () => {
    expect(validateField("phone", "call me").ok).toBe(false);
    expect(validateField("phone", "+256 700 000 000")).toEqual({ ok: true, value: "+256 700 000 000" });
  });
});

describe("buildProfilePatch", () => {
  const loaded: FieldValues = { given_name: "Amina", middle_names: null, family_name: "Okello", full_name: "Amina Okello", phone: null, country: "Uganda" };
  const draft = (over: Partial<Record<(typeof EDITABLE_FIELDS)[number], string>> = {}) => ({
    given_name: "Amina", middle_names: "", family_name: "Okello", full_name: "Amina Okello", phone: "", country: "Uganda", ...over,
  });
  it("sends only what changed, with the value each had when the screen loaded", () => {
    const r = buildProfilePatch("u1", loaded, draft({ middle_names: "Grace", phone: "+256 700 000 000" }));
    expect(r).toEqual({ ok: true, body: {
      userId: "u1",
      fields: { middle_names: "Grace", phone: "+256 700 000 000" },
      expected: { middle_names: null, phone: null },
    } });
  });
  it("sends nothing when nothing changed", () => {
    expect(buildProfilePatch("u1", loaded, draft())).toEqual({ ok: true, body: null });
  });
  it("clearing a value sends null and expects the old one", () => {
    const r = buildProfilePatch("u1", loaded, draft({ country: "" }));
    expect(r).toMatchObject({ ok: true, body: { fields: { country: null }, expected: { country: "Uganda" } } });
  });
  it("returns every refused field and sends nothing", () => {
    const r = buildProfilePatch("u1", loaded, draft({ full_name: "", phone: "abc" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["full_name", "phone"]);
  });
  it("carries the preferred name only when it is offered", () => {
    expect(buildProfilePatch("u1", loaded, draft(), { loaded: null, draft: "Mina" })).toMatchObject({ ok: true, body: { fields: { preferred_name: "Mina" }, expected: { preferred_name: null } } });
    expect(buildProfilePatch("u1", loaded, draft())).toEqual({ ok: true, body: null });
    expect(buildProfilePatch("u1", loaded, draft(), { loaded: null, draft: "x".repeat(81) }).ok).toBe(false);
  });
});

describe("patchErrorMessage", () => {
  it("words each refusal the route can give", () => {
    expect(patchErrorMessage(409, "CHANGED")).toContain("changed since you opened them");
    expect(patchErrorMessage(409, "LEARNER_OWNED")).toContain("chosen by the person");
    expect(patchErrorMessage(503, "NOT_SET_UP")).toContain("not set up");
    expect(patchErrorMessage(500, undefined, "Server said no")).toBe("Server said no");
    expect(patchErrorMessage(500, undefined)).toBe("The details could not be saved.");
  });
});

describe("prefillRows", () => {
  it("keeps strings only, labelled, trimmed and capped", () => {
    expect(prefillRows({ profession: " Nurse ", trainingLevel: "Year 2", bad: 4, empty: "  ", programme: "x".repeat(300) }).map(r => [r.label, r.value.length])).toEqual([
      ["Profession", 5], ["Training level", 6], ["Programme", 200],
    ]);
  });
  it("is empty for anything that is not an object", () => {
    expect(prefillRows(null)).toEqual([]);
    expect(prefillRows(["a"])).toEqual([]);
    expect(prefillRows("profession")).toEqual([]);
  });
});

describe("invitations and audit paging", () => {
  it("a pending invitation that is no longer live has expired", () => {
    expect(invitationStatus("PENDING", true)).toBe("Waiting to be accepted");
    expect(invitationStatus("PENDING", false)).toBe("Expired");
    expect(invitationStatus("ACCEPTED", false)).toBe("Accepted");
    expect(invitationStatus("REVOKED", false)).toBe("Revoked");
  });
  it("pages the audit trail by twenty and keeps the page number sane", () => {
    expect(AUDIT_PAGE_SIZE).toBe(20);
    expect(parseAuditPage("3")).toBe(3);
    expect(parseAuditPage("-1")).toBe(0);
    expect(parseAuditPage("x")).toBe(0);
    expect(parseAuditPage(null)).toBe(0);
    expect(parseAuditPage("99999")).toBe(0);
  });
});
