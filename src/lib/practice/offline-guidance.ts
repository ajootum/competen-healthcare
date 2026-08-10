import { practiceToday } from "@/lib/practice/practice-time";

// CP-OFFLINE-SURVEY-001 s9 item 4 — CACHED PRACTICE GUIDANCE, the projection and the rules.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ IT IMPORTS EXACTLY ONE THING, AND ONLY BECAUSE THAT THING ALREADY EXISTS.
//
// offline-projection.ts carries the rule: this module is read by the route handler (server), by the
// writer and reader (client) and by the harness (node), so nothing server-only may reach it. A single
// server-only import into a client component has already cost this repository a board -- clean tsc,
// clean eslint, clean harness, dead page. `practice-time.ts` is pure Intl arithmetic with no Supabase
// and no next/server, which is why offline-projection.ts already imports from it.
//
// ⚠ AND IT IS IMPORTED RATHER THAN REWRITTEN FOR A SPECIFIC REASON. The first draft of this file defined
// its own `practiceToday(now, timezone)` -- same name as the existing one, ARGUMENTS THE OTHER WAY ROUND.
// Both compile at every call site that passes two strings-worth of intent, and the wrong one silently
// answers with the date in the wrong zone. One owner per calculation, and the calculation already had an
// owner.
//
// ── WHY THIS IS A DIFFERENT CACHE FROM THE CLINIC DAY, NOT A FIELD ON IT ────────────────────────────
//
// The survey ranks guidance FOURTH by felt loss and then says it is "the cheapest real value in the
// programme" -- static, safe, conflict-free. It differs from the clinic day on every axis that made the
// day's rules what they are:
//
//   day                                    guidance
//   ---------------------------------      ------------------------------------------------------
//   names living patients                  NAMES NOBODY. Not one field is patient data.
//   wrong the moment the day ends          a protocol does not stop being true at midnight
//   the hazard is a stale schedule         the hazard is a WITHDRAWN OR REVISED document
//   expires end-of-clinic-day              expires on a cap, see OFFLINE_GUIDANCE_MAX_DAYS
//
// Sharing one record would have forced the shorter, stricter rule onto content that does not need it --
// and end-of-day expiry on guidance would make it useless for exactly the four-day trip the whole
// programme exists to serve. Two records, two expiries, two sets of sentences.
//
// ⚠ WHAT IS STILL WITHHELD, EVEN THOUGH NONE OF IT IS PATIENT DATA:
//
//   author, owner and approver NAMES     colleagues' names, of no clinical use to a reader mid-clinic
//   the approval record                  "published" already carries that somebody approved it
//   drafts and in-review documents       ⚠ THE SINGLE MOST IMPORTANT EXCLUSION -- see below
//   archived and superseded documents    withdrawn guidance is the hazard, not the payload
//   archived_reason, internal notes      practice-internal, not clinical content
//
// ⚠ ONLY `published` IS CACHED, AND IT IS A CLINICAL SAFETY RULE RATHER THAN A TIDINESS ONE. A draft
// protocol on a device with no connection is indistinguishable from an approved one to the person
// reading it at 2am, and the practice never agreed to it. `status` is not a filter that a caller passes
// in; it is fixed in the query and asserted by the harness, so widening it takes a deliberate edit.

/** Bumped when the shape below changes. A record from an older schema is discarded, never migrated. */
export const OFFLINE_GUIDANCE_SCHEMA_VERSION = 1;

/**
 * ⚠ THE LIBRARY-WIDE HARD EXPIRY, IN DAYS, AND IT IS A JUDGEMENT RATHER THAN A DERIVED NUMBER.
 *
 * The reasoning, so it can be argued with:
 *   - It has to outlast the trip. The user's framing for this whole programme is "if the device is
 *     offline for 4 days". An expiry inside that window would delete the guidance on the day it is most
 *     needed, which is the failure this feature exists to prevent.
 *   - It has to bound the hazard. The hazard is a document WITHDRAWN OR REVISED while the device was
 *     away; expiry is the only control that reaches a device that never reconnects (s3.8.2). Seven days
 *     is the longest a withdrawn protocol can survive on a device that never comes back.
 *   - It can be long because nothing here is patient data. The day cache is short because it names
 *     living patients; this names none, so the disclosure argument that shortened that one does not
 *     apply to this one.
 *
 * ⚠ NOT SETTLED BY THE USER. Survey decision 1 settled the hard expiry for the CLINIC DAY (end of clinic
 * day) and guidance was not in front of them. This is a build-time judgement, kept in one constant so
 * changing it is a one-line decision rather than an archaeology exercise.
 */
