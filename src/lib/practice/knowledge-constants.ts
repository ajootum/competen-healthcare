// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-KS-001 PHASE 1 -- PRACTICE GUIDANCE. The constants half.
//
// CPR-KS-001's Engine 4 is the "Guideline & SOP Engine": eight document types, ten named template
// sections. This file is that vocabulary, plus the three things the spec does NOT say and this build
// must: what a guidance document IS NOT, which of the ten sections are authored and which are read off
// the record, and which of section 8's library facets nothing here can answer.
//
// ---- ⚠ THE NAME, BECAUSE THERE IS A COLLISION AND IT IS NOT A DETAIL --------------------------------
//
// This module is called PRACTICE GUIDANCE, not Knowledge Studio.
//
//   1. `/super-admin/ckp/studio` and `loadKnowledgeStudio()` in src/lib/super-admin/ckp-studio.ts are
//      ALREADY called Knowledge Studio. Two things with one name in one product is a support call that
//      begins "no, the other one".
//   2. ⚠ THE STRONGER REASON IS SAFETY. "Studio" and "designer" name a TOOL. CPR-KS-001's own Engine 2
//      would have been a "clinical algorithm designer", and the danger there was created by the NAME,
//      before anybody drew anything: a practitioner who builds an escalation tree in a clinical
//      algorithm designer will reasonably believe the system is now watching those thresholds. The
//      house rule that came out of it is to NAME AN ASSET FOR WHAT IT PRODUCES. What this produces is
//      guidance: written standing instructions that a person reads.
//
// The ROUTE is /practice/knowledge-studio because that is where the programme filed it and a URL is an
// address rather than a claim. Every user-facing word on it says Practice Guidance.
//
// ---- ⚠ WHAT A GUIDANCE DOCUMENT IS NOT --------------------------------------------------------------
//
// It is prose. Nothing in this product reads it, evaluates it, monitors against it or acts on it. That
// sentence is GUIDANCE_NOT_MONITORED below, it is rendered on every guidance document including the
// printed one, and it is never a green tick and never silence -- the `not_checked` idiom
// publish-constants.ts established, for the same reason: an unwarned screen reads as a cleared screen.
//
// `protocol` is one of the eight types and it is still prose. A protocol here is a document; it is not a
// flowchart, it is not a decision tree, and it fires nothing. The algorithm engine is a separate
// programme with its own safety case and it is not in this phase.
//
// ---- CAPABILITIES: NOTHING MINTED -------------------------------------------------------------------
//
// Probed live 2026-08-07 against practice_role_capabilities: 47 distinct codes, and NO `knowledge.*` and
// no `asset.*` among them. Migration 210 already documents template.manage as "the same people who write
// the note templates keep the protocols", which is exactly the author of this. Reading takes
// document.view, on migration 210's reasoning that a protocol is something everybody who reads documents
// should be able to find. Six invented capability codes have shipped in this product; an invented code
// compiles, 403s for everybody including the practice owner, and errors nowhere.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY CAPABILITY CODE THIS MODULE NAMES, AS AN EXPORTED ARRAY.
 *
 * Same reason patient-access-constants.ts and publish-constants.ts export theirs: a code reached only
 * through an object literal is invisible to the audit harness's literal scanner. Both were confirmed
 * present in the live catalogue when this was written.
 */
export const KNOWLEDGE_CAPABILITY_CODES: string[] = ["document.view", "template.manage"];

export const KNOWLEDGE_CAPABILITIES = {
  /** Find and read guidance. Migration 210's rule for the document library, unchanged. */
  view: "document.view",
  /** Write it, send it for approval, publish it, withdraw it. */
  manage: "template.manage",
} as const;

/** The module's name in every sentence a practitioner reads. See the header for why it is not "Studio". */
export const GUIDANCE_MODULE_NAME = "Practice Guidance";
export const GUIDANCE_LIBRARY_NAME = "Guidance Library";
export const GUIDANCE_ROUTE = "/practice/knowledge-studio";

