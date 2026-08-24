import { audit } from "@/lib/practice/audit";
import { createDocument } from "@/lib/practice/documentation";
import { buildMergeContext, practitionerNameFor, type MergeContext } from "@/lib/practice/document-generation";
import {
  composeReferralLetter, composeVisitSummary, composePatientInstructions, composeClinicalSummary,
  composeInvestigationRequest, composeFollowUpInstructions, composeMedicationList, recipientLine,
  type ComposedDocument, type Recipient, type RecipientKind,
  sectionsFor,
} from "@/lib/practice/document-compose";
import {
  defaultSelection, resolveSelection, selectableFacts, type FactCategory, type SelectableFact,
} from "@/lib/practice/document-facts";
import { assistantSettings } from "@/lib/practice/ai-assistant";
import { phraseFactSections, type PhrasingResult } from "@/lib/practice/document-phrasing";
import { publishedStyleFor } from "@/lib/practice/document-style-store";
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
  /** CPR-DOC-AUTO-001 s10. Opt-in per request; the default and every failure is deterministic. */
  phrasing?: PhrasingChoice;
  correlationId: string;
};

type ResolvedRecipient = { recipient: Recipient; destinationId: string | null };

/**
 * Who the letter is to: a saved destination, or typed this once.
 *
 * Exactly one of the two. Accepting both would leave the letter and the referral record disagreeing
 * about the recipient with no rule for which wins.
 */
async function resolveRecipient(admin: any, ctx: WorkspaceContext, args: {
  destinationId?: string | null; recipient?: AdHocRecipient | null;
}, actorId: string): Promise<EngineResult<ResolvedRecipient>> {
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
  Promise<EngineResult<{ documentId: string; referralId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const reason = (args.reason ?? "").trim();
  if (!reason) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a referral needs a reason" };

  const prepared = await prepare(admin, ctx, args);
  if (!prepared.ok) return prepared;
  const { selected, merge } = prepared.data;

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

  const phrased = await narrativeFor(admin, ctx, {
    requested: args.phrasing === "assisted", audience: "clinician",
    facts: selected, typed: [reason, args.requestedAction],
  });

  const composed = composeReferralLetter({
    narrative: phrased.narrative,
    today: merge["today"],
    recipient,
    patient: { name: merge["patient.name"], identifier: merge["patient.identifier"], sex: merge["patient.sex"], age: merge["patient.age"] },
    reason,
    requestedAction: args.requestedAction ?? null,
    facts: selected,
    practitionerName: merge["practitioner.name"],
    practiceName: merge["practice.name"],
  });

  const stored = await store(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId, docType: "referral_letter",
    composed, selected, addressedTo, purpose: "referral_letter", phrasing: phrased.phrasing,
    correlationId: args.correlationId, extraAudit: { referralId, destinationId },
  });
  if (!stored.ok) return stored;

  await admin.from("practice_clinical_document").update({ referral_id: referralId }).eq("id", stored.data.documentId);

  return { ok: true, data: {
    documentId: stored.data.documentId, referralId,
    disclosed: stored.data.disclosed, phrasing: stored.data.phrasing,
  } };
}

/**
 * THE SHARED TAIL OF EVERY GENERATED DOCUMENT -- store it, record what it disclosed, say so.
 *
 * Section 6 requires letterhead, lifecycle and storage to be shared rather than duplicated per
 * generator, and section 19 forbids a second document repository. This function is where that is
 * actually true: the referral letter, the visit summary and the patient instructions all end here, so
 * none of them can acquire its own storage, its own provenance rule or its own audit shape by drifting.
 *
 * Adding a document type in a later phase means writing a composer and calling this. If a new type
 * needs something this cannot do, that is a design conversation, not a second copy of these forty lines.
 */
