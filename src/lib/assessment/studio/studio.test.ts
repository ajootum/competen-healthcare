import { describe, expect, it } from "vitest";
import { hashDoc, STANDARD_CHECKLIST_LAYOUT } from "../core";
import { RESP_ASSESS, RESP_RULES, STAGE_RATING, uid } from "../core/fixtures";
import { assembleContent, assembleDefinition, renumber, scaleFromRows, toDefinition } from "./assemble";
import { contentProblems, diffContent, itemSignature, sectionsParentFirst } from "./diff";
import { approvalStatus, availabilities, CAP, friendlyDbError, type TransitionInput } from "./transitions";
import { validateInstrumentVersion } from "./validation";
import { buildTimeline } from "./read";
import type { EditorContent, EditorItem, ReviewDecisionRow } from "./types";

// Database-shaped rows for the fixture checklist, so assembly is proven against the same shape PostgREST returns.
const rowsOf = (def = RESP_ASSESS) => {
  const secId = (k: string) => `S-${k.slice(-4)}`;
  const itemId = (k: string) => `I-${k.slice(-4)}`;
  return {
    groups: def.groups.map((g) => ({ ...g })),
    sections: def.sections.map((s) => ({ id: secId(s.stable_key), stable_key: s.stable_key, parent_section_id: s.parent_section_key ? secId(s.parent_section_key) : null, title: s.title, guidance: s.guidance ?? null, weight: String(s.weight), position: s.position })),
    items: def.items.map((i) => ({
      id: itemId(i.stable_key), section_id: secId(i.section_key), stable_key: i.stable_key, code: i.code, prompt: i.prompt, guidance: i.guidance, expected_performance: i.expected_performance ?? [],
      response_type: i.response_type, scale_version_id: i.response_type === "rating_scale" ? "SV1" : null, config: i.config, group_code: i.group_code, method_codes: i.method_codes, method_rule: i.method_rule,
      mandatory: i.mandatory, critical: i.critical, critical_requirements: i.critical_requirements, evidence_requirement: i.evidence_requirement ?? {}, weight: String(i.weight), references_text: i.references_text, position: i.position,
    })),
    fields: [], mappings: [{ item_id: itemId(def.items[0].stable_key), section_id: null, kind: "ref_kind", ref_id: "R1", ref_code: "C-1", ref_version: "F 1.0.0", ref_hash: "h", ref_snapshot: { wording: "w" }, relation: "assesses" }],
    scales: new Map([["SV1", STAGE_RATING]]),
  };
};

describe("studio assembly from rows", () => {
  it("builds the engine definition with section keys, frozen scales and numbers coerced", () => {
    const { def, content } = assembleDefinition({ versionNo: 2, instrumentCode: "X-000001", ...rowsOf() });
    expect(def.version_no).toBe(2);
    expect(def.items).toHaveLength(RESP_ASSESS.items.length);
    expect(def.items[0].section_key).toBe(RESP_ASSESS.items[0].section_key);
    expect(def.items[0].scale?.levels.length).toBe(STAGE_RATING.levels.length);
    expect(typeof def.items[0].weight).toBe("number");
    expect(content.items[0].mapping?.ref_id).toBe("R1");
    expect(content.items[1].mapping).toBeNull();
  });
  it("drops the mapping from the engine definition", () => {
    const content = assembleContent({ versionNo: 1, ...rowsOf() });
    const def = toDefinition(content, { versionNo: 1 });
    expect("mapping" in def.items[0]).toBe(false);
  });
  it("orders levels by ordinal and keeps states", () => {
    const s = scaleFromRows("V", { code: "SC", scale_kind: "rating" }, [{ code: "b", label: "B", ordinal: 2 }, { code: "a", label: "A", ordinal: 1 }], [{ state: "not_assessed", label: "NA" }]);
    expect(s.levels.map((l) => l.code)).toEqual(["a", "b"]);
    expect(s.states).toHaveLength(1);
  });
  it("renumber is 1..n in array order and does not mutate", () => {
    const a = [{ position: 9 }, { position: 4 }];
    expect(renumber(a).map((x) => x.position)).toEqual([1, 2]);
    expect(a[0].position).toBe(9);
  });
});

describe("scoring hash equality", () => {
  it("the stored hash equals the engine's rules hash for the same document, whatever the key order", () => {
    const shuffled = JSON.parse(JSON.stringify({ rules: RESP_RULES.rules, fallback: RESP_RULES.fallback, schema: RESP_RULES.schema, outcomes: RESP_RULES.outcomes, gates: RESP_RULES.gates, ...(RESP_RULES.aggregates ? { aggregates: RESP_RULES.aggregates } : {}), ...(RESP_RULES.groups ? { groups: RESP_RULES.groups } : {}), ...(RESP_RULES.defaults ? { defaults: RESP_RULES.defaults } : {}), ...(RESP_RULES.permitOrdinalMean !== undefined ? { permitOrdinalMean: RESP_RULES.permitOrdinalMean } : {}) }));
    expect(hashDoc(shuffled)).toBe(hashDoc(RESP_RULES));
    expect(hashDoc({ ...RESP_RULES, fallback: "ZZZ" })).not.toBe(hashDoc(RESP_RULES));
  });
});

