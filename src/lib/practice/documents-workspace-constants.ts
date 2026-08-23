// CPR-DOC-002 DOCUMENTS WORKSPACE -- the vocabularies, in a module with NO SERVER IMPORTS.
//
// ⚠ THAT IS THE WHOLE REASON THIS FILE IS SEPARATE FROM documents-workspace.ts. The register table and
// the classify panel are client components; documents-workspace.ts imports the audit writer, which
// imports the Supabase server client. A function that crosses that boundary compiles, lints, and passes
// every harness -- and then the page white-screens in a production build. It killed the Follow-ups board
// this week. Everything a client component needs is HERE, and nothing here imports anything but types.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// PHASES 1 TO 4 (s20). Phase 1: overview dashboard, patient documents, my documents, uploads with
// source attribution and patient linkage, cross-practice search and filters, the status model, basic
// audit. Phase 2: the structured editor, PDF render, signature, issue and the Shared & Issued register.
// Phase 3: review queues, document tasks, saved views, bulk operations, AI-assisted drafting and the
// permission picture. Phase 4: what of "integrations" can honestly be built, which is the export half
// and nothing else -- see PHASE 4 below.
//
// WHAT IS DELIBERATELY ABSENT, AND WHY IT IS ABSENT RATHER THAN GREYED OUT. s18 forbids "not built"
// messages in production UI; this codebase forbids controls that do nothing. Both rules are satisfied by
// the same move: the control IS NOT DRAWN. A disabled button with an apology under it is the thing s18 is
// actually complaining about, and a live button that does nothing is worse.
//
// AND ONE PHASE 2 SURFACE IS STILL NOT DRAWN, for the same reason: DELIVERY STATUS. s3 asks Shared &
// Issued for "issued, printed, downloaded, emailed or link-shared documents with delivery status", s4
// wants a failed-shares queue and s18 wants a Failed chip. Nothing in this product SENDS anything --
// recordRelease() records that a copy left, which is a different fact -- so there is no column, anywhere,
// that could produce a delivery outcome. A Failed chip over a table with no failure state would be
// decoration, and a "Delivered" one would be a claim nobody checked. The Shared & Issued tab states in
// one line what a release is and is not; see SHARE_DELIVERY_NOTE below.
//
// The comp draws four quick actions (Create document, Upload document, Generate with AI, Scan document)
// and five metric cards, one of which is "Expiring soon". "Generate with AI" is Phase 3 and IS now
// drawn -- on a draft document, where there is a consultation to ground it in, and nowhere else. "Scan
// document" is Phase 4 and is NOT drawn: scanning needs a device channel this product does not have.
// "Expiring soon -- within 30 days" needs a retention or expiry model, and there is no such column on
// any table in this schema, so there is no figure to put in the card and the card is not drawn.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// PHASE 4 (s20 "Integrations: patient upload channels, secure links, external services and extended
// import/export"), AND WHY ALMOST NONE OF IT IS HERE.
//
//   PATIENT UPLOAD CHANNELS.  There is no way for a patient to authenticate to this product, and no
//                             storage path a patient could write to. A channel with no identity behind
//                             it does not attribute an upload to a patient -- it attributes it to
//                             whoever had the link. `uploaded_by_patient` is STILL absent from
//                             DOC_ORIGIN for exactly that reason, unchanged from Phase 1.
//   SECURE LINKS.             A secure link is a URL plus expiry plus revocation plus A WAY TO SEND IT
//                             plus somebody at the other end whose identity was checked. This
//                             deployment has no delivery channel configured at all, and no patient
//                             authentication. Minting a token nobody can receive, for a recipient
//                             nobody can verify, would produce a control that appears to share a
//                             clinical document and does not.
//   EXTERNAL SERVICES.        No laboratory, radiology or HIE integration exists to connect to.
//
//   EXTENDED IMPORT/EXPORT.   THIS IS THE ONE HALF THAT IS REAL, and it is built: a metadata export of
//                             exactly the rows the caller can already read, over the same filter the
//                             register applies, gated on the seeded data.export capability and logged
//                             as a disclosure. Import already exists as the incoming register and the
//                             attachment upload, both built long before this specification.
//
// None of the three absent surfaces is drawn as a disabled control or explained in the interface. They
// are simply not there, which is what s18 and this codebase's rule against dead controls both ask for.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

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
 * TWO OF s18's CHIPS ARE STILL NOT DRAWN AFTER PHASE 2. "Failed" is a DELIVERY failure, and Phase 2 built
 * issuing rather than delivery -- recording that a copy left the practice is not sending it, so no row
 * anywhere can be in a failed state and a Failed chip could only ever be decoration. "Archived" has no
 * state on either object: a clinical document is never archived (migration 210's header: it is marked
 * entered in error and kept forever) and an incoming document has no archive column.
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
 *   Shared & Issued    BUILT here      s20 Phase 2, over migration 195's release register.
 *   Library            ALREADY EXISTS  /practice/documents/library -- CPR-320 built it.
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
    key: "shared", href: "/practice/documents/shared", label: "Shared & Issued",
    blurb: "Copies recorded as having left this practice, and who is holding one.", capability: "document.view",
  },
  // ⚠ A SEVENTH AREA, WHICH s3 DOES NOT NAME, AND THE REASON IT IS A TAB RATHER THAN A CARD ON THE
  // OVERVIEW. s3's six areas are places documents LIVE. This one is a place WORK lives: s10's saved
  // views, s14's "document assigned for review" and "draft awaiting signature", and s15's DocumentTask.
  // Phase 1 already put three attention queues on the Overview, and they are previews -- eight rows and
  // a link. The moment a queue can be ASSIGNED to somebody it stops being a preview, because "what is
  // mine" and "what is the practice's" are two lists and neither fits under a card.
  {
    key: "review", href: "/practice/documents/review", label: "Review & tasks",
    blurb: "What needs looking at, what is assigned to you, and the saved views for both.",
    capability: "document.view",
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

/**
 * The card's href WITH the period the reader has chosen carried into it.
 *
 * ⚠ EVERY CARD DIVERGED FROM ITS OWN LIST UNDER A PERIOD, NOT JUST ONE. `documentsOverview` calls
 * `documentRegister` with `{from, to}`, so every count on the dashboard is already period-bounded --
 * while `DOC_CARD_VIEW` is a static string carrying no period at all. Narrow to last March, and a card
 * reading 3 opened a list of 47. The same held for all three attention queues, whose rows are the same
 * filtered arrays.
 *
 * ⚠ THE COMMENT ABOVE DOC_CARD_VIEW ALREADY RECORDS THIS EXACT BUG BEING FOUND AND FIXED ONCE -- "card
 * said 5, list showed 8, and both were correct answers to two different questions". It was fixed for
 * `origin` and the period control later reintroduced it on a different axis. Which is the argument for
 * this being a FUNCTION: a static map cannot express a href that depends on state, so the next axis
 * added to this dashboard has somewhere to go other than a second literal.
 *
 * ⚠ AND created_this_month DROPS ITS WINDOW WHEN BOUNDED, because the COUNT does. documentsOverview
 * removes the `this_month` sub-filter under a period -- intersecting the reader's March with "this
 * month" would read nought -- so an href that kept it would open the one list guaranteed to be empty.
 */
export function docCardHref(
  key: DocCardKey, period: { from?: string; to?: string } = {},
): string {
  const base = DOC_CARD_VIEW[key];
  if (!period.from && !period.to) return base;

  const [path, query] = base.split("?");
  const params = new URLSearchParams(query ?? "");
  // Mirrors documentsOverview's `bounded ? {origin} : {origin, window}`.
  if (key === "created_this_month") params.delete("window");
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  return `${path}?${params.toString()}`;
}

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
  // CPR-DOC-AUTO-001 s5. Migration 354 added this to the doc_type CHECK -- keep the two in step, or a
  // generated instruction sheet filters as nothing and lists with a blank type.
  ["patient_instructions", "Patient instructions"],
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
  // PHASE 3. Three acts that were not previously possible, so no event could describe them.
  "practice.document_review_assigned": { verb: "asked somebody to review", origin: "created_in_cp" },
  "practice.incoming_bulk_classified": { verb: "classified in bulk", origin: "received_externally" },
  // ⚠ THE ONE THAT MATTERS MOST IN TWO YEARS. A document whose trail carries BOTH this event and
  // practice.document_attested was signed by a person over text a machine first wrote, and the pair is
  // the only place that stays answerable after the body has been edited past recognition.
  "practice.document_ai_drafted": { verb: "had a machine draft written into", origin: "created_in_cp" },
  "practice.documents_exported": { verb: "exported metadata covering", origin: "created_in_cp" },
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

/* ══ PHASE 2 (s20) ═══════════════════════════════════════════════════════════════════════════════════
 *
 * Everything below is Phase 2's vocabulary, and it is HERE rather than in the engine for the reason this
 * file exists at all: the editor, the sign panel and the issue form are client components, and the engine
 * imports the audit writer, which imports the Supabase server client.
 */

/* ── s7.1: SIGNING A DOCUMENT IS NOT SIGNING AN ENCOUNTER ────────────────────────────────────────────
 *
 * s7.1, verbatim: "Signing a document means issuing or attesting to that document. It must remain
 * distinct from signing an encounter. A consultation may be complete while its referral letter is still
 * a draft, and a document may be reissued without reopening the encounter."
 *
 * ⚠ THE TWO ACTS ARE ALREADY SEPARATE IN THE DATABASE, AND THAT SEPARATION IS NOT THIS FILE'S DOING.
 * Migration 195's header sets it out: "An encounter signature says 'this is what I recorded'. A document
 * signature says 'this is what I issued, to someone, who now holds a copy I cannot retrieve'." They are
 * different tables (practice_encounter vs practice_clinical_document), different columns, different
 * capability codes (encounter.sign vs document.sign, both seeded, both probed live), and different
 * consequences -- a signed encounter can be reopened to ACTIVE, a signed document can only be amended
 * into a successor version.
 *
 * ⚠ WHAT WAS MISSING, AND IS WHAT PHASE 2 ADDS: THE SECOND ATTESTATION. Two distinct acts need two
 * distinct statements, and there was only ever one button. Signing a document put signed_at and signed_by
 * on a row and recorded a bare `{ documentId }` in the audit trail -- which is a record that somebody
 * pressed something, not a record of what they said. The statement below is what a document signature
 * MEANS, it is shown in full before the act, its version is echoed back by the caller so a client showing
 * older wording cannot sign under newer wording, and it is written to the trail with the SHA-256 of the
 * exact text that was signed.
 *
 * ⚠ WHY REUSING THE ENCOUNTER PATH WOULD NOT HAVE BEEN SAFE. transitionEncounter() writes signed_at on
 * the CONSULTATION and emits encounter.signed, which the follow-up and activity projections consume. A
 * referral letter signed through it would close a consultation that is still open, and would tell every
 * downstream reader that the clinical record was attested when only a letter was. The document path below
 * calls transitionDocument() -- a different engine over a different table -- and touches no encounter.
 */
export const DOC_ATTESTATION = {
  /**
   * ⚠ BUMP THIS WHEN THE STATEMENT CHANGES. A signature made today attested to today's wording; a
   * signature recorded against version "doc-1" means the sentence below and not whatever replaces it.
   * The version is stored with each signature so that stays answerable.
   */
  version: "doc-1",
  statement:
    "I have read this document in full. Its content is accurate to the best of my knowledge, and I am "
    + "issuing it under my own name. Once signed it cannot be edited -- a correction becomes a new, linked "
    + "version, because any copy already released stays out in the world.",
  /** Drawn beside the statement so nobody reads the document signature as the consultation's. */
  distinction:
    "This signs the DOCUMENT, not the consultation behind it. A consultation may be complete while its "
    + "letter is still a draft, and a letter may be reissued without reopening the consultation.",
} as const;

/**
 * s8 / s12: A FIELD THE RECORD COULD NOT FILL IS VISIBLE, AND IT BLOCKS SIGNING.
 *
 * document-generation.ts renders an unresolved merge field as `[[patient.date_of_birth not recorded]]`
 * rather than as blank, because "Dear ," is something a practitioner skims past and signs. That rule ends
 * one step short: nothing stopped the marker being signed. s12's last bullet -- "block issuing when
 * required fields remain unresolved" -- is the missing half, and this is the scanner behind it.
 *
 * TWO KINDS, because they are two different mistakes:
 *   generated  `[[...]]`  the merge ran and this field had no value. A data gap.
 *   unmerged   `{{...}}`  a template field that was never merged at all -- typed by hand, or pasted from
 *                         a template body. It would print literally as `{{patient.name}}`.
 *
 * PURE, AND SHARED. The editor counts them live as you type and the engine refuses the signature; one
 * function, so the button cannot say ready while the engine says no.
 */
export type DocMarker = { marker: string; kind: "generated" | "unmerged" };

export function unresolvedMarkers(body: string): DocMarker[] {
  const found: DocMarker[] = [];
  for (const m of String(body ?? "").matchAll(/\[\[[^\]\n]{1,120}\]\]/g))
    found.push({ marker: m[0], kind: "generated" });
  for (const m of String(body ?? "").matchAll(/\{\{[^}\n]{1,120}\}\}/g))
    found.push({ marker: m[0], kind: "unmerged" });
  return found;
}

