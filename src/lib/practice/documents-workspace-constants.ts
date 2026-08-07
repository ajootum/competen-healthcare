// CPR-DOC-002 DOCUMENTS WORKSPACE -- the vocabularies, in a module with NO SERVER IMPORTS.
//
// ⚠ THAT IS THE WHOLE REASON THIS FILE IS SEPARATE FROM documents-workspace.ts. The register table and
// the classify panel are client components; documents-workspace.ts imports the audit writer, which
// imports the Supabase server client. A function that crosses that boundary compiles, lints, and passes
// every harness -- and then the page white-screens in a production build. It killed the Follow-ups board
// this week. Everything a client component needs is HERE, and nothing here imports anything but types.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// PHASE 1 ONLY (s20). Overview dashboard, patient documents, my documents, uploads with source
// attribution and patient linkage, cross-practice search and filters, the status model, basic audit.
//
// WHAT IS DELIBERATELY ABSENT, AND WHY IT IS ABSENT RATHER THAN GREYED OUT. s18 forbids "not built"
// messages in production UI; this codebase forbids controls that do nothing. Both rules are satisfied by
// the same move: the control IS NOT DRAWN. A disabled button with an apology under it is the thing s18 is
// actually complaining about, and a live button that does nothing is worse. So:
//
//   the structured editor, PDF render, signature, sharing        s20 Phase 2 -- no control drawn
//   review queues, document tasks, AI drafting, saved views      s20 Phase 3 -- no control drawn
//   patient upload channels, secure links                        s20 Phase 4 -- no control drawn
//
// The comp draws four quick actions (Create document, Upload document, Generate with AI, Scan document)
// and five metric cards, one of which is "Expiring soon". Generate with AI is Phase 3. Scan document is
// Phase 4. "Expiring soon -- within 30 days" needs a retention or expiry model, and there is no such
// column on any table in this schema, so there is no figure to put in the card and the card is not drawn.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* ── SOURCE ATTRIBUTION (s5.3, s17, s18) ─────────────────────────────────────────────────────────────
 *
 * s18: "Use clear source labels: Created in CP, Uploaded by patient, Uploaded by staff, Received
 * externally." THREE OF THE FOUR ARE REAL AND ONE IS NOT, and the difference is which table a row is in:
 *
 *   created_in_cp        practice_clinical_document   this practice composed and (may have) signed it
 *   uploaded_by_staff    practice_attachment          a member of this practice put the file here
 *   received_externally  practice_incoming_document   it arrived; `source` says from whom, in words
 *
 * ⚠ `uploaded_by_patient` IS NOT A VALUE ANY ROW CAN CARRY, because s20 puts patient upload channels in
 * Phase 4 and there is no channel through which a patient can put anything into this product. Offering
 * the label would let somebody file a staff upload as a patient upload, which is a claim about provenance
 * that the record cannot support. It is absent from this map on purpose; when Phase 4 ships it becomes a
 * fourth entry rather than a re-interpretation of an existing one.
 *
 * ⚠ ORIGIN IS STRUCTURAL, NOT A COLUMN, WHICH IS WHY s17's "patient-uploaded documents retain source
 * attribution even after classification" HOLDS BY CONSTRUCTION: classification writes patient_id and
 * doc_type on a practice_incoming_document row and cannot move the row to another table, so the origin
 * cannot change. The free-text `source` beside it is likewise never a parameter of classifyIncoming --
 * see the allowlist there.
 */
export const DOC_ORIGIN = {
  created_in_cp: {
    label: "Created in CP", short: "Created",
    chip: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]",
    blurb: "Composed in this practice from its own records.",
  },
  uploaded_by_staff: {
    label: "Uploaded by staff", short: "Uploaded",
    chip: "bg-violet-100 text-violet-700",
    blurb: "A file put here by somebody who works in this practice.",
  },
  received_externally: {
    label: "Received externally", short: "Received",
    chip: "bg-sky-100 text-sky-700",
    blurb: "It arrived from outside. The source names who sent it.",
  },
} as const;

