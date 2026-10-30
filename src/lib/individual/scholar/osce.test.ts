/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { textGroundingViolations } from "@/lib/ai/grounding";
import { findPatientIdentifiers } from "./extract";
import {
  DEFAULT_OSCE_SECTIONS, OSCE_FEEDBACK_SYSTEM, OSCE_FEEDBACK_WITHHELD, OSCE_OFF, OSCE_PRACTICE_LABEL, OSCE_SOURCE_LABEL, OSCE_STATION_SYSTEM, OSCE_TEMPLATES,
  OSCE_UNAVAILABLE, OSCE_WITHHELD, TEMPLATE_CONTENT_STATUS, checkOsceDraft, claimsVerification, finishRun, normaliseResponses, normaliseSections,
  parseOsceFeedback, remediation, scoreSummary, scoreTicks, stationFromCompetency, stationFromTemplate, timerAnnouncement, timerState, validateChecklist,
  type OsceItem, type OscePassage,
} from "./osce";
import { DEFAULT_POLICY, policyPath, resolvePolicy } from "../policy";
import { osceSchema, resetOsceSchema } from "./store";
import { osceAvailability, osceGate } from "./osce-service";
import { FORMATIVE_NOTICE } from "./spaces";

const item = (id: string, critical = false, extra: Partial<OsceItem> = {}): OsceItem => ({ id, text: `Item ${id}`, critical, ...extra });
const six = ["a", "b", "c", "d", "e", "f"].map((id, i) => item(id, i % 2 === 0));

describe("the checklist, as 720 accepts it", () => {
  it("accepts 6 to 14 items, each with an id, text and a boolean critical", () => {
    expect(validateChecklist(six).ok).toBe(true);
    expect(validateChecklist([...six, ...["g", "h", "i", "j", "k", "l", "m", "n"].map(id => item(id))]).ok).toBe(true);
  });
  it("refuses too few, too many, duplicates and malformed items, each with a plain reason", () => {
    expect(validateChecklist(six.slice(0, 5))).toMatchObject({ ok: false });
    expect(validateChecklist(Array.from({ length: 15 }, (_, i) => item(`x${i}`)))).toMatchObject({ ok: false });
    expect(validateChecklist([...six.slice(0, 5), item("a")])).toEqual({ ok: false, reason: "Two checklist items share an id." });
    expect(validateChecklist([...six.slice(0, 5), { id: "z", text: "t", critical: "yes" }])).toMatchObject({ ok: false });
    expect(validateChecklist([...six.slice(0, 5), { id: "z", text: " ", critical: true }])).toMatchObject({ ok: false });
    expect(validateChecklist([...six.slice(0, 5), "plain text"])).toMatchObject({ ok: false });
    expect(validateChecklist([...six.slice(0, 5), { id: "z", text: "t", critical: true, outcome: 3 }])).toMatchObject({ ok: false });
    expect(validateChecklist("not a list")).toMatchObject({ ok: false });
  });
  it("narrower bounds from policy apply, wider ones never pass 720's", () => {
    expect(validateChecklist(six, { min: 8, max: 12 })).toMatchObject({ ok: false });
    expect(validateChecklist(Array.from({ length: 15 }, (_, i) => item(`x${i}`)), { min: 1, max: 40 })).toMatchObject({ ok: false });
  });
  it("the shipped template is a valid checklist, labelled not clinically reviewed, built from the respiratory seed outcomes", () => {
    for (const t of OSCE_TEMPLATES) {
      expect(validateChecklist(t.checklist).ok).toBe(true);
      const d = stationFromTemplate(t);
      expect(d).toMatchObject({ source: "template", templateKey: t.key, contentStatus: TEMPLATE_CONTENT_STATUS, model: null });
      expect(d.contentStatus).toMatch(/not clinically reviewed/);
    }
    const outcomes = OSCE_TEMPLATES[0].checklist.map(i => i.outcome).filter(Boolean);
    for (const seed of ["Measures respiratory rate over a full minute", "Interprets SpO2 against the prescribed target range", "Documents findings in the agreed format",
      "Recognises signs of respiratory distress", "Escalates using a structured handover", "Initiates first-line interventions within scope"]) expect(outcomes).toContain(seed);
  });
});

