import { describe, expect, it } from "vitest";
import { PRIMARY_MAX, STYLE_BLURB, STYLE_DEFAULTS, cleanStyleCode, effectiveStyle, moreItems, mistakeOffer, styleChoices, styleCode, styleFromCode, type StyleAvailability } from "./learn-style";
import { cleanUnfinished, mergeResume, parsePositionPut, type ServerPosition } from "./learn-position";
import { TEACHING_AI_ACTIVITY } from "./config";

const ALL = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask", "ask_me", "guide", "challenge", "mistake", "teach_back", "high_yield"];
const av = (over: Partial<StyleAvailability> = {}): StyleAvailability => ({ actions: ALL, consent: true, reasonOf: () => null, ...over });

describe("styleChoices", () => {
  it("shows Explain, Guide me and Challenge me, each running the existing action; Explain runs none", () => {
    const c = styleChoices(STYLE_DEFAULTS, av());
    expect(c.map(x => [x.style, x.action, x.disabled])).toEqual([["explain", null, false], ["guide", "guide", false], ["challenge", "challenge", false]]);
    expect(c.map(x => x.description)).toEqual([STYLE_BLURB.explain, STYLE_BLURB.guide, STYLE_BLURB.challenge]);
  });
  it("offers Ask me and Teach back inside Challenge me only", () => {
    const c = styleChoices(STYLE_DEFAULTS, av());
    expect(c[2].followOns.map(f => f.action)).toEqual(["ask_me", "teach_back"]);
    expect(c[0].followOns).toEqual([]);
    expect(c[1].followOns).toEqual([]);
  });
  it("never shows more than three primary choices", () => {
    expect(styleChoices(STYLE_DEFAULTS, av()).length).toBeLessThanOrEqual(PRIMARY_MAX);
  });
  it("hides a choice the style policy or the learning-actions policy hides; Explain is always there", () => {
    expect(styleChoices({ guide: "off", challenge: "on" }, av()).map(x => x.style)).toEqual(["explain", "challenge"]);
    expect(styleChoices({ guide: "on", challenge: "off" }, av()).map(x => x.style)).toEqual(["explain", "guide"]);
    expect(styleChoices({ guide: "off", challenge: "off" }, av()).map(x => x.style)).toEqual(["explain"]);
    expect(styleChoices(STYLE_DEFAULTS, av({ actions: ["teach"] })).map(x => x.style)).toEqual(["explain"]);
    expect(styleChoices(STYLE_DEFAULTS, av({ actions: ["teach", "challenge"] })).map(x => x.style)).toEqual(["explain", "challenge"]);
  });
  it("keeps a choice visible but disabled, with the reason, when its activity is unavailable (never bypassed)", () => {
    const c = styleChoices(STYLE_DEFAULTS, av({ reasonOf: a => (a === "guide" ? "not_eligible" : a === "teach_back" ? "allowance_exhausted" : null) }));
    expect(c[1]).toMatchObject({ style: "guide", disabled: true, reason: "not_eligible" });
    expect(c[2]).toMatchObject({ style: "challenge", disabled: false, reason: null });
    expect(c[2].followOns.find(f => f.action === "teach_back")).toMatchObject({ disabled: true, reason: "allowance_exhausted" });
    expect(c[2].followOns.find(f => f.action === "ask_me")).toMatchObject({ disabled: false });
    expect(c[0].disabled).toBe(false);
  });
  it("with AI help off the AI styles are disabled (the page says why), Explain stays usable", () => {
    const c = styleChoices(STYLE_DEFAULTS, av({ consent: false }));
    expect(c.map(x => x.disabled)).toEqual([false, true, true]);
    expect(c.every(x => x.reason === null)).toBe(true);
  });
  it("the underlying activities are the unchanged metering mapping", () => {
    expect(TEACHING_AI_ACTIVITY).toMatchObject({ guide: "explain", challenge: "check", ask_me: "check", teach_back: "clarify", mistake: "clarify", high_yield: "summary" });
  });
});

describe("moreItems", () => {
  it("holds the lesson's other classic actions and High-yield, never a style or Explain my mistake", () => {
    const m = moreItems(STYLE_DEFAULTS, av(), ["explain", "simplify", "summary"]);
    expect(m.map(x => [x.action, x.kind])).toEqual([["explain", "classic"], ["simplify", "classic"], ["summary", "classic"], ["high_yield", "approach"]]);
    expect(m.find(x => x.action === "simplify")!.label).toBe("Simplify");
    expect(m.find(x => x.action === "summary")!.label).toBe("Summarise");
    expect(m.map(x => x.action)).not.toContain("mistake");
    expect(m.map(x => x.action)).not.toContain("guide");
  });
  it("moves Ask me / Teach back here when Challenge me is hidden, so no capability is lost", () => {
    const m = moreItems({ ...STYLE_DEFAULTS, challenge: "off" }, av(), []);
    expect(m.map(x => x.action)).toEqual(["high_yield", "ask_me", "teach_back"]);
  });
  it("is empty when switched off, and only offers actions policy offers", () => {
    expect(moreItems({ ...STYLE_DEFAULTS, moreMenu: "off" }, av(), ["simplify"])).toEqual([]);
    expect(moreItems(STYLE_DEFAULTS, av({ actions: ["teach", "simplify"] }), ["simplify", "summary"]).map(x => x.action)).toEqual(["simplify"]);
  });
  it("carries the disabled reason", () => {
    const m = moreItems(STYLE_DEFAULTS, av({ reasonOf: a => (a === "high_yield" ? "level_insufficient" : null) }), []);
    expect(m[0]).toMatchObject({ action: "high_yield", disabled: true, reason: "level_insufficient" });
  });
});

