// The four defects (and the low observation) the staging acceptance run of SCHOLAR-OSCE-01 s11 + Adaptive Exams found,
// 31 Oct 2026 (docs/evidence/SCHOLAR-PRACTICE/acceptance-2026-10-31.md), each with the test that decides its fix.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { textGroundingViolations } from "@/lib/ai/grounding";
import { findPatientIdentifiers } from "./extract";
import { OSCE_TEMPLATES, feedbackGroundingCheck, feedbackGroundingText, parseOsceFeedback, stationFromTemplate } from "./osce";
import { checklistView, stationView } from "./osce-service";
import {
  LEVEL_OF, PENDING_MAX, blueprintOf, blueprintScope, itemSource, nextDifficulty, recordServed, selectNext, servedSources, unusedCoverage,
  type AdaptiveBlueprint, type Candidate, type ServedSource,
} from "./adaptive";
import { planGeneration } from "./revision";
import { ADAPTIVE_GENERATION_CALLS_MAX } from "./config";
import type { GenerationDifficulty } from "./question-intel";

// ── D1 ── OSCE feedback: a grounding check fit for feedback, not the Practice-document one ─────────────────────────────

describe("D1. OSCE AI feedback: accurate replies shown, invented values and verdicts withheld", () => {
  const tpl = OSCE_TEMPLATES[0];
  const station = stationFromTemplate(tpl);
  // What the acceptance learner wrote (rate and SpO2 not written, as on staging).
  const responses = {
    "Introduction and consent": "Hello, I am a student nurse. I would like to look at your breathing, is that alright with you?",
    "Assessment": "I would look at the rhythm and effort of breathing and listen to breath sounds on both sides.",
    "Findings": "I would look for signs of respiratory distress such as use of accessory muscles.",
    "Escalation and plan": "I would escalate to the nurse in charge using SBAR and document my findings.",
  };
  const grounding = feedbackGroundingText({ ...station, guidance: tpl.guidance, expectedActivities: tpl.expectedActivities, responses });
  const ticks = ["ITEM intro: done", "ITEM consent: done", "ITEM rate: missed", "ITEM rhythm: done", "ITEM spo2: missed", "ITEM sounds: done",
    "ITEM distress: done", "ITEM interventions: missed", "ITEM escalate: done", "ITEM document: done"];
  const reply = (parts: Record<string, string>) => [...ticks, ...["UNDERSTOOD", "MISSING_STEPS", "REASONING", "SAFETY", "IMPROVE", "REVISE"].map(k => `${k}: ${parts[k] ?? "none"}`)].join("\n");
  const feedbackCheck = feedbackGroundingCheck(textGroundingViolations);
  const parse = (raw: string) => parseOsceFeedback(raw, station.checklist, grounding, feedbackCheck, findPatientIdentifiers);
  const practiceParse = (raw: string) => parseOsceFeedback(raw, station.checklist, grounding, textGroundingViolations, findPatientIdentifiers);

  // Replay 1 on staging (withheld for "two").
  const accurateTwo = reply({
    UNDERSTOOD: "Introduces themselves and gains consent; Assesses the rhythm and effort of breathing; Listens to breath sounds; Escalates using a structured handover",
    MISSING_STEPS: "Measures respiratory rate over a full minute; Interprets SpO2 against the prescribed target range",
    REASONING: "The writing does not give the respiratory rate or the SpO2, the two most time-sensitive objective measurements in this station",
    SAFETY: "Measuring respiratory rate over a full minute and interpreting SpO2 against the prescribed target range are critical items that were not written",
    IMPROVE: "Say the rate over a full minute out loud; Initiates first-line interventions within scope",
    REVISE: "Interprets SpO2 against the prescribed target range; Measures respiratory rate over a full minute",
  });
  // Replay 2 on staging (withheld for "marked" and "normal").
  const accurateMarkedNormal = reply({
    UNDERSTOOD: "Consent is marked critical and the writing gains consent before starting; Escalates using a structured handover",
    MISSING_STEPS: "Measures respiratory rate over a full minute",
    REASONING: "Interpret SpO2 against the prescribed target range rather than a general normal value",
    SAFETY: "Interprets SpO2 against the prescribed target range is marked as critical and was missed",
    IMPROVE: "Say the order out loud: rate over a full minute, rhythm and effort, saturation against the prescribed target, breath sounds",
    REVISE: "Interprets SpO2 against the prescribed target range",
  });

  it("the acceptance replies that were withheld by the Practice check are shown by the feedback check", () => {
    expect(practiceParse(accurateTwo)).toEqual({ ok: false, reason: "ungrounded" });
    expect(practiceParse(accurateMarkedNormal)).toEqual({ ok: false, reason: "ungrounded" });
    expect(textGroundingViolations(accurateTwo, grounding)).toEqual(expect.arrayContaining([{ kind: "ungrounded_number", token: "two" }]));
    const a = parse(accurateTwo), b = parse(accurateMarkedNormal);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) expect(a.suggested.find(t => t.itemId === "spo2")?.mark).toBe("missed");
  });

  it("an invented SpO2 target, an invented quantity, or a verdict is still withheld", () => {
    const invented = (IMPROVE: string) => parse(reply({ UNDERSTOOD: "Listens to breath sounds", IMPROVE }));
    expect(invented("Aim for an SpO2 of 94-98% before escalating")).toEqual({ ok: false, reason: "ungrounded" });
    expect(invented("Aim for SpO2 of ninety four percent")).toEqual({ ok: false, reason: "ungrounded" });
    expect(invented("Give two litres of oxygen")).toEqual({ ok: false, reason: "ungrounded" });
    expect(invented("Recheck every four hours")).toEqual({ ok: false, reason: "ungrounded" });
    // A counting "two" does not excuse a quantity "two" elsewhere in the same feedback.
    expect(invented("The two most time-sensitive measurements were missed; recheck every two hours")).toEqual({ ok: false, reason: "ungrounded" });
    expect(parse(reply({ UNDERSTOOD: "You passed this station" }))).toEqual({ ok: false, reason: "verdict_words" });
    expect(parse(reply({ UNDERSTOOD: "You are competent at respiratory assessment" }))).toEqual({ ok: false, reason: "verdict_words" });
  });

  it("'marked' and 'normal' as findings are still withheld; only the meta uses are excused", () => {
    expect(parse(reply({ REASONING: "Breath sounds were within the normal range" }))).toEqual({ ok: false, reason: "ungrounded" });
    expect(parse(reply({ REASONING: "Breath sounds normal" }))).toEqual({ ok: false, reason: "ungrounded" });
    expect(parse(reply({ SAFETY: "Marked distress was not escalated" }))).toEqual({ ok: false, reason: "ungrounded" });
    expect(parse(reply({ SAFETY: "Consent is marked critical; marked distress was not escalated" }))).toEqual({ ok: false, reason: "ungrounded" });
    expect(parse(reply({ REASONING: "The SpO2 was mild" }))).toEqual({ ok: false, reason: "ungrounded" });
  });

  it("identifiers are still withheld", () => {
    expect(parse(reply({ UNDERSTOOD: "NHS number 943 476 5919 was checked" })).ok).toBe(false);
  });

  it("the Practice and Scholar text checks are unchanged, and generation.ts uses the feedback check for OSCE feedback only", () => {
    expect(textGroundingViolations("the two most time-sensitive measurements", ["station"])).toEqual([{ kind: "ungrounded_number", token: "two" }]);
    expect(textGroundingViolations("marked critical", ["station"])).toEqual([{ kind: "asserted_finding", token: "marked" }]);
    const gen = readFileSync("src/lib/individual/scholar/generation.ts", "utf8");
    expect(gen.match(/feedbackGroundingCheck\(/g)?.length).toBe(1);
    expect(gen).toMatch(/parseOsceFeedback\(r\.text, input\.checklist, feedbackGroundingText\(input\), feedbackGroundingCheck\(groundingViolations\)/);
    expect(gen).toMatch(/checkOsceDraft\(r\.text, passages, \{ min: input\.min, max: input\.max \}, groundingViolations,/);
  });
});

// ── D2 ── a Server Component must never call a function exported from a "use client" module ─────────────────────────

describe("D2. no server module calls a function from a 'use client' module", () => {
  const ROOT = resolve("src");
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p); } };
  // Scholar's own pages and components. (Professional's server pages import the string constant `inputCls` from the
  // "use client" module _components/professional/forms.tsx: the same class, outside this branch's scope, reported.)
  walk(resolve("src/app/individual/(app)/[experience]/(scholar)"));
  const isClient = (p: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*["']use client["']/.test(readFileSync(p, "utf8"));
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
    return null;
  };
  /** Named, non-type imports from client modules that are not components (PascalCase): a function the server would call. */
  const offenders = (file: string): string[] => {
    const src = readFileSync(file, "utf8");
    const out: string[] = [];
    for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      if (m[1]) continue;
      const target = resolveImport(file, m[3]);
      if (!target || !isClient(target)) continue;
      for (const raw of m[2].split(",")) {
        const name = raw.trim();
        if (!name || name.startsWith("type ")) continue;
        const local = name.split(/\s+as\s+/)[0].trim();
        if (!/^[A-Z]/.test(local)) out.push(`${file.slice(ROOT.length)} imports ${local} from ${m[3]}`);
      }
    }
    return out;
  };

  it("the adaptive pages import adaptiveHref from the plain module (question-view.ts), not adaptive-client.tsx", () => {
    const study = "src/app/individual/(app)/[experience]/(scholar)/study";
    expect(isClient(resolve(`${study}/_components/adaptive-client.tsx`))).toBe(true);
    expect(isClient(resolve(`${study}/_components/question-view.ts`))).toBe(false);
    expect(readFileSync(`${study}/_components/question-view.ts`, "utf8")).toMatch(/export const adaptiveHref/);
    expect(readFileSync(`${study}/_components/adaptive-client.tsx`, "utf8")).not.toMatch(/export const adaptiveHref/);
    for (const page of [`${study}/revise/adaptive/page.tsx`, `${study}/revise/page.tsx`]) expect(offenders(resolve(page))).toEqual([]);
  });

  it("no server module of Scholar calls a lower-case export of a client module", () => {
    const server = files.filter(f => !isClient(f));
    expect(server.length).toBeGreaterThan(20);
    expect(server.flatMap(offenders)).toEqual([]);
  });

  it("the scan can fail: the old import is caught", () => {
    const planted = `import { AdaptiveRunner, adaptiveHref } from "../../_components/adaptive-client";`;
    const fake = resolve("src/app/individual/(app)/[experience]/(scholar)/study/revise/adaptive/page.tsx");
    const src = planted;
    const m = [...src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)][0];
    const target = resolveImport(fake, m[3]);
    expect(target && isClient(target)).toBe(true);
    expect(m[2].split(",").map(s => s.trim()).filter(n => !/^[A-Z]/.test(n))).toEqual(["adaptiveHref"]);
  });
});

