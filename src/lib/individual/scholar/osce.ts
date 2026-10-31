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
//
// SCHOLAR-OSCE-01 (owner, 31 Oct 2026), migration 721: the full station definition (profession, programme, topic, body
// system, objectives, expected activities, guidance shown only after a run, references, version), no fixed checklist
// limit beyond the structural bound (8 to 12 is the design default, in policy), governed stations read from the CKRI
// library (published and clinically approved only), the score explained with critical misses shown apart, and a run's
// written work autosaved and resumed. ⚠ PROFESSION-AGNOSTIC: the rules here assume no profession. A profession, a
// setting or a role appears only in DATA (a template, a station's own fields), never in the engine.

export const OSCE_PRACTICE_LABEL = "Simulated practice — not an observed clinical skills assessment and not verified competence";
export const OSCE_UNAVAILABLE = "OSCE practice is not available here yet: the place it keeps your stations has not been installed on this environment. Everything else in Scholar works as before.";
export const OSCE_OFF = "OSCE practice is not offered right now.";
/** Said wherever feedback or guidance is shown: practice points the learner back to their course and local guidance. */
export const OSCE_GUIDELINES_NOTE = "Check what you practised against your course materials and current local clinical guidelines. This is practice, not clinical guidance.";

/**
 * The structural bounds (721). A checklist of 1 to 60 items: wide on purpose, so a clinically justified station is never
 * refused for its length. The DESIGN default is 8 to 12 (OSCE_DESIGN_CHECKLIST, and the policy defaults), which is a
 * pattern, not a rule. Duration and sections are 720's.
 */
export const OSCE_BOUNDS = { checklistMin: 1, checklistMax: 60, durationMin: 3, durationMax: 20, sectionsMax: 6 } as const;
export const OSCE_DESIGN_CHECKLIST = { min: 8, max: 12 } as const;
export const OSCE_TEXT_MAX = { title: 160, scenario: 4000, instructions: 2000, item: 300, section: 80, response: 4000, field: 160, list: 400, guidance: 4000 } as const;
export const DEFAULT_OSCE_SECTIONS: readonly string[] = ["Introduction and consent", "Assessment", "Findings", "Escalation and plan"];
export const OSCE_PROMPT_VERSIONS = { station: "scholar-osce-station-v1", feedback: "scholar-osce-feedback-v2" } as const;

export type OsceSource = "template" | "competency" | "ai" | "own" | "library";
/** OSCE-AUTHORING-01 (owner, 31 Oct 2026): a governed station is said to be from the library AND clinically reviewed. */
export const LIBRARY_STATION_LABEL = "From the Competen library (clinically reviewed)";
export const OSCE_SOURCE_LABEL: Record<OsceSource, string> = {
  template: "Competen practice template",
  competency: "Built from a competency's learning outcomes",
  ai: "Written by AI from your notes",
  own: "Written by you",
  library: LIBRARY_STATION_LABEL,
};
export const OSCE_SOURCES: readonly OsceSource[] = ["library", "template", "competency", "ai", "own"];

export type OsceDifficulty = "introductory" | "intermediate" | "advanced";
export const OSCE_DIFFICULTIES: readonly OsceDifficulty[] = ["introductory", "intermediate", "advanced"];
export const OSCE_DIFFICULTY_LABEL: Record<OsceDifficulty, string> = { introductory: "Introductory", intermediate: "Intermediate", advanced: "Advanced" };
export const isOsceDifficulty = (v: unknown): v is OsceDifficulty => typeof v === "string" && (OSCE_DIFFICULTIES as readonly string[]).includes(v);

/** One checklist item. `quote`/`chunkId`: where an item written from notes is grounded. `outcome`: the outcome it practises. */
export type OsceItem = { id: string; text: string; critical: boolean; outcome?: string; quote?: string; chunkId?: string };
export type OsceMark = "done" | "partly" | "missed";
export const OSCE_MARKS: readonly OsceMark[] = ["done", "partly", "missed"];
export const OSCE_MARK_LABEL: Record<OsceMark, string> = { done: "Done", partly: "Partly", missed: "Missed" };
export type OsceTick = { itemId: string; mark: OsceMark };
export const isOsceMark = (v: unknown): v is OsceMark => typeof v === "string" && (OSCE_MARKS as readonly string[]).includes(v);

/** Assessment guidance and suggested responses: shown to the learner only AFTER a run, never in the brief or during it. */
export type OsceGuidance = { suggestedResponses: string[]; assessmentGuidance: string | null };
/** Where a station came from, kept on it (721 source_references). */
export type OsceReference =
  | { kind: "notes"; materialId: string; chunkId: string; citation: string }
  | { kind: "competency"; competencyId: string; label: string }
  | { kind: "library"; resourceId: string; versionId: string; versionNo: number }
  | { kind: "reference"; label: string; url?: string };

/** The station definition beyond the brief and checklist (721). Every field is optional: unknown is null, never invented. */
export type OsceDefinition = {
  profession: string | null; programmeCode: string | null; programmeLabel: string | null; topic: string | null; bodySystem: string | null;
  difficulty: OsceDifficulty | null; learningOutcomes: string[]; objectives: string[]; expectedActivities: string[];
  guidance: OsceGuidance | null; references: OsceReference[]; version: number;
};
export const EMPTY_DEFINITION: OsceDefinition = {
  profession: null, programmeCode: null, programmeLabel: null, topic: null, bodySystem: null, difficulty: null,
  learningOutcomes: [], objectives: [], expectedActivities: [], guidance: null, references: [], version: 1,
};