export type DocOrigin = keyof typeof DOC_ORIGIN;

export const DOC_ORIGINS = Object.keys(DOC_ORIGIN) as DocOrigin[];

/* ── THE STATUS MODEL (s7) AND ITS CHIPS (s18) ───────────────────────────────────────────────────────
 *
 * ⚠ THESE ARE DERIVED WORDS OVER STORED COLUMN VALUES, AND BOTH ARE SHOWN. s7 names ten statuses;
 * migrations 195 and 200 store five and three respectively. Nothing here invents a state: each
 * presentation status is a function of what is actually in the row, and `stored` records the column
 * value so a reader can always get back to it.
 *
 *   DRAFT             -> draft            s7 "Draft: editable working document"
 *   FINAL             -> approved         s7 "Approved: content accepted but not yet issued". This is
 *                                         exactly what FINAL means in document-constants.ts.
 *   SIGNED, 0 releases-> signed           s7 "Signed: practitioner has applied an issuance signature"
 *   SIGNED, >=1       -> issued           s7 "Issued: delivered, printed or formally released". DERIVED
 *                                         FROM THE RELEASE REGISTER, not from a status column -- a copy
 *                                         left the practice, and that fact is a row in
 *                                         practice_clinical_document_release.
 *   AMENDED           -> superseded       s7 "Superseded: replaced by a later version"
 *   ENTERED_IN_ERROR  -> entered_in_error the true name, kept. s7 has no equivalent and inventing one
 *                                         would soften a permanent flag into an archive.
 *   RECEIVED          -> awaiting_review  s7 has both "Received" and "Awaiting review"; migration 200
 *                                         stores one value for both because in this product they are the
 *                                         same fact -- it arrived and nobody has looked. The chip says
 *                                         the actionable half, since that is what the queue is for.
 *   REVIEWED          -> reviewed
 *   ACTIONED          -> actioned         beyond s7's list; migration 200's third state, kept true.
 *   (an attachment)   -> filed            a file has no lifecycle. It is here or it is removed.
 *
 * TWO OF s18's CHIPS ARE NOT DRAWN. "Failed" is a delivery failure and delivery is Phase 2 -- there is no
 * table that can produce one, so a Failed chip could only ever be decoration. "Archived" has no state on
 * either object: a clinical document is never archived (migration 210's header: it is marked entered in
 * error and kept forever) and an incoming document has no archive column.
 */
export type DocStatus =
  | "draft" | "approved" | "signed" | "issued" | "superseded" | "entered_in_error"
  | "awaiting_review" | "reviewed" | "actioned" | "filed";

export const DOC_STATUS: Record<DocStatus, { label: string; chip: string; blurb: string }> = {
  draft: {
    label: "Draft", chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    blurb: "Editable. Nobody outside this practice has seen it.",
  },
  approved: {
    label: "Approved", chip: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
    blurb: "Written and marked ready. Not signed, so not issued.",
  },
  signed: {
    label: "Signed", chip: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
    blurb: "A practitioner has put their name on it. No copy has been recorded as released.",
  },
  issued: {
    label: "Issued", chip: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
    blurb: "Signed, and at least one copy is recorded as having left the practice.",
  },
  superseded: {
    label: "Superseded", chip: "bg-violet-100 text-violet-700 ring-1 ring-violet-200",
    blurb: "Replaced by a later version. Still part of the record -- somebody holds this copy.",
  },
  entered_in_error: {
    label: "Entered in error", chip: "bg-slate-100 text-slate-500 ring-1 ring-slate-300",
    blurb: "Permanently flagged and permanently kept.",
  },
  awaiting_review: {
    label: "Awaiting review", chip: "bg-sky-100 text-sky-700 ring-1 ring-sky-200",
    blurb: "It arrived and nobody has looked at it yet.",
  },
  reviewed: {
    label: "Reviewed", chip: "bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200",
    blurb: "A practitioner has looked. What was done about it is not yet recorded.",
  },
  actioned: {
    label: "Actioned", chip: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
    blurb: "Looked at, and what was done about it is written down.",
  },
  filed: {
    label: "Filed", chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    blurb: "A file held against a patient. A file has no lifecycle of its own.",
  },
};