/**
 * ⚠ ONE FUNCTION, CALLED BY THE SIGN PANEL AND BY THE ENGINE.
 *
 * The panel draws these as the reasons the sign control is not there; signDocument() refuses on the same
 * list. TWO COPIES OF THIS RULE WOULD BE A BUTTON THAT SAYS READY OVER AN ENGINE THAT SAYS NO -- the same
 * drift the card/href arrangement in Phase 1 exists to prevent, in a place where the consequence is not a
 * wrong number but a letter that went out with a hole in it.
 *
 * ⚠ IT LIVES IN THIS FILE, NOT IN THE ENGINE, AND THAT IS LOAD-BEARING. documents-workspace-issue.ts
 * imports node:crypto and the audit writer; a client component importing anything from it compiles,
 * lints, passes every harness and then white-screens in a production build. The engine imports this.
 *
 * The patient link is NOT checked here: "this row's patient_id resolves to a live patient in this
 * workspace" is a database fact, not something a payload can carry, so signDocument() checks it there.
 */
export type SignBlocker = { code: string; message: string };

export function signBlockers(doc: { status: string; body: string; markers: DocMarker[] }): SignBlocker[] {
  const blockers: SignBlocker[] = [];
  if (doc.status !== "FINAL")
    blockers.push({
      code: "NOT_READY",
      message: doc.status === "DRAFT"
        ? "Mark it ready first. Finishing the writing and putting your name on it are two decisions."
        : `A document at ${doc.status} cannot be signed.`,
    });
  if (!String(doc.body ?? "").trim())
    blockers.push({ code: "EMPTY_DOCUMENT", message: "There is no content to sign." });
  if (doc.markers.length > 0)
    blockers.push({
      code: "UNRESOLVED_FIELDS",
      message: `${doc.markers.length} field${doc.markers.length === 1 ? "" : "s"} the record could not fill `
        + `${doc.markers.length === 1 ? "is" : "are"} still in the text: `
        + `${doc.markers.slice(0, 4).map(m => m.marker).join(", ")}`
        + `${doc.markers.length > 4 ? ", and more" : ""}. Replace or remove them before signing.`,
    });
  return blockers;
}

