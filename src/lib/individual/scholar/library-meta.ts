// ── LIBRARY ITEM METADATA AND PROVENANCE ── SQIE-CLOSE-2026-11 WS-E (owner directive s4, owner decisions 4 Nov items 2-3) ───
//
// A governed library question (CKRI revision_question, 442/800) may say WHO it is written for and WHERE it comes from. The
// keys sit at the top level of the version content, with the names the pilot batch (content/sqie-pilot-batch) and the 721
// OSCE station content already use, so one vocabulary covers both kinds:
//   programme_code, programme_label        an individual_scholar_programme (387) code and its words
//   qualification_level, qualification_label  a qualification code (e.g. pre_registration_diploma) and its words
//   difficulty                             introductory, intermediate or advanced (the 721 vocabulary)
// and the provenance an author or an import records, kept exactly as given:
//   references, source_verification, competency_mapping (framework version, competency, learning objective, status),
//   misconception_tags, topic, question_type, pilot_batch, calculation
// All of it is inside the exact content an educator reviews, a clinician approves (the content hash) and a publisher
// publishes, and it is frozen with it. Migration 995 checks the shape in the database.
//
// ⚠ ALL OPTIONAL. A question without them is offered exactly as before: to every learner whose accepted competency links
// match, at standard difficulty. Only a KNOWN mismatch (programme, or qualification family) excludes an item.
// ⚠ NOT COPIED INTO THE LEARNER'S ANSWER. The 800 guard rebuilds a copy from answerKey, rubric and marking only. The copy's
// `difficulty` column (416, 1-3, not guarded) takes the item's difficulty, so an adaptive exam can target it.
// ⚠ A DRAFT MAPPING IS NOT EVIDENCE (owner decision 3). competency_mapping is shown as a draft unless the version is
// published AND the framework version it names is published (mappingStatus). Nothing here turns a question result into
// verified competence or a stage.
//
// Pure and dependency-free (the HQ form, a client component, imports it).

export const LIBRARY_DIFFICULTIES = ["introductory", "intermediate", "advanced"] as const;
export type LibraryDifficulty = (typeof LIBRARY_DIFFICULTIES)[number];
export const DIFFICULTY_LABEL: Record<LibraryDifficulty, string> = { introductory: "Introductory", intermediate: "Intermediate", advanced: "Advanced" };
/** The 1-3 scale 416 records on a learner question (1 easier, 2 standard, 3 harder). */
export const DIFFICULTY_NUMBER: Record<LibraryDifficulty, 1 | 2 | 3> = { introductory: 1, intermediate: 2, advanced: 3 };

/** The qualification families a learner's programme and level words name (the same words levelDefaultDifficulty reads). */
export const QUALIFICATION_LEVELS = ["certificate", "diploma", "degree", "postgraduate"] as const;
export type QualificationLevel = (typeof QUALIFICATION_LEVELS)[number];
export const QUALIFICATION_LABEL: Record<QualificationLevel, string> = {
  certificate: "Certificate / enrolled", diploma: "Diploma", degree: "Degree (bachelor's)", postgraduate: "Postgraduate (master's, doctoral)",
};
/** The 387 programme code shape (individual_scholar_programme_code_check). */
export const PROGRAMME_CODE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const QUALIFICATION_CODE = /^[a-z][a-z0-9_]{1,60}$/;

export type LibraryMeta = {
  programmeCode?: string; programmeLabel?: string; qualificationLevel?: string; qualificationLabel?: string; difficulty?: LibraryDifficulty;
};

/** Provenance keys kept exactly as given (shape-checked lightly here and in 995). */
export const CARRIED_KEYS = ["references", "source_verification", "competency_mapping", "misconception_tags", "topic", "question_type", "pilot_batch", "calculation"] as const;
const META_KEYS = ["programme_code", "programme_label", "qualification_level", "qualification_label", "difficulty"] as const;

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= max ? v.trim() : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const absent = (v: unknown) => v === undefined || v === null || v === "";

