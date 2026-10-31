import { describe, expect, it } from "vitest";
import { buildMastery, DEFAULT_MASTERY_THRESHOLDS, hrefKey, mergeStudyNext, type MasteryEvidence, type MasteryLevel, type MasteryMarking } from "./mastery";
import type { Recommendation } from "./intelligence";

// SCHOLAR-COMPANION-01 P1: learning progress by topic and competency, and what to study next. Pure.

const NOW = "2026-10-31T12:00:00Z";
const M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const K1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const S = "22222222-2222-4222-8222-222222222222";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

let n = 0;
const ev = (o: Partial<MasteryEvidence> & { topic?: string | null; ok?: boolean; ago?: number; level?: MasteryLevel; marking?: MasteryMarking }): MasteryEvidence => ({
  itemId: o.itemId ?? `q${n++}`, topic: o.topic === undefined ? "Sepsis" : o.topic, competencyId: o.competencyId ?? null, materialId: o.materialId ?? M1, chunkId: o.chunkId ?? null,
  kind: o.kind ?? "question", level: o.level ?? "recall", correct: o.correct ?? o.ok ?? true, score: o.score, at: o.at ?? daysAgo(o.ago ?? 1), marking: o.marking ?? "code",
});
const many = (k: number, o: Parameters<typeof ev>[0]) => Array.from({ length: k }, () => ev(o));
const topicOf = (rows: MasteryEvidence[], label = "Sepsis", extra: Partial<Parameters<typeof buildMastery>[0]> = {}) =>
  buildMastery({ evidence: rows, now: NOW, ...extra }).topics.find(t => t.label === label)!;

describe("status thresholds", () => {
  it("is not_started, with null accuracy (never 0), when a known topic has no evidence", () => {
    const r = buildMastery({ evidence: [], now: NOW, knownTopics: [{ topic: "Sepsis", materialId: M1, chunkId: null }] });
    expect(r.topics[0]).toMatchObject({ status: "not_started", attempts: 0, recentAccuracy: null, highestLevel: null });
    expect(r.topics[0].basis).toMatch(/No answers recorded/);
  });
  it("needs_work below the developing line, developing between, secure at the secure line with enough evidence", () => {
    expect(topicOf([...many(1, { ok: true }), ...many(3, { ok: false })]).status).toBe("needs_work");
    expect(topicOf([...many(3, { ok: true }), ...many(2, { ok: false })]).status).toBe("developing"); // 60%
    expect(topicOf(many(4, { ok: true })).status).toBe("secure");
  });
  it("a high percentage on too little evidence is developing, not secure", () => {
    const t = topicOf(many(2, { ok: true }));
    expect(t.recentAccuracy).toBe(100);
    expect(t.status).toBe("developing");
    expect(t.basis).toMatch(/not yet enough evidence/);
  });
  it("thresholds are overridable (policy bands)", () => {
    const rows = [...many(3, { ok: true }), ...many(2, { ok: false })];
    expect(buildMastery({ evidence: rows, now: NOW, thresholds: { developingPercent: 70 } }).topics[0].status).toBe("needs_work");
    expect(DEFAULT_MASTERY_THRESHOLDS.securePercent).toBe(80);
  });
  it("states its basis in words and never calls itself competence", () => {
    const t = topicOf(many(4, { ok: true }));
    expect(t.basis).toMatch(/4 answers in the last 180 days \(4 marked by the app\)/);
    expect(t.basis).toMatch(/not verified competence/);
  });
});

describe("recency weighting", () => {
  it("counts a recent answer more than an old one", () => {
    const recentWrong = topicOf([ev({ ok: true, ago: 60 }), ev({ ok: true, ago: 59 }), ev({ ok: false, ago: 0 })]);
    const oldWrong = topicOf([ev({ ok: false, ago: 60 }), ev({ ok: true, ago: 1 }), ev({ ok: true, ago: 0 })]);
    expect(oldWrong.recentAccuracy!).toBeGreaterThan(recentWrong.recentAccuracy!);
  });
  it("halves an answer's weight every half-life", () => {
    // one right today (w 1) and one wrong 14 days ago (w 0.5): 1 / 1.5 = 67%
    expect(topicOf([ev({ ok: true, ago: 0 }), ev({ ok: false, ago: 14 })]).recentAccuracy).toBe(67);
  });
  it("uses a graded score where there is one", () => {
    expect(topicOf([ev({ score: 0.25, ago: 0 })]).recentAccuracy).toBe(25);
  });
});