export const OFFLINE_GUIDANCE_MAX_DAYS = 7;

/**
 * ⚠ CAPS. A practice may hold hundreds of documents and the sections are free text, so an uncapped
 * payload is an unbounded write to a phone. Both are REPORTED when they bite -- see `OfflineGuidanceLibrary.dropped`.
 * A silent cap reads as "this is all of it", which is the one thing a reference library must never imply.
 */
export const OFFLINE_GUIDANCE_MAX_DOCUMENTS = 60;
export const OFFLINE_GUIDANCE_MAX_BYTES = 1_500_000;

export type OfflineGuidanceSection = {
  key: string;
  heading: string;
  /** What somebody wrote. Empty sections are dropped upstream rather than cached as blanks. */
  body: string;
  position: number;
};

export type OfflineGuidanceDoc = {
  id: string;
  /** The practice's own reference, e.g. "GUI-014". What a colleague says out loud. */
  code: string;
  title: string;
  summary: string | null;
  docType: string;
  specialty: string | null;
  version: number;
  /** ISO date. Null when the document carries none. */
  effectiveFrom: string | null;
  /** ISO date. Null means ⚠ nothing brings this document back for review. */
  reviewOn: string | null;
  sections: OfflineGuidanceSection[];
};

export type OfflineGuidanceLibrary = {
  schemaVersion: number;
  workspaceId: string;
  timezone: string;
  /** The instant the SERVER assembled this. Never a client clock. */
  asOf: string;
  /** The instant after which the whole library is DELETED rather than shown. */
  expiresAt: string;
  documents: OfflineGuidanceDoc[];
  /** ⚠ A FAILED READ IS NOT AN EMPTY LIBRARY. */
  documentsUnavailable: boolean;
  /** Null when everything in force was stored. Otherwise what was left out, and why. */
  dropped: { count: number; reason: string } | null;
};

export const OFFLINE_GUIDANCE_SECTION_KEYS: readonly (keyof OfflineGuidanceSection)[] = [
  "key", "heading", "body", "position",
] as const;

export const OFFLINE_GUIDANCE_DOC_KEYS: readonly (keyof OfflineGuidanceDoc)[] = [
  "id", "code", "title", "summary", "docType", "specialty",
  "version", "effectiveFrom", "reviewOn", "sections",
] as const;

export const OFFLINE_GUIDANCE_LIBRARY_KEYS: readonly (keyof OfflineGuidanceLibrary)[] = [
  "schemaVersion", "workspaceId", "timezone", "asOf", "expiresAt",
  "documents", "documentsUnavailable", "dropped",
] as const;

/**
 * ⚠ FIELDS THAT MUST NEVER APPEAR, BY NAME.
 *
 * Every one of these is a real column on `practice_guidance_document`, so a lazy `{...row}` is caught by
 * name rather than by "unexpected key". They are people (`owner_id`, `created_by`), the approval record,
 * and the lifecycle fields that only mean something to somebody administering the library.
 */
export const OFFLINE_GUIDANCE_FORBIDDEN_FIELDS = [
  "owner_id", "ownerId", "created_by", "createdBy", "authorName", "ownerName",
  "approval_request_id", "approvalRequestId", "approval", "decidedByName", "assignedToName",
  "archived_at", "archivedAt", "archived_reason", "archivedReason",
  "supersedes_id", "supersedesId", "status", "readiness", "moves",
] as const;

/** Keys on `obj` that are not in `allowed`. Empty means the projection held. */
export function guidanceKeysOutsideAllowList(obj: object, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter(k => !allowed.includes(k));
}

/** The instant a cached library stops being readable: `OFFLINE_GUIDANCE_MAX_DAYS` after capture. */
export function offlineGuidanceExpiry(asOf: string, maxDays: number = OFFLINE_GUIDANCE_MAX_DAYS): string {
  return new Date(Date.parse(asOf) + maxDays * 86_400_000).toISOString();
}

