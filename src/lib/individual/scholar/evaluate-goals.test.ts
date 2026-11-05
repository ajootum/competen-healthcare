import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVALUATE_VIEWS, METHOD_MEANING, compareSnapshots, dimensionView, dimensionsOf, filterSnapshots, goalStatus, historyOf, needsAttention, parseEvaluateView, parseProgressTab, sectionName, snapshotRow, supportedCount, unprovenOf } from "./evaluate-goals";

const measured = (band: string, n = 6) => ({ state: "measured", band, n });
const dims = (k: unknown, r: unknown, a: unknown, s: unknown) => dimensionsOf({ knowledge: k, retention: r, application: a, reasoning: s } as never);
const none = { state: "not_measured", reason: "Nothing yet" };
const thin = { state: "insufficient", have: 1, need: 3 };

describe("the views", () => {
  it("open on My Goals", () => {
    expect(parseEvaluateView(undefined)).toBe("goals");
    expect(parseEvaluateView("reasoning")).toBe("reasoning");
    expect(parseEvaluateView("x")).toBe("goals");
    expect(EVALUATE_VIEWS).toEqual(["goals", "competencies", "learning", "reasoning", "monthly", "history"]);
    expect(parseProgressTab(undefined)).toBe("overview");
    expect(parseProgressTab("practice")).toBe("practice");
  });
});

describe("evidence status", () => {
  it("reads a band as description, never a number shown as a result", () => {
    expect(dimensionView("knowledge", measured("strong")).status).toBe("supported");
    expect(dimensionView("knowledge", measured("developing")).status).toBe("developing");
    expect(dimensionView("knowledge", measured("needs_work")).status).toBe("gap");
  });
  it("counts the evidence behind each stored shape", () => {
    expect(dimensionView("knowledge", { state: "measured", band: "strong", independent: 7 }).have).toBe(7);
    expect(dimensionView("retention", { state: "measured", band: "strong", recalls: 4 }).have).toBe(4);
  });
  it("never treats missing evidence as failure", () => {
    const t = dimensionView("application", thin);
    expect(t.status).toBe("thin");
    expect(t.note).toContain("not a low result");
    expect(t).toMatchObject({ have: 1, need: 3 });
    const n = dimensionView("reasoning", none);
    expect(n.status).toBe("not_assessed");
    expect(dimensionView("reasoning", null).status).toBe("not_assessed");
    expect(dimensionView("reasoning", null).note).toContain("not a low result");
  });
});

describe("what a goal's evidence shows", () => {
  it("does not call reading or recall alone an outcome", () => {
    expect(goalStatus(dims(measured("strong"), measured("strong"), none, none), "strong")).toBe("insufficient_evidence");
  });
  it("needs application or reasoning, and more than one dimension", () => {
    expect(goalStatus(dims(measured("strong"), none, measured("strong"), none), "moderate")).toBe("outcome_supported");
    expect(goalStatus(dims(none, none, measured("strong"), none), "moderate")).toBe("insufficient_evidence");
  });
  it("holds back where confidence is insufficient", () => {
    expect(goalStatus(dims(measured("strong"), none, measured("strong"), none), "insufficient")).toBe("insufficient_evidence");
  });
  it("names a gap first", () => {
    expect(goalStatus(dims(measured("strong"), measured("strong"), measured("strong"), measured("needs_work")), "strong")).toBe("learning_gap");
  });
  it("says not assessed, not failed, when nothing has tested it", () => {
    const s = goalStatus(dims(none, none, none, none), "insufficient");
    expect(s).toBe("not_assessed");
    expect(needsAttention(s)).toBe(false);
  });
  it("names what remains unproven", () => {
    const d = dims(measured("strong"), thin, none, measured("developing"));
    expect(unprovenOf(d)).toEqual(["Retention", "Application", "Reasoning"]);
    expect(supportedCount(d)).toBe(1);
  });
});

const snap = (id: string, label: string, createdAt: string, r: unknown) => snapshotRow({ id, scope: { label }, kind: "student", method: "existing", confidence: { level: "moderate" }, createdAt, results: r });