// ── D3 ── generate when the UNUSED questions at the target run out ──────────────────────────────────────────────────

type SimQ = Candidate & { chunkId: string; current: boolean };
type Coverage = (pool: readonly SimQ[], used: ReadonlySet<string>, target: GenerationDifficulty) => Set<string>;

/**
 * One adaptive exam, run with the same pure pieces chooseNext uses: selectNext at the target, else ONE generation call
 * planned by planGeneration over the coverage (within ADAPTIVE_GENERATION_CALLS_MAX), else the nearest difficulty.
 * Generation keeps `keep` questions per call (staging kept fewer than three after the checks).
 */
function simulate(input: { length: number; start: GenerationDifficulty; answers: boolean[]; keep: number; coverage: Coverage; pool?: SimQ[] }) {
  const pool: SimQ[] = [...(input.pool ?? [])];
  const served: string[] = [], asked: GenerationDifficulty[] = [], outcomes: boolean[] = [], from: string[] = [];
  let calls = 0, made = 0;
  for (let n = 0; n < input.length; n++) {
    const target = nextDifficulty(input.start, outcomes);
    const exclude = new Set(served);
    const lastKind = served.length ? "mcq" as const : null;
    const first = selectNext({ target, pool, exclude, formats: ["mcq"], lastKind });
    let pick = first.exact;
    if (!pick) {
      const call = calls < ADAPTIVE_GENERATION_CALLS_MAX ? planGeneration({ shortfall: 3, chunkIds: ["c1"], formats: ["mcq"], existing: input.coverage(pool, exclude, target) })[0] : undefined;
      const fresh: string[] = [];
      if (call) {
        calls++;
        for (let k = 0; k < input.keep; k++) {
          const id = `g${++made}`;
          pool.push({ id, kind: "mcq", difficulty: LEVEL_OF[target], library: false, createdAt: `2026-10-31T10:${String(made).padStart(2, "0")}:00Z`, lastAnsweredAt: null, chunkId: "c1", current: true });
          fresh.push(id);
        }
      }
      const again = selectNext({ target, pool, exclude, formats: ["mcq"], lastKind, fresh: new Set(fresh) });
      pick = again.exact ?? again.nearest ?? first.nearest;
    }
    if (!pick) break;
    served.push(pick.id); asked.push(target); from.push(pick.from); outcomes.push(input.answers[n]);
  }
  return { served, asked, calls, from };
}

