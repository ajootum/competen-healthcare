import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { workspaceClock } from "@/lib/practice/practice-time";
import { INCOMING_DOC_TYPES } from "@/lib/practice/communication-constants";
import {
  DOC_AUDIT_EVENTS, DOC_CARD_KEYS, DOC_CARD_VIEW, authoredStatus, receivedStatus,
  type DocCardKey, type DocFilter, type DocOrigin, type DocStatus,
} from "@/lib/practice/documents-workspace-constants";

// CPR-DOC-002 DOCUMENTS WORKSPACE, PHASE 1 (s20). The cross-practice operational view over documents
// this practice authored, received or filed -- and the two writes that were missing from that loop.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS MODULE COMPOSES; IT DOES NOT DUPLICATE. Everything it reads already exists:
//
//   practice_clinical_document          migration 195 -- authored, versioned, signed, supersession chain
//   practice_clinical_document_release  migration 195 -- who was given a copy
//   practice_incoming_document          migration 200 -- what arrived, from whom, and who has looked
//   practice_attachment                 migration 207 -- files held against a patient, in a private bucket
//   practice_audit_event                migration 191 -- what was done, by whom, when
//
// s15's data model names Document, DocumentVersion, DocumentLink, DocumentReview, DocumentSignature,
// DocumentShare, DocumentAuditEvent and DocumentTask. Six of those eight are already implemented by other
// names across the four tables above; DocumentReview and DocumentTask are s20 Phase 3. NO MIGRATION IS
// WRITTEN OR NEEDED FOR PHASE 1, and the two writes below add no column to anything.
//
// WHAT WAS GENUINELY MISSING, and is the whole of this module's write surface:
//
//   CLASSIFY. s6.2 step 3 and 4 -- "User or authorised staff links the document to a patient. User
//   classifies the document type and document date." There is no function anywhere in this codebase that
//   does that. InboxConsole.tsx even tells the user that "linking it to a patient happens from their
//   record once it has been reviewed", which was never true: recordIncoming() takes a patientId at
//   creation and nothing could ever set one afterwards. An arriving result therefore stayed attached to
//   nobody, forever, and was invisible in the record of the person it was about.
//
//   UNLINK, WITH A REASON. s17 -- "Deleting a patient link requires confirmation and an audit reason."
//
// ⚠ SOURCE ATTRIBUTION SURVIVES CLASSIFICATION (s17), BY CONSTRUCTION AND NOT BY DISCIPLINE.
// classifyIncoming() HAS NO `source` PARAMETER. Its patch is built from a three-field allowlist, so there
// is no argument a caller could pass, and no route it could pass one through, that would let filing a
// document rewrite where it came from. The alternative -- accepting a whole row and trusting the caller
// not to include `source` -- is the shape that makes this rule a thing somebody has to remember.
//
// ⚠ A FAILED READ IS NEVER A ZERO. Every count on this page is a `Reading`, and the three states are
// distinct all the way to the card: `ok` with a number, `unreadable` with the database's own words, and
// `forbidden` when the caller does not hold the capability. Reporting the second as "0 awaiting review"
// tells a practitioner their inbox is clear because a query timed out, and this product's whole claim on
// the incoming register is that the unreviewed result is the harm.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * THREE STATES, NOT TWO. `unreadable` carries the database's message so a page can show it rather than
 * inventing a reason; `forbidden` is a permission answer and is not a failure.
 */
export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; detail: string }
  | { state: "forbidden"; detail: string };

/**
 * One row of the register, whatever it actually is underneath.
 *
 * `stored` IS CARRIED ALONGSIDE `status`. The chip shows a derived word from s7's vocabulary; the row
 * still knows the column value it came from, so a support question ("why does this say Issued?") is
 * answerable without reading this file.
 */
export type DocumentRow = {
  id: string;
  origin: DocOrigin;
  title: string;
  docType: string;
  patientId: string | null;
  patientName: string | null;
  status: DocStatus;
  stored: string;
  /** The date that matters for this row: signed, received, or created. YYYY-MM-DD. */
  at: string;
  /** Where it came from IN WORDS. The practice's own name for authored rows; the sender for arrivals. */
  source: string;
  authorId: string | null;
  version: number | null;
  priority: string | null;
  whereHeld: string | null;
  summary: string | null;
  href: string | null;
};

