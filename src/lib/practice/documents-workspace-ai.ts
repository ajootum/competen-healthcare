import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { updateDocument } from "@/lib/practice/documentation";
import { runAssistant, assistantSettings, type GroundingSource } from "@/lib/practice/ai-assistant";
import { bodyDigest } from "@/lib/practice/documents-workspace-issue";
import { AI_DRAFT_TASKS, type AiDraftState } from "@/lib/practice/documents-workspace-constants";
import type { Reading } from "@/lib/practice/documents-workspace";

// CPR-DOC-002 s12, AI-ASSISTED DOCUMENT CREATION -- PHASE 3.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS IS NOT AN ASSISTANT. IT IS A BRIDGE, AND A LABEL.
//
// CPR-210 built the assistant, and it already performs four of s12's six capabilities. Everything that
// makes it safe is ALREADY THERE and NONE OF IT IS REBUILT HERE:
//
//   the consent gate            assistantSettings + setAssistantEnabled, versioned disclosure, and stale
//                               consent treated as no consent
//   no ungrounded mode          buildContext returns null with no record, and runAssistant refuses
//   the disclosure log          logAccess(action: "export") -- record content leaving this system is
//                               recorded as a disclosure and not as an ordinary view
//   the safety prompt           "reorganise what is in the RECORD. Never introduce a clinical fact"
//   the refusals, in the UI     REFUSED: no confidence score, no citations, no differential, no
//                               interactions, no guidelines
//   the conversation record     practice_ai_session + practice_ai_message, with the real model id
//
// ⚠ WHAT WAS MISSING WAS s12's LAST RULE, AND IT WAS MISSING COMPLETELY. "Label AI-generated content
// until the practitioner reviews it." Until now the assistant's answer sat in practice_ai_message and
// the practitioner copied it into a document BY HAND -- and at the moment of pasting, nothing anywhere
// recorded that those words came from a model. A letter a clinician wrote and a letter a model wrote
// were the same bytes in the same column with the same history, and no query could ever tell them apart.
//
// So this module does two things and nothing else:
//
//   1. draftIntoDocument()  runs one of CPR-210's own tasks and writes its answer into a DRAFT document
//                           through documentation.ts's own updateDocument(), recording the act.
//   2. aiAttribution()      answers, for any document, whether a machine wrote its text and whether a
//                           person has touched it since.
//
// ⚠ NO MIGRATION, AND THE ATTRIBUTION IS NOT A COLUMN. It is derived from two facts that already exist:
// an audit event, and the SHA-256 of the body. The event records what the body was left as; the digest
// of the body TODAY either matches it or does not. Adding a boolean column would have been weaker, not
// stronger -- a flag can be set by anything, whereas a digest that no longer matches is proof somebody
// edited the text, and one that still matches is proof nobody has.
//
// ⚠ THE DEPENDENCY RUNS ONE WAY ONLY: this module imports bodyDigest from documents-workspace-issue.ts,
// and that module imports NOTHING from here. It is tempting to have signDocument() stamp the signature
// with "this text began as machine output", and it would be a circular import. It is also unnecessary:
// the audit trail holds practice.document_ai_drafted and practice.document_attested against the same
// documentId, so "was the signed text machine-drafted" stays answerable by reading the trail -- which is
// where every other question of this kind about this product is answered. What the signer sees at the
// moment of signing is the banner this module's reader produces, rendered beside the sign panel.
//
// ⚠ AND THE BOUNDARY, WHICH IS THE WHOLE SAFETY POSITION: A MACHINE MAY AUTHOR. IT MAY NOT SIGN.
// draftIntoDocument requires document.author -- migration 248's line, which gave the practice assistant
// document.author and deliberately withheld document.sign -- and refuses any document that is not a
// DRAFT. It cannot mark a document ready, it cannot sign one, and it cannot issue one. The three verbs
// after "draft" all belong to a person, and there is no code path here that reaches any of them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const DRAFT_TASK_KEYS = AI_DRAFT_TASKS.map(t => t.key);

/** The separator an appended draft goes under, so the join is visible in the text itself. */
const APPEND_SEPARATOR = "\n\n";

/* ── THE LABEL (s12) ─────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ THREE STATES, PLUS UNREADABLE, AND THEY ARE FOUR DIFFERENT SENTENCES.
 *
 *   none              nobody asked a machine to draft this. NO BANNER IS DRAWN. The absence of a claim
 *                     is the correct rendering of the absence of an event -- a banner reading "no AI was
 *                     used" on every hand-written letter in the practice would be noise that trains
 *                     people to stop reading the one that matters.
 *   machine_unedited  a machine wrote it and the body is BYTE-IDENTICAL to what it left. Nobody has so
 *                     much as fixed a comma. This is the state s12's rule exists for.
 *   machine_edited    a machine wrote it and a person has changed it since. How much survives is not
 *                     tracked and the label does not pretend otherwise.
 *   unreadable        the trail could not be read. ⚠ THIS MUST NOT RENDER AS `none`. "No machine wrote
 *                     this" and "we could not find out whether a machine wrote this" are opposite
 *                     advice to somebody about to put their name on it, and the failure to distinguish
 *                     them is the exact bug class this product keeps finding.
 */