describe("level ladder", () => {
  it("demonstrates a level with at least 2 correct and at least 70% at it", () => {
    const rows = [...many(2, { level: "recall" }), ...many(2, { level: "understanding" }), ...many(1, { level: "application" })];
    const t = topicOf(rows);
    expect(t.highestLevel).toBe("understanding");
    expect(t.byLevel.find(l => l.level === "application")).toMatchObject({ attempts: 1, demonstrated: false });
  });
  it("2 right of 4 at a level (50%) is not demonstrated", () => {
    const t = topicOf([...many(2, { level: "application", ok: true }), ...many(2, { level: "application", ok: false }), ...many(2, { level: "recall" })]);
    expect(t.highestLevel).toBe("recall");
  });
  it("AI and self evidence is weighted lower in demonstrating a level", () => {
    expect(topicOf(many(2, { level: "reasoning", marking: "ai_evaluation" })).highestLevel).toBeNull();
    expect(topicOf(many(4, { level: "reasoning", marking: "ai_evaluation" })).highestLevel).toBe("reasoning");
    expect(topicOf(many(2, { level: "reasoning", marking: "code" })).highestLevel).toBe("reasoning");
  });
  it("unknown-level evidence counts towards accuracy but never towards a level", () => {
    const t = topicOf(many(5, { level: "unknown" }));
    expect(t.highestLevel).toBeNull();
    expect(t.status).toBe("secure");
    expect(t.byLevel.some(l => l.level === "unknown")).toBe(true);
  });
});

describe("AI and self evidence is separated and weighted lower", () => {
  it("counts by marking on every entry, and in the total", () => {
    const rows = [...many(2, { marking: "code" }), ...many(3, { marking: "ai_evaluation" }), ...many(1, { marking: "self" })];
    const r = buildMastery({ evidence: rows, now: NOW });
    expect(r.topics[0].byMarking).toEqual({ code: 2, ai_evaluation: 3, self: 1 });
    expect(r.byMarking).toEqual({ code: 2, ai_evaluation: 3, self: 1 });
    expect(r.topics[0].basis).toMatch(/2 marked by the app, 3 AI-evaluated, 1 self-rated/);
  });
  it("self-rated and AI wrong answers move accuracy less than app-marked ones", () => {
    const codeWrong = topicOf([...many(2, { ok: true }), ev({ ok: false, marking: "code" })]).recentAccuracy!;
    const selfWrong = topicOf([...many(2, { ok: true }), ev({ ok: false, marking: "self" })]).recentAccuracy!;
    expect(selfWrong).toBeGreaterThan(codeWrong);
  });
  it("cannot be secure on AI-evaluated answers alone until there is enough weight", () => {
    expect(topicOf(many(3, { marking: "ai_evaluation" })).status).toBe("developing");
    expect(topicOf(many(6, { marking: "ai_evaluation" })).status).toBe("secure");
  });
});

describe("weak concepts", () => {
  it("lists items missed twice or more, or whose latest answer was wrong", () => {
    const rows = [
      ev({ itemId: "a", ok: false, ago: 5 }), ev({ itemId: "a", ok: false, ago: 3 }), ev({ itemId: "a", ok: true, ago: 1 }),
      ev({ itemId: "b", ok: true, ago: 5 }), ev({ itemId: "b", ok: false, ago: 1 }),
      ev({ itemId: "c", ok: false, ago: 9 }), ev({ itemId: "c", ok: true, ago: 2 }),
    ];
    const w = topicOf(rows).weakConcepts;
    expect(w.map(x => x.itemId)).toEqual(["a", "b"]);
    expect(w[0]).toMatchObject({ misses: 2, latestWrong: false });
    expect(w[1]).toMatchObject({ misses: 1, latestWrong: true });
  });
});