/**
 * ⚠ THE SENTENCE THAT MUST APPEAR ON EVERY GUIDANCE DOCUMENT, ON SCREEN AND ON PAPER.
 *
 * Not a disclaimer at the bottom of a settings page. A practitioner who writes "escalate to the
 * consultant if the score is 5 or more" into a document held by a clinical system will otherwise
 * reasonably believe the system now knows that. It does not. It stored the sentence.
 */
export const GUIDANCE_NOT_MONITORED = {
  headline: "This is a written instruction. Nothing here checks it.",
  detail:
    "Competen Practice stores and publishes this document so people can read it. It does not evaluate what it says, does not watch for the thresholds or timings written in it, and raises no alert when something in it is not followed. Anything this document requires happens because a person does it.",
  /** The one line that fits on printed paper, where there is no room for the paragraph. */
  onPaper:
    "Read by people. This system does not monitor or enforce anything written here.",
} as const;

// ── THE EIGHT DOCUMENT TYPES (CPR-KS-001 Engine 4, "Document types") ────────────────────────────────
//
// ⚠ THE SAME EIGHT ARE A CHECK CONSTRAINT ON practice_guidance_document.doc_type. That is deliberate and
// it is the line the survey drew at section 8: a studio that lets somebody invent a ninth type produces
// rows the DATABASE rejects, and no amount of front-end work fixes it. A ninth type is a migration
// BEFORE the UI offers it, never after.

export type GuidanceTypeDefinition = {
  code: string;
  label: string;
  /** What distinguishes it from the seven beside it, in a practitioner's words. */
  meaning: string;
};

export const GUIDANCE_TYPES: GuidanceTypeDefinition[] = [
  { code: "guideline", label: "Guideline",
    meaning: "What is recommended, with room for clinical judgement. A guideline advises." },
  { code: "policy", label: "Policy",
    meaning: "What this practice has decided, as a matter of position rather than of technique." },
  { code: "protocol", label: "Protocol",
    meaning: "The steps for one clinical situation, in order. ⚠ Written down, not executed -- see the notice on every document." },
  { code: "sop", label: "Standard operating procedure",
    meaning: "How a recurring task is done here, so that it is done the same way by whoever is on." },
  { code: "work_instruction", label: "Work instruction",
    meaning: "One task, at the level of detail somebody doing it for the first time needs." },
  { code: "clinical_standard", label: "Clinical standard",
    meaning: "The level of care this practice holds itself to, against which an audit can be run." },
  { code: "practice_standard", label: "Practice standard",
    meaning: "The same, for how the practice is run rather than for what is done to a patient." },
  { code: "service_manual", label: "Service manual",
    meaning: "A service described end to end, usually assembling several of the above." },
];

export const GUIDANCE_TYPE_CODES: string[] = GUIDANCE_TYPES.map(t => t.code);
export const guidanceType = (code: string) => GUIDANCE_TYPES.find(t => t.code === code) ?? null;
export const guidanceTypeLabel = (code: string) => guidanceType(code)?.label ?? code;

// ── THE TEN SECTIONS (CPR-KS-001 Engine 4, "Template sections") ─────────────────────────────────────
//
// Purpose · Scope · Definitions · Responsibilities · Procedure · Documentation · Escalation ·
// References · Review · Approval.
//
// ⚠ THE LAST TWO ARE NOT AUTHORED, AND THAT IS THE MOST CONSEQUENTIAL DECISION IN THIS FILE.
//
// Read literally, "Review" and "Approval" are boxes an author types into. But this product HOLDS both
// facts already: review_on and effective_from are columns, and the approval is a real
// practice_approval_request with a named decider, a timestamp and a note. A free-text Approval section
// reading "Approved by Dr Okello, 3 March" on a document whose approval record says PENDING is a lie
// printed on clinical guidance, and nothing would ever catch it because nothing would be comparing them.
//
// So eight sections are written and two are RENDERED FROM THE RECORD. Where the record has nothing to
// say -- no review date, no approval -- the section says "not checked" in the idiom
// publish-constants.ts established, never a blank and never a reassuring absence.
//
// This is document-library.ts's "composed, not stored" rule applied to a page: a second copy of a fact
// three columns already hold is a copy that drifts the first time somebody edits one and not the other.