// ── WHAT THE READER IS ALLOWED TO DO WITH WHAT IT FOUND ─────────────────────────────────────────────

export type OfflineGuidanceReadResult =
  | { state: "ok"; library: OfflineGuidanceLibrary; notice: OfflineGuidanceNotice }
  /** ⚠ The record must be DELETED, not hidden. `reason` is shown; nothing else is. */
  | { state: "expired"; reason: string; purge: true }
  | { state: "clock_rollback"; reason: string; purge: false }
  | { state: "wrong_schema"; reason: string; purge: true }
  | { state: "none"; reason: string; purge: false };

export type OfflineGuidanceNotice = {
  /** Whole days since capture, on the wall clock rather than a rounded hour count. */
  days: number;
  /** An absolute stamp, never a relative "3 days ago" on its own. */
  atLabel: string;
  sentence: string;
  tone: "amber" | "orange" | "red";
};

/**
 * ⚠ THE SENTENCE NAMES THE ACTUAL HAZARD, WHICH IS NOT "THIS MIGHT BE OLD".
 *
 * Guidance captured three days ago is very probably still correct, and a banner crying staleness at
 * content that is almost certainly current trains people to ignore banners. The real risk is narrow and
 * specific: the document may have been REVISED OR WITHDRAWN while this device was away, and this device
 * has no way to find out. That is what these sentences say, and they say it in those words.
 *
 * ⚠ None of them says "current", "up to date", "synced" or "latest". There is no sync.
 */
export function offlineGuidanceNotice(asOf: string, timezone: string, now: Date): OfflineGuidanceNotice {
  const ms = Math.max(0, now.getTime() - Date.parse(asOf));
  const days = Math.floor(ms / 86_400_000);
  const atLabel = new Date(asOf).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone || "UTC",
  });
  const tone = days >= 4 ? "red" as const : days >= 1 ? "orange" as const : "amber" as const;
  const sentence = days < 1
    ? `Offline. This is the guidance that was in force at ${atLabel}. If any of it has been revised or withdrawn since, this device cannot know.`
    : days < 4
      ? `Offline for ${days} day${days === 1 ? "" : "s"}. This is the guidance that was in force at ${atLabel}. A document revised or withdrawn since then would still look current here.`
      : `Offline for ${days} days. This is the guidance that was in force at ${atLabel}. Check anything you are about to rely on against the practice before you act on it.`;
  return { days, atLabel, sentence, tone };
}

/**
 * The one place that decides whether a cached library may be shown at all.
 *
 * ⚠ The clock-rollback and wrong-schema rules are the day cache's rules, deliberately identical. The
 * device clock is attacker-controlled and nothing at this layer changes that; refusing when the device
 * believes it is EARLIER than the capture instant is cheap and catches a genuinely wrong clock. It is
 * not presented as a defence against a competent adversary.
 */
export function readOfflineGuidance(
  library: OfflineGuidanceLibrary | null, now: Date,
): OfflineGuidanceReadResult {
  if (!library)
    return { state: "none", purge: false, reason: "No practice guidance has been stored on this device yet." };
  if (library.schemaVersion !== OFFLINE_GUIDANCE_SCHEMA_VERSION)
    return {
      state: "wrong_schema", purge: true,
      reason: "This device holds guidance in a format this version no longer reads, so it is discarded rather than guessed at.",
    };
  if (now.getTime() < Date.parse(library.asOf))
    return {
      state: "clock_rollback", purge: false,
      reason: "This device's clock is earlier than the moment this guidance was captured, so its age cannot be worked out. Nothing is shown.",
    };
  if (now.getTime() >= Date.parse(library.expiresAt))
    return {
      state: "expired", purge: true,
      reason: `This device has not reached the practice for over ${OFFLINE_GUIDANCE_MAX_DAYS} days. The guidance it was holding has been removed, because there is no way to tell from here whether any of it still stands.`,
    };
  return { state: "ok", library, notice: offlineGuidanceNotice(library.asOf, library.timezone, now) };
}

// ── ONE DOCUMENT, AS A READER SEES IT ───────────────────────────────────────────────────────────────