async function store(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId: string | null; docType: string;
  composed: ComposedDocument; selected: SelectableFact[];
  addressedTo?: string; purpose: string; correlationId: string;
  phrasing?: PhrasingChoice;
  extraAudit?: Record<string, unknown>;
}): Promise<EngineResult<{ documentId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const created = await createDocument(admin, {
    workspaceId: ctx.workspaceId, patientId: args.patientId, encounterId: args.encounterId,
    docType: args.docType, title: args.composed.title, addressedTo: args.addressedTo,
    body: args.composed.body, actorId: ctx.userId, correlationId: args.correlationId,
  });
  if (!created.ok) return created;

  // Only written when it is not the default, so a deterministic document needs no second round trip
  // and the column can never disagree with migration 356's default for the rows that predate it.
  // CPR-DOC-CONFIG-001 s8/s11/s15. The structure behind the body, and the style version this document
  // was rendered with. The pin is what stops a later publish repainting a letter somebody has signed.
  const style = await publishedStyleFor(admin, ctx.workspaceId);
  await admin.from("practice_clinical_document").update({
    content_model: args.composed.blocks,
    ...(style ? { style_id: style.id } : {}),
    ...(args.phrasing === "assisted" ? { phrasing: "assisted" } : {}),
  }).eq("id", created.data.id);

  // PROVENANCE COMES FROM WHAT THE COMPOSER USED, not from what was selected. If a fact were ever
  // selected but had no section to appear in, this table would not claim it was disclosed.
  const byKey = new Map(args.selected.map(f => [f.key, f] as const));
  const disclosed = args.composed.usedFactKeys
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
                        message: "the document was created but what it disclosed could not be recorded. Do not issue it -- report this." };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.document_generated",
    payload: {
      documentId: created.data.id, purpose: args.purpose, disclosed: disclosed.length,
      phrasing: args.phrasing ?? "deterministic",
      historicalDisclosed: args.selected.filter(f => f.scope === "historical").length,
      ...(args.extraAudit ?? {}),
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: {
    documentId: created.data.id, disclosed: disclosed.length,
    // WHAT ACTUALLY HAPPENED, not what was asked for. A practitioner who requested prose and received
    // the list is told, rather than left to wonder why the draft looks the same as always.
    phrasing: args.phrasing ?? "deterministic",
  } };
}


export type PhrasingChoice = "deterministic" | "assisted";

/**
 * Ask for AI phrasing, if this practice has agreed to it and the practitioner asked.
 *
 * THE DEFAULT IS DETERMINISTIC AND SO IS EVERY FAILURE. Not requested, not enabled, no provider, the
 * model errored, or the output did not verify -- all five return the same thing: no narrative, so the
 * composer prints the labelled lists it always did. There is no path here that produces unverified
 * prose, and none that turns a phrasing problem into a failed document.
 *
 * The typed strings are passed to the verifier because section 17 counts explicit practitioner input
 * as grounding, alongside selected source data.
 */
async function narrativeFor(admin: any, ctx: WorkspaceContext, opts: {
  requested: boolean;
  audience: "clinician" | "patient";
  facts: SelectableFact[];
  typed: (string | null | undefined)[];
}): Promise<{ narrative: string | null; phrasing: PhrasingChoice; detail: PhrasingResult | null }> {
  if (!opts.requested) return { narrative: null, phrasing: "deterministic", detail: null };

  const settings = await assistantSettings(admin, ctx.workspaceId);
  const result = await phraseFactSections({
    sections: sectionsFor(opts.audience, opts.facts),
    typed: opts.typed.filter(Boolean).map(String),
    // STALE CONSENT IS NOT CONSENT. assistantSettings distinguishes a practice that agreed to the
    // CURRENT disclosure from one that agreed to an older one, and only the first counts.
    enabled: settings.enabled && settings.noticeCurrent,
    canGenerate: settings.configured,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });

  return result.phrasing === "assisted"
    ? { narrative: result.narrative, phrasing: "assisted", detail: result }
    : { narrative: null, phrasing: "deterministic", detail: result };
}

/**
 * THE SHARED HEAD OF EVERY GENERATED DOCUMENT -- offer the record, resolve the selection, read the
 * patient's details.
 *
 * The counterpart to store(). Between the two, a document type is reduced to the only thing that
 * genuinely differs: which composer runs and what it is asked for.
 */
/**
 * ⚠ AN OMITTED SELECTION MEANS SECTION 9'S DEFAULT. AN EMPTY ARRAY MEANS NOTHING.
 *
 * The two are different requests and the distinction is what lets the visit summary be genuinely
 * one-click (section 3's mode A): the caller says nothing about facts and gets this consultation's,
 * without a round trip to ask what the default is and post it straight back.
 *
 * `[]` still means include nothing, so a practitioner who unticks every box gets what they asked for
 * rather than silently having the default reinstated.
 */
