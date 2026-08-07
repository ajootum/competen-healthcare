import { createHash } from "node:crypto";
import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { transitionDocument, recordRelease, getTemplate } from "@/lib/practice/documentation";
import { buildMergeContext, letterhead } from "@/lib/practice/document-generation";
import { MERGE_FIELDS, RELEASE_CHANNELS } from "@/lib/practice/document-constants";
import { workspaceClock } from "@/lib/practice/practice-time";
import {
  DOC_ATTESTATION, RECIPIENT_REQUIRED_CHANNELS, authoredStatus, unresolvedMarkers, signBlockers,
  type DocMarker, type DocStatus, type SignBlocker,
} from "@/lib/practice/documents-workspace-constants";
import type { Reading } from "@/lib/practice/documents-workspace";

// CPR-DOC-002 DOCUMENTS WORKSPACE, PHASE 2 (s20): the structured editor's support, the SIGNATURE, the
// ISSUE, and the Shared & Issued register.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ MOST OF PHASE 2 WAS ALREADY BUILT, BY CPR-130 AND CPR-330, UNDER OTHER NAMES. Nothing here rebuilds
// any of it, and nothing here writes a migration:
//
//   the document object        practice_clinical_document        migration 195 s4
//   the version chain          supersedes_document_id + a partial unique index on it    195 s4
//   IMMUTABILITY AFTER SIGNING trg_practice_clinical_document_signed_guard              195 s7
//   the release register       practice_clinical_document_release                       195 s5
//   the state machine          transitionDocument / amendDocument / recordRelease   documentation.ts
//   PDF render                 /practice/documents/[id]/print, browser print-to-PDF, with the letterhead
//                              composed at print time from CPR-360's configuration
//   merge fields               document-generation.ts, and its rule that an unresolved field renders as a
//                              VISIBLE MARKER rather than as blank
//
// ⚠ WHAT WAS GENUINELY MISSING, WHICH IS THE WHOLE OF THIS MODULE:
//
//   1. THE DOCUMENT'S OWN ATTESTATION (s7.1). Signing wrote signed_at, signed_by and an audit event
//      carrying `{ documentId }`. That records that somebody pressed something. It does not record what
//      they said they were doing, and s7.1 is precisely a rule about MEANING: the document signature and
//      the encounter signature are two different claims. signDocument() below states the claim, requires
//      the caller to echo the version of the wording it displayed, and writes it to the trail with the
//      SHA-256 of the exact text signed. See DOC_ATTESTATION for why reusing the encounter path is not
//      merely untidy but wrong.
//
//   2. THE GATE BEFORE THE SIGNATURE. transitionDocument() refuses to sign an empty document and nothing
//      else. It could not refuse a document still carrying `[[patient.date_of_birth not recorded]]`,
//      which is s12's "block issuing when required fields remain unresolved" -- the second half of the
//      rule document-generation.ts implements the first half of.
//
//   3. THE ISSUE PATH, WITH s17's PATIENT-LINK CONTROL. recordRelease() checks the status and inserts.
//      It does not check that the patient link still resolves inside this workspace, which is s17's first
//      rule: "a patient-specific document cannot be issued without a patient link."
//
//   4. SHARED & ISSUED (s3). The release register had no reader anywhere in the product. A document's own
//      page listed its releases; nothing could answer "who is holding a copy of anything we wrote", and
//      nothing could answer the question that matters more -- "who is holding a copy of a version we have
//      since amended".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

/**
 * The SHA-256 of the text that was signed.
 *
 * ⚠ IT IS THE ANSWER TO "WHAT DID I SIGN", ASKED LATER. The document row is immutable after signature, so
 * in the ordinary case the body is still there to read. The digest is for the case that is not ordinary:
 * a restore from backup, a migration, a successor version that looks similar, or a dispute. It costs one
 * hash and it makes the attestation check against something rather than assert into the air.
 */
export function bodyDigest(body: string): string {
  return createHash("sha256").update(String(body ?? ""), "utf8").digest("hex");
}

