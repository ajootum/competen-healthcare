import { describe, expect, it } from "vitest";
import type { GovernedVersionRow } from "@/lib/assessment/studio/read";
import {
  buildHistory, filterControlled, filterHistory, frameworkStatus, latestPerDefinition, nextActionFramework, nextActionStudio, plainAction, statusMatches, studioRows, summaryLine,
} from "./unified";

const v = (o: Partial<GovernedVersionRow>): GovernedVersionRow => ({
  kind: "instrument", versionId: "v1", id: "v1", versionNo: 1, definitionId: "d1", code: "CHK-1", name: "Hand hygiene", state: "draft", authoredBy: [], submittedBy: null, submittedAt: null,
  publishedBy: null, publishedAt: null, createdAt: "2026-11-01T10:00:00Z", href: "/super-admin/checklist-studio/d1/v/v1", ...o,
});

describe("next required action", () => {
  it("maps each Studio status to one plain action", () => {
    expect(nextActionStudio("none")).toBe("Create first draft");
    expect(nextActionStudio("draft")).toBe("Submit for review");
    expect(nextActionStudio("in_review")).toBe("Review & approve or request changes");
    expect(nextActionStudio("approved")).toBe("Publish");
    expect(nextActionStudio("published")).toBe("Create new version");
    expect(nextActionStudio("retired")).toBe("—");
  });
  it("maps each framework status, and a pending request is decided first", () => {
    expect(nextActionFramework("draft", false)).toBe("Put competencies forward for clinical review");
    expect(nextActionFramework("in_review", false)).toBe("Decide publication");
    expect(nextActionFramework("published", true)).toBe("Decide publication");
    expect(nextActionFramework("published", false)).toBe("Create revision draft");
    expect(nextActionFramework("archived", false)).toBe("—");
    expect(frameworkStatus("archived")).toBe("retired");
    expect(frameworkStatus("in_review")).toBe("in_review");
  });
});

describe("controlled rows", () => {
  it("keeps the latest version of each definition and adds registered checklists with no version", () => {
    const latest = latestPerDefinition([v({ versionId: "a", versionNo: 1, state: "published" }), v({ versionId: "b", versionNo: 2 }), v({ versionId: "c", definitionId: "d2", kind: "scale" })]);
    expect(latest.map((r) => r.versionId).sort()).toEqual(["b", "c"]);
    const rows = studioRows([v({ authoredBy: ["u1"] })], [{ id: "i9", code: "NEW-1", name: "New one", versions: 0 }, { id: "d1", code: "CHK-1", name: "Hand hygiene", versions: 1 }], { u1: "Ada" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "draft", next: "Submit for review", authors: ["Ada"], version: "v1", type: "Checklist", scope: "Competen Holdings" });
    expect(rows[1]).toMatchObject({ status: "none", next: "Create first draft", href: "/super-admin/checklist-studio/i9" });
  });
  it("filters by status (not-started counts as draft) and by title or code", () => {
    const rows = studioRows([v({}), v({ versionId: "x", definitionId: "d3", code: "ZZ-9", name: "Falls", state: "published" })], [{ id: "i9", code: "NEW-1", name: "New one", versions: 0 }], {});
    expect(statusMatches("none", "draft")).toBe(true);
    expect(filterControlled(rows, "draft", "").map((r) => r.code).sort()).toEqual(["CHK-1", "NEW-1"]);
    expect(filterControlled(rows, "published", "")).toHaveLength(1);
    expect(filterControlled(rows, "all", "falls")).toHaveLength(1);
    expect(filterControlled(rows, "all", "zz-9")).toHaveLength(1);
    expect(summaryLine(rows)).toBe("3 items: 2 draft, 0 in review, 0 approved, 1 published");
    expect(summaryLine([])).toBe("No items");
  });
});

describe("history", () => {
  const versions = [v({ versionId: "v1", href: "/super-admin/checklist-studio/d1/v/v1" })];
  it("merges the four sources newest first, resolving versions and names", () => {
    const items = buildHistory({
      versions, names: { u1: "Ada", u2: "Bo" },
      trail: [{ at: "2026-11-02T09:00:00Z", kind: "event", label: "Put forward for review", actorId: "u1", versionTable: "asmt_instrument_version", versionId: "v1", detail: null }],
      clinical: [{ versionId: "cv", reviewerId: "u2", decision: "approved", comment: "Fine", at: "2026-11-03T09:00:00Z", competency: "Hand washing", frameworkId: "f1" }],
      publications: [{ frameworkId: "f1", frameworkName: "Nursing core", versionNum: 2, label: null, at: "2026-11-01T09:00:00Z", by: "Cy" }],
      organisation: [{ id: "a1", at: "2026-11-04T09:00:00Z", actor: "Di", action: "hq_appointment_scope_set", entity: "Quality lead" }],
    });
    expect(items.map((i) => i.type)).toEqual(["organisation", "clinical", "checklist", "framework"]);
    expect(items[0]).toMatchObject({ who: "Di", what: "Appointment scope set", item: "Quality lead", href: null });
    expect(items[1]).toMatchObject({ who: "Bo", what: "Approved after clinical review", item: "Hand washing", href: "/super-admin/competencies/governance/f1", detail: "Fine" });
    expect(items[2]).toMatchObject({ who: "Ada", item: "Hand hygiene v1", href: "/super-admin/checklist-studio/d1/v/v1" });
    expect(items[3]).toMatchObject({ who: "Cy", what: "Published version 2", item: "Nursing core" });
  });
  it("honours the limit, never invents a person, and filters by type and text", () => {
    const org = Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, at: `2026-11-0${i + 1}T00:00:00Z`, actor: null, action: "hq_position_created", entity: i === 0 ? "Dean" : "Other" }));
    const items = buildHistory({ organisation: org, names: {}, limit: 3 });
    expect(items).toHaveLength(3);
    expect(items[0].at).toBe("2026-11-05T00:00:00Z");
    expect(items[0].who).toBe("Not recorded");
    const all = buildHistory({ organisation: org, names: {} });
    expect(filterHistory(all, "all", "dean")).toHaveLength(1);
    expect(filterHistory(all, "clinical", "")).toHaveLength(0);
    expect(filterHistory(all, "organisation", "")).toHaveLength(5);
  });
  it("turns an audit action into plain words", () => {
    expect(plainAction("hq_position_created")).toBe("Position created");
    expect(plainAction("")).toBe("Change");
  });
  it("lists a document template review as its submission and its decision", () => {
    const items = buildHistory({
      documents: [{ id: "r1", submittedAt: "2026-11-03T08:00:00Z", submittedBy: "a", note: "Footer reworded", decidedBy: "b", decision: "changes_requested", decidedAt: "2026-11-03T09:00:00Z", decisionNote: "Fix the title" },
        { id: "r2", submittedAt: "2026-11-03T10:00:00Z", submittedBy: "a", note: null, decidedBy: null, decision: null, decidedAt: null, decisionNote: null }],
      names: { a: "Ada", b: "Ben" },
    });
    expect(items.map((x) => [x.who, x.what, x.type])).toEqual([
      ["Ada", "Submitted the document templates for review", "documents"],
      ["Ben", "Asked for changes to the document templates", "documents"],
      ["Ada", "Submitted the document templates for review", "documents"],
    ]);
    expect(items[1].detail).toBe("Fix the title");
    expect(filterHistory(items, "documents", "ben")).toHaveLength(1);
  });
});