export type AiAttribution = {
  state: AiDraftState;
  /** The task the machine was asked to perform, in its own words. Null when state is none. */
  task: string | null;
  taskLabel: string | null;
  /** The model id the provider reported, never a product name. Null when it was not recorded. */
  model: string | null;
  at: string | null;
  /** Who pressed the button. A machine drafts; a person asks it to. */
  actorId: string | null;
  /**
   * ⚠ FALSE MEANS THE DRAFT LANDED AND THE RECORD OF IT DID NOT. Carried all the way to the screen, for
   * the same reason Phase 2 carries attestationRecorded: silently discarding the boolean would leave a
   * document full of machine text with nothing anywhere saying so.
   */
  attributionComplete: boolean;
};

export async function aiAttribution(
  admin: any, workspaceId: string, documentId: string, body: string,
): Promise<Reading<AiAttribution>> {
  const { data, error } = await admin.from("practice_audit_event")
    .select("actor_id, payload, occurred_at")
    .eq("workspace_id", workspaceId).eq("event_type", "practice.document_ai_drafted")
    .order("occurred_at", { ascending: false }).limit(200);
  if (error) return { state: "unreadable", detail: String(error.message) };

  // ⚠ FILTERED IN TYPESCRIPT, NOT IN THE QUERY. The document id lives inside a jsonb payload, and a
  // PostgREST filter on a json path that does not match the stored shape returns ZERO ROWS WITH NO
  // ERROR -- which would read as "no machine drafted this document", the precise false negative this
  // whole reader exists to prevent. Two hundred rows of the practice's own trail is a cheap read.
  const events = ((data ?? []) as any[])
    .filter(e => (e.payload ?? {}).documentId === documentId);
  if (events.length === 0)
    return {
      state: "ok",
      value: { state: "none", task: null, taskLabel: null, model: null, at: null, actorId: null, attributionComplete: true },
    };

  const latest = events[0];
  const p = (latest.payload ?? {}) as Record<string, unknown>;
  const recorded = typeof p.bodySha256After === "string" ? p.bodySha256After : null;
  const current = bodyDigest(body ?? "");

  return {
    state: "ok",
    value: {
      // ⚠ A MISSING DIGEST READS AS EDITED, NOT AS UNEDITED. If the trail cannot prove the text is still
      // exactly what the machine produced, the safer of the two claims is the one that does not tell a
      // reader "nothing here has been checked by a person" about text a person may well have rewritten.
      state: recorded !== null && recorded === current ? "machine_unedited" : "machine_edited",
      task: (p.task ?? null) as string | null,
      taskLabel: AI_DRAFT_TASKS.find(t => t.key === p.task)?.label ?? null,
      model: (p.model ?? null) as string | null,
      at: String(latest.occurred_at),
      actorId: (latest.actor_id ?? null) as string | null,
      attributionComplete: recorded !== null,
    },
  };
}

/* ── THE BRIDGE (s12) ────────────────────────────────────────────────────────────────────────────────
 *
 * "Generate a draft referral letter from selected encounter and follow-up information. Summarise
 * selected longitudinal events into a proposed consultation or transfer summary. Rewrite content for
 * clarity, brevity or patient-friendly language."
 */
export type DraftResult = {
  task: string;
  mode: "replace" | "append";
  model: string | null;
  provider: string | null;
  sessionId: string;
  messageId: string;
  grounding: GroundingSource[];
  recordVersion: number;
  /** The SHA-256 of what the machine produced, and of the body it was left as. */
  machineSha256: string;
  bodySha256After: string;
  /** ⚠ FALSE MEANS THE TEXT IS IN THE DOCUMENT AND THE RECORD OF WHERE IT CAME FROM IS NOT. */
  attributionRecorded: boolean;
};