export type GuidanceSectionSource = "authored" | "derived";

export type GuidanceSectionDefinition = {
  key: string;
  heading: string;
  source: GuidanceSectionSource;
  /** Shown BESIDE the box, never written into the document. Prompt text that lands in the body becomes
   *  guidance nobody wrote -- migration 195's distinction, and it holds here for the same reason. */
  prompt: string;
  /** ⚠ Enforced by the ENGINE at publish, not by a CHECK constraint: "this row's text is non-empty" is a
   *  fact about eight sibling rows and a CHECK cannot see them. The column exists so a document carries
   *  what was required when it was written, rather than being retrospectively invalidated by a later
   *  change to this catalogue. */
  required: boolean;
  /** Authored sections only: 1..8, and the database refuses two sections in the same slot. */
  position: number | null;
};

export const GUIDANCE_SECTIONS: GuidanceSectionDefinition[] = [
  { key: "purpose", heading: "Purpose", source: "authored", position: 1, required: true,
    prompt: "Why this document exists and what it is meant to change." },
  { key: "scope", heading: "Scope", source: "authored", position: 2, required: true,
    prompt: "Who it applies to, where, and -- as usefully -- who and what it does not cover." },
  { key: "definitions", heading: "Definitions", source: "authored", position: 3, required: false,
    prompt: "Terms and abbreviations that a locum on their first morning would not share with you." },
  { key: "responsibilities", heading: "Responsibilities", source: "authored", position: 4, required: false,
    prompt: "Who does what. Roles rather than names, so the document survives somebody leaving." },
  { key: "procedure", heading: "Procedure", source: "authored", position: 5, required: true,
    prompt: "The steps themselves, in the order they are done." },
  { key: "documentation", heading: "Documentation", source: "authored", position: 6, required: false,
    prompt: "What has to be recorded, where it goes, and how long it is kept." },
  { key: "escalation", heading: "Escalation", source: "authored", position: 7, required: false,
    prompt: "When to call somebody, whom, and how quickly. ⚠ Nothing in this product watches for these conditions -- a person reads this and acts." },
  { key: "references", heading: "References", source: "authored", position: 8, required: false,
    prompt: "The guidance, legislation or evidence this rests on, with dates." },

  // ── The two the record answers ──────────────────────────────────────────────────────────────────
  { key: "review", heading: "Review", source: "derived", position: null, required: false,
    prompt: "Read from this document's effective and review dates. It is not typed, so it cannot disagree with them." },
  { key: "approval", heading: "Approval", source: "derived", position: null, required: false,
    prompt: "Read from the approval record: who decided, when, and what they said. It is not typed, so it cannot claim an approval that did not happen." },
];

export const GUIDANCE_SECTIONS_AUTHORED: GuidanceSectionDefinition[] =
  GUIDANCE_SECTIONS.filter(s => s.source === "authored");
export const GUIDANCE_SECTIONS_DERIVED: GuidanceSectionDefinition[] =
  GUIDANCE_SECTIONS.filter(s => s.source === "derived");
/** The eight keys the database's CHECK constraint admits. A ninth is a migration. */
export const GUIDANCE_SECTION_KEYS: string[] = GUIDANCE_SECTIONS_AUTHORED.map(s => s.key);
export const GUIDANCE_SECTIONS_REQUIRED: string[] =
  GUIDANCE_SECTIONS_AUTHORED.filter(s => s.required).map(s => s.key);
export const guidanceSection = (key: string) => GUIDANCE_SECTIONS.find(s => s.key === key) ?? null;

