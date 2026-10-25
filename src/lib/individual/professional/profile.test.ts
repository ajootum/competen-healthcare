import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, clampSequence, policyDef, resolvePolicy, validateDraft, type SequencePolicy } from "../policy";
import { missingForCompletion, nextStep, parseContext, parseItem, registrationSteps, resumeStep } from "./profile-form";
import { chains, chainsOf, changedFields, itemState, type ProfileItem } from "./profile-records";
import { rankCatalogues, sameTerm } from "./catalogue-suggestions";
import { profileContext } from "./profile-ai";
import { DEFAULT_STATUSES, OPTIONAL_FIELDS, PROFILE_SECTIONS } from "./profile-vocabulary";

// COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1 -- the pure rules of the registration form, the profile records,
// their states, catalogue suggestions and the AI grounding.

const pp = DEFAULT_POLICY.professionalProfile;
const published = (key: string, settings: unknown) => ({ config_path: `individual.policy.${key}`, published: settings });

describe("configuration (Individual policy, WCE)", () => {
  it("defaults: statuses and settings listed, professions and specialties free text, every country, nothing required beyond the three", () => {
    expect(pp.statuses).toEqual(DEFAULT_STATUSES);
    expect(pp.professions).toEqual([]);
    expect(pp.specialties).toEqual([]);
    expect(pp.jurisdictions.length).toBeGreaterThan(150);
    expect(pp.registrationFields).toEqual([...OPTIONAL_FIELDS]);
    expect(pp.registrationRequired).toEqual([]);
    expect(pp.sections).toEqual([...PROFILE_SECTIONS]);
    expect(pp.ai).toBe("on");
  });
  it("hard-codes no single country or profession as the context", () => {
    expect(pp.jurisdictions.some(j => j.label === "Uganda")).toBe(true);
    expect(pp.jurisdictions.some(j => j.label === "Canada")).toBe(true);
    expect(pp.professions.some(p => /nurs/i.test(p.label))).toBe(false);
  });
  it("a published list replaces the default, and a published EMPTY list means none", () => {
    const p = resolvePolicy([published("professional_statuses", { options: [{ code: "active", label: "Active" }] }), published("professional_jurisdictions", { options: [] })]).professionalProfile;
    expect(p.statuses).toEqual([{ code: "active", label: "Active" }]);
    expect(p.jurisdictions).toEqual([]);
  });
  it("sequence: ordered, known only, once each, fixed members always kept", () => {
    const def = policyDef("professional_profile_sections") as SequencePolicy;
    expect(clampSequence(def, { order: ["aspirations", "bogus", "aspirations", "qualifications"] })).toEqual(["overview", "aspirations", "qualifications"]);
    expect(validateDraft("professional_profile_sections", ["qualifications"]).ok).toBe(false);
    expect(validateDraft("professional_profile_sections", ["overview", "overview"]).ok).toBe(false);
    expect(validateDraft("professional_registration_fields", ["years", "nope"]).ok).toBe(false);
    const ok = validateDraft("professional_registration_fields", ["years", "specialty"]);
    expect(ok.ok && ok.settings).toEqual({ order: ["years", "specialty"] });
  });
  it("a required optional question counts only when it is asked", () => {
    const p = resolvePolicy([published("professional_registration_fields", { order: ["title"] }), published("professional_registration_required", { enabled: ["title", "years"] })]).professionalProfile;
    expect(p.registrationFields).toEqual(["title"]);
    expect(p.registrationRequired).toEqual(["title"]);
  });
  it("no registration number, licence, employment or document can be configured into the form", () => {
    const def = policyDef("professional_registration_fields") as SequencePolicy;
    expect(def.options.map(o => o.value)).toEqual(["specialty", "title", "years", "setting", "role"]);
  });
});