export type OsceStationDraft = OsceDefinition & {
  title: string; scenario: string; candidateInstructions: string; durationMinutes: number; sections: string[]; checklist: OsceItem[];
  source: OsceSource; templateKey: string | null; contentStatus: string; competencyId: string | null;
  materialId: string | null; chunkId: string | null; model: string | null; promptVersion: string | null;
  libraryResourceId: string | null; libraryVersionId: string | null;
  /** A governed copy only: the stored JSON the 721 guard compares, written exactly as published. */
  exact?: { expected_activities: unknown; guidance: unknown };
};

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const cleanOrNull = (v: unknown, max: number) => clean(v, max) || null;
/** Pure. A list of short non-empty strings, duplicates dropped, at most `n`. */
export function cleanList(v: unknown, n: number, max: number = OSCE_TEXT_MAX.list): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const t = clean(x, max);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/** Pure. Guidance read defensively from its stored shape ({suggested_responses, assessment_guidance}). Empty: null. */
export function readGuidance(v: unknown): OsceGuidance | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const suggestedResponses = cleanList(o.suggested_responses ?? o.suggestedResponses, 30, OSCE_TEXT_MAX.guidance);
  const g = o.assessment_guidance ?? o.assessmentGuidance;
  const assessmentGuidance = typeof g === "string" && g.trim() ? g.trim().slice(0, OSCE_TEXT_MAX.guidance) : null;
  return suggestedResponses.length || assessmentGuidance ? { suggestedResponses, assessmentGuidance } : null;
}
export const guidanceJson = (g: OsceGuidance | null) => (g ? { suggested_responses: g.suggestedResponses, assessment_guidance: g.assessmentGuidance } : null);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pure. References read defensively: only the four known shapes, at most 40. */
export function readReferences(v: unknown): OsceReference[] {
  const out: OsceReference[] = [];
  for (const r of Array.isArray(v) ? v : []) {
    const o = (r ?? {}) as Record<string, unknown>;
    if (o.kind === "notes" && UUID_RE.test(String(o.materialId)) && UUID_RE.test(String(o.chunkId))) out.push({ kind: "notes", materialId: String(o.materialId), chunkId: String(o.chunkId), citation: clean(o.citation, 200) });
    else if (o.kind === "competency" && UUID_RE.test(String(o.competencyId))) out.push({ kind: "competency", competencyId: String(o.competencyId), label: clean(o.label, 200) });
    else if (o.kind === "library" && UUID_RE.test(String(o.resourceId)) && UUID_RE.test(String(o.versionId)) && Number.isInteger(o.versionNo)) out.push({ kind: "library", resourceId: String(o.resourceId), versionId: String(o.versionId), versionNo: o.versionNo as number });
    else if ((o.kind === "reference" || o.kind === undefined) && clean(o.label, 300)) {
      const url = typeof o.url === "string" && /^https:\/\/[^\s]+$/.test(o.url) ? o.url.slice(0, 500) : undefined;
      out.push({ kind: "reference", label: clean(o.label, 300), ...(url ? { url } : {}) });
    }
    if (out.length >= 40) break;
  }
  return out;
}

/** Pure. The 721 definition fields of a stored row or a governed content object (snake_case or camelCase), cleaned. */
export function readDefinition(o: Record<string, unknown>): OsceDefinition {
  const pick = (a: string, b: string) => o[a] ?? o[b];
  const version = Number(o.version);
  return {
    profession: cleanOrNull(o.profession, 80), programmeCode: cleanOrNull(pick("programme_code", "programmeCode"), 80),
    programmeLabel: cleanOrNull(pick("programme_label", "programmeLabel"), 200), topic: cleanOrNull(o.topic, OSCE_TEXT_MAX.field),
    bodySystem: cleanOrNull(pick("body_system", "bodySystem"), 80), difficulty: isOsceDifficulty(o.difficulty) ? o.difficulty : null,
    learningOutcomes: cleanList(pick("learning_outcomes", "learningOutcomes"), 60), objectives: cleanList(o.objectives, 30),
    expectedActivities: cleanList(pick("expected_activities", "expectedActivities"), 60), guidance: readGuidance(o.guidance),
    references: readReferences(pick("source_references", "references")), version: Number.isInteger(version) && version >= 1 ? version : 1,
  };
}

// ── VALIDATION (the 720 CHECKs, said first in code so a refusal has a plain reason) ─────────────────────────────

export type ChecklistCheck = { ok: true; items: OsceItem[] } | { ok: false; reason: string };

/**
 * Pure. A checklist as 720/721 accept it: min to max items (the structural 1 to 60 unless narrowed), each with an id,
 * text and a boolean critical, ids unique. No length is refused below the structural bound: 8 to 12 is a design default.
 */
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

// ── A GOVERNED STATION (CKRI kind osce_station, 442 widened by 721) ── its content shape, said first in code ─────
//
// The content of a published, clinically approved station is snake_case JSON, checked again by the database
// (ckri_knowledge_content_ok). A learner copy is that content EXACTLY (the 721 guard compares scenario, instructions,
// duration, checklist, expected activities and guidance), so nothing here rewrites what it copies.

export type GovernedStationContent = {
  scenario: string; candidateInstructions: string; durationMinutes: number; checklist: OsceItem[]; sections: string[] | null;
  definition: OsceDefinition;
  /** The exact stored values the copy must carry (721 guard). */
  raw: { scenario: string; candidate_instructions: string; checklist: unknown; expected_activities: unknown; guidance: unknown };
};

// ── THE STORED FORM, MEASURED AS POSTGRES MEASURES IT ── (OSCE-AUTHORING-01) ────────────────────────────────────
//
// Several bounds are byte bounds on jsonb text (octet_length(x::text)): the whole version content (442: 32000), and on
// the learner's copy (720/721: checklist 64000, objectives 12000, activities and outcomes 24000, references 16000,
// sections 1000). Postgres prints jsonb as {"k": v, "k2": v2} and [a, b], so the bytes are measured the same way here,
// and a station HQ saves is never one the database, or the learner's copy of it, would refuse.