describe("response headings and responses", () => {
  it("defaults, trims, drops duplicates and keeps at most six headings", () => {
    expect(normaliseSections(undefined)).toEqual([...DEFAULT_OSCE_SECTIONS]);
    expect(normaliseSections("  Assessment \n\nassessment\nPlan")).toEqual(["Assessment", "Plan"]);
    expect(normaliseSections(Array.from({ length: 9 }, (_, i) => `H${i}`))).toHaveLength(6);
  });
  it("keeps only the station's own headings, trimmed", () => {
    expect(normaliseResponses({ Assessment: "  RR counted  ", Other: "x", Findings: "" }, ["Assessment", "Findings"])).toEqual({ Assessment: "RR counted" });
    expect(normaliseResponses("nope", ["A"])).toEqual({});
  });
});

describe("the timer and the finish, as pure functions", () => {
  const t0 = 1_000_000;
  it("counts down, warns in the last minute, and is up at zero", () => {
    expect(timerState(t0, 8, t0)).toEqual({ remainingSeconds: 480, warning: false, timeUp: false });
    expect(timerState(t0, 8, t0 + 420_000)).toEqual({ remainingSeconds: 60, warning: true, timeUp: false });
    expect(timerState(t0, 8, t0 + 479_500)).toMatchObject({ remainingSeconds: 1, warning: true });
    expect(timerState(t0, 8, t0 + 500_000)).toEqual({ remainingSeconds: 0, warning: false, timeUp: true });
  });
  it("announces only halfway, one minute and time up -- never every second", () => {
    const said: string[] = [];
    let prev = 480;
    for (let s = 479; s >= 0; s--) { const a = timerAnnouncement(prev, s, 8); if (a) said.push(a); prev = s; }
    expect(said).toEqual(["Halfway: 4 minutes left.", "One minute left.", "Time is up. What you wrote has been kept."]);
    expect(timerAnnouncement(30, 29, 8)).toBeNull();
  });
  it("a run's length is measured from the start and never exceeds the station", () => {
    expect(finishRun(t0, t0 + 125_400, 8)).toEqual({ durationSeconds: 125, timeUp: false });
    expect(finishRun(t0, t0 + 900_000, 8)).toEqual({ durationSeconds: 480, timeUp: true });
    expect(finishRun(t0, t0 - 5_000, 8)).toEqual({ durationSeconds: 0, timeUp: false });
  });
});

describe("scoring with critical misses", () => {
  const ticks = (marks: string[]) => six.map((i, n) => ({ itemId: i.id, mark: marks[n] }));
  it("done 1, partly half, missed 0, and the critical items missed are flagged", () => {
    const s = scoreTicks(six, ticks(["done", "done", "missed", "partly", "partly", "done"]));
    expect(s).toMatchObject({ ok: true, points: 4, outOf: 6, score: 0.667, criticalMissed: 1, criticalMissedIds: ["c"], criticalPartlyIds: ["e"] });
    if (s.ok) expect(scoreSummary(s)).toBe("Practice score 4 of 6 checklist points (67%) · 1 critical item missed");
  });
  it("every item must be marked once, with a known id and a known mark", () => {
    expect(scoreTicks(six, ticks(["done", "done", "done", "done", "done"]).slice(0, 5))).toMatchObject({ ok: false });
    expect(scoreTicks(six, [...ticks(Array(6).fill("done")), { itemId: "a", mark: "done" }])).toEqual({ ok: false, reason: "An item is marked twice." });
    expect(scoreTicks(six, [{ itemId: "zz", mark: "done" }])).toMatchObject({ ok: false });
    expect(scoreTicks(six, ticks(["passed", "done", "done", "done", "done", "done"]))).toMatchObject({ ok: false });
    expect(scoreTicks(six, "x")).toMatchObject({ ok: false });
  });
  it("a perfect run is still a practice score, never a pass", () => {
    const s = scoreTicks(six, ticks(Array(6).fill("done")));
    expect(s).toMatchObject({ ok: true, score: 1, criticalMissed: 0 });
    if (s.ok) { expect(scoreSummary(s)).toMatch(/no critical item missed/); expect(claimsVerification(scoreSummary(s))).toBe(false); }
  });
});

