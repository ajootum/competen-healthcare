import { audit } from "@/lib/practice/audit";
import { createDocument } from "@/lib/practice/documentation";
import { buildMergeContext, practitionerNameFor } from "@/lib/practice/document-generation";
import { composeReferralLetter, recipientLine, type Recipient, type RecipientKind } from "@/lib/practice/document-compose";
import { resolveSelection, selectableFacts, type SelectableFact } from "@/lib/practice/document-facts";
import { recordReferral } from "@/lib/practice/encounter-workspace";
import type { EngineResult } from "@/lib/practice/encounters";
import type { WorkspaceContext } from "@/lib/practice/access";

// CPR-DOC-AUTO-001 sections 6, 8, 15 and 19 -- THE SHARED DOCUMENT GENERATION ENGINE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE ENGINE, NOT A COLLECTION OF LETTER FORMS. Section 20 in as many words.
//
// The shape every automated document follows is the same and lives here:
//
//   offer facts -> resolve the practitioner's selection -> compose -> store -> record what was disclosed
//
// Only the compose step differs per document type, and it is a pure function in document-compose.ts.
// Adding the visit summary in Phase 2 means adding a composer and a caller, not another pipeline. If a
// future document type needs its own storage, its own lifecycle or its own provenance, that is the
// signal that something has gone wrong -- section 19 forbids a second document repository, and section
// 6 forbids duplicating letterhead and lifecycle per generator.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO NEW DOCUMENT MODEL. Output is an ordinary practice_clinical_document created by the SAME
// createDocument every other document goes through, so signing, versioning, the release register and
// the patient timeline all work without knowing this module exists.
//
// DRAFT ONLY. Nothing here signs or issues (section 10). The document is created in whatever state
// createDocument creates it -- DRAFT -- and a human moves it from there.

/* eslint-disable @typescript-eslint/no-explicit-any */

const RECIPIENT_KINDS: RecipientKind[] = ["clinician", "specialty", "facility", "other"];

export type AdHocRecipient = {
  kind: string; displayName: string;
  specialty?: string | null; facility?: string | null; address?: string | null;
  phone?: string | null; email?: string | null;
  /** Section 16: keep it for next time, so the address is not retyped from memory. */
  saveForReuse?: boolean;
};

export type ReferralLetterArgs = {
  patientId: string;
  /**
   * REQUIRED, and this is a product decision rather than a technical limit. A referral letter is the
   * artifact of a referral, and a referral in this product belongs to a consultation -- recordReferral
   * has always required one. Generating a letter with no encounter would create a referral that no
   * consultation accounts for, and section 15 requires the artifact to link to its originating workflow.
   * A letter written the next morning is written against that morning's consultation.
   */
  encounterId: string;
  /** Use an existing referral (recorded on the Overview tab) instead of creating a second one. */
  referralId?: string | null;
  destinationId?: string | null;
  recipient?: AdHocRecipient | null;
  reason: string;
  requestedAction?: string | null;
  factKeys: string[];
  correlationId: string;
};

type ResolvedRecipient = { recipient: Recipient; destinationId: string | null };

/**
 * Who the letter is to: a saved destination, or typed this once.
 *
 * Exactly one of the two. Accepting both would leave the letter and the referral record disagreeing
 * about the recipient with no rule for which wins.
 */