export type OfflineGuidanceRow = {
  id: string;
  code: string;
  title: string;
  summary: string | null;
  docType: string;
  specialty: string | null;
  /**
   * ⚠ COMPUTED AT READ TIME AGAINST THE PRACTICE'S CALENDAR, NOT FROZEN AT CAPTURE. A document can pass
   * its review date while the device is away, and a verdict frozen at capture would say "in date"
   * forever.
   */
  reviewOverdue: boolean;
  /** Null when the document names no review date at all -- which is its own warning, not a pass. */
  reviewOn: string | null;
};

export function offlineGuidanceRow(
  doc: OfflineGuidanceDoc, now: Date, timezone: string,
): OfflineGuidanceRow {
  const today = practiceToday(timezone, now);
  return {
    id: doc.id,
    code: doc.code,
    title: doc.title,
    summary: doc.summary,
    docType: doc.docType,
    specialty: doc.specialty,
    reviewOverdue: !!doc.reviewOn && doc.reviewOn < today,
    reviewOn: doc.reviewOn,
  };
}

/**
 * The line the reader must see under a document that is past its review date, or that has no review date.
 *
 * ⚠ PAST REVIEW DOES NOT MEAN WITHDRAWN, AND THIS MUST NOT IMPLY IT DOES. The online library shows
 * published-but-overdue documents exactly like any other published document, listing them separately as
 * "past their review date". Suppressing them offline would leave a practitioner with NO guidance where
 * online they would have had some, and would be a divergence between the two surfaces -- which is its own
 * hazard. So: shown, with the fact stated.
 */
export function offlineGuidanceReviewNote(row: OfflineGuidanceRow): string | null {
  if (row.reviewOverdue)
    return `The practice set a review date of ${row.reviewOn} for this document and it has passed. It is still the version that was in force, and it has not been withdrawn — it has not been re-confirmed.`;
  if (!row.reviewOn)
    return "No review date is set on this document, so nothing brings it back for re-confirmation.";
  return null;
}

// ── THE CONTROLS AN OFFLINE GUIDANCE SCREEN MAY RENDER ──────────────────────────────────────────────
//
// ⚠ s3.5 applies here in full, and the accident it guards against is LIVE on this screen specifically:
// the online guidance document page carries Edit, Send for approval, Publish and Withdraw. Reusing that
// component offline would render a rich-text body somebody could type a protocol revision into. It would
// be accepted, it would never arrive, and the author would believe the practice had been updated.
//
// So the controls are DATA, and the rule is the same one line the harness already asserts for the day:
//
//     a mutating control is NEVER enabled offline.

export type OfflineGuidanceControl = {
  key: string;
  label: string;
  mutating: boolean;
  enabled: boolean;
  reason: string | null;
};

const NEEDS_CONNECTION =
  "This needs a connection to the practice. Nothing typed here could be delivered, so nothing is accepted.";

export function offlineGuidanceControls(doc: OfflineGuidanceDoc): OfflineGuidanceControl[] {
  return [
    {
      key: `read:${doc.id}`,
      label: "Read this document",
      // Opening a document reads what is already on the device. It sends nothing and changes nothing.
      mutating: false, enabled: true, reason: null,
    },
    { key: `edit:${doc.id}`, label: "Edit this document", mutating: true, enabled: false, reason: NEEDS_CONNECTION },
    { key: `revise:${doc.id}`, label: "Start a new version", mutating: true, enabled: false, reason: NEEDS_CONNECTION },
    { key: `withdraw:${doc.id}`, label: "Withdraw this document", mutating: true, enabled: false, reason: NEEDS_CONNECTION },
  ];
}

/** ⚠ MUST BE EMPTY. Asserted over the real control list rather than over a mock. */
export function enabledMutatingGuidanceControls(
  controls: OfflineGuidanceControl[],
): OfflineGuidanceControl[] {
  return controls.filter(c => c.mutating && c.enabled);
}

// ── THE PROJECTION ──────────────────────────────────────────────────────────────────────────────────
//
// The source shapes are declared as INPUTS rather than imported from knowledge.ts, so that a column added
// to practice_guidance_document tomorrow cannot widen what is cached. The projection reads what it names.

export type GuidanceDocSource = {
  id: string;
  code: string;
  title: string;
  summary: string | null;
  doc_type: string;
  specialty: string | null;
  version: number;
  effective_from: string | null;
  review_on: string | null;
  updated_at: string | null;
};

