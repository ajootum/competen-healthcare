// ── OSCE PRACTICE ── SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026), migration 720 ─────────────────────────────
//
// A simulated OSCE station a learner practises ALONE: a scenario, candidate instructions and a timer; they write what
// they would say and do under a few headings; then they check themselves against the station checklist (done, partly,
// missed per item), optionally with AI feedback that suggests ticks which they confirm. A practice score, with critical
// items missed flagged.
//
// ⚠ FORMATIVE ONLY, NEVER VERIFICATION. Nothing here is an observed clinical skills assessment, a pass, a mark of
// competence or Passport evidence. No result reads or writes competency_verification_*, assessments, or the estate osce_*
// tables (scholar-learning-harness B1/B2). Every surface carries OSCE_PRACTICE_LABEL beside FORMATIVE_NOTICE.
//
// ⚠ PURE. No I/O and no clock of its own (times are passed in), so every rule here is tested by being run. The store is
// store.ts (the one Scholar write site), the AI calls are generation.ts (the one generate() site).

export const OSCE_PRACTICE_LABEL = "Simulated practice — not an observed clinical skills assessment and not verified competence";
export const OSCE_UNAVAILABLE = "OSCE practice is not available here yet: the place it keeps your stations has not been installed on this environment. Everything else in Scholar works as before.";
export const OSCE_OFF = "OSCE practice is not offered right now.";

/** 720 bounds. Policy narrows them for stations written from notes, never widens them. */
export const OSCE_BOUNDS = { checklistMin: 6, checklistMax: 14, durationMin: 3, durationMax: 20, sectionsMax: 6 } as const;
export const OSCE_TEXT_MAX = { title: 160, scenario: 4000, instructions: 2000, item: 300, section: 80, response: 4000 } as const;
export const DEFAULT_OSCE_SECTIONS: readonly string[] = ["Introduction and consent", "Assessment", "Findings", "Escalation and plan"];
export const OSCE_PROMPT_VERSIONS = { station: "scholar-osce-station-v1", feedback: "scholar-osce-feedback-v1" } as const;

export type OsceSource = "template" | "competency" | "ai" | "own";
export const OSCE_SOURCE_LABEL: Record<OsceSource, string> = {
  template: "Competen practice template",
  competency: "Built from a competency's learning outcomes",
  ai: "Written by AI from your notes",
  own: "Written by you",
};

/** One checklist item. `quote`/`chunkId`: where an item written from notes is grounded. `outcome`: the outcome it practises. */
export type OsceItem = { id: string; text: string; critical: boolean; outcome?: string; quote?: string; chunkId?: string };
export type OsceMark = "done" | "partly" | "missed";
export const OSCE_MARKS: readonly OsceMark[] = ["done", "partly", "missed"];
export const OSCE_MARK_LABEL: Record<OsceMark, string> = { done: "Done", partly: "Partly", missed: "Missed" };
export type OsceTick = { itemId: string; mark: OsceMark };
export const isOsceMark = (v: unknown): v is OsceMark => typeof v === "string" && (OSCE_MARKS as readonly string[]).includes(v);

export type OsceStationDraft = {
  title: string; scenario: string; candidateInstructions: string; durationMinutes: number; sections: string[]; checklist: OsceItem[];
  source: OsceSource; templateKey: string | null; contentStatus: string; competencyId: string | null;
  materialId: string | null; chunkId: string | null; model: string | null; promptVersion: string | null;
};

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// ── VALIDATION (the 720 CHECKs, said first in code so a refusal has a plain reason) ─────────────────────────────

export type ChecklistCheck = { ok: true; items: OsceItem[] } | { ok: false; reason: string };

