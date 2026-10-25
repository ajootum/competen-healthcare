/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { resolvePolicy } from "./policy";
import { loadPassportSelection, orderItems, presentable, type PassportItem } from "./passport-view";
import { parsePassportView } from "./professional/share-passport";

// COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7): record-level sharing, pinned.

const policy = resolvePolicy([]);
const today = "2026-10-26";
const ME = "11111111-1111-4111-8111-111111111111", LINK = "22222222-2222-4222-8222-222222222222";
const CPD_A = "33333333-3333-4333-8333-33333333333a", CPD_B = "33333333-3333-4333-8333-33333333333b";

/** A permissive in-memory admin: every query on a table answers that table's rows. Filters are not needed here. */
function fakeAdmin(rows: Record<string, any[]>) {
  const q = (table: string): any => {
    const data = rows[table] ?? [];
    const b: any = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") return (res: any) => res({ data, error: null });
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: data[0] ?? null, error: null });
        return () => b;
      },
    });
    return b;
  };
  return { from: q, storage: { from: () => ({}) } };
}
const cpd = (id: string, title: string) => ({ id, goal_id: null, activity_type: "course", title, provider: null, hours: 1, cpd_points: null, activity_date: "2026-10-01", reflection: null, document_name: null, evidence_class: "self_declared", created_at: "2026-10-01" });
const ctx = { today, profile: policy.professionalProfile, competency: policy.professionalCompetency, lcpd: { passportShareable: [] } as any, passport: policy.professionalPassport };

describe("a link never carries a record that was not chosen for it", () => {
  it("a link with no view carries none of the person's CPD, however much there is", async () => {
    const admin = fakeAdmin({ individual_professional_cpd: [cpd(CPD_A, "Chosen"), cpd(CPD_B, "Not chosen")] });
    const s = await loadPassportSelection(admin, ME, LINK, ctx);
    expect(s.meta).toBeNull();
    expect(s.items.filter(i => i.category === "cpd")).toEqual([]);
  });
  it("a view carries exactly the records ticked for it, and no other", async () => {
    const admin = fakeAdmin({
      individual_passport_share_view: [{ share_token_id: LINK, purpose_label: "A job application", recipient_label: null, summary: null, include_institution: false, activated_at: "2026-10-26T00:00:00Z" }],
      individual_passport_share_record: [{ cpd_id: CPD_A, evidence_id: null, study_item_id: null, scholar_evaluation_id: null }],
      individual_professional_cpd: [cpd(CPD_A, "Chosen"), cpd(CPD_B, "Not chosen")],
    });
    const s = await loadPassportSelection(admin, ME, LINK, ctx);
    expect(s.items.filter(i => i.category === "cpd").map(i => i.title)).toEqual(["Chosen"]);
    expect(s.items.some(i => i.category === "institution")).toBe(false);
    expect(s.items.find(i => i.title === "Chosen")?.trust).toBe("self_declared");
  });
});

describe("the share form (P4)", () => {
  const pp = policy.professionalPassport;
  it("reads only ticked records of known kinds, once each", () => {
    const r = parsePassportView({ [`record:cpd:${CPD_A}`]: "true", [`record:cpd:${CPD_B}`]: "false", [`record:reflection:${CPD_A}`]: "true", purpose: "job-application", summary: " Five years " }, pp);
    expect(r.ok && r.value).toMatchObject({ records: [{ kind: "cpd", id: CPD_A }], purposeLabel: "A job application", summary: "Five years", includeInstitution: false });
  });
  it("refuses a kind the configuration does not let a link carry, and a missing recipient when required", () => {
    expect(parsePassportView({ [`record:cpd:${CPD_A}`]: "true" }, { ...pp, shareable: pp.shareable.filter(k => k !== "cpd") }).ok).toBe(false);
    expect(parsePassportView({}, { ...pp, recipient: "required" }).ok).toBe(false);
    expect(parsePassportView({ purpose: "invented" }, pp).ok).toBe(false);
  });
});

describe("presentation (P3, P5)", () => {
  const item = (category: PassportItem["category"], validity: PassportItem["validity"]): PassportItem => ({
    key: `${category}:${validity}`, category, sourceService: "s", title: category, description: null, issuer: null, date: null, version: null, evidenceRef: null,
    method: null, authority: null, trust: "self_declared", validity, meaning: "m",
  });
  it("orders by the configured sections without dropping any", () => {
    expect(orderItems([item("cpd", "current"), item("institution", "current")], ["institution", "cpd"]).map(i => i.category)).toEqual(["institution", "cpd"]);
    expect(orderItems([item("study", "current")], []).length).toBe(1);
  });
  it("leaves lapsed records off only when configured, and never shows a kind that is not shareable", () => {
    const items = [item("evidence", "expired"), item("evidence", "current"), item("study", "current")];
    expect(presentable(items, { shareable: ["evidence", "study"], validity: "show" }).length).toBe(3);
    expect(presentable(items, { shareable: ["evidence", "study"], validity: "hide" }).map(i => i.validity)).toEqual(["current", "current"]);
    expect(presentable(items, { shareable: ["evidence"], validity: "show" }).some(i => i.category === "study")).toBe(false);
  });
});
