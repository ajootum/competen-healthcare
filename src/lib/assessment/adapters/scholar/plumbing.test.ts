import { describe, expect, it } from "vitest";
import { OLD_LEAVES, OLD_LEAF_TARGET, redirectFor } from "./redirects";
import { PENDING_PREFIX, SAVE_DEBOUNCE_MS, confirmPatch, pendingKey, queuePatch, readPending, saveStatusOf, writePending, type PendingPatch } from "./autosave";
import { fromDbValue, responsesFromRows, splitKey, toDbValue } from "./answers";
import { progressionAfterSubmit, unansweredItems, unansweredMandatory } from "./submit-check";
import { RA, RESP_ASSESS } from "../../core/fixtures";
import { SELF_ATTESTATION, CONTEXT_PRODUCT_LINE } from "./vocab";

describe("the old My Competencies pages", () => {
  it("each lands on the section that took over its job", () => {
    expect(OLD_LEAVES.map(l => redirectFor(l))).toEqual([
      "/individual/scholar/my-competencies",
      "/individual/scholar/my-competencies#frameworks",
      "/individual/scholar/my-competencies#gaps",
      "/individual/scholar/my-competencies/assessments#practice",
      "/individual/scholar/my-competencies/evidence#verification",
    ]);
    expect(Object.keys(OLD_LEAF_TARGET).sort()).toEqual([...OLD_LEAVES].sort());
  });
  it("carries an open study session before the fragment, and a bad one never", () => {
    const study = "11111111-1111-4111-8111-111111111111";
    expect(redirectFor("gaps", study)).toBe(`/individual/scholar/my-competencies?study=${study}#gaps`);
    expect(redirectFor("profile", study)).toBe(`/individual/scholar/my-competencies?study=${study}`);
    expect(redirectFor("gaps", "../../x")).toBe("/individual/scholar/my-competencies#gaps");
    expect(redirectFor("gaps", null)).toBe("/individual/scholar/my-competencies#gaps");
  });
});

describe("autosave queue", () => {
  const p = (key: string, at: number, value: unknown = { level_code: "L3" }): PendingPatch => ({ key, value, revision: 0, at });
  it("debounces at about 800 ms", () => expect(SAVE_DEBOUNCE_MS).toBe(800));
  it("keeps only the newest unsaved answer per item", () => {
    const q = queuePatch(queuePatch([], p("a", 1)), p("a", 2, { level_code: "L5" }));
    expect(q).toHaveLength(1);
    expect(q[0].value).toEqual({ level_code: "L5" });
  });
  it("a confirmed answer leaves the queue, but a newer unsaved one for the same item stays", () => {
    expect(confirmPatch([p("a", 5)], "a", 5)).toEqual([]);
    expect(confirmPatch([p("a", 9)], "a", 5)).toHaveLength(1);
    expect(confirmPatch([p("a", 5), p("b", 5)], "a", 5).map(x => x.key)).toEqual(["b"]);
  });
  it("replays what sessionStorage holds for THIS instance only, and an unreadable store is an empty queue", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    writePending(store, "inst-1", [p("a", 1)]);
    expect(readPending(store, "inst-1")).toHaveLength(1);
    expect(readPending(store, "inst-2")).toEqual([]);
    expect(pendingKey("inst-1").startsWith(PENDING_PREFIX)).toBe(true);
    writePending(store, "inst-1", []);
    expect(mem.size).toBe(0);
    mem.set(pendingKey("bad"), "{nope");
    expect(readPending(store, "bad")).toEqual([]);
    mem.set(pendingKey("bad"), JSON.stringify([{ key: 7 }, { key: "x", revision: 1, at: 2 }]));
    expect(readPending(store, "bad")).toHaveLength(1);
    expect(readPending(null, "x")).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readPending(throwing, "x")).toEqual([]);
    expect(() => writePending(throwing, "x", [p("a", 1)])).not.toThrow();
  });
  it("says Saving, Saved, Offline and Conflict", () => {
    const o = { inFlight: false, queued: 0, offline: false, conflict: false, everSaved: false };
    expect(saveStatusOf(o)).toBe("idle");
    expect(saveStatusOf({ ...o, queued: 2 })).toBe("saving");
    expect(saveStatusOf({ ...o, inFlight: true })).toBe("saving");
    expect(saveStatusOf({ ...o, everSaved: true })).toBe("saved");
    expect(saveStatusOf({ ...o, queued: 1, offline: true })).toBe("offline");
    expect(saveStatusOf({ ...o, queued: 1, offline: true, conflict: true })).toBe("conflict");
  });
});