/** Pure. A checklist as 720 accepts it: min to max items, each with an id, text and a boolean critical, ids unique. */
export function validateChecklist(raw: unknown, bounds: { min: number; max: number } = { min: OSCE_BOUNDS.checklistMin, max: OSCE_BOUNDS.checklistMax }): ChecklistCheck {
  const min = Math.max(OSCE_BOUNDS.checklistMin, bounds.min), max = Math.min(OSCE_BOUNDS.checklistMax, bounds.max);
  if (!Array.isArray(raw)) return { ok: false, reason: "The checklist must be a list of items." };
  if (raw.length < min || raw.length > max) return { ok: false, reason: `A station needs ${min} to ${max} checklist items (this one has ${raw.length}).` };
  const items: OsceItem[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, reason: "Each checklist item must be an item, not plain text." };
    const id = clean(o.id, 40), text = clean(o.text, OSCE_TEXT_MAX.item);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return { ok: false, reason: "Each checklist item needs an id." };
    if (ids.has(id)) return { ok: false, reason: "Two checklist items share an id." };
    if (!text) return { ok: false, reason: "A checklist item has no text." };
    if (typeof o.critical !== "boolean") return { ok: false, reason: "Each checklist item must say whether it is critical." };
    if (o.outcome !== undefined && typeof o.outcome !== "string") return { ok: false, reason: "A checklist item's outcome must be text." };
    ids.add(id);
    const item: OsceItem = { id, text, critical: o.critical };
    const outcome = clean(o.outcome, OSCE_TEXT_MAX.item); if (outcome) item.outcome = outcome;
    const quote = clean(o.quote, 600); if (quote) item.quote = quote;
    if (typeof o.chunkId === "string" && /^[0-9a-f-]{36}$/i.test(o.chunkId)) item.chunkId = o.chunkId;
    items.push(item);
  }
  return { ok: true, items };
}

/** Pure. Response headings: 1 to 6 short non-empty lines, duplicates dropped. Empty or absent: the defaults. */
export function normaliseSections(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\n/) : [];
  const out: string[] = [];
  for (const s of list) {
    const t = clean(s, OSCE_TEXT_MAX.section);
    if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length === OSCE_BOUNDS.sectionsMax) break;
  }
  return out.length ? out : [...DEFAULT_OSCE_SECTIONS];
}

export const clampDuration = (n: unknown, fallback: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(OSCE_BOUNDS.durationMax, Math.max(OSCE_BOUNDS.durationMin, v));
};

/** Pure. The written responses as stored: only the station's own headings, each trimmed and bounded. */
export function normaliseResponses(raw: unknown, sections: readonly string[]): Record<string, string> {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const s of sections) {
    const v = typeof r[s] === "string" ? (r[s] as string).replace(/\r\n/g, "\n").trim().slice(0, OSCE_TEXT_MAX.response) : "";
    if (v) out[s] = v;
  }
  return out;
}

// ── THE TIMER ── one clock (the server's start), shown counting down, announced politely and rarely ───────────────

export type TimerState = { remainingSeconds: number; warning: boolean; timeUp: boolean };

/** Pure. Where the timer stands: remaining whole seconds, the one-minute warning, and time up. */
export function timerState(startedAtMs: number, durationMinutes: number, nowMs: number): TimerState {
  const total = durationMinutes * 60;
  const remaining = Math.max(0, Math.ceil(total - (nowMs - startedAtMs) / 1000));
  return { remainingSeconds: remaining, warning: remaining > 0 && remaining <= 60, timeUp: remaining === 0 };
}

export const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Pure. What a screen reader is told as time passes (aria-live polite), never every second: halfway, one minute left,
 * and time up -- each once, when the clock crosses it between two ticks. Null when nothing is to be said.
 */
export function timerAnnouncement(prevRemaining: number, remaining: number, durationMinutes: number): string | null {
  const total = durationMinutes * 60;
  const crossed = (t: number) => prevRemaining > t && remaining <= t;
  if (crossed(0)) return "Time is up. What you wrote has been kept.";
  if (crossed(60)) return "One minute left.";
  const half = Math.floor(total / 2);
  if (half > 60 && crossed(half)) return `Halfway: ${Math.round(half / 60)} minutes left.`;
  return null;
}