/**
 * Pure. The metadata and provenance keys of a content, normalised, or the plain reason they are not in the shape the
 * library keeps. `fields` is what goes back into the content (top-level keys); absent keys stay absent.
 */
export function checkLibraryMeta(raw: unknown): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const c = isObj(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  const str = (k: string, max: number, re?: RegExp, msg = "") => {
    if (absent(c[k])) return null;
    const t = text(c[k], max);
    if (!t || (re && !re.test(t))) return msg || `${k.replace(/_/g, " ")} is not in the shape the library keeps.`;
    out[k] = t; return null;
  };
  const errs = [
    str("programme_code", 63, PROGRAMME_CODE, "Choose the programme from the list."),
    str("programme_label", 200),
    str("qualification_level", 61, QUALIFICATION_CODE, "Choose a qualification level from the list."),
    str("qualification_label", 200),
    str("topic", 160),
    str("question_type", 40, /^[a-z_]{1,40}$/),
    str("pilot_batch", 80),
  ].filter(Boolean);
  if (errs.length) return { ok: false, error: errs[0] as string };
  if (!absent(c.difficulty)) {
    if (!(LIBRARY_DIFFICULTIES as readonly unknown[]).includes(c.difficulty)) return { ok: false, error: "Choose the difficulty: introductory, intermediate or advanced." };
    out.difficulty = c.difficulty;
  }
  if (c.references !== undefined && c.references !== null) {
    if (!Array.isArray(c.references) || c.references.length > 40 || !c.references.every(isObj)) return { ok: false, error: "References are a list of up to 40 entries." };
    out.references = c.references;
  }
  for (const k of ["source_verification", "competency_mapping", "calculation"] as const)
    if (c[k] !== undefined && c[k] !== null) { if (!isObj(c[k])) return { ok: false, error: `${k.replace(/_/g, " ")} is not readable.` }; out[k] = c[k]; }
  if (c.misconception_tags !== undefined && c.misconception_tags !== null) {
    if (!Array.isArray(c.misconception_tags) || c.misconception_tags.length > 20 || !c.misconception_tags.every(t => typeof t === "string" && t.length >= 1 && t.length <= 80))
      return { ok: false, error: "Misconception tags are up to 20 short words." };
    out.misconception_tags = c.misconception_tags;
  }
  return { ok: true, fields: out };
}

/** Pure. Whether a content carries any metadata or provenance key. */
export const hasMetaKeys = (c: unknown): boolean => isObj(c) && [...META_KEYS, ...CARRIED_KEYS].some(k => c[k] !== undefined);

/** Pure. The metadata a stored content carries (unreadable or absent: none). */
export function metaOf(content: unknown): LibraryMeta | null {
  const r = checkLibraryMeta(content);
  if (!r.ok) return null;
  const f = r.fields;
  const m: LibraryMeta = {
    ...(f.programme_code ? { programmeCode: f.programme_code as string } : {}), ...(f.programme_label ? { programmeLabel: f.programme_label as string } : {}),
    ...(f.qualification_level ? { qualificationLevel: f.qualification_level as string } : {}), ...(f.qualification_label ? { qualificationLabel: f.qualification_label as string } : {}),
    ...(f.difficulty ? { difficulty: f.difficulty as LibraryDifficulty } : {}),
  };
  return Object.keys(m).length ? m : null;
}

/** Pure. The provenance keys of a stored content (to carry through an edit of the draft). */
export function carriedOf(content: unknown): Record<string, unknown> {
  const r = checkLibraryMeta(content);
  if (!r.ok) return {};
  return Object.fromEntries(CARRIED_KEYS.filter(k => r.fields[k] !== undefined).map(k => [k, r.fields[k]]));
}