/**
 * s6.4 / s3: WHAT RECORDING A RELEASE IS, AND WHAT IT IS NOT.
 *
 * ⚠ THE HONEST SENTENCE THAT LETS THE TAB EXIST AT ALL. s3 asks Shared & Issued for delivery status and
 * s6.4 for "share event recorded with sender, recipient, channel, timestamp and delivery RESULT". Five of
 * those six are real rows in practice_clinical_document_release. The sixth needs something that sends,
 * and nothing in this product does. Printing this line is not a "not built" message about a feature; it
 * is a description of what the control in front of the reader actually does, which is the difference s18
 * is drawing.
 */
export const SHARE_DELIVERY_NOTE =
  "Issuing records that a copy left this practice -- who was given it, how, and when. Nothing is sent "
  + "from here, so there is no delivery receipt to show and none is implied.";

/**
 * s6.4: "CP resolves recipient details and warns if missing or unverified."
 *
 * ⚠ ONE CHANNEL BLOCKS AND THE REST WARN, and the split is not arbitrary. For a printed copy handed
 * across a desk, the recipient is usually the patient standing there and an empty box loses little. For
 * an EMAILED copy the address IS the entire record of where the document went -- there is no sent-items
 * folder in this product to reconstruct it from -- so an emailed release with no recipient is a copy that
 * left to nobody knows where. That one is refused; the others produce a warning on the way through.
 */