describe("saved evaluations", () => {
  const a = snap("a", "Sepsis", "2026-10-01T10:00:00Z", { knowledge: thin });
  const b = snap("b", "Sepsis", "2026-11-01T10:00:00Z", { knowledge: measured("strong"), application: measured("needs_work") });
  const c = snap("c", "Burns", "2026-11-02T10:00:00Z", {});
  it("read what they said then, from their stored results", () => {
    expect(b.dims[0].status).toBe("supported");
    expect(b.supported).toBe(1);
    expect(a.confidence).toBe("moderate");
  });
  it("can be searched by what they were of, and by date", () => {
    expect(filterSnapshots([a, b, c], { q: "sepsis" }).map(r => r.id)).toEqual(["a", "b"]);
    expect(filterSnapshots([a, b, c], { from: "2026-11-01" }).map(r => r.id)).toEqual(["b", "c"]);
  });
  it("compare like with like only", () => {
    expect(compareSnapshots(a, c)).toBeNull();
    const x = compareSnapshots(b, a)!;
    expect(x.older.id).toBe("a");
    expect(x.changes[0]).toMatchObject({ label: "Knowledge", from: "thin", to: "supported", movement: "more" });
    expect(x.changes[1].movement).toBe("same");
  });
  it("keep their order over time", () => {
    expect(historyOf([b, c, a], "Sepsis").map(r => r.id)).toEqual(["a", "b"]);
  });
});

describe("names, not file positions", () => {
  it("prefers the topic, then a heading, keeping the position as a last resort", () => {
    expect(sectionName(["Oxygen therapy"], "x", "page 4")).toBe("Oxygen therapy");
    expect(sectionName([], "Personal Hygiene", "page 4")).toBe("Personal Hygiene");
    expect(sectionName([], "This is a whole sentence of the notes.", "page 4")).toBe("page 4");
    expect(sectionName(undefined, null, "page 4")).toBe("page 4");
  });
});

describe("a review of existing evidence", () => {
  const row = (method: string) => snapshotRow({ id: "x", scope: { label: "Sepsis" }, kind: "student", method, confidence: "moderate", createdAt: "2026-11-01T10:00:00Z", results: {} });
  it("is never new independent performance, and says so", () => {
    expect(row("existing").review).toBe(true);
    expect(row("existing").methodLine).toContain("no new evidence");
    expect(row("fresh").review).toBe(false);
    expect(row("fresh").methodLine).toContain("new evidence");
    expect(METHOD_MEANING.existing).toContain("adds no new evidence");
  });
});

describe("boundaries", () => {
  const study = "src/app/individual/(app)/[experience]/(scholar)/study";
  const page = readFileSync(`${study}/evaluate/page.tsx`, "utf8");
  const parts = readFileSync(`${study}/_components/evaluate-parts.tsx`, "utf8");
  const boards = readFileSync(`${study}/_components/progress-dashboards.tsx`, "utf8");
  const progress = readFileSync(`${study}/progress/page.tsx`, "utf8");
  it("shows no overall percentage and no stage worked out here", () => {
    expect(parts).not.toMatch(/\.percent\b/);
    expect(boards.match(/\.percent\b/g)).toHaveLength(1); // practice accuracy only, on its own tile
    expect(boards).toContain("deliberately not averaged");
    expect(parts).not.toMatch(/Novice|Expert/);
  });
  it("keeps self-assessment, approved stage and independent verification in their own columns", () => {
    for (const w of ["Self-assessment", "Approved stage", "Independently verified"]) expect(parts).toContain(w);
  });
  it("uses the one evaluation engine for both screens, with no second scoring", () => {
    expect(boards).toContain("evaluateScope(");
    expect(page).toContain("loadGoalCards(");
    expect(page).toContain("loadCompetencyRows(");
    expect(boards).not.toMatch(/\.from\("/);
    expect(page).not.toMatch(/\.from\("/);
  });
  it("keeps My Progress read only: no start, keep or decide control on its dashboards", () => {
    for (const s of [boards, parts]) { expect(s).not.toContain("KeepContinuous"); expect(s).not.toContain("EvaluationStart"); expect(s).not.toContain("NextActionsCard"); }
    expect(progress).toContain("ProgressTabsNav");
  });
  it("leaves accept, later and dismiss with the learner, on the existing next actions", () => {
    expect(page).toContain("loadNextActions(");
    expect(page).toContain("<NextActionsCard");
  });
});