/** Pure. The metadata keys from the educator form's plain fields, plus the carried provenance (`carried`). */
export function metaFromFields(f: Record<string, unknown>): Record<string, unknown> {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const out: Record<string, unknown> = {};
  if (s(f.programmeCode)) { out.programme_code = s(f.programmeCode).toLowerCase(); if (s(f.programmeLabel)) out.programme_label = s(f.programmeLabel); }
  if (s(f.qualificationLevel)) { out.qualification_level = s(f.qualificationLevel); if (s(f.qualificationLabel)) out.qualification_label = s(f.qualificationLabel); }
  if (s(f.difficulty)) out.difficulty = s(f.difficulty);
  if (isObj(f.carried)) for (const k of CARRIED_KEYS) if (f.carried[k] !== undefined) out[k] = f.carried[k];
  return out;
}

/**
 * Pure. The qualification family that words name, by the SAME words levelDefaultDifficulty (question-intel.ts) reads.
 * Codes are read as words (pre_registration_diploma is a diploma). null when they name none -- then nothing is excluded.
 */
export function qualificationOf(...words: readonly (string | null | undefined)[]): QualificationLevel | null {
  const t = words.filter(Boolean).join(" ").toLowerCase().replace(/[_-]+/g, " ");
  if (!t.trim()) return null;
  if (/\b(doctor(al|ate)?|phd|dphil|dnp)\b/.test(t) || /\b(master'?s?|msc|mph|mn|ma|postgraduate)\b/.test(t)) return "postgraduate";
  if (/\b(bachelor'?s?|bsc|bn|bns|degree|undergraduate)\b/.test(t)) return "degree";
  if (/\bdiploma\b/.test(t)) return "diploma";
  if (/\b(enrolled|certificate)\b/.test(t)) return "certificate";
  return null;
}

/** What is known of a learner for matching: their programme code and qualification family (either may be unknown). */
export type LearnerFit = { programmeCode: string | null; level: QualificationLevel | null };

/**
 * Pure. Whether an item may be offered to this learner: excluded ONLY by a known mismatch -- the item names a programme
 * and the learner's known programme is another, or the item's qualification family and the learner's known one differ.
 */
export function fitsLearner(meta: LibraryMeta | null | undefined, learner: LearnerFit | null | undefined): boolean {
  if (!meta || !learner) return true;
  if (meta.programmeCode && learner.programmeCode && meta.programmeCode !== learner.programmeCode) return false;
  const family = qualificationOf(meta.qualificationLevel, meta.qualificationLabel);
  if (family && learner.level && family !== learner.level) return false;
  return true;
}

/** Pure. A short line for HQ lists: "Diploma · Advanced · nursing-ug-diploma", or null when the item records none. */
export function metaSummary(meta: LibraryMeta | null | undefined): string | null {
  if (!meta) return null;
  const parts = [meta.qualificationLabel ?? (meta.qualificationLevel ? (QUALIFICATION_LABEL[meta.qualificationLevel as QualificationLevel] ?? meta.qualificationLevel) : null),
    meta.difficulty ? DIFFICULTY_LABEL[meta.difficulty] : null, meta.programmeCode ?? null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// ── COMPETENCY MAPPING PROVENANCE (owner decision 3) ──

export type MappingView = { status: "draft" | "validated" | "none"; framework: string | null; version: string | null; competency: string | null; objective: string | null };

/**
 * Pure. How a version's competency_mapping is shown. "validated" only when the version is published AND the mapping
 * names a framework version that was published (framework_pub_status_at_mapping or framework_pub_status = published).
 * Everything else, including a mapping that SAYS it is validated, is a draft: never shown as validated evidence.
 */
export function mappingStatus(content: unknown, versionState: string): MappingView {
  const m = isObj(content) && isObj(content.competency_mapping) ? content.competency_mapping : null;
  if (!m) return { status: "none", framework: null, version: null, competency: null, objective: null };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fwPublished = m.framework_pub_status === "published" || m.framework_pub_status_at_mapping === "published";
  return {
    status: versionState === "published" && fwPublished ? "validated" : "draft",
    framework: str(m.framework_code) ?? str(m.framework_name), version: str(m.framework_version),
    competency: [str(m.competency_code), str(m.competency_name)].filter(Boolean).join(" ") || null, objective: str(m.learning_objective),
  };
}