describe("competencies", () => {
  it("count only evidence tied to a programme competency, and a linked competency with no evidence is not_started", () => {
    const rows = [...many(4, { competencyId: C1 }), ...many(3, { competencyId: "outside" })];
    const r = buildMastery({
      evidence: rows, now: NOW, competencies: [{ id: C1, title: "Recognise sepsis" }, { id: K1, title: "Give fluids" }],
      mappedSections: [{ chunkId: "ch9", materialId: M1, label: "Fluids", competencyId: K1, competencyTitle: "Give fluids" }],
    });
    expect(r.competencies.map(c => [c.label, c.status])).toEqual([["Recognise sepsis", "secure"], ["Give fluids", "not_started"]]);
  });
});

describe("study next", () => {
  const weakTopic = (label: string, wrongRecent: number) => [
    ...many(2, { topic: label, ok: true, ago: 40 }), ...many(wrongRecent, { topic: label, ok: false, ago: 1, materialId: M2 }),
  ];
  it("ranks needs_work with recent misses first, then step-ups, then due cards, then never-practised sections", () => {
    const rows = [
      ...weakTopic("Heart failure", 4),
      ...[...many(2, { topic: "Asthma", ok: true, level: "recall", chunkId: "ch1" }), ev({ topic: "Asthma", ok: false, level: "recall", chunkId: "ch1" })],
    ];
    const r = buildMastery({
      evidence: rows, now: NOW, competencies: [{ id: C1, title: "Recognise sepsis" }],
      dueCards: [{ materialId: M1, materialTitle: "Cardiology notes", due: 3 }],
      mappedSections: [{ chunkId: "ch7", materialId: M1, label: "Sepsis screening", competencyId: C1, competencyTitle: "Recognise sepsis" }],
    });
    expect(r.studyNext.map(s => s.tier)).toEqual(["needs_work", "step_up", "due_cards", "unpractised"]);
    expect(r.studyNext[0].title).toMatch(/Heart failure/);
    expect(r.studyNext[0].reason).toBe("4 of your last 5 answers were wrong on Heart failure, and your recent accuracy is 7%.");
    expect(r.studyNext[0].action.space).toBe("learn");
    expect(r.studyNext[0].action.href).toBe("/individual/scholar/study/learn?topic=Heart%20failure");
    expect(r.studyNext[1].action).toMatchObject({ space: "revise" });
    expect(r.studyNext[1].reason).toMatch(/developing on Asthma/);
  });
  it("orders needs_work topics by recent misses", () => {
    const rows = [...weakTopic("A", 2), ...weakTopic("B", 5)];
    expect(buildMastery({ evidence: rows, now: NOW }).studyNext.map(s => s.title)).toEqual(["Go back over B", "Go back over A"]);
  });
  it("steps a developing topic up one level, to an Apply scenario at application when the section is known", () => {
    const rows = [...many(3, { topic: "Asthma", level: "understanding", chunkId: "ch1" }), ev({ topic: "Asthma", ok: false, level: "understanding", chunkId: "ch1" })];
    const s = buildMastery({ evidence: rows, now: NOW }).studyNext[0];
    expect(s.tier).toBe("step_up");
    expect(s.title).toBe("Step up to application questions on Asthma");
    expect(s.action).toMatchObject({ space: "apply", href: "/individual/scholar/study/apply?section=ch1&from=revision" });
  });
  it("does not step up a topic already shown at application", () => {
    const rows = [...many(3, { topic: "Asthma", level: "application" }), ev({ topic: "Asthma", ok: false, level: "application" })];
    expect(buildMastery({ evidence: rows, now: NOW }).studyNext).toEqual([]);
  });
  it("caps at five and carries the connected study session on every link", () => {
    const rows = Array.from({ length: 8 }, (_, i) => weakTopic(`T${i}`, 2)).flat();
    const r = buildMastery({ evidence: rows, now: NOW, studyId: S });
    expect(r.studyNext).toHaveLength(5);
    for (const s of r.studyNext) expect(s.action.href).toContain(`study=${S}`);
    expect(buildMastery({ evidence: rows, now: NOW }).studyNext[0].action.href).not.toContain("study=");
  });
  it("a material stands in for a topic that was never named, and opens the material", () => {
    const rows = many(4, { topic: "Cardiology notes", ok: false, ago: 1 }).map(r => ({ ...r, topicSource: "material" as const }));
    const s = buildMastery({ evidence: rows, now: NOW }).studyNext[0];
    expect(s.action.href).toBe(`/individual/scholar/study/${M1}`);
    expect(s.title).toBe('Go back over your notes "Cardiology notes"');
  });
  it("groups never-practised sections by competency, skipping sections that have any evidence", () => {
    const r = buildMastery({
      evidence: [ev({ chunkId: "ch1", topic: null })], now: NOW, competencies: [{ id: C1, title: "Recognise sepsis" }],
      mappedSections: [
        { chunkId: "ch1", materialId: M1, label: "Done", competencyId: C1, competencyTitle: "Recognise sepsis" },
        { chunkId: "ch2", materialId: M1, label: "Screening", competencyId: C1, competencyTitle: "Recognise sepsis" },
        { chunkId: "ch3", materialId: M1, label: "Triage", competencyId: C1, competencyTitle: "Recognise sepsis" },
      ],
    });
    expect(r.studyNext).toHaveLength(1);
    expect(r.studyNext[0].reason).toBe("2 sections of your notes linked to Recognise sepsis have no practice yet.");
    expect(r.studyNext[0].action.href).toBe("/individual/scholar/study/learn?section=ch2");
  });
});

