import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { withRetrieval, RETRIEVAL_HREFS, prerequisiteDecisions, transferOffers } from "./retention-data";
import { buildRetrievalSchedule } from "./retrieval-schedule";
import { DEFAULT_POLICY } from "../policy";
import type { StudyNext } from "./mastery";
import type { StateEvidence } from "./learning-state";
import type { StateInputs } from "./learning-state-data";

const next = (id: string, tier: StudyNext["tier"]): StudyNext => ({ id, tier, title: id, reason: "r", action: { space: "learn", label: "Open", href: `/x/${id}` }, covers: [] });
const ev = (o: Partial<StateEvidence> & { itemId: string }): StateEvidence => ({
  attemptId: null, topicKey: "oxygen therapy", chunkId: "c1", materialId: "m1", source: "practice", level: "understanding",
  outcome: 1, marking: "code", at: "2026-10-20T09:00:00Z", confidence: null, misconceptions: [], ...o,
});
const inputs: StateInputs = {
  topics: [{ key: "oxygen therapy", label: "Oxygen therapy", materialId: "m1", chunkIds: ["c1"] }],
  evidence: [ev({ itemId: "a" }), ev({ itemId: "b" })], exposure: [], cards: [], transferRead: true,
};
const schedule = buildRetrievalSchedule({ topics: inputs.topics, evidence: inputs.evidence, cards: [], today: "2026-11-04", plan: null, hrefs: RETRIEVAL_HREFS });

describe("SALE-2026-11 R2 retention reads", () => {
  it("withRetrieval puts due retrieval after needs-work items and before the rest, within the cap", () => {
    const own = [next("needs-1", "needs_work"), next("step-1", "step_up"), next("due-cards", "due_cards"), next("fresh-1", "unpractised"), next("x", "other")];
    const out = withRetrieval(own, schedule);
    expect(out.map(o => o.id)).toEqual(["needs-1", "retrieval-oxygen therapy", "step-1", "due-cards", "fresh-1"]);
    expect(out[1]).toMatchObject({ title: "Recall Oxygen therapy", action: { space: "revise", label: "Recall it now" } });
    expect(out[1].action.href).toMatch(/study\/revise\?material=m1&sections=c1$/);
  });
  it("withRetrieval leaves Study next unchanged with nothing due or the schedule off", () => {
    const own = [next("needs-1", "needs_work")];
    expect(withRetrieval(own, null)).toEqual(own);
    expect(withRetrieval(own, { ...schedule, due: [] })).toEqual(own);
  });
  it("the prerequisite and transfer reads are empty while their keys are off (the default)", () => {
    expect(DEFAULT_POLICY.scholarPrerequisiteSuggestions).toBe("off");
    expect(prerequisiteDecisions(inputs, { catalogue: new Map(), sections: [], byChunk: new Map() }, DEFAULT_POLICY).size).toBe(0);
    expect(transferOffers(inputs, DEFAULT_POLICY).size).toBe(0);
  });
  it("transfer offers need 970 to have been read, then follow rule X1", () => {
    const on = { ...DEFAULT_POLICY, scholarTransferChecks: "on" as const };
    expect(transferOffers({ ...inputs, transferRead: false }, on).size).toBe(0);
    expect(transferOffers(inputs, on).get("oxygen therapy")).toMatchObject({ offered: true });
  });
});