/** Pure. How long a run took, from the server's own start and finish, never more than the station allows. */
export function finishRun(startedAtMs: number, finishedAtMs: number, durationMinutes: number): { durationSeconds: number; timeUp: boolean } {
  const total = durationMinutes * 60;
  const elapsed = Math.max(0, Math.round((finishedAtMs - startedAtMs) / 1000));
  return { durationSeconds: Math.min(elapsed, total), timeUp: elapsed >= total };
}

// ── THE SELF-CHECK AND THE PRACTICE SCORE ───────────────────────────────────────────────────────────────────────

export const MARK_VALUE: Record<OsceMark, number> = { done: 1, partly: 0.5, missed: 0 };

export type OsceScore = {
  ok: true; ticks: OsceTick[]; score: number; points: number; outOf: number;
  criticalMissed: number; criticalMissedIds: string[]; criticalPartlyIds: string[]; missedIds: string[]; partlyIds: string[];
};

/** Pure. Ticks for EVERY item of the checklist, each once: the practice score (done 1, partly half, missed 0) and critical misses. */
export function scoreTicks(items: readonly OsceItem[], raw: unknown): OsceScore | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: "Mark each checklist item first." };
  const byId = new Map<string, OsceMark>();
  for (const t of raw) {
    const o = t as Record<string, unknown>;
    if (!o || typeof o.itemId !== "string" || !isOsceMark(o.mark)) return { ok: false, reason: "Each item is marked done, partly or missed." };
    if (!items.some(i => i.id === o.itemId)) return { ok: false, reason: "A mark names an item this station does not have." };
    if (byId.has(o.itemId)) return { ok: false, reason: "An item is marked twice." };
    byId.set(o.itemId, o.mark);
  }
  const unmarked = items.filter(i => !byId.has(i.id));
  if (unmarked.length) return { ok: false, reason: `Mark every checklist item (${unmarked.length} not marked yet).` };
  const ticks = items.map(i => ({ itemId: i.id, mark: byId.get(i.id)! }));
  const points = ticks.reduce((n, t) => n + MARK_VALUE[t.mark], 0);
  const ids = (m: OsceMark, critical?: boolean) => items.filter(i => byId.get(i.id) === m && (critical === undefined || i.critical === critical)).map(i => i.id);
  const criticalMissedIds = ids("missed", true);
  return {
    ok: true, ticks, points, outOf: items.length, score: Math.round((points / items.length) * 1000) / 1000,
    criticalMissed: criticalMissedIds.length, criticalMissedIds, criticalPartlyIds: ids("partly", true), missedIds: ids("missed"), partlyIds: ids("partly"),
  };
}

/** Pure. The practice score as the learner reads it: points and a percentage, with critical misses -- never pass or fail. */
export function scoreSummary(s: { points: number; outOf: number; criticalMissed: number }): string {
  const pct = s.outOf ? Math.round((s.points / s.outOf) * 100) : 0;
  const pts = Number.isInteger(s.points) ? String(s.points) : s.points.toFixed(1);
  const crit = s.criticalMissed ? ` · ${s.criticalMissed} critical item${s.criticalMissed === 1 ? "" : "s"} missed` : " · no critical item missed";
  return `Practice score ${pts} of ${s.outOf} checklist points (${pct}%)${crit}`;
}

// ── STATION SOURCES WITHOUT AI ─────────────────────────────────────────────────────────────────────────────────