/** Pure. The text Postgres prints for a jsonb value. Postgres orders object keys differently; the length is the same. */
export function pgJsonText(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(pgJsonText).join(", ")}]`;
  if (typeof v === "object") return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${pgJsonText(x)}`).join(", ")}}`;
  return JSON.stringify(v) ?? "null";
}
export const pgJsonBytes = (v: unknown) => new TextEncoder().encode(pgJsonText(v)).length;
export const OSCE_STORED_MAX_BYTES = { content: 32000, checklist: 64000, objectives: 12000, expectedActivities: 24000, learningOutcomes: 24000, references: 16000, sections: 1000 } as const;
/** Postgres counts characters (code points) and btrim strips spaces only. */
const chars = (s: string) => [...s].length;
const pgTrim = (s: string) => s.replace(/^ +| +$/g, "");
type Refusal = { ok: false; reason: string };
const no = (reason: string): Refusal => ({ ok: false, reason });

/**
 * Pure. A governed station's content, validated as the database accepts it (442 ckri_knowledge_content_ok widened by 721,
 * the 442 version size, and the 720/721 bounds of the learner's copy), or the plain reason it cannot be used.
 *
 * ONE FUNCTION, TWO SIDES (OSCE-AUTHORING-01): HQ authoring saves a station only when this accepts it
 * (src/lib/knowledge/educator.ts checkedContent), and Scholar offers a published one only when this accepts it
 * (library-questions.ts). A key stored as JSON null is NOT absent to Postgres (p -> 'k' is then a jsonb null, which the
 * shape check refuses), so it is refused here too: an optional field is omitted, never null.
 */
export function validateStationContent(c: unknown): { ok: true; content: GovernedStationContent } | Refusal {
  const o = (c ?? {}) as Record<string, unknown>;
  if (!c || typeof c !== "object" || Array.isArray(c)) return no("The station content is not an object.");
  const has = (k: string) => o[k] !== undefined;
  const text = (k: string, min: number, max: number) => typeof o[k] === "string" && (o[k] as string).trim().length >= min && chars(pgTrim(o[k] as string)) <= max && chars(pgTrim(o[k] as string)) >= min;
  if (!text("scenario", 20, OSCE_TEXT_MAX.scenario)) return no("The scenario must be 20 to 4000 characters.");
  if (!text("candidate_instructions", 10, OSCE_TEXT_MAX.instructions)) return no("The candidate instructions must be 10 to 2000 characters.");
  const d = o.duration_minutes;
  if (typeof d !== "number" || !Number.isInteger(d) || d < OSCE_BOUNDS.durationMin || d > OSCE_BOUNDS.durationMax) return no("The duration must be a whole number of minutes from 3 to 20.");
  if (Array.isArray(o.checklist) && o.checklist.some(r => r && typeof r === "object" && typeof (r as Record<string, unknown>).text === "string" && chars(((r as Record<string, unknown>).text as string).replace(/\s+/g, " ").trim()) > OSCE_TEXT_MAX.item))
    return no(`A checklist item is longer than ${OSCE_TEXT_MAX.item} characters.`);
  const list = validateChecklist(o.checklist);
  if (!list.ok) return list;
  // The copy keeps the stored checklist exactly, so it must already be in the cleaned form (no padding to trim away).
  const exact = (o.checklist as Record<string, unknown>[]).every((r, i) => r.id === list.items[i].id && r.text === list.items[i].text && (r.outcome === undefined || r.outcome === list.items[i].outcome));
  if (!exact) return no("Each checklist item's id, text and outcome must be stored without extra spaces.");
  if (pgJsonBytes(o.checklist) > OSCE_STORED_MAX_BYTES.checklist) return no("The checklist is too long to store.");
  if (has("sections")) {
    if (!Array.isArray(o.sections) || o.sections.length < 1 || o.sections.length > OSCE_BOUNDS.sectionsMax || o.sections.some(s => typeof s !== "string" || !s.trim() || chars(s.trim()) > OSCE_TEXT_MAX.section)) return no(`Response sections must be 1 to ${OSCE_BOUNDS.sectionsMax} headings of up to ${OSCE_TEXT_MAX.section} characters, or none for the defaults.`);
    if (pgJsonBytes(normaliseSections(o.sections)) > OSCE_STORED_MAX_BYTES.sections) return no("The response sections are too long to store.");
  }
  const lists = [["objectives", "Objectives", 30, OSCE_STORED_MAX_BYTES.objectives], ["expected_activities", "Expected candidate activities", 60, OSCE_STORED_MAX_BYTES.expectedActivities],
    ["learning_outcomes", "Learning outcomes", 60, OSCE_STORED_MAX_BYTES.learningOutcomes]] as const;
  for (const [k, label, n, bytes] of lists) {
    if (!has(k)) continue;
    const v = o[k];
    if (!Array.isArray(v) || v.some(s => typeof s !== "string" || !s.trim())) return no(`${label} must be a list of text, each entry non-empty.`);
    if (v.length > n) return no(`${label}: at most ${n} entries (this has ${v.length}).`);
    if (v.some(s => chars((s as string).replace(/\s+/g, " ").trim()) > OSCE_TEXT_MAX.list)) return no(`${label}: each entry is at most ${OSCE_TEXT_MAX.list} characters.`);
    if (pgJsonBytes(v) > bytes) return no(`${label} are too long to store.`);
  }
  if (has("references")) {
    const v = o.references;
    if (!Array.isArray(v) || v.length > 40 || v.some(r => !r || typeof r !== "object" || Array.isArray(r))) return no("References must be a list of at most 40 references.");
    for (const r of v as Record<string, unknown>[]) {
      if (r.kind !== undefined && r.kind !== "reference") return no("A station reference is a label, with an optional https link.");
      if (typeof r.label !== "string" || !r.label.trim() || chars(r.label.trim()) > 300) return no("Each reference needs a label of up to 300 characters.");
      if (r.url !== undefined && (typeof r.url !== "string" || !/^https:\/\/[^\s]+$/.test(r.url) || r.url.length > 500)) return no("A reference link must start with https:// and have no spaces.");
    }
  }
  if (has("guidance")) {
    const g = o.guidance as Record<string, unknown>;
    if (!g || typeof g !== "object" || Array.isArray(g)) return no("Guidance must be an object.");
    const sr = g.suggested_responses;
    if (sr !== undefined && (!Array.isArray(sr) || sr.length > 30 || sr.some(s => typeof s !== "string" || !s.trim() || chars(s.trim()) > OSCE_TEXT_MAX.guidance))) return no(`Suggested responses: at most 30, each up to ${OSCE_TEXT_MAX.guidance} characters.`);
    const ag = g.assessment_guidance;
    if (ag !== undefined && ag !== null && (typeof ag !== "string" || chars(ag.trim()) > OSCE_TEXT_MAX.guidance)) return no(`Scoring guidance is at most ${OSCE_TEXT_MAX.guidance} characters.`);
  }
  if (has("difficulty") && !isOsceDifficulty(o.difficulty)) return no("Difficulty must be introductory, intermediate or advanced.");
  for (const [k, label, max] of [["profession", "Profession", 80], ["programme_code", "Programme code", 80], ["programme_label", "Programme", 200], ["topic", "Topic", 160], ["body_system", "Body system", 80]] as const)
    if (has(k) && (typeof o[k] !== "string" || !(o[k] as string).trim() || chars(pgTrim(o[k] as string)) > max)) return no(`${label}: up to ${max} characters, or leave it out.`);
  if (pgJsonBytes(o) > OSCE_STORED_MAX_BYTES.content) return no(`The station is too long to store (${pgJsonBytes(o)} of ${OSCE_STORED_MAX_BYTES.content} bytes). Shorten the guidance, scenario or checklist.`);
  const refs = readReferences(o.references).filter(r => r.kind === "reference");
  const LIB_REF = { kind: "library", resourceId: "00000000-0000-0000-0000-000000000000", versionId: "00000000-0000-0000-0000-000000000000", versionNo: 100000 };
  if (pgJsonBytes([LIB_REF, ...refs]) > OSCE_STORED_MAX_BYTES.references) return no("The references are too long to store.");
  const scenario = o.scenario as string, candidateInstructions = o.candidate_instructions as string;
  return {
    ok: true,
    content: {
      scenario, candidateInstructions, durationMinutes: d, checklist: list.items,
      sections: Array.isArray(o.sections) ? normaliseSections(o.sections) : null, definition: readDefinition(o),
      raw: { scenario, candidate_instructions: candidateInstructions, checklist: o.checklist, expected_activities: o.expected_activities ?? null, guidance: o.guidance ?? null },
    },
  };
}

export const libraryContentStatus = (versionNo: number) => `Clinically approved Competen station, version ${versionNo}`;

// ── AUTHORING A GOVERNED STATION ── OSCE-AUTHORING-01 (owner, 31 Oct 2026) ─────────────────────────────────────────
//
// The HQ knowledge-library editor (src/app/super-admin/research/_components/OsceStationEditor.tsx) sends these form
// fields. stationContentOf turns them into the stored snake_case content, which validateStationContent then checks,
// in the browser as the author types and again on the server before any write. Text is tidied (line endings, outer
// spaces), never shortened: anything too long is refused with its reason, not silently cut. An empty optional field is
// OMITTED (a JSON null would be refused by the database).

export type StationReferenceField = { label: string; url?: string };
export type StationItemField = { id: string; text: string; critical: boolean; outcome?: string };
export type StationFields = {
  scenario: string; candidateInstructions: string; durationMinutes: number | string; sections: string[]; checklist: StationItemField[];
  profession: string; programmeCode: string; programmeLabel: string; topic: string; bodySystem: string; difficulty: string;
  learningOutcomes: string[]; objectives: string[]; expectedActivities: string[];
  suggestedResponses: string[]; assessmentGuidance: string; references: StationReferenceField[];
};

const para = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim() : "");
const one = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const lines = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []).map(one).filter(Boolean);

/** Pure. The stored content of a governed station from the HQ editor's fields (see the note above). */
export function stationContentOf(f: Record<string, unknown>): Record<string, unknown> {
  const dRaw = f.durationMinutes;
  const duration = typeof dRaw === "number" ? dRaw : typeof dRaw === "string" && dRaw.trim() !== "" ? Number(dRaw) : null;
  const out: Record<string, unknown> = {
    scenario: para(f.scenario), candidate_instructions: para(f.candidateInstructions), duration_minutes: duration,
    checklist: (Array.isArray(f.checklist) ? f.checklist : []).map(r => {
      const o = (r ?? {}) as Record<string, unknown>;
      const item: Record<string, unknown> = { id: typeof o.id === "string" ? o.id.trim() : "", text: one(o.text), critical: o.critical === true };
      const outcome = one(o.outcome);
      if (outcome) item.outcome = outcome;
      return item;
    }),
  };
  const put = (k: string, v: unknown) => { if (v !== "" && !(Array.isArray(v) && v.length === 0)) out[k] = v; };
  put("sections", lines(f.sections));
  put("objectives", lines(f.objectives));
  put("expected_activities", lines(f.expectedActivities));
  put("learning_outcomes", lines(f.learningOutcomes));
  put("profession", one(f.profession));
  put("programme_code", one(f.programmeCode));
  put("programme_label", one(f.programmeLabel));
  put("topic", one(f.topic));
  put("body_system", one(f.bodySystem));
  put("difficulty", one(f.difficulty));
  put("references", (Array.isArray(f.references) ? f.references : []).map(r => {
    const o = (r ?? {}) as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    return { kind: "reference", label: one(o.label), ...(url ? { url } : {}) };
  }).filter(r => r.label || r.url));
  const suggested = lines(f.suggestedResponses), assessment = para(f.assessmentGuidance);
  if (suggested.length || assessment) out.guidance = { ...(suggested.length ? { suggested_responses: suggested } : {}), ...(assessment ? { assessment_guidance: assessment } : {}) };
  return out;
}

/** Pure. The editor's fields from stored content (a draft being edited, or a new version copied from the published one). */
export function stationFieldsOf(c: unknown): StationFields {
  const o = (c && typeof c === "object" && !Array.isArray(c) ? c : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const g = (o.guidance && typeof o.guidance === "object" && !Array.isArray(o.guidance) ? o.guidance : {}) as Record<string, unknown>;
  return {
    scenario: s(o.scenario), candidateInstructions: s(o.candidate_instructions), durationMinutes: typeof o.duration_minutes === "number" ? o.duration_minutes : 8,
    sections: arr(o.sections),
    checklist: (Array.isArray(o.checklist) ? o.checklist : []).map((r, i) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return { id: typeof x.id === "string" && x.id ? x.id : `item-${i + 1}`, text: s(x.text), critical: x.critical === true, ...(typeof x.outcome === "string" && x.outcome ? { outcome: x.outcome } : {}) };
    }),
    profession: s(o.profession), programmeCode: s(o.programme_code), programmeLabel: s(o.programme_label), topic: s(o.topic), bodySystem: s(o.body_system),
    difficulty: s(o.difficulty), learningOutcomes: arr(o.learning_outcomes), objectives: arr(o.objectives), expectedActivities: arr(o.expected_activities),
    suggestedResponses: arr(g.suggested_responses), assessmentGuidance: s(g.assessment_guidance),
    references: (Array.isArray(o.references) ? o.references : []).map(r => { const x = (r ?? {}) as Record<string, unknown>; return { label: s(x.label), ...(typeof x.url === "string" && x.url ? { url: x.url } : {}) }; }),
  };
}

/** Pure. The learner's copy of a governed station, exactly as published (the 721 guard checks it again). */
export function stationFromLibrary(lib: { resourceId: string; versionId: string; versionNo: number; title: string; content: GovernedStationContent }): OsceStationDraft {
  const c = lib.content;
  return {
    ...c.definition,
    expectedActivities: Array.isArray(c.raw.expected_activities) ? c.raw.expected_activities as string[] : [],
    references: [{ kind: "library", resourceId: lib.resourceId, versionId: lib.versionId, versionNo: lib.versionNo }, ...c.definition.references.filter(r => r.kind === "reference")],
    version: lib.versionNo,
    title: clean(lib.title, OSCE_TEXT_MAX.title), scenario: c.raw.scenario, candidateInstructions: c.raw.candidate_instructions, durationMinutes: c.durationMinutes,
    sections: c.sections ?? [...DEFAULT_OSCE_SECTIONS], checklist: c.raw.checklist as OsceItem[], source: "library", templateKey: null,
    contentStatus: libraryContentStatus(lib.versionNo), competencyId: null, materialId: null, chunkId: null, model: null, promptVersion: null,
    libraryResourceId: lib.resourceId, libraryVersionId: lib.versionId,
    exact: { expected_activities: c.raw.expected_activities, guidance: c.raw.guidance },
  };
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
export const TEMPLATE_CONTENT_STATUS = "Competen practice template — not clinically reviewed";
/** A template is DATA: its profession, topic, objectives and guidance are its own fields, never the engine's. */
export type OsceTemplate = {
  key: string; title: string; scenario: string; candidateInstructions: string; durationMinutes: number; checklist: OsceItem[];
  profession: string | null; topic: string; bodySystem: string; difficulty: OsceDifficulty; objectives: string[]; expectedActivities: string[]; guidance: OsceGuidance;
};
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
    profession: null, topic: "Respiratory assessment and escalation", bodySystem: "Respiratory", difficulty: "introductory",
    objectives: ["Practise a systematic respiratory assessment out loud", "Practise deciding when and how to escalate"],
    expectedActivities: ["Introduces themselves and gains consent", "Assesses breathing systematically", "Says what they find", "Escalates with a structured handover", "Documents what they found"],
    guidance: {
      suggestedResponses: ["A systematic order, said out loud: rate over a full minute, rhythm and effort, saturation against the prescribed target, breath sounds", "A structured handover that says what was found and what is needed"],
      assessmentGuidance: "Look for a systematic order, interpretation against the prescribed target rather than a remembered number, and escalation that is timely and structured. Check the detail against your course materials and local policy.",
    },
  },
];
export const osceTemplate = (key: unknown) => OSCE_TEMPLATES.find(t => t.key === key) ?? null;

/** Pure. A template as a station draft, labelled as a not clinically reviewed practice template. */
export function stationFromTemplate(t: OsceTemplate, sections: readonly string[] = DEFAULT_OSCE_SECTIONS): OsceStationDraft {
  return {
    title: t.title, scenario: t.scenario, candidateInstructions: t.candidateInstructions, durationMinutes: t.durationMinutes,
    sections: [...sections], checklist: t.checklist.map(i => ({ ...i })), source: "template", templateKey: t.key,
    contentStatus: TEMPLATE_CONTENT_STATUS, competencyId: null, materialId: null, chunkId: null, model: null, promptVersion: null,
    ...EMPTY_DEFINITION, profession: t.profession, topic: t.topic, bodySystem: t.bodySystem, difficulty: t.difficulty,
    learningOutcomes: [...new Set(t.checklist.map(i => i.outcome).filter((o): o is string => !!o))], objectives: [...t.objectives],
    expectedActivities: [...t.expectedActivities], guidance: { ...t.guidance, suggestedResponses: [...t.guidance.suggestedResponses] },
    references: [{ kind: "reference", label: "Competen practice template, written from the respiratory seed learning outcomes. Not clinically reviewed." }],
    libraryResourceId: null, libraryVersionId: null,
  };
}

/** The station conventions a competency's outcomes are framed by. Practice framing, not from the competency. */
const FRAMING: readonly { id: string; text: string; critical: boolean; at: "start" | "end" }[] = [
  { id: "f-intro", text: "Introduces themselves and explains what they are going to do", critical: false, at: "start" },
  { id: "f-consent", text: "Gains consent before starting", critical: true, at: "start" },
  { id: "f-summary", text: "Summarises what they found", critical: false, at: "end" },
  { id: "f-next", text: "Says what they would do next, including when they would ask for help", critical: true, at: "end" },
];

export type CompetencyForStation = {
  id: string; code: string | null; title: string; description?: string | null; outcomes: readonly string[]; contentStatusLabel: string;
  profession?: string | null; domain?: string | null; programme?: { code: string; label: string } | null;
};

/**
 * Pure. What a station built from a competency says about review. The COMPETENCY's content status is shown as it is
 * recorded (never assumed approved because it exists), and the station itself is never a clinically reviewed station.
 */
export const competencyContentStatus = (label: string) => clean(`Competency content: ${label || "Not clinically reviewed"} · station not clinically reviewed`, 160);

/**
 * Pure. A station built by CODE from a competency's recorded learning outcomes (no AI): each outcome is a critical item,
 * between the station framing items. Fewer than 2 outcomes: refused with the reason. Every outcome is kept up to the
 * structural bound (721): a competency with many outcomes makes a longer station, not a trimmed one.
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
      contentStatus: competencyContentStatus(c.contentStatusLabel), competencyId: c.id, materialId: null, chunkId: null, model: null, promptVersion: null,
      ...EMPTY_DEFINITION, profession: cleanOrNull(c.profession, 80), programmeCode: cleanOrNull(c.programme?.code, 80), programmeLabel: cleanOrNull(c.programme?.label, 200),
      topic: cleanOrNull(c.domain, OSCE_TEXT_MAX.field) ?? cleanOrNull(c.title, OSCE_TEXT_MAX.field), learningOutcomes: kept,
      objectives: [clean(`Practise the learning outcomes of ${name}`, OSCE_TEXT_MAX.list)],
      references: [{ kind: "competency", competencyId: c.id, label: clean(`${name} (${c.contentStatusLabel || "Not clinically reviewed"})`, 200) }],
      libraryResourceId: null, libraryVersionId: null,
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

// ── AI FEEDBACK ON A RUN (activity `evaluate`) ── suggested ticks the learner confirms, and the six-part feedback ──
//
// SCHOLAR-OSCE-01 s8: correct understanding, missing assessment steps, clinical reasoning gaps, important safety
// considerations, suggested improvements, revision topics. The ticks are SUGGESTIONS the learner confirms or changes
// (their own marks are what is recorded, and the result says which marks were the learner's and which the AI suggested).
// Never a pass, a fail or a claim of competence, and never anything the station, its guidance and the writing do not hold.

export const OSCE_FEEDBACK_SYSTEM = [
  "You give formative feedback on what a healthcare student WROTE during a simulated OSCE practice station they did alone, for their own study.",
  "Judge ONLY against the station checklist, the station text and the station guidance given. Do not use outside knowledge, and do not reward anything the checklist does not ask for.",
  "For every checklist item write one line, exactly 'ITEM <id>: done', 'ITEM <id>: partly' or 'ITEM <id>: missed' -- done where the writing clearly shows it, partly where it shows some of it, missed where it does not.",
  "Then exactly these six lines, each short (write none where a part has nothing, separate points with ;):",
  "UNDERSTOOD: what the writing shows was understood correctly",
  "MISSING_STEPS: assessment or task steps from the checklist that were missed or only partly shown",
  "REASONING: gaps in the clinical reasoning the writing shows, in the words of the checklist and guidance",
  "SAFETY: important safety points from the CRITICAL checklist items that the writing missed or only partly showed",
  "IMPROVE: suggested improvements for next time",
  "REVISE: topics to revise, in the words of the checklist",
  "Never give a mark, a score, a percentage, a pass or a fail, and never say the student is competent. No new facts, numbers, doses, drugs or advice. No names.",
].join("\n");

export function osceFeedbackPrompt(station: { scenario: string; candidateInstructions: string; checklist: readonly OsceItem[]; guidance?: OsceGuidance | null; expectedActivities?: readonly string[] }, responses: Record<string, string>): string {
  const written = Object.entries(responses).map(([h, t]) => `${h}:\n${t}`).join("\n\n") || "(nothing written)";
  const g = station.guidance;
  return [
    `STATION: ${station.scenario}\nTASK: ${station.candidateInstructions}`,
    `CHECKLIST:\n${station.checklist.map(i => `${i.id}: ${i.text}${i.critical ? " [CRITICAL]" : ""}`).join("\n")}`,
    ...(station.expectedActivities?.length ? [`EXPECTED ACTIVITIES:\n${station.expectedActivities.join("\n")}`] : []),
    ...(g ? [`GUIDANCE:\n${[g.assessmentGuidance ?? "", ...g.suggestedResponses].filter(Boolean).join("\n")}`] : []),
    `WHAT I WROTE:\n${written}`,
  ].join("\n\n");
}

/**
 * Pure. The texts OSCE feedback may draw its facts from: the station (scenario, task, checklist, the items' quotes and
 * outcomes, expected activities, guidance) and what the learner wrote. Nothing else grounds it.
 */
export function feedbackGroundingText(input: { scenario: string; candidateInstructions: string; checklist: readonly OsceItem[]; responses: Record<string, string>; guidance?: OsceGuidance | null; expectedActivities?: readonly string[] }): string[] {
  return [input.scenario, input.candidateInstructions, ...input.checklist.map(i => i.text), ...input.checklist.map(i => i.quote ?? ""), ...input.checklist.map(i => i.outcome ?? ""),
    ...(input.expectedActivities ?? []), ...(input.guidance?.suggestedResponses ?? []), input.guidance?.assessmentGuidance ?? "", ...Object.values(input.responses)].filter(Boolean);
}

// ── THE FEEDBACK'S OWN GROUNDING CHECK ── D1, staging acceptance 31 Oct 2026 ──
//
// The Holdings check (src/lib/ai/grounding.ts) was built for prose that states facts about a PATIENT: there, "marked",
// "normal" and a spelled-out "two" are a severity, a test result and a count nobody recorded. Formative feedback states
// facts about the learner's WRITING against the station: that an item is "marked critical", that the guidance asks for
// the prescribed target "rather than a general normal value", that "the two most time-sensitive measurements" were
// missed. Read as patient facts, these withheld 4 of 7 accurate replies on staging. This check is the Holdings check
// with three closed, exact excusals, each applied only when EVERY use of the word in the feedback is the meta use:
//   1. a number word COUNTING things, never one followed (within three words) by a quantity -- a unit, a duration, a
//      dose, a rate: "two litres", "every four hours", "five minutes" still need that number in the station or the
//      writing. Digits are never excused: an SpO2 target of 94-98% that is not in the station is withheld.
//   2. "marked" as the checklist's own marking: "marked critical", "marked as done / partly / missed". "Marked distress"
//      is still a severity.
//   3. "normal" naming a reference value set against the station's target: "rather than a (general) normal value".
//      "Within the normal range" and "breath sounds normal" are still findings.
// Pass, fail and competence wording is refused before this (claimsVerification), identifiers too. Every other number,
// month and finding rule applies as written. The Practice and Scholar text checks are unchanged.

const QUANTITY_AFTER = new Set([
  "l", "litre", "litres", "liter", "liters", "ml", "millilitres", "mg", "mcg", "microgram", "micrograms", "g", "gram", "grams", "kg", "mmol", "mmhg", "kpa",
  "second", "seconds", "sec", "secs", "minute", "minutes", "min", "mins", "hour", "hours", "hr", "hrs", "h", "hourly", "day", "days", "daily", "week", "weeks",
  "month", "months", "year", "years", "breath", "breaths", "beat", "beats", "bpm", "percent", "per", "%", "times", "dose", "doses", "tablet", "tablets",
  "puff", "puffs", "unit", "units", "drop", "drops", "metre", "metres", "meter", "meters", "cm", "mm", "degrees", "l/min",
]);
const COUNT_WORDS: readonly string[] = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const MARKED_META = /\bmarked\s+(?:as\s+)?(?:an?\s+)?(?:critical|done|partly|missed)\b/g;
const NORMAL_META = /\b(?:rather than|instead of|than|not|versus|vs\.?)\s+(?:[a-z-]+\s+){0,2}normal\s+(?:value|values|range|ranges|number|numbers|figure|figures)\b/g;

const lowerText = (s: string) => s.toLowerCase().replace(/[‐-―]/g, "-");
/** Whether every use of `word` in `text` counts things: none is followed, within three words, by a quantity. */
function onlyCounts(text: string, word: string): boolean {
  const toks = lowerText(text).replace(/(\d)%/g, "$1 %").split(/[^a-z0-9%/]+/).filter(Boolean);
  return toks.every((t, i) => t !== word || !toks.slice(i + 1, i + 4).some(n => QUANTITY_AFTER.has(n)));
}
const onlyMeta = (text: string, word: string, meta: RegExp) => !new RegExp(`\\b${word}\\b`).test(lowerText(text).replace(meta, " "));

/** Pure. The OSCE feedback grounding check: `base` (the Holdings text check) with the three excusals above. */
export function feedbackGroundingCheck(base: GroundingCheck): GroundingCheck {
  return (text, grounding) => base(text, grounding).filter(raw => {
    const v = raw as { kind?: string; token?: string };
    if (v.kind === "ungrounded_number" && v.token && COUNT_WORDS.includes(v.token)) return !onlyCounts(text, v.token);
    if (v.kind === "asserted_finding" && v.token === "marked") return !onlyMeta(text, "marked", MARKED_META);
    if (v.kind === "asserted_finding" && v.token === "normal") return !onlyMeta(text, "normal", NORMAL_META);
    return true;
  });
}

export type OsceFeedbackParts = {
  understanding: string[]; missingSteps: string[]; reasoningGaps: string[]; safety: string[]; improvements: string[]; revisionTopics: string[];
};
export const OSCE_FEEDBACK_PARTS: readonly (keyof OsceFeedbackParts)[] = ["understanding", "missingSteps", "reasoningGaps", "safety", "improvements", "revisionTopics"];
export const OSCE_FEEDBACK_LABEL: Record<keyof OsceFeedbackParts, string> = {
  understanding: "Correct understanding",
  missingSteps: "Missing assessment steps",
  reasoningGaps: "Clinical reasoning gaps",
  safety: "Important safety considerations",
  improvements: "Suggested improvements",
  revisionTopics: "Revision topics",
};
export type OsceFeedback = { ok: true; suggested: OsceTick[]; parts: OsceFeedbackParts } | { ok: false; reason: "malformed" | "ungrounded" | "identifier" | "verdict_words" };

const FEEDBACK_KEY: Record<string, keyof OsceFeedbackParts> = {
  UNDERSTOOD: "understanding", MISSING_STEPS: "missingSteps", "MISSING STEPS": "missingSteps", REASONING: "reasoningGaps",
  SAFETY: "safety", IMPROVE: "improvements", REVISE: "revisionTopics",
};
const emptyParts = (): OsceFeedbackParts => ({ understanding: [], missingSteps: [], reasoningGaps: [], safety: [], improvements: [], revisionTopics: [] });

/**
 * Pure. The evaluator's reply, checked: a suggested tick for items it named (unknown ids ignored), the six parts, and
 * feedback that adds nothing the station, checklist, guidance and responses do not hold, identifies no one, and never
 * claims a pass or competence. Anything else is withheld: the learner marks themselves, as without AI.
 */
export function parseOsceFeedback(raw: string, items: readonly OsceItem[], grounding: readonly string[], grounded: GroundingCheck, identifiers: IdentifierCheck): OsceFeedback {
  const suggested = new Map<string, OsceMark>();
  const parts = emptyParts();
  let found = 0;
  for (const line of raw.split("\n")) {
    const m = /^\s*\**\s*ITEM\s+([A-Za-z0-9_-]+)\s*\**\s*:\s*\**\s*(done|partly|missed)\b/i.exec(line);
    if (m) { if (items.some(i => i.id === m[1]) && !suggested.has(m[1])) suggested.set(m[1], m[2].toLowerCase() as OsceMark); continue; }
    const f = /^\s*\**\s*(UNDERSTOOD|MISSING[_ ]STEPS|REASONING|SAFETY|IMPROVE|REVISE)\s*\**\s*:\s*(.*)$/i.exec(line);
    if (!f) continue;
    found++;
    const key = FEEDBACK_KEY[f[1].toUpperCase()];
    const body = f[2].trim();
    if (/^none\.?$/i.test(body) || !body) continue;
    parts[key] = body.split(/;\s*/).map(s => s.trim().replace(/\.$/, "")).filter(Boolean).slice(0, 5).map(s => s.slice(0, 300));
  }
  if (!found || !suggested.size) return { ok: false, reason: "malformed" };
  const text = OSCE_FEEDBACK_PARTS.flatMap(k => parts[k]).join("\n");
  if (claimsVerification(text)) return { ok: false, reason: "verdict_words" };
  if (identifiers(text).length) return { ok: false, reason: "identifier" };
  if (text && grounded(text, [...grounding]).length) return { ok: false, reason: "ungrounded" };
  return { ok: true, suggested: items.filter(i => suggested.has(i.id)).map(i => ({ itemId: i.id, mark: suggested.get(i.id)! })), parts };
}

/**
 * Pure. Feedback kept on a run, read for display: the six parts. A run kept by the first version (right, missing,
 * misconceptions, why, next) is read into the nearest parts, so nothing kept is lost. Anything else: null.
 */
export function readFeedbackParts(v: unknown): OsceFeedbackParts | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 5) : typeof x === "string" && x.trim() ? [x.trim()] : []);
  const out = emptyParts();
  if (OSCE_FEEDBACK_PARTS.some(k => k in o)) { for (const k of OSCE_FEEDBACK_PARTS) out[k] = list(o[k]); }
  else if ("right" in o || "missing" in o) {
    out.understanding = list(o.right); out.missingSteps = list(o.missing); out.reasoningGaps = list(o.misconceptions);
    out.improvements = [...list(o.why), ...list(o.next)];
  } else return null;
  return out;
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

// ── HOW THE SCORE IS MADE, AND WHAT A HIGH SCORE MUST NOT HIDE (SCHOLAR-OSCE-01 s9) ───────────────────────────────

/** Pure. The practice score explained in plain steps, for the results page. Never pass, fail or competence. */
export function scoreExplanation(s: { points: number; outOf: number; criticalMissed: number; criticalPartly: number; criticalTotal: number }): string[] {
  const pct = s.outOf ? Math.round((s.points / s.outOf) * 100) : 0;
  const pts = Number.isInteger(s.points) ? String(s.points) : s.points.toFixed(1);
  return [
    `Each of the ${s.outOf} checklist item${s.outOf === 1 ? "" : "s"} counts one point if marked done, half a point if partly, and nothing if missed.`,
    `Your marks add up to ${pts} of ${s.outOf} points, which is ${pct}%.`,
    s.criticalTotal
      ? `Critical items count the same in the score, so they are also listed on their own: ${s.criticalMissed} of ${s.criticalTotal} critical item${s.criticalTotal === 1 ? "" : "s"} missed${s.criticalPartly ? ` and ${s.criticalPartly} partly done` : ""}. A high score does not cancel a missed critical item.`
      : "This station marks no item as critical.",
    "The score is a practice measure from the marks you confirmed. It is not a pass or a fail, and it is not an assessment of competence.",
  ];
}

// ── THE RESULT: STRENGTHS, GAPS, NEXT STEPS (SCHOLAR-OSCE-01 s10) ───────────────────────────────────────────────

export type OsceGap = { itemId: string; text: string; critical: boolean; mark: "partly" | "missed" };
export type OsceResult = { strengths: string[]; gaps: OsceGap[]; criticalMissed: OsceGap[]; criticalPartly: OsceGap[] };

/** Pure. From the confirmed ticks: what went well (done items), the gaps (missed then partly, critical first). */
export function resultOf(checklist: readonly OsceItem[], ticks: readonly OsceTick[]): OsceResult {
  const mark = new Map(ticks.map(t => [t.itemId, t.mark]));
  const gap = (i: OsceItem): OsceGap => ({ itemId: i.id, text: i.text, critical: i.critical, mark: mark.get(i.id) as "partly" | "missed" });
  const weak = checklist.filter(i => mark.get(i.id) === "missed" || mark.get(i.id) === "partly").map(gap)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || (a.mark === b.mark ? 0 : a.mark === "missed" ? -1 : 1));
  return {
    strengths: checklist.filter(i => mark.get(i.id) === "done").map(i => i.text),
    gaps: weak, criticalMissed: weak.filter(g => g.critical && g.mark === "missed"), criticalPartly: weak.filter(g => g.critical && g.mark === "partly"),
  };
}

/** Pure. Per item: the learner's own mark and, where AI feedback was asked for, what it suggested -- kept apart. */
export function marksCompared(checklist: readonly OsceItem[], ticks: readonly OsceTick[], suggested: readonly OsceTick[] | null) {
  return checklist.map(i => ({
    itemId: i.id, text: i.text, critical: i.critical,
    yours: ticks.find(t => t.itemId === i.id)?.mark ?? null,
    suggested: suggested?.find(t => t.itemId === i.id)?.mark ?? null,
  }));
}

// ── THE SNAPSHOT A RUN IS MARKED AGAINST (721) ──────────────────────────────────────────────────────────────────

export type OsceSnapshot = {
  version: number; title: string; scenario: string; candidateInstructions: string; durationMinutes: number; sections: string[];
  checklist: OsceItem[]; guidance: OsceGuidance | null; expectedActivities: string[];
};
export function snapshotOf(s: OsceSnapshot): Record<string, unknown> {
  return {
    version: s.version, title: s.title, scenario: s.scenario, candidate_instructions: s.candidateInstructions, duration_minutes: s.durationMinutes,
    sections: s.sections, checklist: s.checklist, guidance: guidanceJson(s.guidance), expected_activities: s.expectedActivities,
  };
}
/** Pure. The stored snapshot, or the station itself where a run has none (one started before 721). */
export function readSnapshot(v: unknown, fallback: OsceSnapshot): OsceSnapshot {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
  const o = v as Record<string, unknown>;
  const list = validateChecklist(o.checklist);
  if (!list.ok) return fallback;
  const version = Number(o.version);
  return {
    version: Number.isInteger(version) && version >= 1 ? version : fallback.version, title: clean(o.title, OSCE_TEXT_MAX.title) || fallback.title,
    scenario: typeof o.scenario === "string" ? o.scenario : fallback.scenario,
    candidateInstructions: typeof o.candidate_instructions === "string" ? o.candidate_instructions : fallback.candidateInstructions,
    durationMinutes: clampDuration(o.duration_minutes, fallback.durationMinutes), sections: Array.isArray(o.sections) ? normaliseSections(o.sections) : fallback.sections,
    checklist: list.items, guidance: readGuidance(o.guidance), expectedActivities: cleanList(o.expected_activities, 60),
  };
}

// ── INTERRUPTION RECOVERY (SCHOLAR-OSCE-01 s7) ── the server clock decides, written work is never lost ───────────

/** How often the browser saves while typing (debounced), and how late after time up a save is still kept. */
export const OSCE_AUTOSAVE = { debounceMs: 1500, heartbeatMs: 15000, graceSeconds: 20 } as const;

/**
 * Pure. Where an open run stands when the learner comes back: still running (with the server's remaining seconds),
 * or time up (finish it with what was saved). Never restarts the clock.
 */
export function resumeOf(startedAtMs: number, durationMinutes: number, serverNowMs: number): { state: "running"; remainingSeconds: number } | { state: "time_up" } {
  const t = timerState(startedAtMs, durationMinutes, serverNowMs);
  return t.timeUp ? { state: "time_up" } : { state: "running", remainingSeconds: t.remainingSeconds };
}

/** Pure. Whether an autosave arriving now is still inside the run (with a short grace for a save sent at the bell). */
export function saveAllowed(startedAtMs: number, durationMinutes: number, serverNowMs: number): boolean {
  return serverNowMs <= startedAtMs + (durationMinutes * 60 + OSCE_AUTOSAVE.graceSeconds) * 1000;
}

// ── STATION SELECTION (SCHOLAR-OSCE-01 s6) ── filter and browse by topic or body system, competency, programme, ──
// difficulty and source. Pure: the page passes its stations and the query.

export type OsceFilter = { q: string | null; competency: string | null; programme: string | null; difficulty: OsceDifficulty | null; source: OsceSource | null };
export type Filterable = { title: string; topic: string | null; bodySystem: string | null; competencyId: string | null; programmeCode: string | null; difficulty: OsceDifficulty | null; source: OsceSource };

/** Pure. The filter from a query string's values. Unknown values are ignored, never an error. */
export function parseOsceFilter(sp: Record<string, string | string[] | undefined>): OsceFilter {
  const one = (k: string) => { const v = sp[k]; const s = Array.isArray(v) ? v[0] : v; return typeof s === "string" && s.trim() ? s.trim().slice(0, 120) : null; };
  const source = one("source"), difficulty = one("difficulty");
  return {
    q: one("q"), competency: one("competency"), programme: one("programme"),
    difficulty: isOsceDifficulty(difficulty) ? difficulty : null,
    source: source && (OSCE_SOURCES as readonly string[]).includes(source) ? source as OsceSource : null,
  };
}

/** Pure. The stations a filter keeps. `q` matches the topic, the body system or the title (any word order). */
export function filterStations<T extends Filterable>(stations: readonly T[], f: OsceFilter): T[] {
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return stations.filter(s => {
    const hay = `${s.title} ${s.topic ?? ""} ${s.bodySystem ?? ""}`.toLowerCase();
    return words.every(w => hay.includes(w))
      && (!f.competency || s.competencyId === f.competency) && (!f.programme || s.programmeCode === f.programme)
      && (!f.difficulty || s.difficulty === f.difficulty) && (!f.source || s.source === f.source);
  });
}

/** Pure. The choices a filter offers, from the stations themselves (nothing offered that would match none). */
export function stationFacets(stations: readonly Filterable[]) {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  return {
    topics: uniq(stations.flatMap(s => [s.topic, s.bodySystem])), programmes: uniq(stations.map(s => s.programmeCode)),
    competencies: uniq(stations.map(s => s.competencyId)), difficulties: OSCE_DIFFICULTIES.filter(d => stations.some(s => s.difficulty === d)),
    sources: OSCE_SOURCES.filter(x => stations.some(s => s.source === x)),
  };
}

// ── NOTES TOO THIN FOR A STATION (SCHOLAR-OSCE-01 s4) ── offer evidence recovery, never a guess ─────────────────

export const OSCE_RECOVERY_NOTE = "Your notes were not enough for a station that could be checked against them. You can look for more learning resources on this topic below (your notes, then the approved Competen library), or choose a practice template or a competency instead.";

/** Pure. The evidence-recovery request a withheld station offers: the material's own title as the topic, its section. */
export function osceRecoveryRequest(m: { materialId: string; title: string; chunkId: string | null }, reason: string): { question: string; materialId: string; sectionId: string | null; withheldReason: string } | null {
  const question = clean(m.title, 300);
  return question.length >= 3 ? { question, materialId: m.materialId, sectionId: m.chunkId, withheldReason: `osce_${reason}`.slice(0, 40) } : null;
}