export const RECIPIENT_REQUIRED_CHANNELS = ["emailed"] as const;

/**
 * ⚠ THESE THREE SWATCHES BELONG IN palette.ts AND ARE HERE ONLY BECAUSE THAT FILE IS HELD BY ANOTHER
 * AGENT THIS SESSION -- the same note the Phase 1 card swatches above carry, and the same note CPR-PI-001
 * and CPR-V5-007 each left. Every hue is one palette.ts already uses for the same meaning:
 *
 *   issued    emerald -- this product's "done, and correctly done" hue.
 *   awaiting  amber   -- "waiting, not yet late". Nobody holds a copy; that may be right.
 *   outdated  rose    -- the only FAILURE on the row, and it goes GREY WHEN THE COUNT IS ZERO. A red
 *                        card reading 0 trains a reader to ignore red; this one only turns red when
 *                        somebody outside the practice really is holding text we have replaced.
 */
export const SHARE_COUNT_SWATCH: Record<"issued" | "awaiting" | "outdated", { box: string; figure: string }> = {
  issued: { box: "border-emerald-200/80 bg-emerald-50/70", figure: "text-emerald-700" },
  awaiting: { box: "border-amber-200/80 bg-amber-50/70", figure: "text-amber-700" },
  outdated: { box: "border-rose-300 bg-rose-50", figure: "text-rose-700" },
};

/** The zero state of the one card that must not cry wolf. */
export const SHARE_COUNT_SWATCH_QUIET = { box: "border-gray-200 bg-white", figure: "text-gray-400" };

export const SHARE_COUNT_LABEL = {
  issued: {
    label: "Copies issued", caption: "Recorded as having left the practice",
    blurb: "Every release recorded against a signed document. One row per copy, not per document.",
  },
  awaiting: {
    label: "Signed, nothing issued", caption: "Nobody is recorded as holding one",
    blurb: "Signed documents with no release recorded. Either nobody has been given a copy, or somebody was and it was never written down.",
  },
  outdated: {
    label: "Held copies now superseded", caption: "The holder's version was amended",
    blurb: "A copy was issued, and that version has since been amended. Whoever holds it is holding text this practice has replaced.",
  },
} as const;

/* ── s4.1's THREE ACTIONS ────────────────────────────────────────────────────────────────────────────
 *
 * "Display three primary actions: Create a document, Upload a patient document, and Open templates."
 *
 * ⚠ EVERY ONE OF THESE IS A ROUTE THAT EXISTS AND DOES THE THING WHEN YOU GET THERE. s4.1 names
 * "Create a document" as an action, and it points at s6.3's "generate from encounter" rather than at a
 * blank editor -- not because the editor is missing (Phase 2 built it) but because a clinical document
 * with no patient and no source record is not a thing this product can make: practice_clinical_document
 * .patient_id is NOT NULL (migration 195 s4), which is s17's first rule enforced by the schema. Every
 * document starts from a patient or a consultation, so the action starts there too.
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

/* ══ PHASE 3 (s20) ═══════════════════════════════════════════════════════════════════════════════════
 *
 * "Review queues, document tasks, AI-assisted drafting, saved views, advanced permissions."
 *
 * Everything below is Phase 3's vocabulary, and it is HERE rather than in an engine for the reason this
 * file exists at all: the review console, the bulk panel and the AI panel are client components.
 */