describe("a station from a competency (no AI)", () => {
  const resp001 = { id: "11111111-1111-1111-1111-111111111111", code: "COMP-RESP-001", title: "Performs a systematic respiratory assessment",
    outcomes: ["Measures respiratory rate over a full minute", "Interprets SpO2 against the prescribed target range", "Documents findings in the agreed format"], contentStatusLabel: "Not clinically reviewed" };
  it("each outcome becomes a critical item between the framing items, labelled with the competency's status", () => {
    const r = stationFromCompetency(resp001, 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.checklist).toHaveLength(7);
    expect(r.draft.checklist.filter(i => i.outcome).map(i => i.critical)).toEqual([true, true, true]);
    expect(r.draft).toMatchObject({ source: "competency", competencyId: resp001.id, contentStatus: "Competency content: Not clinically reviewed", model: null });
    expect(validateChecklist(r.draft.checklist).ok).toBe(true);
  });
  it("too few outcomes is refused with the reason, and too many are trimmed to 720's maximum", () => {
    expect(stationFromCompetency({ ...resp001, outcomes: ["one"] }, 8)).toMatchObject({ ok: false });
    const many = stationFromCompetency({ ...resp001, outcomes: Array.from({ length: 20 }, (_, i) => `Outcome ${i}`) }, 8);
    expect(many).toMatchObject({ ok: true, trimmed: 10 });
    if (many.ok) expect(many.draft.checklist).toHaveLength(14);
  });
});

describe("a station from the learner's notes: grounded, or withheld", () => {
  const notes = [
    "Count the respiratory rate for a full minute while the patient is at rest.",
    "Check oxygen saturation and compare it with the target range on the chart.",
    "Look for signs of respiratory distress such as use of accessory muscles.",
    "Listen to breath sounds on both sides of the chest.",
    "Escalate concerns to the nurse in charge using a structured handover.",
    "Explain the assessment to the patient and gain consent before starting.",
    "Document the findings in the agreed format after the assessment.",
    "Introduce yourself to the patient and confirm who they are.",
  ].join(" ");
  const passages: OscePassage[] = [{ chunkId: "c0000000-0000-0000-0000-000000000001", content: notes, citation: "Resp notes, page 1" }];
  const draft = (items: any[], over: Record<string, unknown> = {}) => JSON.stringify({
    title: "Respiratory assessment", scenario: "A patient on a ward needs a respiratory assessment. You check their breathing.",
    candidateInstructions: "Assess the patient's breathing and escalate concerns.", checklist: items, ...over,
  });
  const good = [
    { text: "Counts the respiratory rate for a full minute", critical: true, source: "S1", quote: "Count the respiratory rate for a full minute" },
    { text: "Checks oxygen saturation against the target range", critical: true, source: "S1", quote: "compare it with the target range on the chart" },
    { text: "Looks for signs of respiratory distress", critical: true, source: "S1", quote: "Look for signs of respiratory distress" },
    { text: "Listens to breath sounds on both sides of the chest", critical: false, source: "S1", quote: "Listen to breath sounds on both sides of the chest" },
    { text: "Escalates concerns using a structured handover", critical: true, source: "S1", quote: "using a structured handover" },
    { text: "Explains the assessment and gains consent", critical: true, source: "S1", quote: "gain consent before starting" },
    { text: "Documents the findings in the agreed format", critical: false, source: "S1", quote: "Document the findings in the agreed format" },
    { text: "Introduces themselves to the patient", critical: false, source: "S1", quote: "Introduce yourself to the patient" },
  ];
  const check = (raw: string, min = 8, max = 12) => checkOsceDraft(raw, passages, { min, max }, textGroundingViolations, findPatientIdentifiers);

  it("keeps a station whose every item quotes its passage", () => {
    const r = check(draft(good));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.items).toHaveLength(8); expect(r.items[0]).toMatchObject({ id: "i1", critical: true, chunkId: passages[0].chunkId }); }
  });
  it("drops an item whose quote is not in the passage, and withholds when too few survive", () => {
    const r = check(draft([...good.slice(0, 7), { text: "Gives oxygen at a set rate", critical: true, source: "S1", quote: "give oxygen at fifteen litres" }]));
    expect(r).toMatchObject({ ok: false, reason: "too_few_items", kept: 7 });
    if (!r.ok) expect(r.dropped).toContain("quote_not_in_passage");
    expect(OSCE_WITHHELD.too_few_items).toMatch(/Nothing was kept/);
  });
  it("drops an item that adds a number the notes do not contain", () => {
    const r = check(draft([...good, { text: "Counts a respiratory rate above 24", critical: true, source: "S1", quote: "Count the respiratory rate for a full minute" }]));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.items).toHaveLength(8); expect(r.dropped).toContain("ungrounded"); }
  });
  it("withholds the whole station when the brief is ungrounded or identifying, or the model declined", () => {
    expect(check(draft(good, { scenario: "A patient aged 74 has a respiratory rate of 32." }))).toMatchObject({ ok: false, reason: "ungrounded_brief" });
    expect(check(draft(good, { scenario: "Mr John Smith, NHS number 943 476 5919, needs assessing." }))).toMatchObject({ ok: false });
    expect(check(draft([]))).toMatchObject({ ok: false, reason: "not_supported" });
    expect(check("not json")).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("keeps at most the policy maximum", () => {
    const r = check(draft(good), 6, 6);
    expect(r.ok && r.items.length).toBe(6);
  });
});