describe("merge with learning intelligence", () => {
  const rec = (id: string, href: string | null, title = id): Recommendation => ({ id, priority: 50, title, reason: "because", href });
  const own = buildMastery({
    evidence: [...many(2, { topic: "X", ok: true, ago: 40 }), ...many(3, { topic: "X", ok: false, ago: 1 })], now: NOW,
    dueCards: [{ materialId: M1, materialTitle: "N", due: 2 }],
  }).studyNext;

  it("drops an intelligence item that points at the same place, or that one of ours covers", () => {
    const m = mergeStudyNext(own, [rec("review-due", "/individual/scholar/study/revise"), rec("revisit-" + M1, `/individual/scholar/study/${M1}`), rec("pick-up", `/individual/scholar/study/${M2}`)], 5);
    expect(m.items.filter(i => i.tier === "other").map(i => i.covers[0])).toEqual(["pick-up"]);
    expect(m.rest).toEqual([]);
  });
  it("treats the same place as equal whatever its study parameter or parameter order", () => {
    expect(hrefKey("/a/revise?material=1&difficulty=harder&study=" + S)).toBe(hrefKey("/a/revise?difficulty=harder&material=1"));
    const m = mergeStudyNext(own, [rec("x", `/individual/scholar/study/revise?material=${M1}&study=${S}`)], 5);
    expect(m.items.some(i => i.id === "intel-x")).toBe(false);
  });
  it("fills spare places with intelligence items that have a link, and leaves the rest to its own list", () => {
    const m = mergeStudyNext([], [rec("a", "/individual/scholar/study/apply"), rec("b", null), rec("c", "/individual/scholar/study")], 2, S);
    expect(m.items.map(i => i.id)).toEqual(["intel-a", "intel-c"]);
    expect(m.items[0].action).toMatchObject({ space: "apply", href: `/individual/scholar/study/apply?study=${S}` });
    expect(m.rest.map(r => r.id)).toEqual(["b"]);
  });
  it("never exceeds the cap", () => {
    const m = mergeStudyNext(own, Array.from({ length: 6 }, (_, i) => rec(`r${i}`, `/individual/scholar/study/${i}`)), 5);
    expect(m.items).toHaveLength(5);
  });
});

describe("evidence is bounded by the loader, and says so", () => {
  it("names unread older evidence in the basis when truncated", () => {
    expect(topicOf(many(4, {}), "Sepsis", { truncated: true }).basis).toMatch(/not counting older ones that were not read/);
  });
});