describe("content diff", () => {
  const base: EditorContent = assembleContent({ versionNo: 1, ...rowsOf() });
  const clone = (c: EditorContent): EditorContent => JSON.parse(JSON.stringify(c));
  it("no change is a no-op", () => { expect(diffContent(base, clone(base)).unchanged).toBe(true); });
  it("the frozen scale is not part of an item's signature", () => {
    const c = clone(base); c.items[0].scale = null;
    expect(itemSignature(c.items[0])).toBe(itemSignature(base.items[0]));
    expect(diffContent(base, c).unchanged).toBe(true);
  });
  it("an edit, a reorder, an add and a delete are each found", () => {
    const c = clone(base);
    c.items[0].prompt = "Changed";
    const moved = c.items.splice(2, 1)[0]; c.items.unshift(moved);
    c.items = renumber(c.items);
    const added: EditorItem = { ...clone(base).items[1], stable_key: uid(999), prompt: "New", mapping: null };
    c.items.push(added);
    const removedKey = c.items[3].stable_key;
    c.items.splice(3, 1);
    const d = diffContent(base, c);
    expect(d.itemUpserts.some((i) => i.stable_key === uid(999))).toBe(true);
    expect(d.itemUpserts.some((i) => i.prompt === "Changed")).toBe(true);
    expect(d.itemDeletes).toContain(removedKey);
    expect(d.sectionUpserts).toHaveLength(0);
  });
  it("a reorder changes only positions and keeps stable keys", () => {
    const c = clone(base);
    c.items = renumber([...c.items].reverse());
    const d = diffContent(base, c);
    expect(d.itemDeletes).toHaveLength(0);
    expect(new Set(d.itemUpserts.map((i) => i.stable_key)).size).toBe(d.itemUpserts.length);
    expect(d.itemUpserts.every((i) => base.items.some((b) => b.stable_key === i.stable_key))).toBe(true);
  });
  it("sections are written parents first", () => {
    const order = sectionsParentFirst([
      { stable_key: "c", parent_section_key: "p", title: "c", weight: 1, position: 2 },
      { stable_key: "p", parent_section_key: null, title: "p", weight: 1, position: 1 },
    ]);
    expect(order.map((s) => s.stable_key)).toEqual(["p", "c"]);
  });
  it("unwritable content is refused before the database", () => {
    const c = clone(base);
    c.items[0].section_key = "nope"; c.items[1].critical = true; c.items[1].mandatory = false; c.items[2].prompt = " ";
    expect(contentProblems(c).length).toBeGreaterThanOrEqual(3);
    expect(contentProblems(base)).toEqual([]);
  });
});

const decision = (over: Partial<ReviewDecisionRow>): ReviewDecisionRow => ({
  id: "d", version_table: "asmt_instrument_version", version_id: "v", review_kind: "governance", reviewer_id: "r1", decision: "approved", content_hash: "H", rationale: null, created_at: "2026-11-03T00:00:00Z", ...over,
});
const input = (over: Partial<TransitionInput> = {}): TransitionInput => ({
  kind: "instrument", state: "draft", actorId: "me", caps: [CAP.view, CAP.author], authoredBy: ["me"], editedBy: [], involved: ["me"], contentHash: "H", risk: "standard",
  requiresDomainReview: false, deliveryModes: ["self_assessment"], decisions: [], need: { standard: 1, high: 2 }, validationErrors: 0, ...over,
});