export type GuidanceSectionSource = {
  guidance_id: string;
  section_key: string;
  heading: string;
  body: string | null;
  position: number;
};

export function projectOfflineGuidanceDoc(
  row: GuidanceDocSource, sections: GuidanceSectionSource[],
): OfflineGuidanceDoc {
  // FIELD BY FIELD. No spread, ever -- see the header.
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    summary: row.summary,
    docType: row.doc_type,
    specialty: row.specialty,
    version: row.version,
    effectiveFrom: row.effective_from,
    reviewOn: row.review_on,
    sections: sections
      // ⚠ AN EMPTY SECTION IS DROPPED RATHER THAN CACHED AS A BLANK. A heading followed by white space on
      // a device with no connection reads as "there is nothing to say about this", which is a different
      // claim from "nobody has written this yet". The online page says which one it is; offline it cannot,
      // so it says neither.
      .filter(s => (s.body ?? "").trim().length > 0)
      .sort((a, b) => a.position - b.position)
      .map(s => ({
        key: s.section_key,
        heading: s.heading,
        body: (s.body ?? "").trim(),
        position: s.position,
      })),
  };
}

/**
 * Apply the caps and say what they cost.
 *
 * ⚠ NO SILENT TRUNCATION. When something is left behind the library carries `dropped`, and the screen
 * prints it. A reference library that quietly holds two thirds of itself is worse than one that holds
 * none: the practitioner searches, does not find, and concludes the practice has no protocol for it.
 */
/**
 * ⚠ `totalAvailable` IS NOT `docs.length`, AND CONFLATING THEM WOULD UNDER-REPORT THE DROP.
 *
 * The server reads every published document's metadata (cheap) but fetches SECTIONS only for the first
 * `OFFLINE_GUIDANCE_MAX_DOCUMENTS` of them, because the bodies are the expensive part. So `docs` here is
 * already a slice, and only the caller knows how many were really in force. Defaulting it to `docs.length`
 * keeps the function honest when it genuinely was given everything.
 */
export function capOfflineGuidance(
  docs: OfflineGuidanceDoc[],
  opts: { maxDocuments?: number; maxBytes?: number; totalAvailable?: number } = {},
): { documents: OfflineGuidanceDoc[]; dropped: { count: number; reason: string } | null } {
  const maxDocuments = opts.maxDocuments ?? OFFLINE_GUIDANCE_MAX_DOCUMENTS;
  const maxBytes = opts.maxBytes ?? OFFLINE_GUIDANCE_MAX_BYTES;
  const total = opts.totalAvailable ?? docs.length;
  const kept: OfflineGuidanceDoc[] = [];
  let bytes = 0;
  let hitBytes = false;

  for (const doc of docs) {
    if (kept.length >= maxDocuments) break;
    const size = JSON.stringify(doc).length;
    if (bytes + size > maxBytes && kept.length > 0) { hitBytes = true; break; }
    kept.push(doc);
    bytes += size;
  }

  const count = total - kept.length;
  if (count === 0) return { documents: kept, dropped: null };

  const many = count === 1 ? "is" : "are";
  const plural = count === 1 ? "" : "s";
  return {
    documents: kept,
    dropped: {
      count,
      reason: hitBytes
        ? `${count} more document${plural} in force at the practice ${many} not on this device: what is here already fills the space set aside for it. The ${kept.length} most recently updated are the ones held.`
        : `${count} more document${plural} in force at the practice ${many} not on this device: only the ${maxDocuments} most recently updated are held.`,
    },
  };
}

export function projectOfflineGuidanceLibrary(input: {
  workspaceId: string;
  timezone: string;
  asOf: string;
  documents: OfflineGuidanceDoc[];
  documentsUnavailable: boolean;
  dropped: { count: number; reason: string } | null;
}): OfflineGuidanceLibrary {
  return {
    schemaVersion: OFFLINE_GUIDANCE_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    timezone: input.timezone,
    asOf: input.asOf,
    expiresAt: offlineGuidanceExpiry(input.asOf),
    documents: input.documents,
    documentsUnavailable: input.documentsUnavailable,
    dropped: input.dropped,
  };
}