describe("registration form", () => {
  it("steps: required facts first, optional questions in configured order, then review; practice step dropped when none asked", () => {
    expect(registrationSteps(pp).map(s => s.key)).toEqual(["profession", "practice", "review"]);
    expect(registrationSteps(pp)[0].fields.map(f => [f.key, f.required])).toEqual([["profession", true], ["jurisdiction", true], ["status", true]]);
    expect(registrationSteps({ ...pp, registrationFields: [] }).map(s => s.key)).toEqual(["profession", "review"]);
    expect(registrationSteps({ ...pp, registrationFields: ["years", "title"] })[1].fields.map(f => f.key)).toEqual(["years", "title"]);
  });
  it("a chosen code stores its label; Other stores the typed words; an unknown code is refused", () => {
    const ok = parseContext({ status: "practising", jurisdiction: "other", jurisdictionText: "Ontario, Canada", profession: "", professionText: "Physiotherapist" }, ["profession", "jurisdiction", "status"], pp);
    expect(ok.ok && ok.value).toMatchObject({
      professional_status_code: "practising", self_declared_professional_status: "Practising",
      practice_jurisdiction_code: null, self_declared_practice_jurisdiction: "Ontario, Canada",
      profession_code: null, self_declared_profession: "Physiotherapist",
    });
    expect(parseContext({ status: "forged" }, ["status"], pp).ok).toBe(false);
  });
  it("reads only the fields of the step, so a step never clears another", () => {
    const r = parseContext({ profession: "", professionText: "Midwife", years: "7" }, ["years"], pp);
    expect(r.ok && Object.keys(r.value)).toEqual(["self_declared_years_experience"]);
    expect(parseContext({ years: "71" }, ["years"], pp).ok).toBe(false);
  });
  it("completion needs the three facts, plus any configured required question", () => {
    expect(missingForCompletion({ self_declared_profession: "Nurse" }, pp)).toEqual(["jurisdiction", "status"]);
    expect(missingForCompletion({ self_declared_profession: "N", self_declared_practice_jurisdiction: "Kenya", self_declared_professional_status: "Practising" }, pp)).toEqual([]);
    expect(missingForCompletion({ self_declared_profession: "N", self_declared_practice_jurisdiction: "Kenya", self_declared_professional_status: "P" }, { ...pp, registrationRequired: ["title"] })).toEqual(["title"]);
  });
  it("resumes where the person stopped, back to step one while a required fact is missing", () => {
    const steps = registrationSteps(pp);
    expect(resumeStep(undefined, steps)).toBe("profession");
    const full = { self_declared_profession: "N", self_declared_practice_jurisdiction: "K", self_declared_professional_status: "P" };
    expect(resumeStep({ ...full, registration_step: "review" }, steps)).toBe("review");
    expect(resumeStep({ self_declared_profession: "N", registration_step: "review" }, steps)).toBe("profession");
    expect(resumeStep({ ...full, registration_completed_at: "2026-10-25T00:00:00Z" }, steps)).toBeNull();
    expect(nextStep("profession", steps)).toBe("practice");
    expect(nextStep("profession", registrationSteps({ ...pp, registrationFields: [] }))).toBe("review");
  });
});