/* ── s10's SAVED VIEWS ───────────────────────────────────────────────────────────────────────────────
 *
 * s10, verbatim: "Saved views such as Awaiting my review, Unsigned drafts, Patient uploads today and
 * Failed shares."
 *
 * ⚠ TWO OF THOSE FOUR EXAMPLES CANNOT EXIST IN THIS PRODUCT, AND THEY ARE ABSENT RATHER THAN EMPTY.
 *
 *   Patient uploads today   needs a patient upload channel. s20 puts that in Phase 4 and Phase 4 cannot
 *                           build it: there is no patient authentication anywhere in this product, so
 *                           there is no such thing as a row a patient uploaded. A view that would always
 *                           read zero is not a saved view, it is a promise.
 *   Failed shares           needs a delivery result. Nothing here sends anything -- see
 *                           SHARE_DELIVERY_NOTE. The same reason Phase 2 refused the Failed chip.
 *
 * A view whose count would be structurally zero is worse than no view: a practitioner who sees "Patient
 * uploads today: 0" concludes no patient sent anything today, which is a claim about the world rather
 * than about this database. So the list below is the views this product can actually answer.
 *
 * ⚠ THESE ARE NAMED STANDARD VIEWS, NOT VIEWS A USER SAVED. There is no store for a user-authored saved
 * view in this schema -- see the note at the head of documents-workspace-review.ts for what one would
 * have to be. Every view here is a filter this file declares, and its COUNT is produced by running that
 * exact filter through applyFilter() over the exact rows the register fetched. Card and list therefore
 * cannot drift, which is the Phase 1 discipline applied one layer up.
 *
 * `sources` NAMES WHICH REGISTER READS THE COUNT DEPENDS ON. When one of them failed, the view's count
 * is `unreadable` and says which, rather than becoming a zero. "Nothing is awaiting review" and "we
 * could not look" are different sentences.
 */
export type DocSavedView = {
  key: string;
  label: string;
  blurb: string;
  /** The filter, applied by the same function the register applies. Null for views not over the register. */
  filter: DocFilter | null;
  /** The list this figure opens. Always exactly these rows. */
  href: string;
  /** Which register sources the count depends on, so a failed read makes it unreadable and not zero. */
  sources: string[];
  /** Mirrors DOC_CARD_SWATCH's hues: sky for arrivals, amber for waiting, rose for the failure state. */
  tone: "sky" | "amber" | "rose" | "violet";
};

export const DOC_SAVED_VIEWS: DocSavedView[] = [
  {
    key: "assigned_to_me",
    label: "Assigned to me",
    blurb: "Open tasks about a document, with your name on them. The only queue in this workspace anybody actually owns.",
    // NOT OVER THE REGISTER. Its rows are practice_task, so the engine counts them separately and its
    // source is named accordingly.
    filter: null,
    href: "/practice/documents/review",
    sources: ["document tasks"],
    tone: "violet",
  },
  {
    key: "awaiting_review",
    label: "Arrived, nobody has looked",
    blurb: "Incoming documents still at RECEIVED. Nobody is assigned -- this is the practice's pile, not any one person's.",
    filter: { status: ["awaiting_review"] },
    href: "/practice/documents/patient?status=awaiting_review",
    sources: ["incoming register"],
    tone: "sky",
  },
  {
    key: "unsigned_drafts",
    label: "Unsigned drafts",
    blurb: "Written and not signed, so not issued to anybody. s10 names this view by name.",
    filter: { status: ["draft", "approved"] },
    href: "/practice/documents/patient?status=draft,approved",
    sources: ["authored documents"],
    tone: "amber",
  },
  {
    key: "signed_not_issued",
    label: "Signed, nothing issued",
    blurb: "Signed with no release recorded. Either nobody has been given a copy, or somebody was and it was never written down.",
    filter: { status: ["signed"] },
    href: "/practice/documents/shared",
    // ⚠ THE RELEASE REGISTER IS A SOURCE OF THIS FIGURE. `signed` MEANS "SIGNED WITH ZERO RELEASES", so
    // a failed release read would silently promote every issued document in the practice into this view.
    sources: ["authored documents", "release register"],
    tone: "amber",
  },
  {
    key: "unlinked",
    label: "No patient link",
    blurb: "Arrived without a patient. Until one is chosen it is invisible in the record of the person it is about.",
    filter: { link: "unlinked" },
    href: "/practice/documents/patient?link=unlinked",
    sources: ["incoming register"],
    tone: "rose",
  },
];

/**
 * ⚠ THESE SWATCHES BELONG IN palette.ts AND ARE HERE ONLY BECAUSE THAT FILE IS HELD BY ANOTHER AGENT
 * THIS SESSION -- the same note the Phase 1 and Phase 2 swatches above each carry. Every hue is one
 * palette.ts already uses for the same meaning, and the tinting GOES GREY AT ZERO for the reason the
 * Phase 2 outdated-copies card does: a coloured badge reading 0 trains a reader to ignore the colour.
 */
export const DOC_VIEW_TONE: Record<DocSavedView["tone"], { box: string; figure: string; label: string }> = {
  sky: { box: "border-sky-200/80 bg-sky-50/70", figure: "text-sky-700", label: "text-sky-900" },
  amber: { box: "border-amber-200/80 bg-amber-50/70", figure: "text-amber-700", label: "text-amber-900" },
  rose: { box: "border-rose-300 bg-rose-50", figure: "text-rose-700", label: "text-rose-900" },
  violet: { box: "border-violet-200/80 bg-violet-50/70", figure: "text-violet-700", label: "text-violet-900" },
};

export const DOC_VIEW_TONE_QUIET = { box: "border-gray-200 bg-white", figure: "text-gray-400", label: "text-gray-700" };