// ── THE FIVE STATES (CPR-KS-001 section 3, "Version Engine") ────────────────────────────────────────
//
// Draft · Review · Approved · Published · Archived.
//
// ⚠ `in_review`, NOT `review`. There is a `review_on` COLUMN on the same row meaning something entirely
// different -- the date this document next has to be looked at. A status called `review` sitting beside
// a date called `review_on` is a bug waiting for the afternoon somebody reads one as the other.
//
// ⚠ APPROVED AND PUBLISHED ARE GENUINELY DIFFERENT, and collapsing them was the first draft's mistake.
// Approval is a clinical judgement by a named person. Publication is a DATE from which the document is
// in force. A guideline approved in October to take effect on 1 January is approved and is not yet in
// force, and a practitioner reading it in November must be able to see which.

export type GuidanceStateDefinition = {
  code: string;
  label: string;
  /** What it means to somebody who finds this document, which is not the same as what it means to its author. */
  meaning: string;
  /** Can its text be edited in this state? */
  editable: boolean;
  /** Is it in force -- i.e. should anybody be following it today? */
  inForce: boolean;
};

export const GUIDANCE_STATES: GuidanceStateDefinition[] = [
  { code: "draft", label: "Draft", editable: true, inForce: false,
    meaning: "Being written. Nobody should be following it, and it prints marked DRAFT." },
  { code: "in_review", label: "In review", editable: false, inForce: false,
    meaning: "With a colleague for a decision. Frozen while they read it -- a document that changes under a reviewer is one they did not approve." },
  { code: "approved", label: "Approved", editable: false, inForce: false,
    meaning: "A colleague has approved it and it is not yet in force. Publishing is a separate, deliberate act with a date on it." },
  { code: "published", label: "Published", editable: false, inForce: true,
    meaning: "In force from its effective date. This is the version to follow." },
  { code: "archived", label: "Archived", editable: false, inForce: false,
    meaning: "Withdrawn or superseded. Kept and readable, because knowing what the practice used to say is often the question." },
];

export const GUIDANCE_STATE_CODES: string[] = GUIDANCE_STATES.map(s => s.code);
export const guidanceState = (code: string) => GUIDANCE_STATES.find(s => s.code === code) ?? null;
export const guidanceStateLabel = (code: string) => guidanceState(code)?.label ?? code;
export const GUIDANCE_STATES_EDITABLE: string[] = GUIDANCE_STATES.filter(s => s.editable).map(s => s.code);
export const GUIDANCE_STATES_IN_FORCE: string[] = GUIDANCE_STATES.filter(s => s.inForce).map(s => s.code);

/**
 * ⚠ THE ONLY MOVES THAT EXIST. Anything not listed here is refused by name, not by falling through.
 *
 * There is no `approved -> in_review`, no `published -> draft` and no way out of `archived`. Editing an
 * approved document does not silently re-open it either: the forward path from anything that is not a
 * draft is a NEW VERSION -- registration-config.ts's rule for published templates, for the same reason.
 * A document somebody can quietly amend after approval is a document whose approval means nothing.
 */
export const GUIDANCE_TRANSITIONS: { from: string; to: string; label: string; why: string }[] = [
  { from: "draft", to: "in_review", label: "Send for approval",
    why: "Creates a practice_approval_request and freezes the text while a colleague reads it." },
  { from: "in_review", to: "draft", label: "Withdraw from review",
    why: "The author takes it back. The approval request is withdrawn with it, so no decision is left pending on a document nobody is waiting on." },
  { from: "in_review", to: "approved", label: "Record the approval",
    why: "Follows the decision on the approval request. ⚠ This engine does not decide -- delegation.ts does, and it refuses anybody approving their own work." },
  { from: "approved", to: "published", label: "Publish",
    why: "Puts it in force from its effective date, and archives whatever it supersedes." },
  { from: "approved", to: "draft", label: "Re-open for editing",
    why: "Any further change invalidates the approval, so the approval link is cleared with it rather than being carried forward onto text nobody approved." },
  { from: "draft", to: "archived", label: "Abandon",
    why: "A draft that is not going anywhere. Kept, because a half-written protocol is evidence of what was being considered." },
  { from: "published", to: "archived", label: "Withdraw",
    why: "Takes it out of force. Nothing is deleted -- what the practice used to say is often the question being asked." },
];