/** Shipped as DATA, built from the respiratory seed outcomes. Never clinically reviewed, and labelled so everywhere. */
export const TEMPLATE_CONTENT_STATUS = "Competen practice template - not clinically reviewed";
export type OsceTemplate = { key: string; title: string; scenario: string; candidateInstructions: string; durationMinutes: number; checklist: OsceItem[] };
export const OSCE_TEMPLATES: readonly OsceTemplate[] = [
  {
    key: "respiratory-assessment",
    title: "Respiratory assessment and escalation",
    scenario: "You are asked to see an adult on a ward who says they feel more short of breath than usual. A simulated person and their observation chart are with you. No one else is available until you call for help.",
    candidateInstructions: "Introduce yourself and gain consent. Carry out a systematic respiratory assessment, say what you find, and say what you would do next, including when and how you would escalate. Under each heading, write what you would say and do.",
    durationMinutes: 8,
    checklist: [
      { id: "intro", text: "Introduces themselves and explains the purpose of the assessment", critical: false },
      { id: "consent", text: "Gains consent before starting", critical: true },
      { id: "rate", text: "Measures respiratory rate over a full minute", critical: true, outcome: "Measures respiratory rate over a full minute" },
      { id: "rhythm", text: "Assesses the rhythm and effort of breathing", critical: false, outcome: "Assesses rate, rhythm, effort, saturation and breath sounds" },
      { id: "spo2", text: "Interprets SpO2 against the prescribed target range", critical: true, outcome: "Interprets SpO2 against the prescribed target range" },
      { id: "sounds", text: "Listens to breath sounds", critical: false, outcome: "Assesses rate, rhythm, effort, saturation and breath sounds" },
      { id: "distress", text: "Recognises signs of respiratory distress", critical: true, outcome: "Recognises signs of respiratory distress" },
      { id: "interventions", text: "Initiates first-line interventions within scope", critical: false, outcome: "Initiates first-line interventions within scope" },
      { id: "escalate", text: "Escalates using a structured handover", critical: true, outcome: "Escalates using a structured handover" },
      { id: "document", text: "Documents findings in the agreed format", critical: false, outcome: "Documents findings in the agreed format" },
    ],
  },
];
export const osceTemplate = (key: unknown) => OSCE_TEMPLATES.find(t => t.key === key) ?? null;

/** Pure. A template as a station draft, labelled as a not clinically reviewed practice template. */
export function stationFromTemplate(t: OsceTemplate, sections: readonly string[] = DEFAULT_OSCE_SECTIONS): OsceStationDraft {
  return {
    title: t.title, scenario: t.scenario, candidateInstructions: t.candidateInstructions, durationMinutes: t.durationMinutes,
    sections: [...sections], checklist: t.checklist.map(i => ({ ...i })), source: "template", templateKey: t.key,
    contentStatus: TEMPLATE_CONTENT_STATUS, competencyId: null, materialId: null, chunkId: null, model: null, promptVersion: null,
  };
}

/** The station conventions a competency's outcomes are framed by. Practice framing, not from the competency. */
const FRAMING: readonly { id: string; text: string; critical: boolean; at: "start" | "end" }[] = [
  { id: "f-intro", text: "Introduces themselves and explains what they are going to do", critical: false, at: "start" },
  { id: "f-consent", text: "Gains consent before starting", critical: true, at: "start" },
  { id: "f-summary", text: "Summarises what they found", critical: false, at: "end" },
  { id: "f-next", text: "Says what they would do next, including when they would ask for help", critical: true, at: "end" },
];

export type CompetencyForStation = { id: string; code: string | null; title: string; description?: string | null; outcomes: readonly string[]; contentStatusLabel: string };

/**
 * Pure. A station built by CODE from a competency's recorded learning outcomes (no AI): each outcome is a critical item,
 * between the station framing items. Fewer than 2 outcomes, or a checklist outside 720's bounds: refused with the reason.
 */