export type Register = {
  rows: DocumentRow[];
  /**
   * WHICH SOURCE FAILED, AND WHAT THE DATABASE SAID. Not a boolean: "the incoming register could not be
   * read" and "nothing could be read" are different sentences and the page prints the one that is true.
   */
  unreadable: { source: string; detail: string }[];
  /** A source that returned exactly its limit. PostgREST caps at 1000; this says so rather than lying. */
  truncated: string[];
  today: string;
  timezone: string;
};

const PER_SOURCE_LIMIT = 500;

const dayOf = (v: unknown): string => String(v ?? "").slice(0, 10);

/* ── THE REGISTER ────────────────────────────────────────────────────────────────────────────────────
 *
 * s2.1: "The Documents Workspace provides a cross-practice view across all patients, locations and
 * document workflows." Three tables, read in parallel, merged into one sorted list.
 *
 * ⚠ THE FILTER IS APPLIED IN ONE PLACE, OVER THE MERGED ROWS. Pushing each filter down into three
 * different PostgREST queries would mean three predicates that have to agree, over three schemas that do
 * not -- `doc_type` means different things in two of them and the third has `kind`. One predicate over
 * one array is the only shape in which the card's figure and the list it opens cannot drift apart.
 */
export async function documentRegister(
  admin: any, workspaceId: string, filter: DocFilter = {},
): Promise<Register> {
  const { timezone, today } = await workspaceClock(admin, workspaceId);

  const [authored, incoming, attachments] = await Promise.all([
    admin.from("practice_clinical_document")
      .select("id, patient_id, doc_type, title, status, version, signed_at, created_at, created_by, supersedes_document_id")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(PER_SOURCE_LIMIT),
    admin.from("practice_incoming_document")
      .select("id, patient_id, doc_type, source, title, summary, received_on, where_held, priority, status, created_at, created_by")
      .eq("workspace_id", workspaceId).order("received_on", { ascending: false }).limit(PER_SOURCE_LIMIT),
    admin.from("practice_attachment")
      .select("id, patient_id, encounter_id, file_name, kind, caption, created_at, created_by")
      .eq("workspace_id", workspaceId).is("removed_at", null)
      .order("created_at", { ascending: false }).limit(PER_SOURCE_LIMIT),
  ]);

  const unreadable: { source: string; detail: string }[] = [];
  const truncated: string[] = [];
  const take = (label: string, res: any): any[] => {
    // ⚠ THE ERROR IS THE ANSWER, NOT AN EMPTY ARRAY. `data ?? []` here is the exact line that turns an
    // outage into the sentence "you have no documents".
    if (res?.error) { unreadable.push({ source: label, detail: String(res.error.message ?? res.error) }); return []; }
    const rows = (res?.data ?? []) as any[];
    if (rows.length === PER_SOURCE_LIMIT) truncated.push(label);
    return rows;
  };

  const authoredRows = take("authored documents", authored);
  const incomingRows = take("incoming register", incoming);
  const attachmentRows = take("patient files", attachments);

  // Releases turn SIGNED into ISSUED (s7). Only fetched when there is something to fetch, and a failure
  // here is NOT silently "no releases" -- that would draw every issued document as merely signed.
  let releaseCount = new Map<string, number>();
  if (authoredRows.length > 0) {
    const rel = await admin.from("practice_clinical_document_release")
      .select("document_id").eq("workspace_id", workspaceId)
      .in("document_id", authoredRows.map(d => d.id));
    if (rel.error) unreadable.push({ source: "release register", detail: String(rel.error.message) });
    else {
      releaseCount = new Map();
      for (const r of (rel.data ?? []) as any[])
        releaseCount.set(r.document_id, (releaseCount.get(r.document_id) ?? 0) + 1);
    }
  }
  const releasesUnreadable = unreadable.some(u => u.source === "release register");

  // Names in one query rather than one per row.
  const patientIds = [...new Set([
    ...authoredRows.map(r => r.patient_id),
    ...incomingRows.map(r => r.patient_id),
    ...attachmentRows.map(r => r.patient_id),
  ].filter(Boolean))] as string[];
  let nameOf = new Map<string, string>();
  if (patientIds.length > 0) {
    const p = await admin.from("practice_patient").select("id, display_name").in("id", patientIds);
    if (p.error) unreadable.push({ source: "patient names", detail: String(p.error.message) });
    else nameOf = new Map(((p.data ?? []) as any[]).map(x => [x.id, x.display_name]));
  }
  // A name that could not be read is not "Unknown patient" -- that phrase means the link is broken.
  const namesUnreadable = unreadable.some(u => u.source === "patient names");
  const nameFor = (id: string | null): string | null =>
    !id ? null : namesUnreadable ? "(name could not be read)" : (nameOf.get(id) ?? "Unknown patient");

  const rows: DocumentRow[] = [
    ...authoredRows.map(d => ({
      id: d.id as string,
      origin: "created_in_cp" as DocOrigin,
      title: d.title as string,
      docType: d.doc_type as string,
      patientId: (d.patient_id ?? null) as string | null,
      patientName: nameFor(d.patient_id ?? null),
      // ⚠ WHEN THE RELEASE REGISTER COULD NOT BE READ, a SIGNED document is drawn as signed and NOT as
      // issued. Claiming a copy left the practice on the strength of a failed read is the wrong error to
      // make: "issued" is a statement that somebody out there is holding this.
      status: authoredStatus(d.status as string, releasesUnreadable ? 0 : (releaseCount.get(d.id) ?? 0)),
      stored: d.status as string,
      at: dayOf(d.signed_at ?? d.created_at),
      source: "This practice",
      authorId: (d.created_by ?? null) as string | null,
      version: (d.version ?? null) as number | null,
      priority: null, whereHeld: null, summary: null,
      href: `/practice/documents/${d.id}`,
    })),
    ...incomingRows.map(d => ({
      id: d.id as string,
      origin: "received_externally" as DocOrigin,
      title: d.title as string,
      docType: d.doc_type as string,
      patientId: (d.patient_id ?? null) as string | null,
      patientName: nameFor(d.patient_id ?? null),
      status: receivedStatus(d.status as string),
      stored: d.status as string,
      at: dayOf(d.received_on ?? d.created_at),
      source: d.source as string,
      authorId: (d.created_by ?? null) as string | null,
      version: null,
      priority: (d.priority ?? null) as string | null,
      whereHeld: (d.where_held ?? null) as string | null,
      summary: (d.summary ?? null) as string | null,
      href: "/practice/inbox",
    })),
    ...attachmentRows.map(a => ({
      id: a.id as string,
      origin: "uploaded_by_staff" as DocOrigin,
      title: (a.caption?.trim() || a.file_name) as string,
      docType: a.kind as string,
      patientId: (a.patient_id ?? null) as string | null,
      patientName: nameFor(a.patient_id ?? null),
      status: "filed" as DocStatus,
      stored: "FILED",
      at: dayOf(a.created_at),
      source: "Uploaded here",
      authorId: (a.created_by ?? null) as string | null,
      version: null,
      priority: null, whereHeld: null,
      summary: null,
      // The bytes are reached through the patient's record, which is where the access log for opening
      // one already lives. A link straight to the file would bypass that log.
      href: a.patient_id ? `/practice/patients/${a.patient_id}` : null,
    })),
  ];

  return {
    rows: applyFilter(rows, filter, today).sort((a, b) => b.at.localeCompare(a.at)),
    unreadable, truncated, today, timezone,
  };
}