export const guidanceCanMove = (from: string, to: string) =>
  GUIDANCE_TRANSITIONS.some(t => t.from === from && t.to === to);
export const guidanceMovesFrom = (from: string) => GUIDANCE_TRANSITIONS.filter(t => t.from === from);

// ── PUBLISH READINESS ───────────────────────────────────────────────────────────────────────────────
//
// The same three-state shape as publish-constants.ts, and the same reason: A CHECK NOBODY CAN PERFORM
// MUST SAY "NOT CHECKED". Never a green tick, never silence.
//
//   engine    A fact about this document's own rows that only code reading several of them can see.
//   database  ⚠ A fact enforced by a CONSTRAINT, reported here so somebody sees the gap before they try.
//             THE ENGINE DOES NOT RE-IMPLEMENT THESE -- a rule written twice is a rule that will one day
//             be written differently in the two places, and the copy that matters is the one nobody can
//             bypass.
//   build     A fact about this code. No configuration changes it.
//   absent    ⚠ NOT CHECKABLE. No column and no store can answer, so nothing here pretends to.

export type GuidanceCheckSeverity = "blocker" | "warning" | "advisory";
export type GuidanceCheckAuthority = "engine" | "database" | "build" | "absent";

export type GuidanceCheckDefinition = {
  code: string;
  requirement: string;
  severity: GuidanceCheckSeverity;
  authority: GuidanceCheckAuthority;
  detail: string;
  /** ⚠ Only for `absent`: exactly what would make this checkable, so the gap is actionable. */
  wouldNeed: string | null;
};

export const GUIDANCE_CHECKS: GuidanceCheckDefinition[] = [
  {
    code: "REQUIRED_SECTIONS",
    requirement: "Purpose, Scope and Procedure all say something",
    severity: "blocker", authority: "engine",
    detail: "A protocol with an empty Procedure is a heading somebody will find at three in the morning. Which sections are required was fixed when the document was created and is carried on its own rows, so changing the catalogue later cannot retrospectively invalidate what is already published.",
    wouldNeed: null,
  },
  {
    code: "APPROVAL_DECIDED",
    requirement: "The approval request has actually been approved",
    severity: "blocker", authority: "engine",
    detail: "The database can see that an approval is LINKED. Only this can see that somebody DECIDED it -- a request still sitting at PENDING satisfies the constraint and satisfies nobody else. The decision itself is delegation.ts's, including its refusal to let anybody approve their own work.",
    wouldNeed: null,
  },
  {
    code: "REVIEW_DATE_SET",
    requirement: "A date is set for looking at this again",
    severity: "warning", authority: "engine",
    detail: "Guidance with no review date does not expire; it just quietly stops being true. This is a warning rather than a blocker because a work instruction for a machine the practice will own for twenty years genuinely may not need one.",
    wouldNeed: null,
  },
  {
    code: "APPROVAL_LINKED",
    requirement: "An approval record is attached",
    severity: "blocker", authority: "database",
    detail: "`practice_guidance_in_force` refuses a published row with no approval_request_id. Nothing in this engine repeats that rule -- it reports it, and when somebody tries anyway the database refuses and the refusal is returned with the constraint named.",
    wouldNeed: null,
  },
  {
    code: "EFFECTIVE_FROM_SET",
    requirement: "An effective date is set",
    severity: "blocker", authority: "database",
    detail: "The same constraint. Published means in force, and in force from when is not a question a reader should have to guess at.",
    wouldNeed: null,
  },
  {
    code: "CODE_NOT_IN_USE",
    requirement: "No other published document holds this reference",
    severity: "blocker", authority: "database",
    detail: "`ux_practice_guidance_published_code` is a partial unique index over published rows only, so a practice may hold ten drafts of SOP-014 and exactly one published one. Publishing a new version therefore requires withdrawing the old one, in that order -- which is the point, because two documents in force under one reference is how a ward follows the wrong one.",
    wouldNeed: null,
  },
  {
    code: "NOT_MONITORED",
    requirement: "The document says plainly that nothing here checks it",
    severity: "advisory", authority: "build",
    detail: "⚠ ALWAYS TRUE IN THIS BUILD, and printed rather than assumed. This product stores and publishes guidance; it does not evaluate it, watch for the thresholds written in it, or raise anything when it is not followed. This row does not depend on configuration and cannot be cleared.",
    wouldNeed: null,
  },
  {
    code: "STAFF_HAVE_READ",
    requirement: "The people it applies to have read it",
    severity: "warning", authority: "absent",
    detail: "⚠ NOT CHECKED. There is no read-receipt, acknowledgement or attestation store anywhere in the practice tier, so nothing here can tell whether one person or nobody has opened this. This row is not a pass, and it is a warning rather than an advisory because for a policy it is usually the whole point.",
    wouldNeed: "An acknowledgement store (who opened which version, when) and a rule for which documents require one. Distribution is CPR-KS-001's Phase 6 and is blocked on there being any delivery channel at all.",
  },
  {
    code: "EVIDENCE_CURRENT",
    requirement: "The evidence and guidance it cites are still current",
    severity: "advisory", authority: "absent",
    detail: "⚠ NOT CHECKED. References are free text. Nothing here resolves a citation, knows when the source was last revised, or could tell a 2019 guideline from this year's. A review date is the only mechanism this build offers, and it depends on a person.",
    wouldNeed: "A structured citation store with source identifiers, plus something outside this product that knows when each source last changed.",
  },
];