describe("profile records", () => {
  it("parses per kind and never reads a field the kind does not carry", () => {
    const r = parseItem("employment", { title: "Staff nurse", identifier: "123", expiresOn: "2030-01-01", startedOn: "2020-01-01", type: "hospital" }, pp);
    expect(r.ok && r.value).toMatchObject({ section: "employment", self_declared_identifier: null, expires_on: null, started_on: "2020-01-01", type_code: "hospital", type_label: "Hospital" });
    const reg = parseItem("registration", { title: "General register", identifier: "RN-1", type: "active" }, pp);
    expect(reg.ok && reg.value).toMatchObject({ self_declared_identifier: "RN-1", type_label: "Active" });
    expect(parseItem("employment", { title: "X role", startedOn: "2024-01-01", endedOn: "2023-01-01" }, pp).ok).toBe(false);
    expect(parseItem("verified", { title: "Anything" }, pp).ok).toBe(false);
    expect(parseItem("qualification", { title: "BSc", type: "not-a-type" }, pp).ok).toBe(false);
  });
  const item = (over: Partial<ProfileItem>): ProfileItem => ({
    id: "a", section: "employment", title: "Staff nurse", type_code: null, type_label: null, organisation: null, jurisdiction: null, self_declared_identifier: null,
    started_on: null, ended_on: null, expires_on: null, target_on: null, detail: null, document_name: null, evidence_class: "self_declared",
    supersedes_id: null, superseded_at: null, withdrawn_at: null, withdrawn_reason: null, created_at: "2026-01-01T00:00:00Z", ...over,
  });
  it("states: withdrawn > superseded > expired > document-supported > self-declared, and nothing is ever verified", () => {
    const today = "2026-10-25";
    expect(itemState(item({}), today)).toBe("self_declared");
    expect(itemState(item({ evidence_class: "source_linked" }), today)).toBe("document_supported");
    expect(itemState(item({ evidence_class: "independently_verified" }), today)).toBe("self_declared");
    expect(itemState(item({ expires_on: "2026-01-01", evidence_class: "source_linked" }), today)).toBe("expired");
    expect(itemState(item({ superseded_at: "x" }), today)).toBe("superseded");
    expect(itemState(item({ withdrawn_at: "x", expires_on: "2020-01-01" }), today)).toBe("withdrawn");
  });
  it("versions chain newest first, earlier versions kept; withdrawn chains apart", () => {
    const v1 = item({ id: "v1", superseded_at: "2026-02-01", created_at: "2026-01-01" });
    const v2 = item({ id: "v2", supersedes_id: "v1", ended_on: "2026-06-30", superseded_at: "2026-03-01", created_at: "2026-02-01" });
    const v3 = item({ id: "v3", supersedes_id: "v2", title: "Senior nurse", ended_on: "2026-06-30", created_at: "2026-03-01" });
    const other = item({ id: "o", withdrawn_at: "2026-04-01", withdrawn_reason: "recorded_in_error", created_at: "2026-04-01" });
    const all = [v1, v2, v3, other];
    expect(chains(all).map(c => [c.current.id, c.earlier.map(e => e.id)])).toEqual([["o", []], ["v3", ["v2", "v1"]]]);
    const { live, withdrawn } = chainsOf(all, "employment");
    expect(live.map(c => c.current.id)).toEqual(["v3"]);
    expect(withdrawn.map(c => c.current.id)).toEqual(["o"]);
    expect(changedFields(v3, v2)).toEqual(["name"]);
    expect(changedFields(v2, v1)).toEqual(["end"]);
  });
});

describe("catalogue suggestions", () => {
  const fws = [
    { id: "f1", name: "Midwifery core", competency_layer: "profession", profession_term_id: "t1", specialty_term_id: null },
    { id: "f2", name: "Critical care", competency_layer: "specialty", profession_term_id: null, specialty_term_id: "t2" },
    { id: "f3", name: "Foundations", competency_layer: "foundational", profession_term_id: null, specialty_term_id: null },
    { id: "f4", name: "Pharmacy", competency_layer: "profession", profession_term_id: "t3", specialty_term_id: null },
  ];
  const terms = new Map([["t1", "Midwife"], ["t2", "Critical care nursing"], ["t3", "Pharmacist"]]);
  it("matches profession and specialty, offers foundational, skips the unrelated", () => {
    const r = rankCatalogues(fws, terms, { profession: "Registered Midwife", specialties: ["Critical care"] });
    expect(r.map(c => c.frameworkId)).toEqual(["f2", "f1", "f3"]);
    expect(rankCatalogues(fws, terms, { profession: null, specialties: [] }).map(c => c.frameworkId)).toEqual(["f3"]);
    expect(rankCatalogues([], terms, { profession: "Midwife", specialties: [] })).toEqual([]);
  });
  it("whole words only", () => {
    expect(sameTerm("Nurse", "Registered nurse")).toBe(true);
    expect(sameTerm("Nurse", "Nursery teacher")).toBe(false);
  });
});

