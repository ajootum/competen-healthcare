// ── SCHOLAR-CE-2026 CE-05: THE QUESTION-FORMAT REGISTRY ── one source of truth for every question format ────────────────
//
// Before this file the format knowledge was spread over six lists (config.ts REVISION_FORMATS / VERIFY_FORMATS / ADAPTIVE_FORMATS
// and their label maps, library-format.ts LIBRARY_FORMATS / FORMAT_MARKING / COPY_KIND, blind-verify.ts BLIND_FORMATS), the
// `answer.format` tests in revision.ts / store.ts / library-format.ts, and a copy in the HQ library form. Each of them is now
// derived from the rows below, in the order it always had, so nothing about what is offered, stored or marked changes.
//
// A row says, for one format: its key and the words a learner sees, how it is marked (code, code then AI, AI, or the learner's
// own judgement), whether AI is involved in marking or writing it, how it is stored (a stored kind, or a `short` item told
// apart by answer.format), where it is offered, what a miss does (remediation), and the modules that write, mark and show it.
//
// DEFAULTS. Whether a format is on in the revision policy by default is `revisionDefault`; config.ts derives
// REVISION_FORMATS_OFF_BY_DEFAULT from it and policy.ts reads that for the fallback of scholar_revision_formats, so there is no
// second place to change. The blind-check default set is `verifyDefault`, likewise read by policy.ts. The tests tie both to the
// policy's own fallback so a row can never say one thing while the policy does another.
// A format may not be added to or dropped from any of the lists without a row here (question-formats.test.ts scans the source).
//
// Pure and dependency-free (a client bundle may import it): no I/O, no clock, no model, no other module of the app.

export type MarkingMode = "code" | "code_then_ai" | "ai" | "self";

/** The module references of a format: what writes it, marks it and shows it (paths from src/, checked to exist by the test). */
export type FormatModules = { writer: string; marker: string; renderer: string };

type Row = {
  /** The format key. `case` is the multiple-choice case set (kind case); `scenario` is CE-05's evolving multi-stage item. */
  key: string;
  /** What the learner sees on the format picker and the question card. */
  label: string;
  /** The same format in the blind-check picker, where that reads differently. */
  verifyLabel?: string;
  description: string;
  marking: MarkingMode;
  /** Marking may call the formative evaluator (metered, labelled). */
  aiMarking: boolean;
  /** An AI call writes the item (cloze is written by a rule). */
  aiWritten: boolean;
  /** The stored kind (migrations 416/710). A format that is stored as `short` is told apart by answer.format. */
  stored: "mcq" | "case" | "mrq" | "short" | "flashcard" | "match" | "sequence" | "structured";
  /** The learner is shown the stored options (a choice, a set of choices, pairs or steps). */
  usesOptions: boolean;
  /** answer.format of a `short` item stored as this format, or null. */
  answerFormat: string | null;
  /** Offered by Revision at all (policy scholar_revision_formats), and its default there. null: not a Revision format. */
  revisionDefault: "on" | "off" | null;
  /** Position in the blind-check list (policy scholar_verify_formats) and whether it is in that list's default. null: not a verify format. */
  verifyRank: number | null;
  verifyDefault: boolean;
  /** An adaptive exam may use it (formative exams: not flashcards). */
  adaptive: boolean;
  /** Position in the second-reader (blind) list, or null: this format has no blind check. */
  blindRank: number | null;
  /** The governed Competen library may hold it: its position in that list, the library's own label, the marking rules it may carry, and the kind a copy is stored as. */
  library: { rank: number; label: string; marking: readonly ("deterministic" | "self" | "rubric_ai_formative")[]; copyKind: "mcq" | "mrq" | "short" | "flashcard" | "match" | "sequence" | "structured" } | null;
  /** Only with feedback after each answer (the format is answered in steps or in parts). */
  immediateFeedbackOnly: boolean;
  /** What a miss does. Every format but a flashcard: a review card is made or reset and the competency/source links are offered. A flashcard's grade IS its review. */
  remediation: "card_on_miss" | "recall_grade";
  modules: FormatModules;
};

const S = "lib/individual/scholar";