describe("D3. an adaptive exam keeps writing questions while its unused ones at the target run out", () => {
  const legacy: Coverage = (pool, _used, target) => new Set(pool.filter(q => q.current && (q.difficulty ?? 2) === LEVEL_OF[target]).map(q => `${q.chunkId}|${q.kind}`));
  const fixed: Coverage = (pool, used, target) => unusedCoverage(pool, used, target);
  const exam = { length: 5, start: "standard" as const, answers: [true, true, true, true, false], keep: 2 };

  it("an mcq-only 5-item exam on one section reaches 5, and the path moves up after three right", () => {
    const r = simulate({ ...exam, coverage: fixed });
    expect(r.served).toHaveLength(5);
    expect(r.asked).toEqual(["standard", "standard", "standard", "harder", "harder"]);
    expect(r.calls).toBeLessThanOrEqual(ADAPTIVE_GENERATION_CALLS_MAX);
    expect(new Set(r.served).size).toBe(5);
  });

  it("the old coverage (every stored question counted, used or not) stopped it at 2 of 5, as on staging run 2", () => {
    const r = simulate({ ...exam, coverage: legacy });
    expect(r.served).toHaveLength(2);
  });

  it("only questions not yet served in this exam, at the target difficulty and the current prompt version, cover a pair", () => {
    const q = (id: string, difficulty: number | null, current = true): SimQ => ({ id, kind: "mcq", difficulty, library: false, createdAt: "", lastAnsweredAt: null, chunkId: "c1", current });
    expect(unusedCoverage([q("a", 2)], new Set(["a"]), "standard")).toEqual(new Set());
    expect(unusedCoverage([q("a", 2)], new Set(), "standard")).toEqual(new Set(["c1|mcq"]));
    expect(unusedCoverage([q("a", null)], new Set(), "standard")).toEqual(new Set(["c1|mcq"]));
    expect(unusedCoverage([q("a", 3)], new Set(), "standard")).toEqual(new Set());
    expect(unusedCoverage([q("a", 2, false)], new Set(), "standard")).toEqual(new Set());
  });

  it("the nearest difficulty is offered only after a generation call was tried and wrote nothing usable", () => {
    const stored: SimQ[] = [{ id: "e1", kind: "mcq", difficulty: 1, library: false, createdAt: "2026-01-01", lastAnsweredAt: null, chunkId: "c1", current: true }];
    const r = simulate({ length: 1, start: "standard", answers: [true], keep: 0, coverage: fixed, pool: stored });
    expect(r.calls).toBe(1);
    expect(r.served).toEqual(["e1"]);
  });

  it("chooseNext passes this exam's served questions to the coverage", () => {
    const svc = readFileSync("src/lib/individual/scholar/adaptive-service.ts", "utf8");
    expect(svc).toMatch(/generateForTarget\(ctx, req, policy, input\.setId, input\.blueprint, found\.questions, exclude, target, input\.lastKind\)/);
    expect(svc).toMatch(/const existing = unusedCoverage\([\s\S]*?, used, target\)/);
  });
});