export const DOC_STATUSES = Object.keys(DOC_STATUS) as DocStatus[];

/** Statuses a practitioner-authored document can be in while it is still theirs to change. */
export const WORKING_STATUSES: DocStatus[] = ["draft", "approved"];

/**
 * The presentation status of an authored document.
 *
 * PURE, AND SHARED BY THE ENGINE AND THE TABLE. `releases` is a count the engine supplies from the
 * release register; passing 0 for "we did not look" would silently turn every issued document back into
 * a merely-signed one, so the engine only ever passes a number it actually read.
 */
export function authoredStatus(stored: string, releases: number): DocStatus {
  if (stored === "DRAFT") return "draft";
  if (stored === "FINAL") return "approved";
  if (stored === "SIGNED") return releases > 0 ? "issued" : "signed";
  if (stored === "AMENDED") return "superseded";
  return "entered_in_error";
}

export function receivedStatus(stored: string): DocStatus {
  if (stored === "REVIEWED") return "reviewed";
  if (stored === "ACTIONED") return "actioned";
  return "awaiting_review";
}

/* ── THE WORKSPACE'S TABS (s3, s3.1) ─────────────────────────────────────────────────────────────────
 *
 * s3.1, verbatim: "Keep a single primary sidebar item labelled Documents. Remove Messages and Results &
 * Incoming from the permanent navigation. Sub-navigation should appear inside the workspace as tabs or
 * segmented controls."
 *
 * s3 names six areas. THREE ARE BUILT IN PHASE 1 and are tabs; two already exist as their own routes and
 * are linked rather than rebuilt; one is Phase 2 and is not drawn at all.
 *
 *   Overview           BUILT here      s20 Phase 1
 *   Patient Documents  BUILT here      s20 Phase 1
 *   My Documents       BUILT here      s20 Phase 1
 *   Templates          ALREADY EXISTS  /practice/documents/templates -- CPR-330 built it. Linked, not
 *                                      rebuilt, and gated on template.manage exactly as that page is.
 *   Library            ALREADY EXISTS  /practice/documents/library -- CPR-320 built it.
 *   Shared & Issued    NOT DRAWN       s20 Phase 2 (sharing and delivery status). A release register
 *                                      exists, but "documents leaving the practice with delivery status"
 *                                      is the Phase 2 object and half of it would be a tab that lies.
 */
export type DocTab = { key: string; href: string; label: string; blurb: string; capability: string | null };

export const DOC_TABS: DocTab[] = [
  {
    key: "overview", href: "/practice/documents", label: "Overview",
    blurb: "What needs attention, and what has happened lately.", capability: "document.view",
  },
  {
    key: "patient", href: "/practice/documents/patient", label: "Patient Documents",
    blurb: "Everything held against a patient, whatever its origin.", capability: "document.view",
  },
  {
    key: "mine", href: "/practice/documents/mine", label: "My Documents",
    blurb: "The documents you wrote, at every stage.", capability: "document.view",
  },
  {
    key: "templates", href: "/practice/documents/templates", label: "Templates",
    blurb: "Reusable structures for letters, certificates and summaries.", capability: "template.manage",
  },
  {
    key: "library", href: "/practice/documents/library", label: "Library",
    blurb: "The practice's own documents: protocols, blank forms, price lists.", capability: "document.view",
  },
];