describe("AI feedback on a run: suggestions the learner confirms, or withheld", () => {
  const items = six;
  const grounding = ["Item a", "Item b", "Item c", "Item d", "Item e", "Item f", "I counted the rate"];
  const parse = (raw: string) => parseOsceFeedback(raw, items, grounding, textGroundingViolations, findPatientIdentifiers);
  const reply = (extra = "") => ["ITEM a: done", "ITEM b: partly", "ITEM zz: done", "ITEM c: missed", "RIGHT: Item a", "MISSING: Item c", "MISCONCEPTIONS: none", "WHY: Item c matters", `NEXT: practise Item c${extra}`].join("\n");
  it("reads suggested ticks for known items and the five parts", () => {
    const f = parse(reply());
    expect(f).toMatchObject({ ok: true, suggested: [{ itemId: "a", mark: "done" }, { itemId: "b", mark: "partly" }, { itemId: "c", mark: "missed" }] });
    if (f.ok) expect(f.parts).toMatchObject({ right: ["Item a"], missing: ["Item c"], misconceptions: [], why: "Item c matters" });
  });
  it("withholds feedback that claims competence or a pass, adds numbers, or has no ticks", () => {
    expect(parse(reply(". You are competent."))).toEqual({ ok: false, reason: "verdict_words" });
    expect(parse(reply(" at 30 breaths"))).toEqual({ ok: false, reason: "ungrounded" });
    expect(parse("RIGHT: Item a")).toEqual({ ok: false, reason: "malformed" });
    expect(OSCE_FEEDBACK_WITHHELD).toMatch(/Mark each item yourself/);
  });
  it("the feedback prompt forbids marks, passes and competence claims", () => {
    expect(OSCE_FEEDBACK_SYSTEM).toMatch(/Never give a mark, a score, a percentage, a pass or a fail, and never say the student is competent/);
    expect(OSCE_STATION_SYSTEM).toMatch(/not an assessment/);
  });
});

describe("remediation after a run", () => {
  it("critical misses first, a notes section where the item has one, then Revise for the station's material", () => {
    const st = { checklist: [item("a"), item("b", true, { chunkId: "c0000000-0000-0000-0000-000000000009" }), item("c", false, { outcome: "Escalates" })], materialId: "m1", competencyId: null };
    const r = remediation(st, [{ itemId: "a", mark: "done" }, { itemId: "b", mark: "missed" }, { itemId: "c", mark: "partly" }]);
    expect(r.map(x => x.segment)).toEqual(["learn", "learn", "revise"]);
    expect(r[0].query).toEqual({ section: "c0000000-0000-0000-0000-000000000009", action: "teach" });
    expect(r[1]).toMatchObject({ label: "Learn: Escalates", query: { topic: "Escalates", action: "teach" } });
    expect(r[2].query).toEqual({ material: "m1" });
  });
});

describe("policy: on by default, bounded, coherent", () => {
  it("defaults: offered, 8 minutes, 8 to 12 items", () => {
    expect(DEFAULT_POLICY.scholarOsce).toEqual({ enabled: true, durationMinutes: 8, checklistMin: 8, checklistMax: 12 });
  });
  it("published values are clamped to 720's bounds, and the fewest never exceeds the most", () => {
    const p = resolvePolicy([
      { config_path: policyPath("scholar_osce"), published: { value: "off" } }, { config_path: policyPath("scholar_osce_duration_minutes"), published: { value: 45 } },
      { config_path: policyPath("scholar_osce_checklist_min"), published: { value: 13 } }, { config_path: policyPath("scholar_osce_checklist_max"), published: { value: 9 } },
    ]);
    expect(p.scholarOsce).toEqual({ enabled: false, durationMinutes: 20, checklistMin: 9, checklistMax: 9 });
  });
});

// A fake admin: every query on `table` resolves to what `answer` gives for it.
function fakeAdmin(answer: (table: string) => { data: any; error: any }) {
  const from = (table: string) => {
    const q: any = {};
    for (const m of ["select", "eq", "like", "limit", "order", "in", "is", "not", "maybeSingle", "single"]) q[m] = () => q;
    q.then = (res: any, rej: any) => Promise.resolve(answer(table)).then(res, rej);
    return q;
  };
  return { from };
}