const ROWS = [
  { key: "mcq", label: "Multiple choice", description: "One best answer from four options.", marking: "code", aiMarking: false, aiWritten: true, stored: "mcq", usesOptions: true, answerFormat: null,
    revisionDefault: "on", verifyRank: 0, verifyDefault: true, adaptive: true, blindRank: null,
    library: { rank: 0, label: "Single best answer", marking: ["deterministic"], copyKind: "mcq" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/revision.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "mrq", label: "Multiple response", description: "Choose every option the notes support; partial credit for each right choice.", marking: "code", aiMarking: false, aiWritten: true, stored: "mrq", usesOptions: true, answerFormat: null,
    revisionDefault: "on", verifyRank: 2, verifyDefault: true, adaptive: true, blindRank: null,
    library: { rank: 1, label: "Multiple response", marking: ["deterministic"], copyKind: "mrq" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/revision.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "short", label: "Short answer", description: "A few words, matched to the notes by code, then judged by AI or by you.", marking: "code_then_ai", aiMarking: true, aiWritten: true, stored: "short", usesOptions: false, answerFormat: null,
    revisionDefault: "on", verifyRank: 3, verifyDefault: true, adaptive: true, blindRank: null,
    library: { rank: 2, label: "Short answer", marking: ["deterministic", "self"], copyKind: "short" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/revision.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "flashcard", label: "Flashcards", description: "Recall the back of a card, then grade your own recall.", marking: "self", aiMarking: false, aiWritten: true, stored: "flashcard", usesOptions: false, answerFormat: null,
    revisionDefault: "on", verifyRank: 7, verifyDefault: false, adaptive: false, blindRank: 3,
    library: { rank: 6, label: "Flashcard", marking: ["self"], copyKind: "flashcard" }, immediateFeedbackOnly: false, remediation: "recall_grade",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/flashcards.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "match", label: "Matching", description: "Match each prompt to its pair; fractional marks.", marking: "code", aiMarking: false, aiWritten: true, stored: "match", usesOptions: true, answerFormat: null,
    revisionDefault: "on", verifyRank: 5, verifyDefault: false, adaptive: true, blindRank: 1,
    library: { rank: 7, label: "Matching", marking: ["deterministic"], copyKind: "match" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/revision.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "sequence", label: "Sequencing", description: "Put the steps in order; fractional marks.", marking: "code", aiMarking: false, aiWritten: true, stored: "sequence", usesOptions: true, answerFormat: null,
    revisionDefault: "on", verifyRank: 6, verifyDefault: false, adaptive: true, blindRank: 2,
    library: { rank: 8, label: "Sequence", marking: ["deterministic"], copyKind: "sequence" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/revision.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "structured", label: "Structured (multi-part)", verifyLabel: "Structured (multi-part)", description: "A lead-in and two to four parts, each with its own marks.", marking: "code_then_ai", aiMarking: true, aiWritten: true,
    stored: "structured", usesOptions: false, answerFormat: null, revisionDefault: "on", verifyRank: 4, verifyDefault: false, adaptive: true, blindRank: 4,
    library: { rank: 9, label: "Structured (parts)", marking: ["deterministic", "self"], copyKind: "structured" }, immediateFeedbackOnly: true, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/revision.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "cloze", label: "Fill in the blank (cloze)", description: "One blank in a sentence from the notes, written by a rule (no AI).", marking: "code", aiMarking: false, aiWritten: false, stored: "short", usesOptions: false, answerFormat: "cloze",
    revisionDefault: "on", verifyRank: null, verifyDefault: false, adaptive: false, blindRank: null,
    library: { rank: 3, label: "Fill the blank", marking: ["deterministic"], copyKind: "short" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/cloze-service.ts`, marker: `${S}/cloze.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "true_false", label: "True or false", description: "A statement the notes settle; two buttons; marked by code.", marking: "code", aiMarking: false, aiWritten: true, stored: "short", usesOptions: false, answerFormat: "true_false",
    revisionDefault: "on", verifyRank: 8, verifyDefault: false, adaptive: false, blindRank: 0,
    library: { rank: 4, label: "True or false", marking: ["deterministic"], copyKind: "short" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/formats.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  { key: "extended", label: "Extended response (AI feedback)", verifyLabel: "Extended response", description: "A paragraph answer, marked by AI against the key points in the notes.", marking: "ai", aiMarking: true, aiWritten: true,
    stored: "short", usesOptions: false, answerFormat: "extended", revisionDefault: "off", verifyRank: 9, verifyDefault: false, adaptive: false, blindRank: 5,
    library: { rank: 5, label: "Extended response", marking: ["rubric_ai_formative", "self"], copyKind: "short" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/formats.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  // SCHOLAR-CE-2026 CE-05: a stem that unfolds over two to four stages, each stage one question of an existing kind. Stored as `short`
  // (answer.format = 'scenario'): no migration. On by default exactly as structured is (its comparable format); the blind check is not
  // run on it, so it is in no verify list.
  { key: "scenario", label: "Evolving scenario (stage by stage)", description: "A situation that unfolds over two to four stages; each stage reveals more and asks one question.", marking: "code_then_ai", aiMarking: true, aiWritten: true,
    stored: "short", usesOptions: false, answerFormat: "scenario", revisionDefault: "off", verifyRank: null, verifyDefault: false, adaptive: false, blindRank: null,
    library: null, immediateFeedbackOnly: true, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/scenario.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  // SQIE-CLOSE-2026-11 WS-A: a calculation -- a dose, rate or value worked out from figures the notes give, answered as a number and a unit.
  // Stored as `short` (answer.format = 'calculation', its key and authored tolerance in scoring-rules.ts): no migration. Marked by CODE only
  // (numeric parsing, unit normalisation and conversion, tolerance). Off by default (a clinical tolerance policy is an owner decision). The
  // generated key is ALWAYS blind-solved by a second reader (generation.ts), whatever scholar_verify_formats says, so it is in no verify list.
  // SQIE-CLOSE-2026-11 WS-E (migration 997): the governed library holds it too -- marked by code only, copied as `short`.
  { key: "calculation", label: "Calculation (units and tolerance)", description: "Work out a dose, rate or value from the figures in your notes; a number and its unit, marked by code.", marking: "code", aiMarking: false, aiWritten: true,
    stored: "short", usesOptions: false, answerFormat: "calculation", revisionDefault: "off", verifyRank: null, verifyDefault: false, adaptive: false, blindRank: 6,
    library: { rank: 10, label: "Calculation", marking: ["deterministic"], copyKind: "short" }, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/scoring-rules.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx" } },
  // The multiple-choice case set: a Revision/Case question, never a Revision format of its own, but a stored kind the blind check covers.
  { key: "case", label: "Case questions", description: "Multiple-choice questions on a practice case.", marking: "code", aiMarking: false, aiWritten: true, stored: "case", usesOptions: true, answerFormat: null,
    revisionDefault: null, verifyRank: 1, verifyDefault: true, adaptive: false, blindRank: null, library: null, immediateFeedbackOnly: false, remediation: "card_on_miss",
    modules: { writer: `${S}/generation.ts`, marker: `${S}/revision.ts`, renderer: "app/individual/(app)/[experience]/(scholar)/study/_components/case-client.tsx" } },
] as const satisfies readonly Row[];

type Rows = typeof ROWS;
export type FormatRow = Rows[number];
export type QuestionFormat = FormatRow["key"];

/** Every format, in the order Revision has always listed them (the case set last). */
export const QUESTION_FORMATS: readonly FormatRow[] = ROWS;
export const FORMAT_ROW: { readonly [K in QuestionFormat]: Extract<FormatRow, { key: K }> } = Object.fromEntries(ROWS.map(r => [r.key, r])) as never;

const rank = (a: number | null, b: number | null) => (a ?? 0) - (b ?? 0);

// ── REVISION (policy scholar_revision_formats) ──
type RevisionRow = Extract<FormatRow, { revisionDefault: "on" | "off" }>;
export type RevisionFormat = RevisionRow["key"];
export const REVISION_FORMATS = ROWS.filter(r => r.revisionDefault !== null).map(r => r.key) as unknown as readonly RevisionFormat[];
export const REVISION_FORMAT_LABEL = Object.fromEntries(ROWS.filter(r => r.revisionDefault !== null).map(r => [r.key, r.label])) as Record<RevisionFormat, string>;
/** Formats whose default is OFF in the policy fallback. */
export const REVISION_FORMATS_OFF_BY_DEFAULT = ROWS.filter(r => r.revisionDefault === "off").map(r => r.key) as unknown as readonly RevisionFormat[];
/** Whether a format is on in the revision policy fallback (what policy.ts reads). */
export const onByDefault = (f: RevisionFormat): boolean => FORMAT_ROW[f].revisionDefault === "on";

// ── BLIND CHECK (policy scholar_verify_formats) ──
type VerifyRow = Extract<FormatRow, { verifyRank: number }>;
export type VerifyFormat = VerifyRow["key"];
const verifyRows = ROWS.filter(r => r.verifyRank !== null).sort((a, b) => rank(a.verifyRank, b.verifyRank));
export const VERIFY_FORMATS = verifyRows.map(r => r.key) as unknown as readonly VerifyFormat[];
export const VERIFY_FORMAT_LABEL = Object.fromEntries(verifyRows.map(r => [r.key, ("verifyLabel" in r ? r.verifyLabel : undefined) ?? r.label])) as Record<VerifyFormat, string>;
/** The checks that ran before the setting existed: the policy fallback. */
export const VERIFY_FORMATS_DEFAULT = verifyRows.filter(r => r.verifyDefault).map(r => r.key) as unknown as readonly VerifyFormat[];

// ── ADAPTIVE EXAMS (policy scholar_adaptive_formats) ──
type AdaptiveRow = Extract<FormatRow, { adaptive: true }>;
export type AdaptiveFormat = AdaptiveRow["key"];
export const ADAPTIVE_FORMATS = ROWS.filter(r => r.adaptive).map(r => r.key) as unknown as readonly AdaptiveFormat[];

// ── THE SECOND READER (blind-verify.ts) ──
type BlindRow = Extract<FormatRow, { blindRank: number }>;
export type BlindFormat = BlindRow["key"];
export const BLIND_FORMATS = ROWS.filter(r => r.blindRank !== null).sort((a, b) => rank(a.blindRank, b.blindRank)).map(r => r.key) as unknown as readonly BlindFormat[];

// ── THE GOVERNED LIBRARY (library-format.ts) ──
type LibraryRow = Extract<FormatRow, { library: object }>;
export type LibraryFormat = LibraryRow["key"];
const libraryRows = ROWS.filter(r => r.library !== null).sort((a, b) => (a.library?.rank ?? 0) - (b.library?.rank ?? 0));
export const LIBRARY_FORMATS = libraryRows.map(r => r.key) as unknown as readonly LibraryFormat[];
export const LIBRARY_FORMAT_LABEL = Object.fromEntries(libraryRows.map(r => [r.key, r.library!.label])) as Record<LibraryFormat, string>;
export const LIBRARY_FORMAT_MARKING = Object.fromEntries(libraryRows.map(r => [r.key, r.library!.marking])) as unknown as Record<LibraryFormat, readonly ("deterministic" | "self" | "rubric_ai_formative")[]>;
export const LIBRARY_COPY_KIND = Object.fromEntries(libraryRows.map(r => [r.key, r.library!.copyKind])) as unknown as Record<LibraryFormat, "mcq" | "mrq" | "short" | "flashcard" | "match" | "sequence" | "structured">;

// ── STORAGE: the formats that are a `short` item told apart by answer.format ──
type ShortRow = Extract<FormatRow, { answerFormat: string }>;
export type ShortFormat = ShortRow["key"];
export const SHORT_STORED_FORMATS = ROWS.filter(r => r.answerFormat !== null).map(r => r.key) as unknown as readonly ShortFormat[];
/** The stored kind of a format (what the database CHECKs of migrations 416/710 know). */
export const storedKindOfFormat = (f: string): string => (f in FORMAT_ROW ? FORMAT_ROW[f as QuestionFormat].stored : f);
/** answer.format values that make a stored `short` item one of the other formats (the library-offer reader's list). */
export const ANSWER_FORMATS_OF_SHORT: readonly string[] = ROWS.filter(r => r.answerFormat !== null).map(r => r.answerFormat as string);
/** Whether a format is answered only with feedback after each answer. */
export const needsImmediateFeedback = (f: string): boolean => f in FORMAT_ROW && FORMAT_ROW[f as QuestionFormat].immediateFeedbackOnly;

/** The picker rows of the HQ library form (a client component imports this: the registry has no server code). */
export const LIBRARY_FORM_OPTIONS = libraryRows.map(r => ({ value: r.key as string, label: r.library!.label, marking: [...r.library!.marking] as string[] }));

/** The kinds whose items carry options the learner is shown (learnerItem). */
export const OPTION_KINDS: readonly string[] = ROWS.filter(r => r.usesOptions).map(r => r.stored);
/** The kinds migration 417's revision-set CHECK knows (structured is kept in an adaptive blueprint only). */
export const SET_CHECK_KINDS: readonly string[] = [...new Set(ROWS.map(r => r.stored as string))].filter(k => k !== "structured");

/** Revise engine quality (owner, 5 Nov 2026, 2.6): the formats that suit each revision intention, most suitable first. Empty: everything offered. What is offered stays the policy's decision (revision-depth.ts intentFormats). */
export const INTENT_FORMATS = {
  quick_recall: ["flashcard", "true_false", "cloze", "mcq"],
  deep_understanding: ["short", "extended", "structured", "match", "mrq"],
  clinical_reasoning: ["scenario", "mcq", "structured", "short"],
  mixed_challenge: [],
} as const satisfies Record<string, readonly QuestionFormat[]>;