/** A view whose figure could not be read. Keeps its place, loses its colour, prints an em dash. */
export const DOC_VIEW_TONE_UNREADABLE = {
  box: "border-dashed border-slate-300 bg-white", figure: "text-slate-300", label: "text-slate-500",
};

/* ── s15's DocumentTask, AND WHAT IT ALREADY IS ──────────────────────────────────────────────────────
 *
 * s15 names a DocumentTask entity with document_id, task_type, assignee_id, due_at and status.
 *
 * ⚠ IT EXISTS. Migration 198 built practice_task with a `document_id` column referencing
 * practice_clinical_document, an assignee that must be an ACTIVE member, due_on, remind_on, a five-value
 * status machine and an immutable practice_task_event trail. Every field s15 asks for is there and four
 * more besides. NO MIGRATION IS WRITTEN FOR PHASE 3 and none is needed for tasks about a document this
 * practice AUTHORED.
 *
 * ⚠ WHAT IS NOT THERE, STATED PLAINLY BECAUSE IT IS THE ONE REAL HOLE IN PHASE 3: practice_task HAS NO
 * incoming_document_id. A task can point at an authored clinical document, a patient, an encounter, a
 * follow-up or a reflection -- and NOT at an arriving document. Which means the queue that most needs an
 * owner, "this lab result arrived and nobody has looked at it", is the one queue that cannot be assigned
 * to anybody. It is not faked here. The arrivals queue is rendered as the practice's, it says so in
 * those words, and no assign control is drawn over it. See documents-workspace-review.ts for the exact
 * column that would close it.
 */
export const DOC_REVIEW_CATEGORY = "clinical_admin";

/**
 * ⚠ ASSIGNING A REVIEW DOES NOT MOVE THE DOCUMENT'S STATUS, AND THAT IS A DECISION RATHER THAN AN
 * OMISSION.
 *
 * s7 lists "In review" as a status between Draft and Approved. Migration 195 stores five values --
 * DRAFT, FINAL, SIGNED, AMENDED, ENTERED_IN_ERROR -- and IN_REVIEW is not one of them. Two ways to
 * honour s7 were available:
 *
 *   WRITE A MIGRATION adding IN_REVIEW to the CHECK and to the transition table. Not this agent's to
 *   write, and it would change the meaning of the status column on every document already stored.
 *
 *   BORROW AN EXISTING VALUE, most temptingly FINAL. That would be the wrong answer even if it were
 *   allowed: FINAL means "the content is accepted", it is the ONLY status signBlockers() will sign from,
 *   and marking a document FINAL because somebody was asked to look at it would make "ready to sign" and
 *   "not yet checked" the same word.
 *
 * So a review is a TASK -- a real row, in a real store, with a real assignee and a real trail -- and the
 * document's own status column does not move at all. The sentence below is rendered beside the assign
 * control so nobody expects a chip to change.
 */
export const DOC_REVIEW_STATUS_NOTE =
  "Asking somebody to review this creates a task assigned to them. The document's own status does not "
  + "change: it stays a draft until whoever is writing it marks it ready, and marking it ready is what "
  + "makes it signable.";

/* ── s10's BULK OPERATIONS ───────────────────────────────────────────────────────────────────────────
 *
 * s10: "Bulk operations limited to safe actions such as classify, archive, assign reviewer and export
 * metadata."
 *
 * TWO OF THE FOUR ARE BUILT IN BULK AND TWO ARE NOT, and neither absence is drawn:
 *
 *   classify         BUILT. Over practice_incoming_document, through the same classifyIncoming() the
 *                    single-row panel uses, one row at a time so a failure is per row and never a
 *                    silent partial.
 *   export metadata  BUILT. See DOC_EXPORT_COLUMNS.
 *   archive          NOT BUILT, and there is nothing to build it over. A clinical document is never
 *                    archived -- migration 210's header is explicit that it is marked entered in error
 *                    and kept forever -- and practice_incoming_document has no archive column at all. A
 *                    bulk Archive button would have to write a state that does not exist.
 *   assign reviewer  BUILT FOR AUTHORED DOCUMENTS, ONE AT A TIME, for the reason in the DocumentTask
 *                    note above: an arrival cannot be the subject of a task. Offered in bulk over a
 *                    mixed selection it would silently skip every arrival in it, which is the worst
 *                    possible behaviour for a control whose whole promise is "these are now somebody's".
 *
 * ⚠ THE CAP IS A SAFETY RULE, NOT A PERFORMANCE ONE. A bulk classify sets the patient on every row it
 * touches. Fifty is a plausible morning's post; nine hundred is somebody who selected everything, and
 * filing nine hundred results against one patient is the most damaging single action this workspace can
 * perform. The engine REFUSES above the cap rather than truncating, because a truncated bulk that
 * reports success is indistinguishable from one that worked.
 */
export const DOC_BULK_LIMIT = 50;

/* ── s5.3's METADATA, AS THE EXPORT'S COLUMNS ────────────────────────────────────────────────────────
 *
 * ⚠ METADATA ONLY, AND THE OMISSIONS ARE THE POINT. There is no `body` column here and there is no
 * `summary` column either. The body of a referral letter is clinical content; so is the one-line summary
 * of an arriving result, which in practice reads "Hb 6.2, for review". An export is a file that leaves
 * the machine it was made on. Every column below is a fact ABOUT a document rather than the content of
 * one, and the patient's name is here because s5.3 lists the patient link as required metadata and an
 * export of document metadata with no way to tell whose document it is answers nothing.
 *
 * The order follows s5.3's own list.
 */