/**
 * ⚠ THE TWO ROUTES s3.1 TAKES OUT OF THE SIDEBAR, AND THE ONLY REASON THEY ARE HERE.
 *
 * /practice/messages and /practice/inbox are BUILT PAGES that work. s3.1 removes them from the permanent
 * navigation, and the moment that happens they have no way in -- which is the defect that made
 * /practice/setup and /practice/pathways dead ends in this codebase already, twice, both found by hand.
 *
 * They are NOT tabs. s3.1 is explicit that "Communication is not a document type", and the incoming
 * register's material is surfaced inside Patient Documents rather than as a sixth area. These are LINKS,
 * rendered on every tab of the workspace, each saying what it is and why it sits beside rather than
 * inside. That is what keeps the nav change safe to make.
 */
export const DOC_ADJACENT: { href: string; label: string; blurb: string; capability: string }[] = [
  {
    href: "/practice/inbox", label: "Incoming register",
    blurb: "Record what arrived and stamp it reviewed. Its patient-linked rows appear in Patient Documents.",
    capability: "inbox.record",
  },
  {
    href: "/practice/messages", label: "Internal messages",
    blurb: "Conversations between people who work here. Not documents -- kept beside this workspace, not in it.",
    capability: "message.use",
  },
];

/* ── s4's METRIC CARDS ───────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. `view` is the exact query string the register
 * applies, so the card and the list it opens run the SAME predicate over the SAME rows. A card counting
 * one thing while its list shows another has shipped on the Patients register in this codebase; the only
 * fix that holds is the one where the two cannot differ.
 *
 * ⚠ NO RATES. s4 asks for counts and denominators and nothing else. The comp prints "24 ↑ 15% vs last
 * month" against "Created this month" -- a percentage against a baseline. `created_this_month` carries
 * the prior month's COUNT instead, and carries it only when the prior month genuinely existed for this
 * practice; a workspace three weeks old has no last month and gets no comparison at all.
 *
 * ⚠ COLOUR. Tinted card, tinted icon badge, and THE FIGURE IN THE CARD'S OWN HUE. Five grey rectangles
 * with five numbers in them have to be read one at a time; five coloured ones are found.
 *
 * ⚠ THESE SWATCHES BELONG IN palette.ts AND ARE HERE ONLY BECAUSE THAT FILE IS HELD BY ANOTHER AGENT
 * THIS SESSION. That file's own header records the same thing happening to CPR-PI-001 and CPR-V5-007,
 * each of which left a note saying the swatches belonged there. So does this one. Every hue below is one
 * palette.ts already carries for the same meaning, taken from it rather than chosen afresh:
 *
 *   total             the workspace's own indigo. A total is not an alarm; it is the denominator.
 *   created_this_month violet -- PI_PANEL.practice_activity is violet for "what this practice did".
 *   awaiting_review   sky    -- CARE_CARD_SWATCH.resultsToReview is sky, for exactly this: arrived and
 *                              unreviewed, which migration 200 s5 calls the missed-result harm.
 *   drafts            amber  -- this product's "waiting, not yet late" hue everywhere.
 *   unlinked          rose   -- the only FAILURE on the row. A document filed against nobody is not
 *                              merely untidy: it is invisible in the record of the person it is about.
 */
export type DocCardSwatch = {
  badge: string; figure: string; box: string; accent: string; icon: string; caption: string;
};

export const DOC_CARD_SWATCH: Record<string, DocCardSwatch> = {
  total: {
    badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]",
    box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.06]", accent: "bg-[var(--cp-primary)]",
    icon: "▦", caption: "text-[var(--cp-primary-deep)]/60",
  },
  created_this_month: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "✎", caption: "text-violet-800/60",
  },
  awaiting_review: {
    badge: "bg-sky-100 text-sky-700", figure: "text-sky-700",
    box: "border-sky-200/80 bg-sky-50/70", accent: "bg-sky-400",
    icon: "▼", caption: "text-sky-800/60",
  },
  drafts: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", accent: "bg-amber-400",
    icon: "◷", caption: "text-amber-800/60",
  },
  unlinked: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-300 bg-rose-50", accent: "bg-rose-500",
    icon: "⚠", caption: "text-rose-800/60",
  },
};