export async function draftIntoDocument(admin: any, ctx: WorkspaceContext, args: {
  documentId: string; task: string; mode?: "replace" | "append"; correlationId: string;
}): Promise<EngineResult<DraftResult>> {
  // 1. THE CAPABILITY. Migration 248's boundary: an assistant may author. It may not sign.
  if (!hasCapability(ctx, "document.author"))
    return {
      ok: false, status: 403, code: "FORBIDDEN",
      message: "you do not hold document.author in this practice, so nothing may write into this document -- machine or otherwise",
    };

  if (!DRAFT_TASK_KEYS.includes(args.task))
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `the draft task must be one of: ${DRAFT_TASK_KEYS.join(", ")}`,
    };
  const mode = args.mode === "append" ? "append" : "replace";

  // 2. THE CONSENT GATE, BEFORE ANY RECORD IS READ.
  //
  // ⚠ THE POSITION OF THIS CHECK IS THE POINT, NOT ITS EXISTENCE. runAssistant checks the same setting;
  // placed after the document read this would be a redundant line that changes no outcome, which is
  // exactly the shape a harness passes over. It is CPR-210's own doctrine -- "the consent gate comes
  // first, before any record is read and certainly before anything leaves this system" -- and putting it
  // above the read is what makes it true here as well: a practice that has not agreed to disclose record
  // content does not have a document read on its behalf in order to be told so.
  //
  // The observable consequence, and what the harness asserts: with the assistant off, asking for a draft
  // of a document THAT DOES NOT EXIST answers AI_NOT_ENABLED rather than Not found.
  const settings = await assistantSettings(admin, ctx.workspaceId);
  if (!settings.enabled)
    return {
      ok: false, status: 403, code: "AI_NOT_ENABLED",
      message: "the assistant is off for this practice -- somebody with settings access has to turn it on, and doing so discloses record content to a third-party provider",
    };

  const { data: doc, error: readErr } = await admin.from("practice_clinical_document")
    .select("id, patient_id, encounter_id, status, body, record_version, title")
    .eq("id", args.documentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (readErr) return { ok: false, status: 500, code: "READ_FAILED", message: readErr.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // 3. DRAFT ONLY, AND FINAL IS REFUSED AS FIRMLY AS SIGNED.
  //
  // ⚠ THE OBVIOUS RULE IS "not signed", AND IT IS THE WRONG RULE. updateDocument() already refuses a
  // SIGNED or AMENDED document -- migration 195's trigger refuses it one layer deeper still -- so a
  // "not signed" check here would be a check that never fires and would leave FINAL open. FINAL means a
  // person has read the whole thing and accepted its content; it is the ONE status signBlockers() will
  // take a signature from. Machine text arriving into a document somebody has already accepted would
  // move the words out from under the acceptance, and the next act on that document is the signature.
  if (doc.status !== "DRAFT")
    return {
      ok: false, status: 422, code: "NOT_A_DRAFT",
      message: doc.status === "FINAL"
        ? "this document has been marked ready, which means somebody accepted its content -- reopen it as a draft before letting the assistant write into it"
        : "only a draft can be drafted into; this document is signed or closed, and a correction is an amendment",
    };

  // 4. SOMETHING TO GROUND IT IN.
  //
  // ⚠ CHECKED HERE AS WELL AS INSIDE runAssistant, AND THE DUPLICATE EARNS ITS PLACE BY WHAT IT SAYS.
  // runAssistant would refuse with NOTHING_TO_GROUND_IN, which is true and useless: it names a general
  // condition of the assistant rather than the fact about THIS document that the reader can fix. Every
  // one of s12's four tasks is grounded on a CONSULTATION; a document not linked to one has nothing for
  // a model to reorganise, and a model with nothing to reorganise invents.
  if (!doc.encounter_id)
    return {
      ok: false, status: 422, code: "NO_ENCOUNTER",
      message: "this document is not linked to a consultation, and the assistant only ever rewrites what a consultation already records -- with nothing to work from it would be composing rather than drafting",
    };

  // 5. CPR-210's OWN ENGINE. The consent gate, the disclosure version, the grounding, the access log,
  //    the system prompt, the conversation record and the audit entry are all its, not this module's.
  const answer = await runAssistant(admin, ctx, {
    task: args.task as any,
    encounterId: doc.encounter_id as string,
    correlationId: args.correlationId,
  });
  if (!answer.ok) return answer;

  const machineText = String(answer.data.answer ?? "").trim();
  // ⚠ AN EMPTY ANSWER IS NOT A SUCCESSFUL DRAFT. Written through, `replace` would blank the document and
  // the audit would record that a machine had drafted nothing into it.
  if (!machineText)
    return {
      ok: false, status: 502, code: "EMPTY_DRAFT",
      message: "the assistant returned nothing, so nothing was written into the document",
    };

  const existing = String(doc.body ?? "");
  const nextBody = mode === "append" && existing.trim()
    ? `${existing.replace(/\s+$/, "")}${APPEND_SEPARATOR}${machineText}`
    : machineText;

  // 6. THE WRITE, THROUGH documentation.ts, WITH ITS ERROR CHECKED.
  //
  // ⚠ NOT A DIRECT UPDATE. updateDocument() carries the locked-status refusal, the optimistic record
  // version (so two people drafting at once produce a 409 rather than one silently losing), and the
  // practice.document_updated audit entry. A raw `.update({ body })` here would skip all three, and the
  // third is the one that makes the trail read as though the text appeared by itself.
  const written = await updateDocument(admin, {
    workspaceId: ctx.workspaceId, documentId: doc.id, body: nextBody,
    recordVersion: doc.record_version as number,
    actorId: ctx.userId, correlationId: args.correlationId,
  });
  if (!written.ok) return written;

  const machineSha256 = bodyDigest(machineText);
  const bodySha256After = bodyDigest(nextBody);

  // 7. THE ATTRIBUTION, WRITTEN AFTER THE BODY AND WITH ITS RESULT CHECKED.
  //
  // ⚠ THE ORDER IS DELIBERATE AND SO IS THE BOOLEAN. Written BEFORE the update, a failed write would
  // leave a permanent record of a machine drafting a document it never touched. Written after and
  // DISCARDED -- which is what a bare `await audit(...)` does, since audit() returns false rather than
  // throwing -- the document would be full of machine text with nothing anywhere saying so, and the
  // caller would be told everything worked. That is the discarded-error class this product has shipped
  // twice. So the boolean travels back to the screen, and the screen says it.
  const attributionRecorded = await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.document_ai_drafted",
    payload: {
      documentId: doc.id,
      task: args.task,
      mode,
      model: answer.data.model,
      provider: answer.data.provider,
      sessionId: answer.data.sessionId,
      messageId: answer.data.messageId,
      // ⚠ THE DIGESTS, NOT THE TEXT. The trail is readable by anybody holding access.review and the
      // draft of a referral letter is clinical content. The digest is what makes "is this still exactly
      // what the machine wrote" answerable without putting the letter in the audit log.
      machineSha256,
      bodySha256After,
      // Named, so nobody reading the trail in two years mistakes this for a person having written it.
      act: "machine_draft",
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      task: args.task, mode,
      model: answer.data.model, provider: answer.data.provider,
      sessionId: answer.data.sessionId, messageId: answer.data.messageId,
      grounding: answer.data.grounding,
      recordVersion: written.data.recordVersion,
      machineSha256, bodySha256After,
      attributionRecorded,
    },
  };
}

