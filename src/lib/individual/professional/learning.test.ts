/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LearningReference } from "@/lib/learning/products";
import { cpdYearsWithLearning, learningProvenance, loadProfessionalLearning } from "./learning";
import { cpdHoursByYear } from "./progress";
import { loadIndividualPassport } from "../passport";

// Owner, "COMPETEN LEARNING -- STAGING ACCEPTANCE CONTINUATION" s3 (COMPETEN-LEARNING-01 H1/H2): Professional and the
// Passport read the Holdings learning record BY REFERENCE, label it exactly, never "verified", and work without it.

const USER = "00000000-0000-4000-8000-0000000000aa";
const COMP = "00000000-0000-4000-8000-0000000000c1";

const ref = (over: Partial<LearningReference> = {}): LearningReference => ({
  recordId: "r1", offeringId: "o1", code: "LRN-ECG-01", title: "ECG Interpretation", versionNo: 1, delivery: "hosted", provider: "Competen Holdings",
  completedOn: "2026-10-25", completionKind: "course_completion", outcomeLabel: "Course completion", evidenceClass: "platform_recorded",
  evidenceLabel: "Recorded by Competen Learning", hours: 1.5, cpdNote: "", certificates: [], competencies: [], ...over,
});

/** A read-only fake: every table answers from `rows`, and every call is recorded, writes included. */
function fakeAdmin(rows: Record<string, any[]>, flagOn: boolean) {
  const calls: { table: string; op: string; args: any[] }[] = [];
  const from = (table: string) => {
    const data = table === "practice_platform_flags" ? (flagOn ? [{ enabled: true }] : []) : (rows[table] ?? []);
    const q: any = {};
    for (const op of ["select", "eq", "in", "order", "limit", "insert", "update", "upsert", "delete"]) q[op] = (...args: any[]) => { calls.push({ table, op, args }); return q; };
    q.maybeSingle = async () => ({ data: data[0] ?? null, error: null });
    q.single = async () => ({ data: data[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => Promise.resolve({ data, error: null }).then(ok, ko);
    return q;
  };
  return { admin: { from }, calls };
}

const RECORD_ROWS = {
  learning_record: [
    { id: "r1", offering_id: "o1", version_id: "v1", delivery: "hosted", completed_at: "2026-03-02T10:00:00Z", completion_kind: "assessed_knowledge", evidence_class: "platform_recorded", external_completed_on: null, external_hours: null,
      learning_offering: { code: "LRN-ECG-01", title: "ECG Interpretation" }, learning_offering_version: { version_no: 2, content: {}, delivery_provider_id: "p1" } },
    { id: "r2", offering_id: "o2", version_id: "v2", delivery: "external", completed_at: "2026-02-01T10:00:00Z", completion_kind: "external_completion", evidence_class: "self_declared", external_completed_on: "2026-01-20", external_hours: null,
      learning_offering: { code: "EXT-ALS", title: "Advanced Life Support" }, learning_offering_version: { version_no: 1, content: {}, delivery_provider_id: null } },
  ],
  learning_certificate: [{ record_id: "r1", certificate_no: "LC-AAAA-BBBB-CCCC", outcome: "assessed_knowledge", verification_code: "x".repeat(24), revoked_at: null }],
  learning_offering_version_outcome: [{ version_id: "v1", competency_id: COMP, relation: "develops" }],
  learning_provider: [{ id: "p1", name: "Competen Holdings" }],
  framework_competencies: [{ id: COMP, name: "ECG interpretation" }],
};

describe("provenance, exactly as the owner worded it, never verified", () => {
  it("a hosted completion is issued by Competen Holdings; an external one stays self-declared", () => {
    expect(learningProvenance(ref())).toBe("Course completion, issued by Competen Holdings");
    expect(learningProvenance(ref({ completionKind: "assessed_knowledge" }))).toBe("Assessed knowledge, issued by Competen Holdings");
    expect(learningProvenance(ref({ delivery: "external", completionKind: "external_completion", evidenceClass: "self_declared", evidenceLabel: "Self-declared" }))).toBe("Self-declared");
    expect(learningProvenance(ref({ delivery: "external", completionKind: "external_completion", evidenceClass: "source_linked", evidenceLabel: "Self-declared, with a document attached" }))).toBe("Self-declared, with a document attached");
  });

  it("control: a self-declared record can never be promoted to issued, whatever its completion kind claims", () => {
    expect(learningProvenance(ref({ evidenceClass: "self_declared", evidenceLabel: "Self-declared" }))).toBe("Self-declared");
  });

  it("no label Professional shows for learning says verified", () => {
    for (const r of [ref(), ref({ completionKind: "assessed_knowledge" }), ref({ evidenceClass: "self_declared", evidenceLabel: "Self-declared" }), ref({ evidenceClass: "source_linked", evidenceLabel: "Self-declared, with a document attached" })])
      expect(learningProvenance(r)).not.toMatch(/verif/i);
  });
});

describe("CPD hours: learning counted in, shown separately, nothing invented", () => {
  const own = cpdHoursByYear([{ id: "c1", goal_id: null, hours: 2, activity_date: "2026-05-01", evidence_class: "self_declared" }]);

  it("learning hours add to the year and are reported as from Competen Learning", () => {
    const [y] = cpdYearsWithLearning(own, [ref()]);
    expect(y).toMatchObject({ year: 2026, hours: 3.5, entries: 2, fromLearning: 1.5, learningEntries: 1, learningWithoutHours: 0 });
  });

  it("a course with no hours is an entry with no hours, never zero hours silently", () => {
    const [y] = cpdYearsWithLearning(own, [ref({ hours: null })]);
    expect(y).toMatchObject({ hours: 2, entries: 2, fromLearning: 0, learningEntries: 1, learningWithoutHours: 1 });
  });

  it("LEARNING IS OPTIONAL: with no learning records the person's own years are unchanged", () => {
    expect(cpdYearsWithLearning(own, []).map(({ year, hours, entries, withDocument }) => ({ year, hours, entries, withDocument }))).toEqual(own);
    expect(cpdYearsWithLearning([], [])).toEqual([]);
  });
});

describe("by reference only, behind Learning's own flag", () => {
  it("Learning off: not read at all, and nothing to render", async () => {
    const { admin, calls } = fakeAdmin(RECORD_ROWS, false);
    expect(await loadProfessionalLearning(admin, USER)).toEqual({ enabled: false, refs: [] });
    expect(calls.some(c => c.table.startsWith("learning_"))).toBe(false);
  });

  it("Learning on: the person's own completed records, by their id, and NOTHING is written anywhere", async () => {
    const { admin, calls } = fakeAdmin(RECORD_ROWS, true);
    const { enabled, refs } = await loadProfessionalLearning(admin, USER);
    expect(enabled).toBe(true);
    expect(refs?.map(r => r.recordId)).toEqual(["r1", "r2"]);
    expect(calls.filter(c => c.table === "learning_record" && c.op === "eq").map(c => c.args)).toEqual(expect.arrayContaining([["user_id", USER], ["status", "completed"]]));
    expect(calls.filter(c => ["insert", "update", "upsert", "delete"].includes(c.op))).toEqual([]);
    expect(calls.some(c => c.table.startsWith("individual_professional_"))).toBe(false);
  });

  it("the module holds no write and reads no 373 table", () => {
    const src = readFileSync("src/lib/individual/professional/learning.ts", "utf8");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).not.toMatch(/from\(\s*["'`]individual_professional_/);
  });
});

describe("the Passport section (H2)", () => {
  it("Learning on: one item per completed record, labelled exactly, revoked certificates left out, never verified", async () => {
    const { admin } = fakeAdmin(RECORD_ROWS, true);
    const p = await loadIndividualPassport(admin, USER, "2026-10-25");
    expect(p.learning?.enabled).toBe(true);
    expect(p.learning?.items?.map(i => [i.recordId, i.label, i.evidence])).toEqual([
      ["r1", "Assessed knowledge, issued by Competen Holdings", "platform_recorded"],
      ["r2", "Self-declared", "self_declared"],
    ]);
    expect(p.learning?.items?.[0].certificateNos).toEqual(["LC-AAAA-BBBB-CCCC"]);
    expect(JSON.stringify(p.learning)).not.toMatch(/verif/i);
  });

  it("Learning off: the section is not shown and nothing is read", async () => {
    const { admin, calls } = fakeAdmin(RECORD_ROWS, false);
    const p = await loadIndividualPassport(admin, USER, "2026-10-25");
    expect(p.learning).toEqual({ enabled: false, items: [] });
    expect(calls.some(c => c.table.startsWith("learning_"))).toBe(false);
  });
});

describe("what the pages render", () => {
  const withCerts = ref({ competencies: [{ id: COMP, name: "ECG interpretation", relation: "develops", relationLabel: "Develops knowledge or skills" }],
    certificates: [{ no: "LC-AAAA-BBBB-CCCC", outcome: "course_completion", verificationCode: "SECRETCODE".repeat(3), revoked: false }, { no: "LC-REVO-KEDD-XXXX", outcome: "course_completion", verificationCode: "OTHERCODE".repeat(3), revoked: true }] });

  it("the list states provenance in words, links live certificates only, and never prints a verification code", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: LearningRefs } = await import("@/app/individual/_components/professional/LearningRefs");
    const html = renderToStaticMarkup(createElement(LearningRefs, { refs: [withCerts, ref({ recordId: "r9", hours: null })], accent: "#000", competencies: true, certificates: true }));
    expect(html).toContain("Course completion, issued by Competen Holdings");
    expect(html).toContain("Develops knowledge or skills: ECG interpretation");
    expect(html).toContain('href="/individual/learning/certificate/LC-AAAA-BBBB-CCCC"');
    expect(html).not.toContain("/individual/learning/certificate/LC-REVO-KEDD-XXXX");
    expect(html).toContain("no hours given");
    expect(html).not.toMatch(/SECRETCODE|OTHERCODE|verified/i);
  });

  it("under a need: shared-competency learning is shown with Find learning, and nothing marks it met", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { LearningServes } = await import("@/app/individual/_components/professional/LearningRefs");
    const html = renderToStaticMarkup(createElement(LearningServes, { matches: [withCerts], competencies: [{ id: COMP, name: "ECG interpretation" }], accent: "#000" }));
    expect(html).toContain("Learning you completed that serves this");
    expect(html).toContain(`href="/individual/learning?competency=${COMP}"`);
    expect(html).not.toMatch(/<form|<button|status/i);
    expect(renderToStaticMarkup(createElement(LearningServes, { matches: [], competencies: [], accent: "#000" }))).toBe("");
  });
});