export function stationFromCompetency(c: CompetencyForStation, durationMinutes: number, sections: readonly string[] = DEFAULT_OSCE_SECTIONS): { ok: true; draft: OsceStationDraft; trimmed: number } | { ok: false; reason: string } {
  const outcomes = [...new Set(c.outcomes.map(o => clean(o, OSCE_TEXT_MAX.item)).filter(Boolean))];
  if (outcomes.length < 2) return { ok: false, reason: `${c.title} records ${outcomes.length ? "only one learning outcome" : "no learning outcomes"}, so a station cannot be built from it. Choose another competency or the practice template.` };
  const room = OSCE_BOUNDS.checklistMax - FRAMING.length;
  const kept = outcomes.slice(0, room);
  const checklist: OsceItem[] = [
    ...FRAMING.filter(f => f.at === "start").map(f => ({ id: f.id, text: f.text, critical: f.critical })),
    ...kept.map((o, i) => ({ id: `o${i + 1}`, text: o, critical: true, outcome: o })),
    ...FRAMING.filter(f => f.at === "end").map(f => ({ id: f.id, text: f.text, critical: f.critical })),
  ];
  const v = validateChecklist(checklist);
  if (!v.ok) return { ok: false, reason: v.reason };
  const name = `${c.code ? `${c.code} ` : ""}${c.title}`;
  return {
    ok: true, trimmed: outcomes.length - kept.length,
    draft: {
      title: clean(`Practice station: ${c.title}`, OSCE_TEXT_MAX.title),
      scenario: clean(`A simulated practice station for ${name}.${c.description ? ` ${c.description}` : ""} Imagine a person who needs this from you, in a setting you know.`, OSCE_TEXT_MAX.scenario),
      candidateInstructions: "Show each learning outcome of this competency as you would in practice. Under each heading, write what you would say and do.",
      durationMinutes: clampDuration(durationMinutes, 8), sections: [...sections], checklist: v.items, source: "competency", templateKey: null,
      contentStatus: clean(`Competency content: ${c.contentStatusLabel}`, 160), competencyId: c.id, materialId: null, chunkId: null, model: null, promptVersion: null,
    },
  };
}

// ── A STATION WRITTEN FROM THE LEARNER'S NOTES (activity `questions`) ── prompt and check, the call is generation.ts ──
//
// The prompt shape is the estate station designer's (a brief, then 8 to 12 observable checklist items with critical tags),
// asked of the learner's OWN passages only. A prompt is a request, not a control: checkOsceDraft is the control. Every
// item must quote its passage word for word and add nothing the passages do not hold (the Holdings grounding check),
// the brief must pass the same check, and nothing may identify a person. An item that fails is dropped. If fewer than
// the policy minimum survive, or the brief fails, the station is WITHHELD: nothing is stored.

export const OSCE_STATION_SYSTEM = [
  "You write ONE simulated OSCE practice station for a healthcare student, for their own formative practice, from the PASSAGES of their own notes only.",
  "It is practice the student does alone. It is not an assessment and not patient care advice.",
  "Produce:",
  "1. title: under ten words.",
  "2. scenario: three to five sentences -- the setting, 'a person' who needs care (no name, no age, no dates), and the task. Only what the passages support.",
  "3. candidateInstructions: one or two sentences saying what the student must do in the station.",
  "4. checklist: {MIN} to {MAX} observable items, each something a student would SAY or DO, in the passages' own words. Set critical true where missing it would be unsafe or would defeat the task in the passages' terms.",
  "   For each item give source (the passage tag, S1, S2 ...) and quote: an exact sentence or phrase of at least four words copied from that passage that the item rests on.",
  "RULES: no fact, number, drug, dose, finding or policy the passages do not contain. Never count things ('two signs'). No name, NHS number, date of birth or any detail that could identify a real person.",
  "If the passages cannot support a station, reply {\"checklist\": []}.",
  'Reply with JSON ONLY: {"title": "...", "scenario": "...", "candidateInstructions": "...", "checklist": [{"text": "...", "critical": true, "source": "S1", "quote": "..."}]}',
].join("\n");

export const osceStationSystem = (min: number, max: number) => OSCE_STATION_SYSTEM.replace("{MIN}", String(min)).replace("{MAX}", String(max));