/**
 * What the drafting panel may offer, decided on the server.
 *
 * ⚠ EVERY REASON IT CANNOT RUN IS A SENTENCE, AND THE PANEL DRAWS NO CONTROL WHEN THERE IS ONE. s18
 * forbids "not built" messages; this is not one. "This document is not linked to a consultation" is a
 * fact about the document in front of the reader, and it is the only thing that would let them fix it.
 */
export type DraftAvailability = {
  available: boolean;
  /** Null when available. Otherwise the one thing standing in the way, in the reader's terms. */
  blocker: string | null;
  /** ⚠ True only when the practice turned it on AND a provider is configured for this deployment. */
  enabled: boolean;
  provider: string | null;
  model: string | null;
};

export async function draftAvailability(
  admin: any, ctx: WorkspaceContext, doc: { status: string; encounter_id: string | null },
): Promise<DraftAvailability> {
  const settings = await assistantSettings(admin, ctx.workspaceId);
  const enabled = settings.enabled && settings.noticeCurrent && settings.configured;
  const mayAuthor = hasCapability(ctx, "document.author");

  // ⚠ ONLY TWO SITUATIONS PRODUCE A SENTENCE, AND BOTH ARE FACTS THE READER CAN ACT ON. Everything else
  // -- a document that is not a draft, a caller without document.author, a deployment with no model
  // provider -- draws NOTHING AT ALL. "No model provider is configured for this deployment" is an
  // implementation note about a server, which is exactly what s18 forbids putting in front of a user,
  // and a greyed-out panel explaining a capability somebody does not hold is a dead control with a
  // caption. Not drawing it satisfies both rules at once.
  let blocker: string | null = null;
  if (mayAuthor && doc.status === "DRAFT") {
    if (!doc.encounter_id)
      blocker = "This document is not linked to a consultation. The assistant only rewrites what a consultation already records, so there is nothing here for it to work from.";
    else if (settings.configured && !settings.enabled)
      blocker = "The assistant is off for this practice. Somebody with settings access can turn it on; doing so discloses record content to a third-party provider.";
    else if (settings.configured && !settings.noticeCurrent)
      blocker = "What the assistant discloses has changed since this practice agreed to it, so it needs agreeing to again.";
  }

  return {
    available: mayAuthor && doc.status === "DRAFT" && !!doc.encounter_id && enabled,
    blocker,
    enabled,
    provider: settings.provider ?? null,
    model: settings.model ?? null,
  };
}