export const DOC_EXPORT_COLUMNS: [string, string][] = [
  ["title", "Document title"],
  ["docType", "Document type"],
  ["origin", "Source label"],
  ["source", "Source or organisation"],
  ["status", "Status"],
  ["stored", "Stored status value"],
  ["date", "Document date"],
  ["patientLinked", "Linked to a patient"],
  ["patientName", "Patient"],
  ["version", "Version"],
  ["reference", "Reference"],
];

/**
 * ⚠ ONE CSV WRITER, AND IT QUOTES EVERY FIELD.
 *
 * A conditional quote ("only if it contains a comma") is the shape that has to be right in four places,
 * and a patient recorded as "O'Brien, Ann" or a source recorded as "Mulago Hospital, Kampala" is the
 * ordinary case rather than the edge one. Quoting unconditionally costs two bytes a field and removes
 * the decision.
 *
 * ⚠ AND IT PREFIXES A LEADING =, +, - OR @ WITH AN APOSTROPHE. A spreadsheet opens a cell beginning with
 * one of those as a FORMULA. A document titled "-2 week review" becomes an arithmetic error in the mild
 * case, and a title somebody chose becomes an executed expression in the malicious one. The apostrophe
 * is the documented, lossless way to say "this is text".
 */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * A filter back into a querystring.
 *
 * ⚠ THE EXPORT LINK IS BUILT FROM THE FILTER THAT WAS APPLIED, NOT FROM THE URL THAT WAS TYPED. The page
 * ran parseDocFilter(searchParams) and the register applied THAT; serialising the raw querystring
 * instead would carry through anything parseDocFilter dropped -- `?status=banana`, a stray `page=2`, a
 * hand-edited `authorId` -- and the file would then be produced under a filter the screen never used.
 * Round-tripping through this function and back through parseDocFilter is the only arrangement in which
 * the export and the list it came from cannot be answering different questions.
 *
 * ⚠ authorId IS NOT SERIALISED, DELIBERATELY. parseDocFilter does not read it and the export route will
 * not either; My Documents scopes to the caller from the server-resolved context, and the export link
 * says so with `mine=1` rather than by putting somebody's user id in a URL.
 */
export function docFilterToQuery(filter: DocFilter): string {
  const q = new URLSearchParams();
  if (filter.q) q.set("q", filter.q);
  if (filter.type) q.set("type", filter.type);
  if (filter.status?.length) q.set("status", filter.status.join(","));
  if (filter.origin?.length) q.set("origin", filter.origin.join(","));
  if (filter.from) q.set("from", filter.from);
  if (filter.to) q.set("to", filter.to);
  if (filter.patientId) q.set("patientId", filter.patientId);
  if (filter.link) q.set("link", filter.link);
  if (filter.window) q.set("window", filter.window);
  return q.toString();
}

/** The export URL for exactly the list a page is showing. `mine` is a flag, never a user id. */
export function documentExportHref(filter: DocFilter, mine = false): string {
  const q = docFilterToQuery(filter);
  const parts = [q, mine ? "mine=1" : ""].filter(Boolean);
  return `/api/v1/practice/documents/export${parts.length ? `?${parts.join("&")}` : ""}`;
}

/* ── s12: AI-ASSISTED DOCUMENT CREATION ──────────────────────────────────────────────────────────────
 *
 * ⚠ WHAT PHASE 3 ADDS IS NOT AN ASSISTANT. CPR-210 built one, and it already does four of s12's six
 * capabilities -- draft a referral from a consultation, summarise a history, rewrite the plan in plain
 * language, tidy a note -- behind a consent gate, a disclosure, a grounding refusal with no ungrounded
 * mode, an access-log entry recording that record content left this system, and a system prompt that
 * forbids originating a clinical fact. Rebuilding any of that would be building a second, weaker one.
 *
 * s12's FIFTH capability, "identify missing required template fields", IS ALREADY BUILT AND IS NOT AI:
 * unresolvedMarkers() and signBlockers() above compute it from the text, deterministically, and the
 * engine refuses the signature on it. Asking a model to find missing fields would be a slower, less
 * reliable version of a regular expression, and it would sometimes be wrong about a field that is there.
 *
 * ⚠ WHAT WAS GENUINELY MISSING IS s12's LAST RULE: "Label AI-generated content until the practitioner
 * reviews it." The assistant's answer landed in practice_ai_message and the practitioner copied it into
 * a document by hand -- and the moment it was pasted, NOTHING ANYWHERE recorded that the words were
 * machine-written. A letter drafted by a model and one written by a clinician were the same bytes in the
 * same column with the same history. Phase 3 closes exactly that: the assistant's text can be written
 * into a DRAFT document through one engine that records the act, and the document then carries a visible
 * attribution derived from the trail. See documents-workspace-ai.ts.
 *
 * ⚠ AND THE BOUNDARY, WHICH IS THE WHOLE OF THE SAFETY POSITION: A MACHINE MAY AUTHOR. IT MAY NOT SIGN.
 * The drafting engine requires document.author and refuses anything but a DRAFT. It cannot reach FINAL,
 * it cannot reach SIGNED, and it cannot issue. The person who signs states DOC_ATTESTATION's sentence --
 * "I have read this document in full" -- with the attribution banner in front of them.
 */