async function prepare(admin: any, ctx: WorkspaceContext, args: {
  patientId: string;
  /**
   * Optional from Phase 3 on. The clinical summary is longitudinal (section 3: "Select + summarise"
   * over the record, not over a consultation) and may be written with no consultation open at all.
   */
  encounterId?: string | null;
  factKeys?: string[];
  from?: string | null; to?: string | null;
  /** See CURRENT_STATE_CATEGORIES. A purpose names only its own subject. */
  alsoCurrent?: FactCategory[];
}): Promise<EngineResult<{ selected: SelectableFact[]; merge: MergeContext }>> {
  const offered = await selectableFacts(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId, from: args.from, to: args.to,
  });
  if (!offered) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // ⚠ "NO CONSULTATION ASKED FOR" AND "THAT CONSULTATION IS NOT THIS PATIENT'S" BOTH ARRIVE AS NULL.
  //
  // selectableFacts returns encounterId null in either case, so the check has to compare against what
  // was REQUESTED. Reading only the result would mean a caller who passed somebody else's encounter id
  // got a document generated against no consultation instead of a refusal -- silently degrading a
  // patient-isolation failure into a slightly different document.
  if (args.encounterId && !offered.encounterId)
    return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that consultation is not this patient's" };

  // ⚠ AN UNRECOGNISED KEY REFUSES THE WHOLE DOCUMENT, and dropping it silently would be the worse bug.
  //
  // A key that is not in the offered set means one of two things: it names a record belonging to
  // somebody else (section 17's patient isolation, which is refused here by simply never having looked
  // it up), or the record moved under the form -- a diagnosis deleted while the document was being
  // composed. In the second case a practitioner is looking at a checked box for a fact that will not be
  // in the document. Generating anyway hands them something missing what they believe is in it, and
  // they will sign it. Refusing costs a reload.
  const keys = args.factKeys === undefined
    ? defaultSelection(offered.groups, { alsoCurrent: args.alsoCurrent })
    : args.factKeys;
  const { selected, unknown } = resolveSelection(offered.groups, keys);
  if (unknown.length)
    return { ok: false, status: 409, code: "FACT_SELECTION_STALE",
             message: `${unknown.length} selected item(s) are no longer in this patient's record. Reload and check the selection.` };

  const merge = await buildMergeContext(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId,
    practitionerName: await practitionerNameFor(admin, ctx.userId),
  });
  if (!merge) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  return { ok: true, data: { selected, merge } };
}

const patientOf = (merge: MergeContext) => ({
  name: merge["patient.name"], identifier: merge["patient.identifier"],
  sex: merge["patient.sex"], age: merge["patient.age"],
});

/**
 * A visit summary for the patient.
 *
 * Section 3's mode is "One-click / review" and section 17's PASS condition is "Current encounter
 * generates without manual re-entry" -- so this takes no typed input at all. The caller passes the
 * selection the form was offered, which by section 9's default is this consultation's facts.
 *
 * REFUSES WHEN THERE IS NOTHING TO SUMMARISE. A document consisting of a date and a patient name is
 * not a summary of anything, and issuing one would let a practitioner hand a patient a page implying
 * their visit is accounted for. The refusal names the fix.
 */
export async function generateVisitSummary(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId: string; factKeys?: string[]; phrasing?: PhrasingChoice; correlationId: string;
}): Promise<EngineResult<{ documentId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const prepared = await prepare(admin, ctx, args);
  if (!prepared.ok) return prepared;
  const { selected, merge } = prepared.data;

  if (!selected.length)
    return { ok: false, status: 422, code: "NOTHING_TO_SUMMARISE",
             message: "nothing has been recorded at this consultation yet, so there is nothing to summarise" };

  const phrased = await narrativeFor(admin, ctx, {
    requested: args.phrasing === "assisted", audience: "patient", facts: selected, typed: [],
  });

  const composed = composeVisitSummary({
    narrative: phrased.narrative,
    today: merge["today"], visitDate: merge["encounter.date"], patient: patientOf(merge),
    facts: selected, practitionerName: merge["practitioner.name"], practiceName: merge["practice.name"],
  });

  return store(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId, docType: "consultation_summary",
    composed, selected, purpose: "visit_summary", phrasing: phrased.phrasing,
    correlationId: args.correlationId,
  });
}

/**
 * Patient instructions.
 *
 * Section 3's mode is "Decision + generation" and section 13's required input is "confirm
 * instructions, treatment directions and follow-up" -- the typed instruction and the ticked facts
 * respectively. Either alone is a usable document, which is why the refusal below needs BOTH absent.
 */