async function resolveRecipient(admin: any, ctx: WorkspaceContext, args: ReferralLetterArgs, actorId: string):
  Promise<EngineResult<ResolvedRecipient>> {
  const adHocName = (args.recipient?.displayName ?? "").trim();
  if (args.destinationId && adHocName)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "choose a saved destination or type a new one, not both" };

  if (args.destinationId) {
    const { data: dest } = await admin.from("practice_referral_destination")
      .select("id, kind, display_name, specialty, facility, address, active, use_count")
      .eq("id", args.destinationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!dest) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (!dest.active)
      return { ok: false, status: 422, code: "DESTINATION_RETIRED", message: "that destination has been retired -- choose another or type the recipient" };

    // Section 16's "frequently used" ordering. A read-then-write counter: two letters sent in the same
    // second could lose one increment, which changes a sort order and nothing else.
    await admin.from("practice_referral_destination")
      .update({ use_count: (dest.use_count ?? 0) + 1, last_used_on: new Date().toISOString().slice(0, 10), updated_by: actorId })
      .eq("id", dest.id);

    return { ok: true, data: {
      destinationId: dest.id,
      recipient: { kind: dest.kind as RecipientKind, displayName: dest.display_name, specialty: dest.specialty, facility: dest.facility, address: dest.address },
    } };
  }

  if (!adHocName)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "who is the referral to?" };
  const kind = (args.recipient?.kind ?? "other") as RecipientKind;
  if (!RECIPIENT_KINDS.includes(kind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "that is not a kind of destination" };

  const recipient: Recipient = {
    kind, displayName: adHocName,
    specialty: args.recipient?.specialty ?? null,
    facility: args.recipient?.facility ?? null,
    address: args.recipient?.address ?? null,
  };

  let destinationId: string | null = null;
  if (args.recipient?.saveForReuse) {
    // LOOK UP THEN WRITE, rather than upsert. The uniqueness rule is an EXPRESSION index
    // (lower(btrim(display_name))) and PostgREST's on_conflict names columns, so an upsert would either
    // fail or quietly create the duplicate the index exists to prevent. A collision here is a
    // reactivation, which is the behaviour migration 352's comment promises.
    const { data: existing } = await admin.from("practice_referral_destination")
      .select("id").eq("workspace_id", ctx.workspaceId).eq("kind", kind)
      .ilike("display_name", adHocName).limit(1);
    const hit = ((existing ?? []) as any[])[0];
    if (hit) {
      await admin.from("practice_referral_destination").update({
        specialty: recipient.specialty, facility: recipient.facility, address: recipient.address,
        phone: args.recipient?.phone ?? null, email: args.recipient?.email ?? null,
        active: true, updated_by: actorId, updated_at: new Date().toISOString(),
      }).eq("id", hit.id);
      destinationId = hit.id;
    } else {
      const { data: made } = await admin.from("practice_referral_destination").insert({
        workspace_id: ctx.workspaceId, kind, display_name: adHocName,
        specialty: recipient.specialty, facility: recipient.facility, address: recipient.address,
        phone: args.recipient?.phone ?? null, email: args.recipient?.email ?? null,
        created_by: actorId, updated_by: actorId,
      }).select("id").maybeSingle();
      destinationId = made?.id ?? null;
    }
  }

  return { ok: true, data: { recipient, destinationId } };
}

/**
 * Generate a referral letter from selected facts.
 *
 * THE ORDER OF WRITES IS THE FAILURE BEHAVIOUR. Section 17: "Generation failure preserves source record
 * and allows safe retry/manual fallback." The referral -- the clinical fact that a referral was made --
 * is written or resolved FIRST. If composition or document storage then fails, the referral survives and
 * the practitioner can retry the letter or write one by hand. The reverse order would lose the clinical
 * record to a document bug.
 */