export type OscePassage = { chunkId: string; content: string; citation: string };

export function osceStationPrompt(passages: readonly OscePassage[]): string {
  return `PASSAGES FROM MY NOTES:\n\n${passages.map((p, i) => `[S${i + 1}] (${p.citation})\n${p.content}`).join("\n\n")}`;
}

/** Pure. The first JSON object in a model reply, or null. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { const v = JSON.parse(t.slice(start, end + 1)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

export type OsceDropReason = "malformed" | "quote_not_in_passage" | "ungrounded" | "identifier" | "repeat";
export type OsceDraftCheck =
  | { ok: true; title: string; scenario: string; candidateInstructions: string; items: OsceItem[]; dropped: OsceDropReason[] }
  | { ok: false; reason: "malformed" | "not_supported" | "ungrounded_brief" | "identifier" | "too_few_items"; dropped: OsceDropReason[]; kept?: number };

export type GroundingCheck = (text: string, grounding: string[]) => readonly unknown[];
export type IdentifierCheck = (text: string) => readonly unknown[];

/**
 * Pure (the two checks are passed in: generation.ts gives it the Holdings grounding check and findPatientIdentifiers).
 * The model's station, checked: the brief grounded, each item quoted from its passage and grounded, nothing identifying,
 * and between `min` and `max` items kept (extra items beyond max are dropped in order).
 */
export function checkOsceDraft(raw: string, passages: readonly OscePassage[], bounds: { min: number; max: number }, grounded: GroundingCheck, identifiers: IdentifierCheck): OsceDraftCheck {
  const dropped: OsceDropReason[] = [];
  const o = parseJsonObject(raw);
  if (!o || !Array.isArray(o.checklist)) return { ok: false, reason: "malformed", dropped };
  if (o.checklist.length === 0) return { ok: false, reason: "not_supported", dropped };
  const title = clean(o.title, OSCE_TEXT_MAX.title), scenario = clean(o.scenario, OSCE_TEXT_MAX.scenario), candidateInstructions = clean(o.candidateInstructions, OSCE_TEXT_MAX.instructions);
  if (!title || !scenario || !candidateInstructions) return { ok: false, reason: "malformed", dropped };
  const texts = passages.map(p => p.content);
  const brief = [title, scenario, candidateInstructions].join("\n");
  if (identifiers(brief).length) return { ok: false, reason: "identifier", dropped };
  if (grounded(brief, texts).length) return { ok: false, reason: "ungrounded_brief", dropped };
  const items: OsceItem[] = [];
  const seen = new Set<string>();
  for (const r of o.checklist as unknown[]) {
    if (items.length >= bounds.max) break;
    const it = r as Record<string, unknown>;
    const text = clean(it?.text, OSCE_TEXT_MAX.item), quote = clean(it?.quote, 600);
    const tag = typeof it?.source === "string" ? /^\s*\[?S(\d+)\]?\s*$/i.exec(it.source) : null;
    const p = tag ? passages[Number(tag[1]) - 1] : undefined;
    if (!text || typeof it?.critical !== "boolean" || !quote || !p) { dropped.push("malformed"); continue; }
    const key = squash(quote).replace(/[.\s]+$/, "");
    if (key.length < 12 || !squash(p.content).includes(key)) { dropped.push("quote_not_in_passage"); continue; }
    if (identifiers(text).length) { dropped.push("identifier"); continue; }
    if (grounded(text, texts).length) { dropped.push("ungrounded"); continue; }
    const k = squash(text);
    if (seen.has(k)) { dropped.push("repeat"); continue; }
    seen.add(k);
    items.push({ id: `i${items.length + 1}`, text, critical: it.critical, quote, chunkId: p.chunkId });
  }
  if (items.length < bounds.min) return { ok: false, reason: "too_few_items", dropped, kept: items.length };
  return { ok: true, title, scenario, candidateInstructions, items, dropped };
}