// ── D4 ── provenance recorded per served item, at selection ────────────────────────────────────────────────────────

describe("D4. the report counts generated / stored / library from what was recorded when each item was served", () => {
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const bp: AdaptiveBlueprint = {
    v: 1, title: "T", scope: { kind: "programme" }, formats: ["mcq"], length: 5, start: "standard", startFrom: "chosen", feedback: "immediate",
    timeLimitMinutes: null, source: "notes", sections: [U(900)], competencyIds: [], libraryIds: [], calls: 0,
  };

  it("run 3 exam 1: all five written during the exam, the first before the session existed, count as generated", () => {
    let b = recordServed(bp, 1, { id: U(1), from: "generated" }, [U(1), U(2), U(3)]); // the first pick, written by the call that chose it
    b = recordServed(b, 2, { id: U(2), from: "stored" });                              // a leftover of that batch
    b = recordServed(b, 3, { id: U(3), from: "stored" });
    b = recordServed(b, 4, { id: U(4), from: "generated" }, [U(4), U(5)]);
    b = recordServed(b, 5, { id: U(5), from: "stored" });
    expect(b.served).toBe("ggggg");
    expect(b.pending).toEqual([]);
    const sources = servedSources(b.served, [U(1), U(2), U(3), U(4), U(5)]);
    expect([...sources.values()]).toEqual(["generated", "generated", "generated", "generated", "generated"]);
  });

  it("library copies and questions stored before the exam keep their own source", () => {
    let b = recordServed(bp, 1, { id: U(10), from: "library" });
    b = recordServed(b, 2, { id: U(11), from: "stored" });
    b = recordServed(b, 3, { id: U(12), from: "generated" }, [U(12)]);
    expect(b.served).toBe("lsg");
    const counts = (m: Map<string, ServedSource>) => [...m.values()].reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>);
    expect(counts(servedSources(b.served, [U(10), U(11), U(12)]))).toEqual({ library: 1, stored: 1, generated: 1 });
  });

  it("the record survives the set scope (blueprintOf / blueprintScope), and the pending memo is bounded", () => {
    const many = Array.from({ length: 20 }, (_, i) => U(100 + i));
    const b = recordServed(bp, 1, { id: many[0], from: "generated" }, many);
    expect(b.pending).toHaveLength(PENDING_MAX);
    const back = blueprintOf(blueprintScope(b));
    expect(back?.served).toBe("g");
    expect(back?.pending).toEqual(b.pending);
    expect(blueprintOf({ adaptive: { ...b, served: "x!" } })?.served).toBeUndefined();
  });

  it("an exam from before the fix falls back to the question's age against the exam's SET-UP, not the session's start", () => {
    const setUp = "2026-10-31T10:00:00Z";
    // Written by the first pick, after the set was created and before the session was (the D4 case).
    expect(itemSource(undefined, { library: false, createdAt: "2026-10-31T10:00:05Z" }, setUp)).toBe("generated");
    expect(itemSource(undefined, { library: false, createdAt: "2026-10-30T09:00:00Z" }, setUp)).toBe("stored");
    expect(itemSource(undefined, { library: true, createdAt: "2026-10-31T10:00:05Z" }, setUp)).toBe("library");
    expect(itemSource("stored", { library: false, createdAt: "2026-10-31T10:00:05Z" }, setUp)).toBe("stored");
  });

  it("both routes record the source when the item is the session's, and the report reads it", () => {
    const start = readFileSync("src/app/api/individual/scholar/revision/adaptive/route.ts", "utf8");
    const next = readFileSync("src/app/api/individual/scholar/revision/adaptive/next/route.ts", "utf8");
    const svc = readFileSync("src/lib/individual/scholar/adaptive-service.ts", "utf8");
    expect(start.indexOf("recordServedItem(ctx.admin, ctx.userId, set.id, first.blueprint, 1, first.pick, first.generated)")).toBeGreaterThan(start.indexOf("createAdaptiveSession("));
    expect(next).toMatch(/if \(await addItem\([^\n]*\n[^\n]*\n\s*await recordServedItem\(ctx\.admin, ctx\.userId, st\.setId, next\.blueprint, st\.questionIds\.length \+ 1, next\.pick, next\.generated\)/);
    expect(svc).toMatch(/itemSource\(st\.provenance\.get\(q\.id\)/);
    expect(svc).not.toMatch(/q\.createdAt >= st\.session\.createdAt/);
  });
});

// ── LOW ── the brief carries no checklist; it is given only once the run has finished ───────────────────────────────

describe("Low. the station brief payload has no checklist, critical flags or guidance", () => {
  const row: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
    id: "s", title: "T", scenario: "S", candidateInstructions: "I", durationMinutes: 8, sections: ["A"], source: "template", contentStatus: "x", version: 1,
    profession: null, programmeLabel: null, topic: null, bodySystem: null, difficulty: null, objectives: [],
    checklist: [{ id: "a", text: "Gains consent before starting", critical: true }], guidance: { suggestedResponses: ["R"], assessmentGuidance: "G" }, expectedActivities: ["E"],
  };
  it("stationView: no checklist, no critical flag, no guidance", () => {
    const v = stationView(row) as Record<string, unknown>;
    expect(v.checklist).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/Gains consent|critical|"G"|suggestedResponses/);
    expect(checklistView(row.checklist)).toEqual([{ id: "a", text: "Gains consent before starting", critical: true, outcome: null, quote: null }]);
  });
  it("the page gives the checklist only for a finished run not yet marked; the finish and time-up replies carry it", () => {
    const page = readFileSync("src/app/individual/(app)/[experience]/(scholar)/study/apply/osce/[stationId]/page.tsx", "utf8");
    expect(page).toMatch(/station=\{stationView\(station\)\}\s*checklist=\{pendingSnap \? checklistView\(pendingSnap\.checklist\) : null\}/);
    const run = readFileSync("src/app/api/individual/scholar/osce/attempts/[id]/route.ts", "utf8");
    expect(run).toMatch(/finished: true, durationSeconds: run\.durationSeconds, [^\n]*checklist: checklistView\(snap\.checklist\)/);
    expect(run).toMatch(/closed: true, timeUp: true, checklist: checklistView\(snap\.checklist\)/);
    const start = readFileSync("src/app/api/individual/scholar/osce/attempts/route.ts", "utf8");
    expect(start).toMatch(/finished: true, timeUp: true, responses: open\.responses, checklist: checklistView\(snap\.checklist\)/);
    // Only the finished (time-up) reply carries it: a new or resumed running run's reply never does.
    expect(start.match(/checklistView\(/g)?.length).toBe(1);
  });
});

// ── COORDINATOR BROWSER CHECK (point 12) ── the station page wraps by its own width; the list page carries the label ──

describe("Point 12 follow-ups: tablet layout by available width, the instructed label on the list page", () => {
  const study = "src/app/individual/(app)/[experience]/(scholar)/study";
  it("the station page has no viewport two-column split; the work column wraps at 20rem", () => {
    const page = readFileSync(`${study}/apply/osce/[stationId]/page.tsx`, "utf8");
    expect(page).not.toMatch(/md:grid-cols-\[minmax\(0,3fr\)/);
    expect(page).toMatch(/className="flex flex-wrap items-start gap-5"/);
    expect(page).toMatch(/className="min-w-0 flex-\[3_1_20rem\] space-y-5"/);
    const client = readFileSync(`${study}/_components/osce-client.tsx`, "utf8");
    expect(client).toMatch(/grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,15rem\),1fr\)\)\]/);
    expect(client).toMatch(/sticky top-2/);
  });
  it("the list page shows 'Simulated practice — not an observed clinical skills assessment' once, near the top", () => {
    const list = readFileSync(`${study}/apply/osce/page.tsx`, "utf8");
    expect(list.match(/OSCE_PRACTICE_LABEL\}/g)?.length).toBe(1);
    expect(list.indexOf("{OSCE_PRACTICE_LABEL}")).toBeLessThan(list.indexOf("<BoundaryNotice"));
  });
});