export async function generatePatientInstructions(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId: string; instructions?: string | null;
  factKeys: string[]; phrasing?: PhrasingChoice; correlationId: string;
}): Promise<EngineResult<{ documentId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const prepared = await prepare(admin, ctx, args);
  if (!prepared.ok) return prepared;
  const { selected, merge } = prepared.data;

  const instructions = (args.instructions ?? "").trim();
  if (!instructions && !selected.length)
    return { ok: false, status: 422, code: "NOTHING_TO_INSTRUCT",
             message: "write what the patient should do, or include something from the record" };

  const phrased = await narrativeFor(admin, ctx, {
    requested: args.phrasing === "assisted", audience: "patient",
    facts: selected, typed: [instructions],
  });

  const composed = composePatientInstructions({
    narrative: phrased.narrative,
    today: merge["today"], patient: patientOf(merge), instructions: instructions || null,
    facts: selected, practitionerName: merge["practitioner.name"], practiceName: merge["practice.name"],
  });

  return store(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId, docType: "patient_instructions",
    composed, selected, purpose: "patient_instructions", phrasing: phrased.phrasing,
    correlationId: args.correlationId,
  });
}

/**
 * A clinical summary, for a colleague (section 5 priority 4).
 *
 * THE ONLY DOCUMENT HERE THAT DOES NOT REQUIRE A CONSULTATION. Section 3 sources it from the
 * "longitudinal selected record", and a summary requested by an insurer or a new treating clinician is
 * written between appointments, not during one. Where an encounter IS given it is honoured -- that
 * consultation's facts arrive pre-selected as usual.
 */
export async function generateClinicalSummary(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId?: string | null;
  destinationId?: string | null; recipient?: AdHocRecipient | null;
  purpose: string; from?: string | null; to?: string | null;
  factKeys: string[]; phrasing?: PhrasingChoice; correlationId: string;
}): Promise<EngineResult<{ documentId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const purpose = (args.purpose ?? "").trim();
  if (!purpose)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "what is this summary for?" };

  const prepared = await prepare(admin, ctx, args);
  if (!prepared.ok) return prepared;
  const { selected, merge } = prepared.data;

  if (!selected.length)
    return { ok: false, status: 422, code: "NOTHING_SELECTED",
             message: "a summary needs something from the record -- choose what it should cover" };

  const recipientResult = await resolveRecipient(admin, ctx, args, ctx.userId);
  if (!recipientResult.ok) return recipientResult;
  const { recipient } = recipientResult.data;

  const phrased = await narrativeFor(admin, ctx, {
    requested: args.phrasing === "assisted", audience: "clinician",
    facts: selected, typed: [purpose],
  });

  const composed = composeClinicalSummary({
    narrative: phrased.narrative,
    today: merge["today"], patient: patientOf(merge), recipient, purpose,
    periodFrom: args.from ?? null, periodTo: args.to ?? null,
    facts: selected, practitionerName: merge["practitioner.name"], practiceName: merge["practice.name"],
  });

  return store(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId ?? null, docType: "clinical_summary",
    composed, selected, addressedTo: recipientLine(recipient),
    purpose: "clinical_summary", phrasing: phrased.phrasing, correlationId: args.correlationId,
  });
}

/**
 * An investigation request (section 5 priority 5).
 *
 * The investigations are facts already recorded against the consultation -- this document asks for
 * what the practitioner has already decided to order, it does not order anything. Section 6:
 * "Generation must not mutate diagnoses, treatments, procedures, results or other source clinical
 * records", and requesting is a clinical act belonging to the investigation workflow, not to this one.
 */