/**
 * s10's filters, as ONE predicate. Exported so the register, the cards and the harness all run it.
 *
 * `window: "this_month"` is computed against the PRACTICE's today, not the server's -- a practice in
 * Kampala rolls into a new month three hours before UTC does.
 */
export function applyFilter(rows: DocumentRow[], filter: DocFilter, today: string): DocumentRow[] {
  const monthPrefix = today.slice(0, 7);
  const q = (filter.q ?? "").trim().toLowerCase();

  return rows.filter(r => {
    if (q) {
      const hay = [r.title, r.source, r.patientName ?? "", r.docType, r.summary ?? ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter.type && r.docType !== filter.type) return false;
    if (filter.status?.length && !filter.status.includes(r.status)) return false;
    if (filter.origin?.length && !filter.origin.includes(r.origin)) return false;
    if (filter.patientId && r.patientId !== filter.patientId) return false;
    if (filter.authorId && r.authorId !== filter.authorId) return false;
    if (filter.link === "linked" && !r.patientId) return false;
    if (filter.link === "unlinked" && r.patientId) return false;
    if (filter.from && r.at < filter.from) return false;
    if (filter.to && r.at > filter.to) return false;
    if (filter.window === "this_month" && !r.at.startsWith(monthPrefix)) return false;
    return true;
  });
}

/* ── s4's OVERVIEW DASHBOARD ─────────────────────────────────────────────────────────────────────────
 *
 * "The landing page should not be an empty library. It should be an operational dashboard showing what
 * requires attention and offering immediate creation and upload actions."
 */

export type DocCard = {
  key: DocCardKey;
  count: Reading<number>;
  /** s4's second column: a denominator, never a rate. Null when there is nothing honest to compare to. */
  against: { label: string; count: number } | null;
  href: string;
};

export type AttentionQueue = {
  key: string;
  label: string;
  blurb: string;
  rows: DocumentRow[];
  /** The href that opens EXACTLY these rows. s4: the queue exists to be worked, not admired. */
  href: string;
};

export type ActivityEntry = {
  id: string;
  at: string;
  verb: string;
  origin: DocOrigin;
  actorId: string | null;
  actorName: string | null;
  subject: string | null;
  eventType: string;
};

export type DocumentsOverview = {
  register: Register;
  cards: DocCard[];
  attention: AttentionQueue[];
  activity: Reading<ActivityEntry[]>;
  /** s4 "Quick templates: frequently used templates based on personal usage." Real counts, or nothing. */
  templates: Reading<{ id: string; title: string; kind: string; used: number }[]>;
  /** True when this practice is genuinely empty, so s4.1's guidance is the honest filler. */
  empty: boolean;
};

/**
 * ⚠ THE PRIOR-MONTH COMPARISON EXISTS ONLY WHEN THE PRIOR MONTH DID.
 *
 * The comp prints "24 ↑ 15% vs last month" on Created this month. That is a rate against a baseline, and
 * this file will not print one: s4 asks for counts and denominators. It carries the prior month's COUNT
 * instead -- and only if this workspace existed before that month began. A practice three weeks old has
 * no last month, and "3 vs 0" would read as a collapse in output rather than as an absence of history.
 */
function priorMonthWindow(today: string): { from: string; to: string; label: string } {
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return {
    from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay)}`,
    label: "Same period last month",
  };
}

export async function documentsOverview(admin: any, workspaceId: string, opts: {
  userId: string; capabilities: string[];
}): Promise<DocumentsOverview> {
  const register = await documentRegister(admin, workspaceId);
  const { rows, today } = register;

  // A source that failed makes every card DERIVED FROM IT unreadable. Which cards those are is not a
  // guess: each card names the sources it counts.
  const failed = new Set(register.unreadable.map(u => u.source));
  const reading = (sources: string[], value: number): Reading<number> => {
    const bad = sources.filter(s => failed.has(s));
    return bad.length > 0
      ? { state: "unreadable", detail: `${bad.join(" and ")} could not be read` }
      : { state: "ok", value };
  };
  const ALL = ["authored documents", "incoming register", "patient files"];

  const created = applyFilter(rows, { origin: ["created_in_cp"], window: "this_month" }, today);
  const awaiting = applyFilter(rows, { status: ["awaiting_review"] }, today);
  const drafts = applyFilter(rows, { status: ["draft", "approved"] }, today);
  const unlinked = applyFilter(rows, { link: "unlinked" }, today);

  // Did last month exist for this practice? Read the workspace's own creation date; a failure to read it
  // means no comparison rather than a comparison against an assumed baseline.
  const prior = priorMonthWindow(today);
  const { data: ws, error: wsError } = await admin.from("practice_workspace")
    .select("created_at").eq("id", workspaceId).maybeSingle();
  const priorWindowExisted = !wsError && !!ws?.created_at && dayOf(ws.created_at) <= prior.from;
  const priorCount = applyFilter(rows, { origin: ["created_in_cp"], from: prior.from, to: prior.to }, today).length;

  // ⚠ THE HREF COMES FROM DOC_CARD_VIEW, NOT FROM A LITERAL WRITTEN HERE. Two copies of a card's
  // querystring is two predicates that have to agree, and the first build had them disagree: the card
  // counted authored documents from this month while its href opened everything from this month.
  const cards: DocCard[] = [
    { key: "total", count: reading(ALL, rows.length), against: null, href: DOC_CARD_VIEW.total },
    {
      key: "created_this_month",
      count: reading(["authored documents"], created.length),
      against: priorWindowExisted && !failed.has("authored documents")
        ? { label: prior.label, count: priorCount } : null,
      href: DOC_CARD_VIEW.created_this_month,
    },
    {
      key: "awaiting_review", count: reading(["incoming register"], awaiting.length), against: null,
      href: DOC_CARD_VIEW.awaiting_review,
    },
    {
      key: "drafts", count: reading(["authored documents"], drafts.length), against: null,
      href: DOC_CARD_VIEW.drafts,
    },
    {
      key: "unlinked", count: reading(["incoming register"], unlinked.length), against: null,
      href: DOC_CARD_VIEW.unlinked,
    },
  ];

  // s4's attention queue, and every entry is the rows themselves rather than a number beside a promise.
  // ⚠ THE SAME PREDICATE AND THE SAME HREF AS THE CARD ABOVE IT. Three sections, three cards, one filter
  // each -- so "Work this list" cannot open something other than what the section is showing.
  const attention: AttentionQueue[] = [
    {
      key: "awaiting_review", label: "Awaiting review",
      blurb: "Arrived, and nobody has looked. A result nobody read is the classic way a practice harms somebody by omission.",
      rows: awaiting.slice(0, 8), href: DOC_CARD_VIEW.awaiting_review,
    },
    {
      key: "unlinked", label: "No patient link",
      blurb: "These arrived without a patient. Until one is chosen they cannot be found from anybody's record.",
      rows: unlinked.slice(0, 8), href: DOC_CARD_VIEW.unlinked,
    },
    {
      key: "drafts", label: "Written, not signed",
      blurb: "Drafts and documents marked ready. Nothing here has been issued to anybody.",
      rows: drafts.slice(0, 8), href: DOC_CARD_VIEW.drafts,
    },
  ].filter(s => s.rows.length > 0);

  const [activity, templates] = await Promise.all([
    documentActivity(admin, workspaceId, 12),
    frequentTemplates(admin, workspaceId, opts.userId),
  ]);

  return {
    register, cards, attention, activity, templates,
    // ⚠ EMPTY ONLY WHEN EVERY SOURCE WAS READ. A workspace whose three reads all failed has no rows
    // either, and drawing s4.1's "here is how to get started" over an outage is the first doctrine's
    // failure in its friendliest costume.
    empty: rows.length === 0 && register.unreadable.length === 0,
  };
}

/* ── BASIC AUDIT (s20 Phase 1, s13) ──────────────────────────────────────────────────────────────────
 *
 * s13 asks for "immutable audit events for view, download, edit, sign, issue, share and delete/archive".
 * practice_audit_event already carries edit, sign, issue and archive-equivalents for every document
 * operation in this product; VIEW and DOWNLOAD are recorded separately in practice_access_log by
 * CPR-370's logAccess, which the attachment route already calls. This reads the first of those.
 *
 * ⚠ EVENTS ARE FILTERED ON THE WAY IN BY A NAMED LIST. practice_audit_event holds everything this
 * product writes -- sessions, appointments, provisioning. An unrecognised type rendered with its raw
 * name would put "practice.session_paused" into a document history; dropped silently, the panel would
 * look complete while missing things. DOC_AUDIT_EVENTS is the list, and the panel says what it covers.
 */
export async function documentActivity(
  admin: any, workspaceId: string, limit = 20,
): Promise<Reading<ActivityEntry[]>> {
  const types = Object.keys(DOC_AUDIT_EVENTS);
  const { data, error } = await admin.from("practice_audit_event")
    .select("id, event_type, actor_id, payload, occurred_at")
    .eq("workspace_id", workspaceId).in("event_type", types)
    .order("occurred_at", { ascending: false }).limit(limit);
  if (error) return { state: "unreadable", detail: String(error.message) };

  const events = (data ?? []) as any[];
  const actorIds = [...new Set(events.map(e => e.actor_id).filter(Boolean))] as string[];
  let actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    // ⚠ `profiles.full_name`, NOT a column on practice_membership. The membership table carries a role
    // and a status and no name at all -- listMembers() in tasks.ts joins profiles for exactly this
    // reason, and inventing practice_membership.display_name here would have made every actor anonymous
    // while the query quietly errored. A failure here loses the NAME, never the event.
    const { data: people } = await admin.from("profiles").select("id, full_name").in("id", actorIds);
    actorName = new Map(((people ?? []) as any[])
      .filter(p => !!p.full_name)
      .map(p => [p.id as string, p.full_name as string]));
  }

  return {
    state: "ok",
    value: events.map(e => {
      // ⚠ THE FALLBACK IS UNREACHABLE WHILE THE `.in()` FILTER ABOVE STANDS, AND EXISTS ANYWAY. Reading
      // `spec.verb` off an undefined entry is a TypeError that white-screens the whole dashboard, so a
      // future edit that widens the query degrades to one visibly wrong row instead. It is also what lets
      // the harness assert the filter: with the fallback, removing `.in()` makes an unrecognised event
      // APPEAR in the panel and the assertion goes red; without it, the same edit crashes the process and
      // the assertion never runs at all.
      const spec = DOC_AUDIT_EVENTS[e.event_type]
        ?? { verb: "acted on", origin: "created_in_cp" as DocOrigin };
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return {
        id: e.id as string,
        at: e.occurred_at as string,
        verb: spec.verb,
        origin: spec.origin,
        actorId: (e.actor_id ?? null) as string | null,
        actorName: e.actor_id ? (actorName.get(e.actor_id) ?? null) : null,
        // ⚠ AN ID, NOT CONTENT. Anybody holding access.review reads this trail; the body of a referral
        // letter is the clinical content the trail exists to account for, not something to copy into it.
        subject: (p.documentId ?? p.incomingId ?? p.attachmentId ?? null) as string | null,
        eventType: e.event_type as string,
      };
    }),
  };
}

/**
 * s4 "Quick templates: frequently used templates based on personal usage."
 *
 * COUNTED FROM DOCUMENTS THIS PERSON ACTUALLY MADE. There is no usage table and none is added: a
 * template's use is a practice_clinical_document row carrying its template_id, which is a fact already in
 * the record. A template nobody has used does not appear -- "frequently used" with a zero beside it is
 * a list of templates, not a shortcut.
 */
export async function frequentTemplates(
  admin: any, workspaceId: string, userId: string,
): Promise<Reading<{ id: string; title: string; kind: string; used: number }[]>> {
  const { data, error } = await admin.from("practice_clinical_document")
    .select("template_id").eq("workspace_id", workspaceId).eq("created_by", userId)
    .not("template_id", "is", null).limit(500);
  if (error) return { state: "unreadable", detail: String(error.message) };

  const used = new Map<string, number>();
  for (const r of (data ?? []) as any[]) used.set(r.template_id, (used.get(r.template_id) ?? 0) + 1);
  if (used.size === 0) return { state: "ok", value: [] };

  const { data: templates, error: tError } = await admin.from("practice_note_template")
    .select("id, title, kind").in("id", [...used.keys()]);
  if (tError) return { state: "unreadable", detail: String(tError.message) };

  return {
    state: "ok",
    value: ((templates ?? []) as any[])
      .map(t => ({ id: t.id as string, title: t.title as string, kind: t.kind as string, used: used.get(t.id) ?? 0 }))
      .sort((a, b) => b.used - a.used || a.title.localeCompare(b.title))
      .slice(0, 6),
  };
}

/* ── THE TWO WRITES (s6.2, s17) ──────────────────────────────────────────────────────────────────────
 *
 * ⚠ NEITHER OF THESE TOUCHES `source`. See the module header: the allowlist is the enforcement.
 */

const INCOMING_TYPE_CODES = INCOMING_DOC_TYPES.map(([c]) => c) as readonly string[];

/**
 * s6.2 steps 3 and 4: link an arriving document to a patient, and classify what it is.
 *
 * WHAT IT WILL NOT DO:
 *   - change `source`. There is no parameter for it.
 *   - remove a patient link. That is unlinkIncomingPatient(), which requires a reason (s17). Passing
 *     null here on a row that HAS a patient is refused rather than silently ignored, because a caller
 *     that meant to unlink and was quietly told "fine" would believe it had happened.
 *   - reach another workspace's row, or link to another workspace's patient.
 */
export async function classifyIncoming(admin: any, args: {
  workspaceId: string; incomingId: string;
  patientId?: string | null; docType?: string; receivedOn?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ patientId: string | null; docType: string; source: string }>> {
  const { data: doc } = await admin.from("practice_incoming_document")
    .select("id, patient_id, doc_type, source, received_on, status")
    .eq("id", args.incomingId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (args.patientId === null && doc.patient_id)
    return {
      ok: false, status: 422, code: "USE_UNLINK",
      message: "removing a patient link needs a reason; use the unlink action",
    };

  let patientId: string | null = doc.patient_id ?? null;
  if (args.patientId) {
    const { data: p } = await admin.from("practice_patient")
      .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!p) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    // Migration 200 is explicit that an arriving document may belong to an ARCHIVED patient -- a result
    // can arrive for somebody whose record was closed last week, and refusing it would lose the fact
    // that it arrived. So no active-status check here, deliberately, unlike createDocument.
    patientId = p.id;
  }

  let docType = doc.doc_type as string;
  if (args.docType !== undefined) {
    if (!INCOMING_TYPE_CODES.includes(args.docType))
      return {
        ok: false, status: 400, code: "VALIDATION_ERROR",
        message: `docType must be one of: ${INCOMING_TYPE_CODES.join(", ")}`,
      };
    docType = args.docType;
  }

  let receivedOn = doc.received_on as string;
  if (args.receivedOn !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.receivedOn))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the document date must be YYYY-MM-DD" };
    receivedOn = args.receivedOn;
  }

  const nothingChanged = patientId === (doc.patient_id ?? null)
    && docType === doc.doc_type && receivedOn === doc.received_on;
  if (nothingChanged)
    return { ok: true, data: { patientId, docType, source: doc.source as string } };

  // ⚠ THE ALLOWLIST. Three fields, written out, and `source` is not one of them. This is s17's "patient-
  // uploaded documents retain source attribution even after classification", enforced by there being
  // nothing to enforce.
  const { error } = await admin.from("practice_incoming_document")
    .update({ patient_id: patientId, doc_type: docType, received_on: receivedOn })
    .eq("id", doc.id).eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.incoming_classified",
    payload: {
      incomingId: doc.id, patientId, docType, receivedOn,
      previousPatientId: doc.patient_id ?? null, previousDocType: doc.doc_type,
      // The source, recorded as evidence that it did not move. Not clinical content -- it is the name of
      // a laboratory or a hospital, which is the one thing about an arrival that must never drift.
      source: doc.source,
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { patientId, docType, source: doc.source as string } };
}

/**
 * s17: "Deleting a patient link requires confirmation and an audit reason."
 *
 * THE REASON IS REQUIRED BY THE ENGINE, NOT BY A DIALOG. A confirmation the client draws is a
 * confirmation the API does not have; the reason is a parameter, blank is a 400, and it lands in the
 * audit payload where a reviewer can read it.
 */
export async function unlinkIncomingPatient(admin: any, args: {
  workspaceId: string; incomingId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ previousPatientId: string }>> {
  if (!args.reason.trim())
    return {
      ok: false, status: 400, code: "REASON_REQUIRED",
      message: "say why this document is not about that patient -- the reason is the record",
    };

  const { data: doc } = await admin.from("practice_incoming_document")
    .select("id, patient_id, source").eq("id", args.incomingId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!doc.patient_id)
    return { ok: false, status: 422, code: "NOT_LINKED", message: "this document is not linked to a patient" };

  const previous = doc.patient_id as string;
  const { error } = await admin.from("practice_incoming_document")
    .update({ patient_id: null }).eq("id", doc.id).eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.incoming_patient_unlinked",
    payload: { incomingId: doc.id, previousPatientId: previous, reason: args.reason.trim(), source: doc.source },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { previousPatientId: previous } };
}

/** The card keys this engine emits. Declared so the swatch map can be asserted against it both ways. */
export const EMITTED_CARD_KEYS: readonly DocCardKey[] = DOC_CARD_KEYS;