/* ── s8: WHAT THE EDITOR NEEDS TO BE STRUCTURED RATHER THAN A BOX ────────────────────────────────────
 *
 * s8 asks for "a structured professional editor, not a free-form graphic canvas", and lists rich text,
 * letterhead, merge fields, protected and editable regions, page and PDF preview, autosave, undo/redo and
 * "clear distinction between system-populated and manually entered content".
 *
 * ⚠ THE BODY STAYS PLAIN TEXT, AND THAT IS A DECISION THIS MODULE UPHOLDS RATHER THAN ONE IT DUCKS.
 * Migration 195 s4 says why, in the column comment: "Plain text, not HTML: this is a clinical record that
 * must be readable in fifty years and diffable today, and a rich-text blob is neither." A rich-text
 * editor here would mean storing markup inside a signed clinical record, and the signature covers the
 * bytes. So the STRUCTURE is everything around the text -- what may be inserted, what it resolves to,
 * what is still unresolved, what the template said the sections were, and what the paper will look like:
 *
 *   MERGE FIELDS, WITH THEIR VALUES FOR THIS PATIENT   the system-populated half, named and resolved
 *   THE MARKERS STILL IN THE TEXT                      the unresolved half, counted and blocking
 *   THE TEMPLATE'S SECTION HEADINGS                    the structure the document was meant to have
 *   THE LETTERHEAD LINES                               the protected region, composed at print time and
 *                                                      NOT editable here, which is what "protected"
 *                                                      means when the alternative is baking a copy of the
 *                                                      practice's address into a signed record
 *
 * ⚠ AUTOSAVE IS REFUSED, DELIBERATELY, AND THE REFUSAL IS OLDER THAN THIS PHASE. DocumentConsole's header
 * has said since CPR-130: "a timer that fires mid-sentence writes half-thoughts into something that will
 * be signed and handed to a patient." s8 asks for it; this product saves on a keystroke you chose. Undo
 * and redo are the textarea's own, within a session, which is what they are everywhere else in this
 * product; version snapshots are the supersession chain, which is stronger than a snapshot because each
 * link is a document in its own right.
 *
 * ⚠ EVERY FIELD BELOW IS A PLAIN VALUE. This payload crosses into a client component, and a FUNCTION on
 * a payload passed to a client component is the bug that killed the Follow-ups board this week: it
 * compiles, it lints, the API is fine, and the page is dead. Walk it: strings, numbers, booleans, arrays
 * of the same. Nothing here is callable and nothing here is a Date.
 */
export type MergeValue = {
  field: string;
  description: string;
  /** What it resolves to FOR THIS DOCUMENT'S PATIENT, right now. Null when the record has no value. */
  value: string | null;
  state: "resolved" | "empty";
};

export type EditorSupport = {
  /** THREE STATES. A merge context that could not be built is not an empty field list. */
  merge: Reading<MergeValue[]>;
  markers: DocMarker[];
  /** s8's protected region: the letterhead, as it will print. Null when the practice configured none. */
  letterheadLines: string[] | null;
  /** The headings the template gave this document, so the structure is visible beside the text. */
  templateSections: { heading: string; prompt: string | null }[];
  /** ⚠ Why this document cannot be signed YET. Empty means the engine will accept a signature. */
  blockers: SignBlocker[];
  attestation: { version: string; statement: string; distinction: string };
};

export async function editorSupport(admin: any, ctx: WorkspaceContext, doc: {
  id: string; patient_id: string; encounter_id: string | null; template_id: string | null;
  body: string; status: string;
}): Promise<EditorSupport> {
  const markers = unresolvedMarkers(doc.body ?? "");

  const [context, head, template] = await Promise.all([
    buildMergeContext(admin, ctx, { patientId: doc.patient_id, encounterId: doc.encounter_id }),
    letterhead(admin, ctx.workspaceId),
    doc.template_id ? getTemplate(admin, ctx.workspaceId, doc.template_id) : Promise.resolve(null),
  ]);

  // ⚠ A NULL CONTEXT IS NOT AN EMPTY LIST OF FIELDS. buildMergeContext returns null when the patient row
  // could not be resolved in this workspace, and drawing thirteen fields all reading "not recorded" would
  // tell a practitioner their patient has no name.
  const merge: Reading<MergeValue[]> = context === null
    ? {
      state: "unreadable",
      detail: "the patient record behind this document could not be read, so no field can be resolved",
    }
    : {
      state: "ok",
      value: MERGE_FIELDS.map(([field, description]) => {
        const raw = context[field];
        const value = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw);
        return { field, description, value, state: value === null ? "empty" as const : "resolved" as const };
      }),
    };

  return {
    merge, markers,
    letterheadLines: head ? head.split("\n") : null,
    templateSections: ((template?.sections ?? []) as any[])
      .map(s => ({ heading: String(s.heading), prompt: s.prompt ? String(s.prompt) : null })),
    blockers: signBlockers({ status: doc.status, body: doc.body ?? "", markers }),
    attestation: {
      version: DOC_ATTESTATION.version,
      statement: DOC_ATTESTATION.statement,
      distinction: DOC_ATTESTATION.distinction,
    },
  };
}