export async function generateInvestigationRequest(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId: string;
  destinationId?: string | null; recipient?: AdHocRecipient | null;
  clinicalIndication: string; factKeys: string[]; phrasing?: PhrasingChoice; correlationId: string;
}): Promise<EngineResult<{ documentId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const indication = (args.clinicalIndication ?? "").trim();
  if (!indication)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a request needs a clinical indication" };

  const prepared = await prepare(admin, ctx, args);
  if (!prepared.ok) return prepared;
  const { selected, merge } = prepared.data;

  // A request naming no investigation is a letter asking for nothing.
  if (!selected.some(f => f.category === "investigation"))
    return { ok: false, status: 422, code: "NO_INVESTIGATION_SELECTED",
             message: "choose which investigation is being requested -- record it on the consultation first if it is not listed" };

  // The destination is optional here, unlike a referral: a request may be handed to the patient.
  let recipient: Recipient | null = null;
  if (args.destinationId || args.recipient?.displayName?.trim()) {
    const resolved = await resolveRecipient(admin, ctx, args, ctx.userId);
    if (!resolved.ok) return resolved;
    recipient = resolved.data.recipient;
  }

  const phrased = await narrativeFor(admin, ctx, {
    requested: args.phrasing === "assisted", audience: "clinician",
    facts: selected, typed: [indication],
  });

  const composed = composeInvestigationRequest({
    narrative: phrased.narrative,
    today: merge["today"], patient: patientOf(merge), recipient, clinicalIndication: indication,
    facts: selected, practitionerName: merge["practitioner.name"], practiceName: merge["practice.name"],
  });

  return store(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId, docType: "investigation_request",
    composed, selected, ...(recipient ? { addressedTo: recipientLine(recipient) } : {}),
    purpose: "investigation_request", phrasing: phrased.phrasing, correlationId: args.correlationId,
  });
}

/**
 * Follow-up instructions, for the patient (section 5 priority 6).
 *
 * One-click over the follow-up plan. Outstanding follow-ups are the subject, so they default in
 * regardless of which consultation raised them -- see CURRENT_STATE_CATEGORIES. The registry offers
 * only OPEN and SCHEDULED ones, so "every offered follow-up" is "everything still owed".
 */
export async function generateFollowUpInstructions(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId: string; instructions?: string | null;
  factKeys?: string[]; phrasing?: PhrasingChoice; correlationId: string;
}): Promise<EngineResult<{ documentId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const prepared = await prepare(admin, ctx, { ...args, alsoCurrent: ["follow_up"] });
  if (!prepared.ok) return prepared;
  const { selected, merge } = prepared.data;

  if (!selected.some(f => f.category === "follow_up"))
    return { ok: false, status: 422, code: "NO_FOLLOW_UP_OUTSTANDING",
             message: "nothing is outstanding for this patient, so there is nothing to come back for" };

  const phrased = await narrativeFor(admin, ctx, {
    requested: args.phrasing === "assisted", audience: "patient",
    facts: selected, typed: [args.instructions],
  });

  const composed = composeFollowUpInstructions({
    narrative: phrased.narrative,
    today: merge["today"], patient: patientOf(merge),
    instructions: (args.instructions ?? "").trim() || null,
    facts: selected, practitionerName: merge["practitioner.name"], practiceName: merge["practice.name"],
  });

  return store(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId, docType: "follow_up_instructions",
    composed, selected, purpose: "follow_up_instructions", phrasing: phrased.phrasing,
    correlationId: args.correlationId,
  });
}

/**
 * The current medication list, for the patient (section 5 priority 7).
 *
 * THIS IS THE DOCUMENT THAT MADE PHASE 1'S DISCLOSURE RULE UNTENABLE, and the reasoning is recorded on
 * CURRENT_STATE_CATEGORIES rather than repeated here. In short: under the unamended scope rule every
 * line of a medication list defaults off, because a drug started last month is historical.
 *
 * MEDICATION ONLY. The selection is narrowed to the medication category before composing, so a
 * one-click list cannot quietly acquire a diagnosis from a wider default.
 */
export async function generateMedicationList(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId?: string | null; factKeys?: string[]; phrasing?: PhrasingChoice; correlationId: string;
}): Promise<EngineResult<{ documentId: string; disclosed: number; phrasing: PhrasingChoice }>> {
  const prepared = await prepare(admin, ctx, { ...args, alsoCurrent: ["medication"] });
  if (!prepared.ok) return prepared;
  const { merge } = prepared.data;

  const selected = prepared.data.selected.filter(f => f.category === "medication");
  if (!selected.length)
    return { ok: false, status: 422, code: "NO_CURRENT_MEDICATION",
             message: "no current medication is recorded for this patient" };

  const phrased = await narrativeFor(admin, ctx, {
    requested: args.phrasing === "assisted", audience: "patient", facts: selected, typed: [],
  });

  const composed = composeMedicationList({
    narrative: phrased.narrative,
    today: merge["today"], patient: patientOf(merge), facts: selected,
    practitionerName: merge["practitioner.name"], practiceName: merge["practice.name"],
  });

  return store(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId ?? null, docType: "medication_list",
    composed, selected, purpose: "medication_list", phrasing: phrased.phrasing,
    correlationId: args.correlationId,
  });
}