describe("transition preconditions", () => {
  it("a draft can be edited and submitted by its author", () => {
    const a = availabilities(input());
    expect(a.edit.allowed && a.submit.allowed).toBe(true);
    expect(a.publish.allowed).toBe(false);
  });
  it("submit is refused without delivery modes or with validation problems, and for a non-author", () => {
    expect(availabilities(input({ deliveryModes: [] })).submit.reason).toMatch(/delivery mode/);
    expect(availabilities(input({ validationErrors: 2 })).submit.reason).toMatch(/2 validation problems/);
    expect(availabilities(input({ authoredBy: ["x"], involved: ["x"] })).submit.reason).toMatch(/author or editor/);
  });
  it("an author cannot review what they authored, but may publish the exact approved version when they hold publish (940)", () => {
    const a = availabilities(input({ state: "in_review", caps: [CAP.review, CAP.publish, CAP.author] }));
    expect(a.reviewGovernance.reason).toMatch(/Not independent/);
    expect(a.approve.allowed).toBe(false);
    const b = availabilities(input({ state: "approved", caps: [CAP.publish] }));
    expect(b.publish.allowed).toBe(true);
    expect(availabilities(input({ state: "approved", caps: [CAP.author] })).publish.reason).toMatch(/publish capability/);
  });
  it("an independent reviewer may decide once per exact content, and an independent publisher may publish an approved version", () => {
    const r = input({ state: "in_review", actorId: "rev", caps: [CAP.review], involved: ["me"] });
    expect(availabilities(r).reviewGovernance.allowed).toBe(true);
    expect(availabilities({ ...r, decisions: [decision({ reviewer_id: "rev" })] }).reviewGovernance.reason).toMatch(/already decided/);
    expect(availabilities(input({ state: "approved", actorId: "pub", caps: [CAP.publish], involved: ["me"] })).publish.allowed).toBe(true);
  });
  it("approval needs the quorum on the CURRENT hash and no rejection, plus the domain review when required", () => {
    const base = { decisions: [decision({})], contentHash: "H", risk: "standard" as const, requiresDomainReview: false, need: { standard: 1, high: 2 } };
    expect(approvalStatus(base).governanceMet).toBe(true);
    expect(approvalStatus({ ...base, contentHash: "OTHER" }).governanceMet).toBe(false);
    expect(approvalStatus({ ...base, risk: "high" }).governanceMet).toBe(false);
    expect(approvalStatus({ ...base, decisions: [...base.decisions, decision({ reviewer_id: "r2", decision: "rejected", rationale: "no" })] }).blocked).toBe(true);
    expect(approvalStatus({ ...base, requiresDomainReview: true }).domainMet).toBe(false);
    expect(approvalStatus({ ...base, requiresDomainReview: true, decisions: [decision({}), decision({ review_kind: "domain", reviewer_id: "d1" })] }).domainMet).toBe(true);
    const st = input({ state: "in_review", caps: [CAP.review], decisions: [decision({})] });
    expect(availabilities(st).approve.allowed).toBe(true);
    expect(availabilities({ ...st, requiresDomainReview: true }).approve.reason).toMatch(/domain approval/);
  });
  it("a frozen version cannot be edited and a published one can be retired by a publisher only", () => {
    expect(availabilities(input({ state: "published" })).edit.reason).toMatch(/frozen/);
    expect(availabilities(input({ state: "published", caps: [CAP.publish] })).retire.allowed).toBe(true);
    expect(availabilities(input({ state: "published" })).retire.allowed).toBe(false);
  });
  it("database refusals become plain words", () => {
    expect(friendlyDbError("asmt_instrument_version: not independent. An author, editor or submitter of this version or any earlier version cannot publish it")).toMatch(/Not independent/);
    expect(friendlyDbError("asmt_instrument_version: a definition cannot be put forward without at least one delivery mode")).toMatch(/delivery mode/);
    expect(friendlyDbError("asmt_instrument_version: not approved. It needs 1 independent governance approval(s) of this exact content and has 0")).toMatch(/needs 1 independent governance/);
    expect(friendlyDbError("something odd")).toBe("something odd");
  });
});

describe("validation report", () => {
  const { def } = assembleDefinition({ versionNo: 1, ...rowsOf() });
  const okInput = { def: RESP_ASSESS, scoring: RESP_RULES as unknown as Record<string, unknown>, tests: [], layouts: [{ id: "L", name: "Standard", layout: STANDARD_CHECKLIST_LAYOUT, isDefault: true }], deliveryModes: ["self_assessment"], unpublishedScaleIds: [], purposePublishable: true, hasDefaultLayout: true };
  it("a sound checklist has no errors", () => {
    const r = validateInstrumentVersion(okInput);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("collects content, scoring, layout and settings problems with their sources", () => {
    const r = validateInstrumentVersion({ ...okInput, def: { ...def, items: [] }, scoring: {}, deliveryModes: [], purposePublishable: false, unpublishedScaleIds: ["x"] });
    const codes = r.errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["no_items", "no_rules", "no_delivery_mode", "purpose_not_publishable", "scale_not_published"]));
    expect(r.ok).toBe(false);
  });
  it("a saved test that no longer passes is an error", () => {
    const r = validateInstrumentVersion({ ...okInput, tests: [{ id: "t1", name: "all pass", responses: {}, expect: { outcome: "NOPE" } }] });
    expect(r.errors.some((e) => e.code === "test_failed")).toBe(true);
  });
});

describe("history timeline", () => {
  it("merges events and decisions oldest first with version numbers", () => {
    const t = buildTimeline(
      [{ id: "e1", subject_table: "asmt_instrument_version", subject_id: "v1", event: "created", actor_id: "a", reason: null, content_hash: null, detail: {}, created_at: "2026-11-03T08:00:00Z" },
       { id: "e2", subject_table: "asmt_instrument_version", subject_id: "v1", event: "validated", actor_id: "a", reason: null, content_hash: null, detail: { errors: 2, warnings: 1 }, created_at: "2026-11-03T09:00:00Z" }],
      [decision({ created_at: "2026-11-03T08:30:00Z", version_id: "v1" })], { v1: 1 });
    expect(t.map((x) => x.label)).toEqual(["Created", "Governance review approved", "Validation recorded"]);
    expect(t[2].detail).toBe("2 problem(s), 1 warning(s)");
    expect(t[0].versionNo).toBe(1);
  });
});