describe("answers on the wire and in the database", () => {
  it("stores exactly one of level, state or value, and treats null-valued keys as absent", () => {
    expect(toDbValue({ level_code: "L4", state: null, value: null })).toEqual({ level_code: "L4" });
    expect(toDbValue({ state: "unable_to_determine", reason: " not sure " })).toEqual({ state: "unable_to_determine", reason: "not sure" });
    expect(toDbValue({ value: 0 })).toEqual({ value: 0 });
    expect(toDbValue({ value: "yes" })).toEqual({ value: "yes" });
  });
  it("treats nothing as Not answered: no row, never a stored not_assessed", () => {
    expect(toDbValue(null)).toBeNull();
    expect(toDbValue({})).toBeNull();
    expect(toDbValue({ level_code: null, state: null, value: null })).toBeNull();
    expect(toDbValue({ value: "" })).toBeNull();
  });
  it("reads a stored answer back, and refuses a shape that is not one", () => {
    expect(fromDbValue({ level_code: "L3" })).toEqual({ level_code: "L3" });
    expect(fromDbValue({ state: "not_observed", reason: "r" })).toEqual({ state: "not_observed", reason: "r" });
    expect(fromDbValue({ value: 4 })).toEqual({ value: 4 });
    expect(fromDbValue(null)).toBeNull();
    expect(fromDbValue([])).toBeNull();
    expect(fromDbValue({ other: 1 })).toBeNull();
  });
  it("splits response keys: an item, or an item and one of its extra fields", () => {
    const k = "00000000-0000-4000-8000-000000000011";
    expect(splitKey(k)).toEqual({ itemKey: k, fieldKey: "primary" });
    expect(splitKey(`${k}#agreement`)).toEqual({ itemKey: k, fieldKey: "agreement" });
    expect(splitKey("nope")).toBeNull();
    expect(splitKey(`${k}#Bad Field`)).toBeNull();
    expect(splitKey(`${k}#a#b`)).toBeNull();
  });
  it("keys responses and revisions the way the engine does", () => {
    const stable = new Map([["id1", "00000000-0000-4000-8000-000000000011"]]);
    const out = responsesFromRows([{ item_id: "id1", field_key: "primary", value: { level_code: "L2" }, revision: 3 }, { item_id: "gone", field_key: "primary", value: { level_code: "L2" }, revision: 1 }], stable);
    expect(out.responses).toEqual({ "00000000-0000-4000-8000-000000000011": { level_code: "L2" } });
    expect(out.revisions["00000000-0000-4000-8000-000000000011"]).toBe(3);
  });
});

describe("before submit", () => {
  it("lists the unanswered items and, apart, the mandatory ones", () => {
    const r = { [RA.k2]: { level_code: "L3" }, [RA.cs2]: { state: "unable_to_demonstrate" as const } };
    const all = unansweredItems(RESP_ASSESS, r);
    expect(all.map(i => i.code)).toEqual(["RA-K-01", "RA-CS-01", "RA-AP-01"]);
    expect(unansweredMandatory(all).map(i => i.code)).toEqual(["RA-K-01", "RA-CS-01"]);
    expect(all.find(i => i.code === "RA-CS-01")?.critical).toBe(true);
  });
  it("lists a deliberately unjudged required criterion in its own words, because the scoring rules still treat it as not answered", () => {
    const k1 = unansweredItems(RESP_ASSESS, { [RA.k1]: { state: "unable_to_determine" } }).find(i => i.code === "RA-K-01");
    expect(k1?.why).toBe("unable_to_judge");
    expect(unansweredItems(RESP_ASSESS, {}).find(i => i.code === "RA-K-01")?.why).toBe("not_answered");
  });
});

describe("self is self-reported and never advances a stage", () => {
  it("records a Scholar instance as self_reported under the Individual product line", () => {
    expect(SELF_ATTESTATION).toBe("self_reported");
    expect(CONTEXT_PRODUCT_LINE).toBe("individual");
  });
  it("records no progression for a self-reported submit, and leaves an assessor's eligible", () => {
    expect(progressionAfterSubmit("self_reported")).toMatchObject({ recorded: false });
    expect(progressionAfterSubmit("ai_assisted_formative")).toMatchObject({ recorded: false });
    expect(progressionAfterSubmit("assessor_evaluated")).toEqual({ recorded: "eligible" });
  });
});