/* ── s7.1 THE DOCUMENT SIGNATURE ─────────────────────────────────────────────────────────────────────
 *
 * ⚠ THE CAPABILITY IS CHECKED HERE, NOT ONLY AT THE ROUTE. s13: "Practice assistant -- upload, classify,
 * prepare drafts and share where delegated; CANNOT SIGN AS PRACTITIONER", and migration 248 gave the
 * assistant document.view and document.author and deliberately withheld document.sign. The route checks
 * it too; this check is the one that survives a future route, a background job or a console caller, and
 * it is the one the harness can put a real assistant context in front of.
 */
export async function signDocument(admin: any, ctx: WorkspaceContext, args: {
  documentId: string;
  /**
   * The version of the wording the caller DISPLAYED. Echoed back so a client showing "doc-1" cannot
   * produce a signature recorded against "doc-2" -- the person attested to what was on their screen.
   */
  attestationVersion: string;
  correlationId: string;
}): Promise<EngineResult<{
  status: string; signedAt: string; bodySha256: string; attestationVersion: string;
  /** ⚠ FALSE MEANS THE DOCUMENT IS SIGNED AND THE ATTESTATION DID NOT REACH THE TRAIL. Say so. */
  attestationRecorded: boolean;
}>> {
  if (!hasCapability(ctx, "document.sign"))
    return {
      ok: false, status: 403, code: "NOT_PERMITTED_TO_SIGN",
      message: "signing a document attests to it as a practitioner, and you do not hold document.sign in this practice",
    };

  const { data: doc, error: readErr } = await admin.from("practice_clinical_document")
    .select("id, patient_id, status, body, version, doc_type, title")
    .eq("id", args.documentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  // ⚠ A FAILED READ IS NOT A MISSING DOCUMENT. Reporting 404 on a timeout tells a practitioner the letter
  // they are looking at does not exist, which is the most alarming way to describe a transient failure.
  if (readErr) return { ok: false, status: 500, code: "READ_FAILED", message: readErr.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (args.attestationVersion !== DOC_ATTESTATION.version)
    return {
      ok: false, status: 409, code: "ATTESTATION_STALE",
      message: "the wording of the signature statement has changed since this page was opened; reload and read it before signing",
    };

  const blockers = signBlockers({
    status: doc.status as string, body: doc.body as string,
    markers: unresolvedMarkers(doc.body as string),
  });
  if (blockers.length > 0)
    return { ok: false, status: 422, code: blockers[0].code, message: blockers[0].message };

  // ⚠ s17 RULE 1, AT THE SIGNATURE AS WELL AS AT THE ISSUE. A signature is an issuance attestation
  // (s7.1's own words), so the same rule applies one step earlier. patient_id is NOT NULL in migration
  // 195 s4, so it can never be absent -- but it CAN point at a patient in another workspace, and a
  // certificate about somebody this practice does not hold a record for is a document about nobody.
  const link = await patientLinkForIssue(admin, ctx.workspaceId, doc.patient_id as string);
  if (!link.ok) return link.failure;

  const bodySha256 = bodyDigest(doc.body as string);

  const moved = await transitionDocument(admin, {
    workspaceId: ctx.workspaceId, documentId: doc.id, to: "SIGNED",
    actorId: ctx.userId, correlationId: args.correlationId,
  });
  if (!moved.ok) return moved;

  // ⚠ THE ATTESTATION IS WRITTEN AFTER THE TRANSITION AND ITS RESULT IS CHECKED. Written before, a failed
  // transition would leave a record of somebody attesting to a document that was never signed. Written
  // after and DISCARDED -- which is what `await audit(...)` on its own does, since audit() returns false
  // rather than throwing -- the document would be signed with no record of what was attested, and the
  // caller would be told everything worked. It is the same discarded-error bug class that has shipped
  // twice on this product. So the boolean is carried all the way back to the screen.
  const attestationRecorded = await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.document_attested",
    payload: {
      documentId: doc.id,
      patientId: doc.patient_id,
      docType: doc.doc_type,
      version: doc.version,
      attestationVersion: DOC_ATTESTATION.version,
      // The statement itself, not a pointer to it. A trail that records "attested under doc-1" and then
      // loses the deploy that defined doc-1 has recorded nothing.
      statement: DOC_ATTESTATION.statement,
      bodySha256,
      // ⚠ NAMED, so nobody reading the trail in two years mistakes this for the consultation's signature.
      act: "document",
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      status: "SIGNED", signedAt: nowIso(), bodySha256,
      attestationVersion: DOC_ATTESTATION.version, attestationRecorded,
    },
  };
}

/* ── s17 RULE 1: A PATIENT-SPECIFIC DOCUMENT CANNOT BE ISSUED WITHOUT A PATIENT LINK ─────────────────
 *
 * ⚠ THIS IS ENFORCED IN THREE PLACES AND THEY ARE NOT REDUNDANT.
 *
 *   THE SCHEMA        practice_clinical_document.patient_id is NOT NULL (migration 195 s4). A raw insert
 *                     with no patient is refused by the database itself. That is the strongest of the
 *                     three and it is somebody else's work.
 *   createDocument()  resolves the patient against the workspace before inserting.
 *   HERE              the link is re-read AT THE MOMENT OF ISSUE, against THIS workspace. The first two
 *                     hold at creation; this one holds at the act that matters. A patient_id can point at
 *                     a row in another practice -- the foreign key is to practice_patient, which is
 *                     global, not to "a patient of mine" -- and it can point at a row that has since been
 *                     deleted. Neither is caught by a NOT NULL constraint, and either one is a certificate
 *                     issued about somebody this practice holds no record for.
 */
async function patientLinkForIssue(admin: any, workspaceId: string, patientId: string | null): Promise<
  { ok: true; displayName: string | null } | { ok: false; failure: EngineResult<never> }
> {
  if (!patientId)
    return {
      ok: false,
      failure: {
        ok: false, status: 422, code: "PATIENT_LINK_MISSING",
        message: "this document is not linked to a patient, and a patient-specific document cannot be issued without one",
      },
    };

  const { data, error } = await admin.from("practice_patient")
    .select("id, display_name").eq("id", patientId).eq("workspace_id", workspaceId).maybeSingle();
  if (error)
    return {
      ok: false,
      failure: { ok: false, status: 500, code: "READ_FAILED", message: error.message },
    };
  if (!data)
    return {
      ok: false,
      failure: {
        ok: false, status: 422, code: "PATIENT_LINK_MISSING",
        message: "the patient this document names is not a patient of this practice, so it cannot be issued from here",
      },
    };
  return { ok: true, displayName: (data.display_name ?? null) as string | null };
}

const CHANNEL_CODES = RELEASE_CHANNELS.map(([c]) => c) as readonly string[];

/**
 * s6.4: record that a copy left the practice.
 *
 * ⚠ document.author, NOT document.sign, AND THAT IS s13 READ EXACTLY. "Practice assistant -- upload,
 * classify, prepare drafts and SHARE WHERE DELEGATED; cannot sign as practitioner." Handing a signed
 * certificate to the patient at the desk is the assistant's job in every practice that has one. What the
 * assistant may not do is put the practitioner's name on it, and that is signDocument()'s gate, not this
 * one. Collapsing the two codes would make the desk unable to do desk work.
 */
export async function issueDocument(admin: any, ctx: WorkspaceContext, args: {
  documentId: string; channel: string; recipient?: string | null; note?: string | null;
  correlationId: string;
}): Promise<EngineResult<{ id: string; channel: string; warnings: string[] }>> {
  if (!hasCapability(ctx, "document.author"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "you do not hold document.author in this practice" };

  if (!CHANNEL_CODES.includes(args.channel))
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `how it was issued must be one of: ${CHANNEL_CODES.join(", ")}`,
    };

  const recipient = args.recipient?.trim() ? args.recipient.trim() : null;
  if (!recipient && (RECIPIENT_REQUIRED_CHANNELS as readonly string[]).includes(args.channel))
    return {
      ok: false, status: 422, code: "RECIPIENT_REQUIRED",
      message: "an emailed copy needs the address it went to -- nothing in this product keeps a sent-items folder to reconstruct it from",
    };

  const { data: doc, error: readErr } = await admin.from("practice_clinical_document")
    .select("id, patient_id, status").eq("id", args.documentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (readErr) return { ok: false, status: 500, code: "READ_FAILED", message: readErr.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // s17: "Only a final rendered version may be shared as an issued document." recordRelease() refuses a
  // non-SIGNED document too; checked here so the reason arrives before the patient-link read runs.
  if (doc.status !== "SIGNED")
    return {
      ok: false, status: 422, code: "NOT_SIGNED",
      message: doc.status === "AMENDED"
        ? "this version has been amended; issue the current version instead"
        : "only a signed document can be issued -- issuing a draft is how somebody ends up holding a letter nobody stood behind",
    };

  const link = await patientLinkForIssue(admin, ctx.workspaceId, doc.patient_id as string);
  if (!link.ok) return link.failure;

  const released = await recordRelease(admin, {
    workspaceId: ctx.workspaceId, documentId: doc.id, channel: args.channel,
    recipient: recipient ?? undefined, note: args.note?.trim() || undefined,
    actorId: ctx.userId, correlationId: args.correlationId,
  });
  if (!released.ok) return released;

  // s6.4's "warns if missing or unverified" -- a warning, on a completed action, not a refusal.
  const warnings: string[] = [];
  if (!recipient)
    warnings.push("No recipient was recorded. The register will show that a copy left, and not to whom.");

  return { ok: true, data: { id: released.data.id, channel: args.channel, warnings } };
}

/* ── s3: SHARED & ISSUED ─────────────────────────────────────────────────────────────────────────────
 *
 * "Documents leaving the practice -- issued, printed, downloaded, emailed or link-shared documents with
 * delivery status."
 *
 * ⚠ THE COLUMN THIS TAB EXISTS FOR IS `outdatedForHolder`. Everything else here could be reconstructed by
 * opening documents one at a time. This one cannot: it is the join between "a copy was released" and
 * "that version has since been amended", and it names the only genuinely dangerous state this product can
 * get into -- somebody outside the practice holding text the practice has replaced. Migration 195's
 * header is explicit that this is why a signed version can never be edited; nothing until now could
 * ANSWER it.
 *
 * ⚠ NO DELIVERY STATUS COLUMN, AND THE PAGE SAYS SO IN ONE LINE. See SHARE_DELIVERY_NOTE.
 */
export type ShareRow = {
  id: string;
  documentId: string;
  title: string;
  docType: string;
  patientId: string | null;
  patientName: string | null;
  channel: string;
  recipient: string | null;
  note: string | null;
  releasedAt: string;
  releasedById: string | null;
  releasedByName: string | null;
  /** The document's status TODAY, derived exactly as the register derives it. */
  documentStatus: DocStatus;
  stored: string;
  outdatedForHolder: boolean;
  href: string;
};

export type AwaitingIssueRow = {
  id: string; title: string; docType: string;
  patientId: string | null; patientName: string | null;
  signedAt: string | null; version: number | null; href: string;
};

export type SharedRegister = {
  /** THREE STATES, and the tab prints the detail when it is the second one. */
  issued: Reading<ShareRow[]>;
  /** Signed documents with no release recorded. The counterpart list, and where the issue action lives. */
  awaiting: Reading<AwaitingIssueRow[]>;
  /** A source that returned exactly its limit. PostgREST caps at 1000; this says so rather than lying. */
  truncated: string[];
  today: string;
  timezone: string;
};

const SHARE_LIMIT = 500;

export async function sharedAndIssued(admin: any, workspaceId: string): Promise<SharedRegister> {
  const { timezone, today } = await workspaceClock(admin, workspaceId);
  const truncated: string[] = [];

  const [releaseRes, docRes] = await Promise.all([
    admin.from("practice_clinical_document_release")
      .select("id, document_id, channel, recipient, note, released_at, released_by")
      .eq("workspace_id", workspaceId).order("released_at", { ascending: false }).limit(SHARE_LIMIT),
    admin.from("practice_clinical_document")
      .select("id, patient_id, doc_type, title, status, version, signed_at")
      .eq("workspace_id", workspaceId).in("status", ["SIGNED", "AMENDED"])
      .order("signed_at", { ascending: false }).limit(SHARE_LIMIT),
  ]);

  // ⚠ EITHER FAILURE POISONS BOTH LISTS, AND BOTH SAY SO SEPARATELY. The releases without the documents
  // are rows with no title; the documents without the releases cannot tell issued from unissued. Reporting
  // "no copies have been issued" off a failed read is the exact sentence this product must never print
  // about documents that left the building.
  if (releaseRes?.error || docRes?.error) {
    const detail = [
      releaseRes?.error ? `the release register: ${releaseRes.error.message}` : null,
      docRes?.error ? `the signed documents: ${docRes.error.message}` : null,
    ].filter(Boolean).join("; ");
    return {
      issued: { state: "unreadable", detail },
      awaiting: { state: "unreadable", detail },
      truncated, today, timezone,
    };
  }

  const releases = (releaseRes?.data ?? []) as any[];
  const docs = (docRes?.data ?? []) as any[];
  if (releases.length === SHARE_LIMIT) truncated.push("issued copies");
  if (docs.length === SHARE_LIMIT) truncated.push("signed documents");

  const docById = new Map(docs.map(d => [d.id as string, d]));

  // A release whose document is not in the list above is a release of a DRAFT or an entered-in-error
  // document -- which recordRelease() refuses, so it can only come from a direct database write. It is
  // fetched rather than dropped: a copy that left the practice is not made less real by being irregular.
  const missingIds = [...new Set(releases.map(r => r.document_id).filter(id => !docById.has(id)))];
  if (missingIds.length > 0) {
    const { data: extra } = await admin.from("practice_clinical_document")
      .select("id, patient_id, doc_type, title, status, version, signed_at")
      .eq("workspace_id", workspaceId).in("id", missingIds);
    for (const d of ((extra ?? []) as any[])) docById.set(d.id as string, d);
  }

  const patientIds = [...new Set(docs.map(d => d.patient_id).filter(Boolean))] as string[];
  let nameOf = new Map<string, string>();
  let namesUnreadable = false;
  if (patientIds.length > 0) {
    const p = await admin.from("practice_patient").select("id, display_name").in("id", patientIds);
    if (p.error) namesUnreadable = true;
    else nameOf = new Map(((p.data ?? []) as any[]).map(x => [x.id, x.display_name]));
  }
  // A name that could not be READ is not "Unknown patient" -- that phrase means the link is broken.
  const nameFor = (id: string | null): string | null =>
    !id ? null : namesUnreadable ? "(name could not be read)" : (nameOf.get(id) ?? "Unknown patient");

  const actorIds = [...new Set(releases.map(r => r.released_by).filter(Boolean))] as string[];
  let actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: people } = await admin.from("profiles").select("id, full_name").in("id", actorIds);
    actorName = new Map(((people ?? []) as any[])
      .filter(p => !!p.full_name).map(p => [p.id as string, p.full_name as string]));
  }

  const releasedCount = new Map<string, number>();
  for (const r of releases) releasedCount.set(r.document_id, (releasedCount.get(r.document_id) ?? 0) + 1);

  const issued: ShareRow[] = releases.map(r => {
    const d = docById.get(r.document_id as string);
    return {
      id: r.id as string,
      documentId: r.document_id as string,
      title: (d?.title ?? "(the document behind this release could not be read)") as string,
      docType: (d?.doc_type ?? "general") as string,
      patientId: (d?.patient_id ?? null) as string | null,
      patientName: nameFor(d?.patient_id ?? null),
      channel: r.channel as string,
      recipient: (r.recipient ?? null) as string | null,
      note: (r.note ?? null) as string | null,
      releasedAt: String(r.released_at),
      releasedById: (r.released_by ?? null) as string | null,
      releasedByName: r.released_by ? (actorName.get(r.released_by) ?? null) : null,
      // ⚠ THE SAME DERIVATION AS THE REGISTER, and it counts releases so a released document reads as
      // `issued` here exactly as it does on the Patient Documents tab. A second status vocabulary on the
      // one tab about copies leaving the practice would be the worst place to have one.
      documentStatus: d ? authoredStatus(d.status as string, releasedCount.get(r.document_id) ?? 0) : "issued",
      stored: (d?.status ?? "UNKNOWN") as string,
      outdatedForHolder: d?.status === "AMENDED",
      href: `/practice/documents/${r.document_id}`,
    };
  });

  const awaiting: AwaitingIssueRow[] = docs
    .filter(d => d.status === "SIGNED" && !releasedCount.has(d.id as string))
    .map(d => ({
      id: d.id as string,
      title: d.title as string,
      docType: d.doc_type as string,
      patientId: (d.patient_id ?? null) as string | null,
      patientName: nameFor(d.patient_id ?? null),
      signedAt: (d.signed_at ?? null) as string | null,
      version: (d.version ?? null) as number | null,
      href: `/practice/documents/${d.id}`,
    }));

  return {
    issued: { state: "ok", value: issued },
    awaiting: { state: "ok", value: awaiting },
    truncated, today, timezone,
  };
}