export type AiDraftState = "none" | "machine_unedited" | "machine_edited";

export const AI_DRAFT_LABEL: Record<AiDraftState, { label: string; blurb: string; chip: string } | null> = {
  // Nothing to say. A document nobody asked a machine to draft carries no banner at all -- the absence
  // of a claim is the correct rendering of the absence of an event.
  none: null,
  machine_unedited: {
    label: "Machine-written draft",
    blurb: "Every word below was produced by the assistant from the consultation, and has not been changed since. "
      + "Read it against the record before you mark it ready. Nothing here has yet been checked by a person.",
    chip: "bg-amber-100 text-amber-800 ring-1 ring-amber-300",
  },
  machine_edited: {
    label: "Started as a machine-written draft",
    blurb: "The assistant wrote a draft here and somebody has edited it since. How much of the machine's wording "
      + "remains is not tracked -- the signature is what says a person stands behind the whole of it.",
    chip: "bg-slate-100 text-slate-700 ring-1 ring-slate-300",
  },
};

/**
 * The tasks the drafting bridge will run, and they are a SUBSET of CPR-210's six.
 *
 * ⚠ THE KEYS ARE NOT NEW. Migration 215 puts a CHECK on practice_ai_session.task listing exactly six
 * values, so a seventh key here would compile, typecheck and fail at INSERT the first time somebody used
 * it -- the invented-code class this codebase has shipped six times. Every key below is one of the six.
 *
 * `summarise_history` and `ask` are absent deliberately. A history summary is grounded on a PATIENT
 * rather than a consultation and would produce a document with no encounter behind it; `ask` is a
 * question, and its answer is a reply to a person rather than the text of a letter.
 */
export const AI_DRAFT_TASKS: { key: string; label: string; blurb: string; produces: string }[] = [
  {
    key: "draft_referral", label: "Draft a referral letter",
    blurb: "A first draft from this consultation, with a clearly marked blank wherever the record does not give it something a letter needs.",
    produces: "A letter for you to correct and sign.",
  },
  {
    key: "summarise_encounter", label: "Summarise this consultation",
    blurb: "Turns the notes already written into a short summary. It adds nothing that is not in them.",
    produces: "A consultation summary.",
  },
  {
    key: "patient_instructions", label: "Put the plan in plain language",
    blurb: "Rewrites the recorded plan so the patient can read it. It adds no advice of its own.",
    produces: "An instruction sheet for the patient.",
  },
  {
    key: "tidy_note", label: "Expand my shorthand",
    blurb: "Turns the shorthand already in the record into sentences. It changes no clinical meaning.",
    produces: "The same content, in full sentences.",
  },
];

export const AI_DRAFT_MODES: { key: string; label: string; blurb: string }[] = [
  { key: "replace", label: "Replace what is there", blurb: "The draft becomes the whole body. Anything currently written is lost." },
  { key: "append", label: "Add below what is there", blurb: "The draft goes under the existing text, which is left alone." },
];

/* ── s13: WHO MAY DO WHAT ────────────────────────────────────────────────────────────────────────────
 *
 * s13 names five roles: practice owner, practitioner, practice assistant, reviewer and read-only user.
 *
 * ⚠ THE CAPABILITY CODES BELOW WERE PROBED AGAINST THE LIVE SEED, NOT WRITTEN FROM THE SPECIFICATION.
 * Six invented capability codes have shipped in this codebase; every one below is present in
 * practice_role_capabilities today. What the matrix RENDERS is not this list either -- it is the
 * capabilities the members of this practice actually hold right now, read live, because a seeded role
 * default and a live grant are different facts and CPR-310's delegation can move the second without
 * touching the first.
 *
 * ⚠ s13's "Reviewer" IS NOT A ROLE IN THIS PRODUCT and no row is invented for it. The seeded roles are
 * practitioner, practice_assistant, practice_owner, billing_reporting and read_only_auditor. Seeding a
 * sixth is a migration. What Phase 3 gives instead is the thing a reviewer role would be FOR: a document
 * task assigned to a named person, which any member holding task.manage can create.
 */
export const DOC_PERMISSION_ROWS: { capability: string; label: string; blurb: string }[] = [
  { capability: "document.view", label: "See documents", blurb: "Open this workspace and read what is in it." },
  { capability: "document.author", label: "Write and issue", blurb: "Create, edit, and record that a copy was given to somebody." },
  { capability: "document.sign", label: "Sign", blurb: "Attest to a document under their own name. The one capability delegation refuses to grant." },
  { capability: "inbox.record", label: "File what arrives", blurb: "Record an arrival, link it to a patient and classify it." },
  { capability: "inbox.review", label: "Stamp an arrival reviewed", blurb: "Say that somebody clinically looked at a result." },
  { capability: "task.manage", label: "Assign a review", blurb: "Create a task about a document and put somebody's name on it." },
  { capability: "template.manage", label: "Manage templates", blurb: "Create and retire the structures documents start from." },
  { capability: "data.export", label: "Export metadata", blurb: "Take a file of document metadata off this system." },
];
