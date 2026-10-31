import { describe, expect, it } from "vitest";
import { TOPICS_NONE, TOPICS_UNREAD, competenciesFound, noProgrammeText, relinkTargets, topicPractice, topicsOf, topicsState } from "./classify-view";
import { competencyAbsence } from "./competency-view";

const concepts = new Map<string, string[]>([
  ["c1", ["Oxygen therapy", "Hypoxaemia"]],
  ["c2", ["oxygen  therapy", "Target saturation"]],
  ["c3", []],
]);

describe("topics found across sections (Classify, in context)", () => {
  it("one topic per name, case and spacing aside, most frequent first, in section order", () => {
    expect(topicsOf(concepts, ["c1", "c2", "c3"])).toEqual([
      { name: "Oxygen therapy", chunkIds: ["c1", "c2"] },
      { name: "Hypoxaemia", chunkIds: ["c1"] },
      { name: "Target saturation", chunkIds: ["c2"] },
    ]);
    expect(topicsOf(new Map())).toEqual([]);
  });
});

describe("competency links found in a material", () => {
  const m = (id: string, chunkId: string, competencyId: string, state: "proposed" | "accepted" | "rejected", outcome: string | null = null) =>
    ({ id, chunkId, competencyId, state, title: competencyId.toUpperCase(), code: null, layer: "core", contentStatus: "draft", outcome });
  it("groups by competency, keeps suggestions apart from decisions, and lists what waits for a decision first", () => {
    const found = competenciesFound([
      m("1", "c1", "k-acc", "accepted"), m("2", "c2", "k-acc", "accepted"),
      m("3", "c1", "k-sug", "proposed", "Records saturation"), m("4", "c2", "k-sug", "accepted"),
      m("5", "c1", "k-rej", "rejected"),
      m("6", "c1", "k-mix", "accepted"), m("7", "c2", "k-mix", "rejected"),
    ]);
    expect(found.map(f => [f.competencyId, f.state])).toEqual([["k-sug", "proposed"], ["k-mix", "mixed"], ["k-acc", "accepted"], ["k-rej", "rejected"]]);
    expect(found[0]).toMatchObject({ proposedIds: ["3"], accepted: 1, chunkIds: ["c1", "c2"], outcomes: ["Records saturation"] });
  });
});

describe("practice by topic: practice, never a score where there is none", () => {
  it("counts questions on a topic's sections, answered, and right on the latest try", () => {
    const qs = [{ id: "q1", chunkId: "c1" }, { id: "q2", chunkId: "c1" }, { id: "q3", chunkId: "c2" }];
    const at = [
      { questionId: "q1", correct: false, answeredAt: "2026-10-01T10:00:00Z" }, { questionId: "q1", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
      { questionId: "q3", correct: false, answeredAt: "2026-10-03T10:00:00Z" },
    ];
    const t = topicPractice(concepts, qs, at);
    expect(t.find(x => x.name === "Oxygen therapy")).toEqual({ name: "Oxygen therapy", sections: 2, questions: 3, answered: 2, rightLatest: 1 });
    expect(t.find(x => x.name === "Hypoxaemia")).toEqual({ name: "Hypoxaemia", sections: 1, questions: 2, answered: 1, rightLatest: 1 });
    expect(topicPractice(concepts, [], []).every(x => x.answered === 0 && x.rightLatest === 0)).toBe(true);
  });
});

describe("honest absence where no programme or catalogue is configured", () => {
  const none = { provisioned: true, programme: null, competencies: null, belowFloor: 0 };
  it("does not ask the student to choose when Competen offers no programme (production today)", () => {
    expect(competencyAbsence(none, 0)).toBe(noProgrammeText(0));
    expect(noProgrammeText(0)).toMatch(/has not set up a programme/);
    expect(noProgrammeText(0)).not.toMatch(/Choose your programme/);
    expect(noProgrammeText(0)).toMatch(/still finds the topics/);
  });
  it("asks the student to choose when programmes are offered, or when that cannot be read", () => {
    expect(competencyAbsence(none, 3)).toMatch(/Choose your programme in My Learning/);
    expect(competencyAbsence(none)).toMatch(/Choose your programme in My Learning/);
    expect(competencyAbsence({ ...none, provisioned: false }, 0)).toBeNull();
  });
});

describe("SCHOLAR-UPLOAD-FIX: the topics line", () => {
  it("says how far topic finding has got while sections wait, never 'none'", () => {
    expect(topicsState({ consent: true, analysed: 12, sections: 47, topics: 0 })).toEqual({ kind: "finding", text: "Finding topics… 12 of 47 sections" });
    expect(topicsState({ consent: true, analysed: 0, sections: 1, topics: 0 }).text).toBe("Finding topics… 0 of 1 section");
    // Topics already found are shown, with the progress line beside them until every section is done.
    expect(topicsState({ consent: true, analysed: 30, sections: 47, topics: 40 })).toEqual({ kind: "found", text: "Finding topics… 30 of 47 sections" });
    expect(topicsState({ consent: true, analysed: 47, sections: 47, topics: 277 })).toEqual({ kind: "found", text: null });
  });
  it("'No topics found' only when every section was analysed and none was found", () => {
    expect(topicsState({ consent: true, analysed: 47, sections: 47, topics: 0 })).toEqual({ kind: "none", text: TOPICS_NONE });
    expect(topicsState({ consent: false, analysed: 47, sections: 47, topics: 0 }).kind).toBe("none");
  });
  it("AI help off keeps the surface's own words; unreadable progress is said, not guessed", () => {
    expect(topicsState({ consent: false, analysed: 3, sections: 47, topics: 0 })).toEqual({ kind: "off", text: null });
    expect(topicsState({ consent: false, analysed: 3, sections: 47, topics: 5 })).toEqual({ kind: "found", text: null });
    expect(topicsState({ consent: true, analysed: null, sections: null, topics: 0 })).toEqual({ kind: "unread", text: TOPICS_UNREAD });
  });
});

describe("SCHOLAR-UPLOAD-FIX: which sections are re-linked", () => {
  const order = ["a", "b", "c", "d", "e"];
  const analysed = new Map<string, string | null>([["a", null], ["b", "BSN"], ["c", "RN-DIP"], ["e", null]]);
  it("the analysed sections recorded against no programme or another one, in document order", () => {
    expect(relinkTargets(order, analysed, "BSN")).toEqual(["a", "c", "e"]);
  });
  it("never a section not analysed yet (the ordinary run maps it), and nothing without a programme", () => {
    expect(relinkTargets(order, analysed, "BSN")).not.toContain("d");
    expect(relinkTargets(order, analysed, null)).toEqual([]);
    expect(relinkTargets(order, new Map([["a", "BSN"]]), "BSN")).toEqual([]);
  });
});