describe("AI grounding", () => {
  const base = { provisioned: true, history: [], items: [] as ProfileItem[] };
  it("opens with the no-invention rule, gives only current records, never a registration number", () => {
    const view = {
      ...base,
      pointer: { self_declared_profession: "Midwife", self_declared_summary: null, self_declared_registration_number: "SECRET-9" } as never,
      items: [
        { id: "q", section: "registration", title: "General register", self_declared_identifier: "RN-77", document_name: "cert.pdf", supersedes_id: null, superseded_at: null, withdrawn_at: null } as never,
        { id: "w", section: "qualification", title: "Withdrawn BSc", supersedes_id: null, superseded_at: null, withdrawn_at: "x" } as never,
      ],
    };
    const text = profileContext(view)!;
    expect(text).toMatch(/^Professional profile \(every fact self-declared/);
    expect(text).toMatch(/Never add a qualification, licence, registration, employer, role or credential/);
    expect(text).toContain("General register");
    expect(text).not.toMatch(/RN-77|SECRET-9|cert\.pdf|Withdrawn BSc/);
  });
  it("is absent before migration 450", () => {
    expect(profileContext({ provisioned: false, pointer: undefined, history: [], items: [] })).toBeNull();
  });
});

describe("part B: verification, reminders, sharing", async () => {
  const { deriveVerification, personActions, isIndependentlyVerified } = await import("./profile-verification");
  const { dueOffset, itemEligible } = await import("./reminders");
  const { parseShareProfile } = await import("./share-profile");
  const r = (event: string, n: number, extra: Record<string, unknown> = {}) => ({ id: `r${n}`, item_id: "i", event, method: null, valid_until: null, reason: null, created_at: `2026-10-0${n}T00:00:00Z`, ...extra }) as never;
  it("only a verifier's verified row is independently verified, and only while in date", () => {
    expect(isIndependentlyVerified(deriveVerification([r("requested", 1), r("verified", 2, { method: "register_check" })], "2026-10-25").state)).toBe(true);
    expect(deriveVerification([r("requested", 1)], "2026-10-25").state).toBe("requested");
    expect(deriveVerification([r("requested", 1), r("verified", 2, { method: "register_check", valid_until: "2026-10-01" })], "2026-10-25").state).toBe("expired");
    expect(deriveVerification([r("requested", 1), r("verified", 2, { method: "x" }), r("revoked", 3, { reason: "lapsed" })], "2026-10-25")).toMatchObject({ state: "revoked", reason: "lapsed", method: null });
    expect(deriveVerification([], "2026-10-25").state).toBe("none");
  });
  it("the person may request, withdraw an open request, or dispute an outcome -- never verify", () => {
    expect(personActions(deriveVerification([], "2026-10-25"), true)).toEqual(["request"]);
    expect(personActions(deriveVerification([r("requested", 1)], "2026-10-25"), true)).toEqual(["withdraw"]);
    expect(personActions(deriveVerification([r("requested", 1), r("declined", 2, { reason: "x" })], "2026-10-25"), true)).toEqual(["request", "dispute"]);
    expect(personActions(deriveVerification([r("requested", 1), r("verified", 2, { method: "x" })], "2026-10-25"), true)).toEqual(["dispute"]);
    expect(personActions(deriveVerification([], "2026-10-25"), false)).toEqual([]);
  });
  it("reminders: one email at the tightest offset reached; lapsed registrations not reminded by default", () => {
    expect(dueOffset("2026-11-14", "2026-10-25", [60, 30])).toBe(30);
    expect(dueOffset("2026-12-20", "2026-10-25", [60, 30])).toBe(60);
    expect(dueOffset("2027-06-01", "2026-10-25", [60, 30])).toBeNull();
    expect(dueOffset("2026-10-01", "2026-10-25", [60])).toBe(60);
    expect(itemEligible({ section: "registration", type_code: "lapsed" }, pp)).toBe(false);
    expect(itemEligible({ section: "registration", type_code: null }, pp)).toBe(true);
    expect(itemEligible({ section: "employment", type_code: null }, pp)).toBe(false);
    expect(itemEligible({ section: "qualification", type_code: null }, { ...pp, reminderKinds: ["credentials"] })).toBe(false);
  });
  it("sharing: nothing by default; only ticked overview and well-formed record ids", () => {
    expect(parseShareProfile({ scope: "full" })).toEqual({ overview: false, itemIds: [] });
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    expect(parseShareProfile({ profileOverview: "true", [`item:${id}`]: "true", "item:nope": "true", [`item:${id.replace("1", "2")}`]: "false" }))
      .toEqual({ overview: true, itemIds: [id] });
  });
});