/**
 * A card whose figure could not be READ.
 *
 * ⚠ IT KEEPS ITS PLACE AND LOSES ITS COLOUR, and its figure is an em dash. "No documents are awaiting
 * review" and "I could not find out what is awaiting review" are different answers and only one of them
 * means you can stop looking. Removing the card instead would make the row look complete when it is not.
 */
export const DOC_CARD_UNREADABLE: DocCardSwatch = {
  badge: "bg-slate-100 text-slate-400", figure: "text-slate-300",
  box: "border-dashed border-slate-300 bg-white", accent: "bg-slate-200",
  icon: "?", caption: "text-slate-400",
};

/**
 * A card this caller is NOT PERMITTED to see the figure for -- a third state, and not the second one.
 * "You may not see this" is an answer; "this could not be read" is a failure. Drawing them the same way
 * would send somebody chasing an outage that is really a permission.
 */
export const DOC_CARD_FORBIDDEN: DocCardSwatch = {
  badge: "bg-slate-100 text-slate-400", figure: "text-slate-300",
  box: "border-slate-200 bg-slate-50/60", accent: "bg-slate-200",
  icon: "⚿", caption: "text-slate-400",
};

/** The card keys the engine emits, declared so the swatch map can be asserted against them both ways. */
export const DOC_CARD_KEYS = [
  "total", "created_this_month", "awaiting_review", "drafts", "unlinked",
] as const;
export type DocCardKey = (typeof DOC_CARD_KEYS)[number];

/**
 * What each card OPENS. The query string is applied by documentRegister() itself, so there is one
 * predicate, not two.
 */
export const DOC_CARD_VIEW: Record<DocCardKey, string> = {
  total: "/practice/documents/patient",
  // ⚠ `origin` IS PART OF THIS HREF AND WAS MISSING ON THE FIRST BUILD. The card counts what this
  // practice AUTHORED this month; the href without the origin opened everything that reached the
  // practice this month, arrivals and files included. Card said 5, list showed 8, and both were correct
  // answers to two different questions. The harness caught it on its first run, which is the whole
  // reason assertion 3a re-parses each card's own href rather than trusting that it matches.
  created_this_month: "/practice/documents/patient?window=this_month&origin=created_in_cp",
  awaiting_review: "/practice/documents/patient?status=awaiting_review",
  // ⚠ THE PATIENT TAB, NOT MY DOCUMENTS. This card counts every unsigned document in the practice; My
  // Documents applies `created_by = me` on top of whatever the URL says, so sending the card there would
  // open a list SHORTER than the figure that sent you. s4's metrics are the practice's, not the caller's.
  drafts: "/practice/documents/patient?status=draft,approved",
  unlinked: "/practice/documents/patient?link=unlinked",
};

export const DOC_CARD_LABEL: Record<DocCardKey, { label: string; caption: string; blurb: string }> = {
  total: {
    label: "Documents held", caption: "All time",
    blurb: "Everything this practice has authored, received or filed against a patient.",
  },
  created_this_month: {
    label: "Created this month", caption: "Authored here",
    blurb: "Documents this practice composed since the first of the month.",
  },
  awaiting_review: {
    label: "Awaiting review", caption: "Nobody has looked",
    blurb: "Arrived and unreviewed. This is the pile the register exists to make visible.",
  },
  drafts: {
    label: "Drafts and approved", caption: "Not yet signed",
    blurb: "Written but not signed, so not issued to anybody.",
  },
  unlinked: {
    label: "No patient link", caption: "Cannot be found from a record",
    blurb: "Arrived without a patient. Until it is linked it is invisible in that person's record.",
  },
};

/* ── s10's FILTERS ───────────────────────────────────────────────────────────────────────────────────
 *
 * s10 asks for full-text search, filters on type/status/date/source/author, and saved views. SAVED VIEWS
 * ARE PHASE 3 and are not drawn. Everything else here is a filter over rows already fetched, applied by
 * the engine, so what the card counted and what the tab shows cannot disagree.
 */