export const guidanceCheck = (code: string) => GUIDANCE_CHECKS.find(c => c.code === code) ?? null;
export const GUIDANCE_CHECKS_NOT_CHECKABLE: string[] =
  GUIDANCE_CHECKS.filter(c => c.authority === "absent").map(c => c.code);
export const GUIDANCE_CHECKS_DATABASE_OWNED: string[] =
  GUIDANCE_CHECKS.filter(c => c.authority === "database").map(c => c.code);
export const GUIDANCE_CHECKS_BLOCKING: string[] =
  GUIDANCE_CHECKS.filter(c => c.severity === "blocker").map(c => c.code);

/** The constraints that own the `database` rows, named so a refusal can be recognised rather than guessed at. */
export const GUIDANCE_CONSTRAINTS = {
  inForce: "practice_guidance_in_force",
  publishedCode: "ux_practice_guidance_published_code",
  reviewAfterEffect: "practice_guidance_review_after_effect",
  archivedReason: "practice_guidance_archived_reason",
} as const;

/**
 * Tinted marks for the checklist. Copied from publish-constants.ts rather than re-chosen, so that
 * "not checked" looks the same in both places.
 *
 * ⚠ SLATE AND A HOLLOW MARK for not_checked. Never green, never a tick.
 */
export const GUIDANCE_CHECK_SWATCH: Record<string, { badge: string; text: string; box: string; icon: string }> = {
  pass: { badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", box: "border-emerald-200/80 bg-emerald-50/60", icon: "✓" },
  fail: { badge: "bg-rose-100 text-rose-700", text: "text-rose-700", box: "border-rose-200/80 bg-rose-50/60", icon: "✕" },
  not_checked: { badge: "bg-slate-200 text-slate-700", text: "text-slate-600", box: "border-dashed border-slate-300 bg-slate-50/70", icon: "◌" },
};

/** State chips for the library. Amber for waiting, sky for decided-not-yet-live, emerald for in force. */
export const GUIDANCE_STATE_SWATCH: Record<string, { chip: string; dot: string }> = {
  draft: { chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  in_review: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  approved: { chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  published: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  archived: { chip: "bg-gray-100 text-gray-500", dot: "bg-gray-400" },
};

// ── THE LIBRARY'S FACETS (CPR-KS-001 section 8, "Asset Library") ────────────────────────────────────
//
// Section 8 asks to search by Specialty · Disease · Age · Tags · Author · Version · Status · Type.
//
// ⚠ TWO OF THOSE EIGHT HAVE NOTHING BEHIND THEM AND ARE NOT OFFERED. A filter control that returns
// whatever it likes is worse than a missing one, because somebody narrows a search with it and believes
// the result. They are declared here instead, and the library renders them as "not offered" with the
// reason -- a control that cannot run must say so.

export type GuidanceFacetDefinition = {
  key: string;
  label: string;
  /** `live` is offered and works. `absent` is declared and not offered. */
  state: "live" | "absent";
  detail: string;
  wouldNeed: string | null;
};

export const GUIDANCE_FACETS: GuidanceFacetDefinition[] = [
  { key: "type", label: "Type", state: "live", wouldNeed: null,
    detail: "The eight document types, from the column's own CHECK constraint." },
  { key: "status", label: "Status", state: "live", wouldNeed: null,
    detail: "The five states, from the column's own CHECK constraint." },
  { key: "specialty", label: "Specialty", state: "live", wouldNeed: null,
    detail: "Free text on the document, the same column practice_note_template uses." },
  { key: "tags", label: "Tags", state: "live", wouldNeed: null,
    detail: "Free tags on the document. This is also where a condition or a disease goes today." },
  { key: "author", label: "Author", state: "live", wouldNeed: null,
    detail: "Who created it, resolved to a name." },
  { key: "version", label: "Version", state: "live", wouldNeed: null,
    detail: "Every version is a row of its own, linked by supersedes_id, so an earlier version is a document you can open rather than a diff to reconstruct." },
  { key: "disease", label: "Disease", state: "absent",
    detail: "⚠ NOT OFFERED. Nothing joins guidance to a coded condition. A disease is a tag here, which is a word somebody typed -- searching it finds documents that happen to use the same spelling and misses the ones that do not. Offering it as a facet would imply a vocabulary that does not exist.",
    wouldNeed: "A coded condition vocabulary linked to guidance rows, and a decision about which coding system." },
  { key: "age", label: "Age", state: "absent",
    detail: "⚠ NOT OFFERED. There is no age band on a guidance document and no age-band vocabulary anywhere in this schema. A paediatric protocol is paediatric because its Scope section says so, in words, and nothing here reads that.",
    wouldNeed: "An age-applicability column with an agreed set of bands, and a rule for what an unset one means." },
];

export const GUIDANCE_FACETS_LIVE: string[] = GUIDANCE_FACETS.filter(f => f.state === "live").map(f => f.key);
export const GUIDANCE_FACETS_ABSENT: string[] = GUIDANCE_FACETS.filter(f => f.state === "absent").map(f => f.key);

/**
 * ⚠ WHAT THE FIVE PERMISSION ROLES OF SECTION 3 ACTUALLY ARE HERE, SAID PLAINLY.
 *
 * CPR-KS-001 section 3 names Owner · Reviewer · Approver · Editor · Viewer. This build has TWO
 * capabilities and one assignable approver, and pretending otherwise on screen would be a permission
 * model somebody relies on.
 *
 *   Owner    -- the `owner_id` column. A person accountable for the document. It is a NAME ON A ROW and
 *               it grants nothing; it does not restrict who may edit.
 *   Reviewer/Approver -- one person, the assignee on the practice_approval_request. One assignee and one
 *               decision is what migration 208 supports. A multi-step chain of approvers is a migration
 *               and it is not in this phase.
 *   Editor   -- anybody holding template.manage.
 *   Viewer   -- anybody holding document.view.
 */
export const GUIDANCE_ROLE_REALITY: { role: string; provided: boolean; how: string }[] = [
  { role: "Owner", provided: true, how: "A named person on the document. Accountability, not permission -- it grants and restricts nothing." },
  { role: "Reviewer", provided: true, how: "The assignee on the approval request. The same person as the Approver: migration 208 supports one assignee and one decision." },
  { role: "Approver", provided: true, how: "As above. ⚠ A multi-step chain of different approvers is NOT built and would need a migration." },
  { role: "Editor", provided: true, how: "Anybody with template.manage. It is not per-document." },
  { role: "Viewer", provided: true, how: "Anybody with document.view. Guidance is not restricted to a subset of the practice." },
];