describe("mistakeOffer", () => {
  it("appears only after a partly / not-yet check whose answer is kept", () => {
    expect(mistakeOffer(av(), "partly", true).show).toBe(true);
    expect(mistakeOffer(av(), "not_yet", true).show).toBe(true);
    expect(mistakeOffer(av(), "understood", true).show).toBe(false);
    expect(mistakeOffer(av(), null, true).show).toBe(false);
    expect(mistakeOffer(av(), "partly", false).show).toBe(false);
    expect(mistakeOffer(av({ actions: ["teach"] }), "partly", true).show).toBe(false);
  });
  it("is disabled with the reason when the activity is unavailable", () => {
    expect(mistakeOffer(av({ reasonOf: () => "not_eligible" }), "partly", true)).toEqual({ show: true, disabled: true, reason: "not_eligible" });
  });
});

describe("effectiveStyle", () => {
  it("falls back to Explain when the chosen style is hidden or disabled, and keeps it otherwise", () => {
    const ok = styleChoices(STYLE_DEFAULTS, av());
    expect(effectiveStyle("guide", ok)).toBe("guide");
    expect(effectiveStyle("challenge", ok)).toBe("challenge");
    expect(effectiveStyle("guide", styleChoices({ guide: "off", challenge: "on" }, av()))).toBe("explain");
    expect(effectiveStyle("challenge", styleChoices(STYLE_DEFAULTS, av({ reasonOf: a => (a === "challenge" ? "not_eligible" : null) })))).toBe("explain");
  });
});

describe("style persistence (790 unfinished.style)", () => {
  it("encodes and decodes: Explain is the default and is not stored", () => {
    expect(styleCode("explain")).toBeUndefined();
    expect(styleCode("guide")).toBe("g");
    expect(styleCode("challenge")).toBe("c");
    expect(styleFromCode("g")).toBe("guide");
    expect(styleFromCode("c")).toBe("challenge");
    for (const bad of [undefined, null, "", "x", "guide", 1, {}]) expect(styleFromCode(bad)).toBe("explain");
    expect(cleanStyleCode("g")).toBe("g");
    expect(cleanStyleCode("zz")).toBeUndefined();
  });
  it("is kept by cleanUnfinished beside the practice state and marks, and unknown codes are dropped", () => {
    expect(cleanUnfinished({ v: 1, style: "c", practiceOpen: 2, recall: { "1": "r" } })).toEqual({ v: 1, practiceOpen: 2, recall: { "1": "r" }, style: "c" });
    expect(cleanUnfinished({ v: 1, style: "g" })).toEqual({ v: 1, style: "g" });
    expect(cleanUnfinished({ v: 1, style: "nope" })).toBeNull();
  });
  it("travels through the position write and comes back from mergeResume", () => {
    const body = { deviceId: "deviceBBBB", clientSeq: 5, baseRevision: null, clientUpdatedAt: "2026-11-01T10:00:00.000Z", step: 1, furthestStep: 1, cardId: "lesson-1", sectionChunkId: null, offsetHint: null, lastCompletedActivity: null, lastCompletedAt: null, unfinished: { v: 1, style: "g" } };
    const r = parsePositionPut(body, Date.parse("2026-11-01T10:01:00.000Z"));
    expect(r.ok && r.value.unfinished).toEqual({ v: 1, style: "g" });
    const server = { step: 1, furthestStep: 1, cardId: "lesson-1", sectionChunkId: null, offsetHint: null, lastCompletedActivity: null, lastCompletedAt: null, unfinished: { v: 1, style: "c" }, deviceId: "deviceAAAA", clientSeq: 1, clientUpdatedAt: "2026-11-01T10:00:00.000Z", revision: 2, updatedAt: "2026-11-01T10:00:01.000Z" } as ServerPosition;
    expect(mergeResume({ steps: [0, 1, 2], fallback: 0, local: null, server }).style).toBe("challenge");
    expect(mergeResume({ steps: [0, 1, 2], fallback: 0, local: null, server: { ...server, unfinished: null } }).style).toBe("explain");
    expect(mergeResume({ steps: [0, 1, 2], fallback: 0, local: null, server: null }).style).toBe("explain");
  });
});