export const OSCE_WITHHELD: Record<Exclude<OsceDraftCheck, { ok: true }>["reason"], string> = {
  malformed: "The station could not be read, so nothing was kept. Try again, or use the practice template.",
  not_supported: "These notes do not describe enough of a clinical task for a practice station. Try a section about an assessment or a procedure.",
  ungrounded_brief: "The scenario drifted beyond what your notes say, so it was withheld. Nothing was kept.",
  identifier: "The station looked as if it could identify a person, so it was withheld. Nothing was kept.",
  too_few_items: "Too few checklist items could be checked against your notes, so the station was withheld. Nothing was kept.",
};

// ── AI FEEDBACK ON A RUN (activity `evaluate`) ── suggested ticks the learner confirms, and the five-part feedback ──

export const OSCE_FEEDBACK_SYSTEM = [
  "You give formative feedback on what a healthcare student WROTE during a simulated OSCE practice station they did alone, for their own study.",
  "Judge ONLY against the station checklist and the station text given. Do not use outside knowledge, and do not reward anything the checklist does not ask for.",
  "For every checklist item write one line, exactly 'ITEM <id>: done', 'ITEM <id>: partly' or 'ITEM <id>: missed' -- done where the writing clearly shows it, partly where it shows some of it, missed where it does not.",
  "Then exactly these five lines, each short (write none where a part has nothing):",
  "RIGHT: what the responses did well (separate points with ;)",
  "MISSING: the checklist items or parts of them that were missed (separate with ;)",
  "MISCONCEPTIONS: any mistaken idea in the responses (separate with ;)",
  "WHY: one sentence on why the missed items matter, in the checklist's words",
  "NEXT: one short thing to practise next",
  "Never give a mark, a score, a percentage, a pass or a fail, and never say the student is competent. No new facts, numbers, doses, drugs or advice. No names.",
].join("\n");

export function osceFeedbackPrompt(station: { scenario: string; candidateInstructions: string; checklist: readonly OsceItem[] }, responses: Record<string, string>): string {
  const written = Object.entries(responses).map(([h, t]) => `${h}:\n${t}`).join("\n\n") || "(nothing written)";
  return [
    `STATION: ${station.scenario}\nTASK: ${station.candidateInstructions}`,
    `CHECKLIST:\n${station.checklist.map(i => `${i.id}: ${i.text}${i.critical ? " [CRITICAL]" : ""}`).join("\n")}`,
    `WHAT I WROTE:\n${written}`,
  ].join("\n\n");
}

export type OsceFeedbackParts = { right: string[]; missing: string[]; misconceptions: string[]; why: string | null; next: string | null };
export type OsceFeedback = { ok: true; suggested: OsceTick[]; parts: OsceFeedbackParts } | { ok: false; reason: "malformed" | "ungrounded" | "identifier" | "verdict_words" };

const FEEDBACK_KEY: Record<string, keyof OsceFeedbackParts> = { RIGHT: "right", MISSING: "missing", MISCONCEPTION: "misconceptions", MISCONCEPTIONS: "misconceptions", WHY: "why", NEXT: "next" };

/**
 * Pure. The evaluator's reply, checked: a suggested tick for items it named (unknown ids ignored), the five parts, and
 * feedback that adds nothing the station, checklist and responses do not hold, identifies no one, and never claims a
 * pass or competence. Anything else is withheld: the learner marks themselves, as without AI.
 */