describe("720 absent: detected once, shown as unavailable with a plain reason", () => {
  beforeEach(() => resetOsceSchema());
  const missing = fakeAdmin(t => t === "individual_scholar_osce_station" ? { data: null, error: { code: "42P01", message: "relation does not exist" } } : { data: [], error: null });
  const present = fakeAdmin(() => ({ data: [], error: null }));
  it("a missing relation is remembered as absent, a transient error is only 'no for now'", async () => {
    expect(await osceSchema(missing, "u1")).toBe(false);
    expect(await osceSchema(present, "u1")).toBe(false); // remembered for the process
    resetOsceSchema();
    const flaky = fakeAdmin(() => ({ data: null, error: { code: "57014", message: "timeout" } }));
    expect(await osceSchema(flaky, "u1")).toBe(false);
    expect(await osceSchema(present, "u1")).toBe(true);
  });
  it("the availability says unavailable, and a route answers 409 with the reason", async () => {
    expect(await osceAvailability(missing, "u1")).toEqual({ state: "unavailable" });
    const r = await osceGate(missing, "u1");
    expect((r as Response).status).toBe(409);
    expect(await (r as Response).json()).toEqual({ error: OSCE_UNAVAILABLE, unavailable: true });
    expect(OSCE_UNAVAILABLE).toMatch(/not available here yet/);
  });
  it("policy off: not offered, before the schema is even asked", async () => {
    const off = fakeAdmin(t => t === "workspace_config_overrides" ? { data: [{ config_path: policyPath("scholar_osce"), published: { value: "off" } }], error: null } : { data: null, error: { code: "42P01" } });
    expect(await osceAvailability(off, "u1")).toEqual({ state: "off" });
    expect(((await osceGate(off, "u1")) as Response).status).toBe(403);
    expect(OSCE_OFF).toMatch(/not offered/);
  });
  it("720 present and policy on: offered with the policy", async () => {
    expect(await osceAvailability(present, "u1")).toEqual({ state: "on", policy: DEFAULT_POLICY.scholarOsce });
  });
});

describe("no verification wording anywhere OSCE practice speaks", () => {
  it("the label says what it is not, and the check tells a claim from its negation", () => {
    expect(OSCE_PRACTICE_LABEL).toBe("Simulated practice — not an observed clinical skills assessment and not verified competence");
    expect(claimsVerification(OSCE_PRACTICE_LABEL)).toBe(false);
    expect(claimsVerification(FORMATIVE_NOTICE)).toBe(false);
    for (const bad of ["You passed this station", "Verified competence", "You are competent", "Certified"]) expect(claimsVerification(bad)).toBe(true);
  });
  it("no shipped OSCE string claims verification, a pass or competence", () => {
    const strings = [OSCE_PRACTICE_LABEL, OSCE_UNAVAILABLE, OSCE_OFF, OSCE_FEEDBACK_WITHHELD, TEMPLATE_CONTENT_STATUS, ...Object.values(OSCE_WITHHELD), ...Object.values(OSCE_SOURCE_LABEL),
      ...OSCE_TEMPLATES.flatMap(t => [t.title, t.scenario, t.candidateInstructions, ...t.checklist.map(i => i.text)])];
    expect(strings.filter(claimsVerification)).toEqual([]);
  });
  it("the OSCE pages, client and routes never claim verification, and read no assessment or verification table", () => {
    const files = [
      "src/app/individual/(app)/[experience]/(scholar)/study/apply/osce/page.tsx",
      "src/app/individual/(app)/[experience]/(scholar)/study/apply/osce/[stationId]/page.tsx",
      "src/app/individual/(app)/[experience]/(scholar)/study/_components/osce-client.tsx",
      "src/app/individual/(app)/[experience]/(scholar)/study/_components/osce-entry.tsx",
      "src/app/api/individual/scholar/osce/stations/route.ts",
      "src/app/api/individual/scholar/osce/attempts/[id]/route.ts",
      "src/lib/individual/scholar/osce.ts", "src/lib/individual/scholar/osce-service.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const visible = [...src.matchAll(/"([^"\n]{12,})"|>([^<>{}\n]{12,})</g)].map(m => m[1] ?? m[2]).filter(s => !/^[a-z_/.@:-]+$/i.test(s) && !/claimsVerification|regex|Never give a mark/.test(s));
      expect(visible.filter(claimsVerification), f).toEqual([]);
      expect(src, f).not.toMatch(/from\("(assessments|competency_verification_[a-z_]+|osce_[a-z_]+|clinical_cases)"\)/);
    }
  });
});