export async function generateReferralLetter(admin: any, ctx: WorkspaceContext, args: ReferralLetterArgs):
  Promise<EngineResult<{ documentId: string; referralId: string; disclosed: number }>> {
  const reason = (args.reason ?? "").trim();
  if (!reason) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a referral needs a reason" };

  const offered = await selectableFacts(admin, ctx, { patientId: args.patientId, encounterId: args.encounterId });
  if (!offered) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!offered.encounterId)
    return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that consultation is not this patient's" };

  // ⚠ AN UNRECOGNISED KEY REFUSES THE WHOLE LETTER, and dropping it silently would be the worse bug.
  //
  // A key that is not in the offered set means one of two things: it names a record belonging to
  // somebody else (section 17's patient isolation, which is refused here by simply never having looked
  // it up), or the record moved under the form -- a diagnosis deleted while the letter was being
  // composed. In the second case a practitioner is looking at a checked box for a fact that will not be
  // in the letter. Generating anyway hands them a document that is missing something they believe is in
  // it, and they will sign it. Refusing costs a reload.
  const { selected, unknown } = resolveSelection(offered.groups, args.factKeys ?? []);
  if (unknown.length)
    return { ok: false, status: 409, code: "FACT_SELECTION_STALE",
             message: `${unknown.length} selected item(s) are no longer in this patient's record. Reload and check the selection.` };

  const recipientResult = await resolveRecipient(admin, ctx, args, ctx.userId);
  if (!recipientResult.ok) return recipientResult;
  const { recipient, destinationId } = recipientResult.data;
  const addressedTo = recipientLine(recipient);

  // The referral first. See the header on ordering.
  let referralId: string;
  if (args.referralId) {
    const { data: existing } = await admin.from("practice_referral")
      .select("id, patient_id").eq("id", args.referralId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!existing) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (existing.patient_id !== args.patientId)
      return { ok: false, status: 422, code: "REFERRAL_PATIENT_MISMATCH", message: "that referral belongs to a different patient" };
    referralId = existing.id;
    if (destinationId) await admin.from("practice_referral").update({ destination_id: destinationId, updated_by: ctx.userId }).eq("id", referralId);
  } else {
    const made = await recordReferral(admin, {
      workspaceId: ctx.workspaceId, encounterId: args.encounterId, actorId: ctx.userId,
      correlationId: args.correlationId, referredTo: addressedTo, reason,
      ...(destinationId ? { destinationId } : {}),
    });
    if (!made.ok) return made;
    referralId = made.data.id;
  }

  const merge = await buildMergeContext(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId,
    practitionerName: await practitionerNameFor(admin, ctx.userId),
  });
  if (!merge) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const composed = composeReferralLetter({
    today: merge["today"],
    recipient,
    patient: { name: merge["patient.name"], identifier: merge["patient.identifier"], sex: merge["patient.sex"], age: merge["patient.age"] },
    reason,
    requestedAction: args.requestedAction ?? null,
    facts: selected,
    practitionerName: merge["practitioner.name"],
    practiceName: merge["practice.name"],
  });

  const created = await createDocument(admin, {
    workspaceId: ctx.workspaceId, patientId: args.patientId, encounterId: args.encounterId,
    docType: "referral_letter", title: composed.title, addressedTo, body: composed.body,
    actorId: ctx.userId, correlationId: args.correlationId,
  });
  if (!created.ok) return created;

  await admin.from("practice_clinical_document").update({ referral_id: referralId }).eq("id", created.data.id);

  // PROVENANCE COMES FROM WHAT THE COMPOSER USED, not from what was selected. If a fact were ever
  // selected but had no section to appear in, this table would not claim it was disclosed.
  const byKey = new Map(selected.map(f => [f.key, f] as const));
  const disclosed = composed.usedFactKeys
    .map((key, index) => ({ fact: byKey.get(key)!, index }))
    .filter(e => e.fact)
    .map(({ fact, index }: { fact: SelectableFact; index: number }) => ({
      workspace_id: ctx.workspaceId, document_id: created.data.id, category: fact.category,
      source_table: fact.sourceTable, source_id: fact.sourceId,
      label: fact.label.slice(0, 500), detail: fact.detail ? fact.detail.slice(0, 2000) : null,
      scope: fact.scope, position: index,
    }));
  if (disclosed.length) {
    const { error } = await admin.from("practice_document_fact").insert(disclosed);
    // A document whose disclosure record failed to write is a document nobody can audit. Say so rather
    // than returning a clean success -- the draft exists and is editable, so this is recoverable.
    if (error) return { ok: false, status: 500, code: "PROVENANCE_NOT_RECORDED",
                        message: "the letter was created but what it disclosed could not be recorded. Do not issue it -- report this." };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.document_generated",
    payload: {
      documentId: created.data.id, purpose: "referral_letter", referralId, destinationId,
      disclosed: disclosed.length,
      historicalDisclosed: selected.filter(f => f.scope === "historical").length,
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { documentId: created.data.id, referralId, disclosed: disclosed.length } };
}