export type DocFilter = {
  q?: string;
  type?: string;
  status?: string[];
  origin?: DocOrigin[];
  from?: string;
  to?: string;
  patientId?: string;
  authorId?: string;
  link?: "linked" | "unlinked";
  window?: "this_month";
};

export const DOC_WINDOWS = ["this_month"] as const;

/**
 * A URL into a filter.
 *
 * ⚠ ONE PARSER, USED BY BOTH TABS AND BY THE API, because a card's href IS a querystring and the figure
 * on that card was computed by applyFilter(). If the page parsed `status=draft,approved` differently
 * from the way the card built it, the card would count five and the list would show none -- and it would
 * look like a data problem rather than a parsing one.
 *
 * ⚠ UNKNOWN VALUES ARE DROPPED, NOT PASSED THROUGH. `?status=banana` filtering to nothing would read as
 * "you have no documents"; dropped, it reads as "no status filter", which is the honest interpretation
 * of a value this product has never emitted.
 */
export function parseDocFilter(
  sp: Record<string, string | string[] | undefined>,
): DocFilter {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const csv = (k: string): string[] => (one(k) ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const date = (k: string): string | undefined => {
    const v = one(k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };

  const status = csv("status").filter((s): s is DocStatus => (DOC_STATUSES as string[]).includes(s));
  const origin = csv("origin").filter((s): s is DocOrigin => (DOC_ORIGINS as string[]).includes(s));
  const link = one("link");
  const window = one("window");

  return {
    q: one("q"),
    type: DOC_TYPE_LABEL[one("type") ?? ""] ? one("type") : undefined,
    status: status.length ? status : undefined,
    origin: origin.length ? origin : undefined,
    from: date("from"),
    to: date("to"),
    patientId: one("patientId"),
    link: link === "linked" || link === "unlinked" ? link : undefined,
    window: window === "this_month" ? "this_month" : undefined,
  };
}

/** Type options across all three origins, for the filter select. The union, deduplicated and labelled. */
export const DOC_TYPE_OPTIONS: [string, string][] = [
  ["consultation_summary", "Consultation summary"],
  ["referral_letter", "Referral letter"],
  ["sick_note", "Sick note"],
  ["procedure_note", "Procedure note"],
  ["discharge_summary", "Discharge summary"],
  ["general", "Other document"],
  ["lab_result", "Lab result"],
  ["imaging_report", "Imaging report"],
  ["referral_response", "Referral response"],
  ["letter", "Letter"],
  ["photograph", "Photograph"],
  ["scan", "Scan"],
  ["result", "Result file"],
  ["consent", "Consent"],
  ["referral", "Referral"],
  ["other", "Other"],
];

export const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPE_OPTIONS);

/**
 * The audit event types this workspace can explain.
 *
 * ⚠ AN EVENT NOT IN THIS MAP IS NOT RENDERED AS "something happened". The activity panel is a reading of
 * practice_audit_event, and that table holds every event this product writes -- provisioning, sessions,
 * appointments. Showing an unrecognised event with its raw type would put "practice.session_paused" in a
 * document history; dropping it silently would make the panel look complete. It is filtered on the way
 * IN, by this list, and the panel says it is showing document activity only.
 */
export const DOC_AUDIT_EVENTS: Record<string, { verb: string; origin: DocOrigin }> = {
  "practice.document_created": { verb: "created", origin: "created_in_cp" },
  "practice.document_updated": { verb: "edited", origin: "created_in_cp" },
  "practice.document_final": { verb: "marked ready", origin: "created_in_cp" },
  "practice.document_draft": { verb: "reopened", origin: "created_in_cp" },
  "practice.document_signed": { verb: "signed", origin: "created_in_cp" },
  "practice.document_entered_in_error": { verb: "marked entered in error", origin: "created_in_cp" },
  "practice.document_amended": { verb: "amended", origin: "created_in_cp" },
  "practice.document_released": { verb: "released a copy of", origin: "created_in_cp" },
  "practice.document_generated": { verb: "generated", origin: "created_in_cp" },
  "practice.document_batch_generated": { verb: "generated a batch of", origin: "created_in_cp" },
  "practice.incoming_recorded": { verb: "recorded the arrival of", origin: "received_externally" },
  "practice.incoming_reviewed": { verb: "reviewed", origin: "received_externally" },
  "practice.incoming_actioned": { verb: "recorded what was done about", origin: "received_externally" },
  "practice.incoming_classified": { verb: "classified", origin: "received_externally" },
  "practice.incoming_patient_unlinked": { verb: "removed the patient link from", origin: "received_externally" },
  "practice.attachment_added": { verb: "uploaded", origin: "uploaded_by_staff" },
  "practice.attachment_removed": { verb: "removed", origin: "uploaded_by_staff" },
};

/* ── s17's FIRST RULE, IN THE MODULE THE UI CAN IMPORT ───────────────────────────────────────────────
 *
 * "A patient-specific document cannot be issued without a patient link."
 *
 * ⚠ FOR AN AUTHORED DOCUMENT THIS IS ALREADY ENFORCED TWICE AND BY SOMEBODY ELSE:
 * practice_clinical_document.patient_id is NOT NULL (migration 195 s4) and createDocument() resolves the
 * patient against the workspace before inserting. A raw insert with a null patient is refused by the
 * database, not by an application check that a future route could skip.
 *
 * WHAT WAS NOT ENFORCED ANYWHERE is the same rule for an ARRIVAL. practice_incoming_document.patient_id
 * is nullable BY DESIGN (a result arrives before anybody has decided whose it is), so an unlinked row is
 * a document about a person that that person's record cannot see. This function names that state, the
 * unlinked card counts it, and the attention queue lists it. It is in this file, not in the engine,
 * because the register table is a client component -- see the header.
 */
export function patientLinkState(row: { patientId: string | null; origin: DocOrigin }): {
  ok: boolean; reason: string | null;
} {
  if (row.patientId) return { ok: true, reason: null };
  return {
    ok: false,
    reason: row.origin === "received_externally"
      ? "Not linked to a patient, so it cannot be found from anybody's record. Link it below."
      : "Not linked to a patient.",
  };
}

/* ── s4.1's THREE ACTIONS ────────────────────────────────────────────────────────────────────────────
 *
 * "Display three primary actions: Create a document, Upload a patient document, and Open templates."
 *
 * ⚠ EVERY ONE OF THESE IS A ROUTE THAT EXISTS AND DOES THE THING WHEN YOU GET THERE. s4.1 names
 * "Create a document" as an action, and s20 puts the document EDITOR in Phase 2 -- so the action is not a
 * button that opens an editor this build does not have. It is the place documents are actually made
 * today: s6.3's "generate from encounter", where the content composes from what the consultation holds.
 * That is a real control with a real destination, which is the only kind this workspace draws.
 *
 * ⚠ AND NO QUERY PARAMETER THAT NOTHING READS. The first build pointed the upload action at
 * `/practice/documents/patient?record=1`, implying a form that would open. Nothing parses `record`, so
 * it was a link dressed as a control. It points at the incoming register, which is where recording an
 * arrival is genuinely done, and the classify step for what it leaves behind is inside Patient Documents.
 */
export const EMPTY_STATE_ACTIONS: { href: string; label: string; blurb: string; capability: string | null }[] = [
  {
    href: "/practice/encounters", label: "Create from a consultation",
    blurb: "A document composes from what an encounter actually holds -- history, findings, impression, plan. Open the consultation and generate it from there.",
    capability: "encounter.list",
  },
  {
    href: "/practice/inbox", label: "Record a document that arrived",
    blurb: "Say what it is, who sent it and where it is held. It then appears here, ready to be linked to a patient.",
    capability: "inbox.record",
  },
  {
    href: "/practice/documents/templates", label: "Open templates",
    blurb: "The structures a letter, certificate or summary starts from.",
    capability: "template.manage",
  },
];