export function parseOsceFeedback(raw: string, items: readonly OsceItem[], grounding: readonly string[], grounded: GroundingCheck, identifiers: IdentifierCheck): OsceFeedback {
  const suggested = new Map<string, OsceMark>();
  const parts: OsceFeedbackParts = { right: [], missing: [], misconceptions: [], why: null, next: null };
  let found = 0;
  for (const line of raw.split("\n")) {
    const m = /^\s*\**\s*ITEM\s+([A-Za-z0-9_-]+)\s*\**\s*:\s*\**\s*(done|partly|missed)\b/i.exec(line);
    if (m) { if (items.some(i => i.id === m[1]) && !suggested.has(m[1])) suggested.set(m[1], m[2].toLowerCase() as OsceMark); continue; }
    const f = /^\s*\**\s*(RIGHT|MISSING|MISCONCEPTIONS?|WHY|NEXT)\s*\**\s*:\s*(.*)$/i.exec(line);
    if (!f) continue;
    found++;
    const key = FEEDBACK_KEY[f[1].toUpperCase()];
    const body = f[2].trim();
    if (/^none\.?$/i.test(body) || !body) continue;
    if (key === "why" || key === "next") parts[key] = body.slice(0, 400);
    else parts[key] = body.split(/;\s*/).map(s => s.trim().replace(/\.$/, "")).filter(Boolean).slice(0, 5).map(s => s.slice(0, 300));
  }
  if (!found || !suggested.size) return { ok: false, reason: "malformed" };
  const text = [...parts.right, ...parts.missing, ...parts.misconceptions, parts.why ?? "", parts.next ?? ""].filter(Boolean).join("\n");
  if (claimsVerification(text)) return { ok: false, reason: "verdict_words" };
  if (identifiers(text).length) return { ok: false, reason: "identifier" };
  if (text && grounded(text, [...grounding]).length) return { ok: false, reason: "ungrounded" };
  return { ok: true, suggested: items.filter(i => suggested.has(i.id)).map(i => ({ itemId: i.id, mark: suggested.get(i.id)! })), parts };
}

export const OSCE_FEEDBACK_WITHHELD = "AI feedback could not be checked against this station, so it is not shown. Mark each item yourself.";

// ── HONESTY ── no surface may claim verification, a pass or competence ───────────────────────────────────────────

/**
 * Pure. Whether text claims what OSCE practice never is: verified, passed, competent (or a pass or fail mark). The
 * negated forms the labels use ("not verified competence", "not an observed ...") do not count.
 */
export function claimsVerification(text: string): boolean {
  const t = text.toLowerCase().replace(/\b(not|never) (an? )?((observed|verified)\b\s*)+/g, "$1 ");
  return /\b(verified|passed|pass mark|you pass|competent|certified|fail(ed)? the station)\b/.test(t);
}

// ── REMEDIATION ── where to go after a run: Learn on what was missed, Revise for the station's material or competency ──

export type OsceRemedy = { label: string; segment: string; query: Record<string, string> };

/** Pure. Links (as study segments and query) for the items missed or partly done: Learn first, then Revise. At most 6. */
export function remediation(station: { checklist: readonly OsceItem[]; materialId: string | null; competencyId: string | null }, ticks: readonly OsceTick[]): OsceRemedy[] {
  const weak = ticks.filter(t => t.mark !== "done").map(t => station.checklist.find(i => i.id === t.itemId)).filter((i): i is OsceItem => !!i)
    .sort((a, b) => Number(b.critical) - Number(a.critical));
  const out: OsceRemedy[] = [];
  const seen = new Set<string>();
  for (const i of weak) {
    if (out.length >= 5) break;
    const q: Record<string, string> = i.chunkId ? { section: i.chunkId, action: "teach" } : { topic: (i.outcome ?? i.text).slice(0, 120), action: "teach" };
    const k = JSON.stringify(q);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label: `Learn: ${i.outcome ?? i.text}`, segment: "learn", query: q });
  }
  if (station.materialId) out.push({ label: "Revise this material", segment: "revise", query: { material: station.materialId } });
  else if (station.competencyId) out.push({ label: "Learn this competency", segment: "learn", query: { competency: station.competencyId } });
  else out.push({ label: "Go to Revise", segment: "revise", query: {} });
  return out;
}
