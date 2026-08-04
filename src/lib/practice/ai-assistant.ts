import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { getEncounter, patientTimeline } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { logAccess } from "@/lib/practice/privacy";

// CPR-210 AI CLINICAL ASSISTANT.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ASSISTANT MAY REORGANISE WHAT IS ALREADY IN THE RECORD. IT MAY NOT ORIGINATE CLINICAL FACTS.
//
// Summarising a consultation the practitioner wrote, drafting a referral from it, putting the plan into
// plain language for the patient -- all of those rearrange text a clinician already committed to.
// Suggesting a diagnosis, a drug, a dose, a guideline or an interaction ORIGINATES a clinical fact, and
// this product has nothing to ground one in. Every task below is on the first side of that line, and the
// system prompt says so to the model as well.
//
// THERE IS NO UNGROUNDED MODE. Every task, including the free-text one, requires a consultation or a
// patient to work from. An assistant with no record in front of it can only invent, so the engine
// refuses rather than answering from the model's own memory.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NOTHING HERE WRITES TO THE CLINICAL RECORD. A response lands in practice_ai_message and nowhere else.
// The specification's rule -- "AI never finalises clinical documentation autonomously" -- holds because
// there is no mechanism, not because a flag is unset. The practitioner copies what they want into a note
// they then sign, which is the existing CPR-130 path and already audited.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type GroundingSource = { kind: string; id: string; label: string; href?: string };

export const ASSISTANT_TASKS = [
  {
    key: "summarise_encounter", label: "Summarise this consultation",
    needs: "encounter" as const,
    blurb: "Turns the notes you already wrote into a short summary.",
  },
  {
    key: "summarise_history", label: "Summarise this patient's history",
    needs: "patient" as const,
    blurb: "Reads their past consultations here and gives you the shape of them.",
  },
  {
    key: "draft_referral", label: "Draft a referral letter",
    needs: "encounter" as const,
    blurb: "A first draft from this consultation, for you to correct and sign.",
  },
  {
    key: "patient_instructions", label: "Put the plan in plain language",
    needs: "encounter" as const,
    blurb: "Rewrites the plan you recorded so the patient can read it.",
  },
  {
    key: "tidy_note", label: "Tidy up my note",
    needs: "encounter" as const,
    blurb: "Expands your shorthand into sentences. Adds nothing.",
  },
  {
    key: "ask", label: "Ask about this record",
    needs: "encounter" as const,
    blurb: "A question about what is in front of you -- not a question about medicine.",
  },
] as const;

export type TaskKey = (typeof ASSISTANT_TASKS)[number]["key"];

/**
 * What the design asks for and this will not do, each with the reason.
 *
 * RENDERED ON THE PAGE, not buried here. A practitioner deciding how far to trust an assistant is
 * better served by a list of what it refuses than by a badge saying it is compliant.
 */
export const REFUSED = [
  {
    key: "confidence",
    label: "A confidence score",
    reason: "The design prints \"Confidence: High -- 92%\" with a green bar. A model's report of its own certainty is not a measurement, it is another generated sentence. A green bar beside a drug dose invites you to trust it, which is the opposite of what a safety indicator should do.",
  },
  {
    key: "citations",
    label: "Citations to guidelines and literature",
    reason: "The design cites NICE NG59, ClinicalKey and the WHO primary care guidelines. This product holds none of them, so any such citation would be the model recalling a title -- checkable-looking and unverifiable, which is worse than no citation. Sources here are records in your own practice, and every one is a link you can open.",
  },
  {
    key: "differential",
    label: "Differential diagnosis",
    reason: "That originates a clinical fact rather than reorganising one you recorded. Nothing here could ground it.",
  },
  {
    key: "interactions",
    label: "Drug and interaction checking",
    reason: "This needs a maintained drug database. There is not one in this product, and a model listing interactions from memory is the exact failure a checker exists to prevent.",
  },
  {
    key: "guidelines",
    label: "Guideline recommendations",
    reason: "Same reason as citations: it would be recalled, not retrieved.",
  },
  {
    key: "learning",
    label: "\"Continuously learning from your practice\"",
    reason: "Nothing here trains a model on your records. Your practice's data is sent to answer one question and is not used to improve anything afterwards.",
  },
  {
    key: "compliance",
    label: "A compliance badge",
    reason: "The design carries one. A badge is a claim about an audit nobody has performed.",
  },
] as const;

// The version of the disclosure a practitioner agrees to when switching this on. Bumping it is how a
// changed disclosure gets re-consented rather than silently inherited.
export const AI_NOTICE_VERSION = "practice-ai-1";

export const AI_NOTICE = [
  "Using the assistant sends the content of the record you have open -- including patient details and clinical notes -- to a third-party model provider outside this system.",
  "It is not used to train anything. It answers your question and the exchange is kept here so the practice can see what was asked and what came back.",
  "The assistant can be wrong, including confidently wrong. Nothing it produces is saved to a patient record unless you copy it in yourself and sign it.",
];

// ── THE CONSENT GATE ─────────────────────────────────────────────────────────────────────────────────

export async function assistantSettings(admin: any, workspaceId: string) {
  // is_effective, ALWAYS. practice_configuration is versioned (migration 191): superseded rows stay,
  // and only a partial unique index keeps ONE row effective. Without this filter maybeSingle() errors
  // the first time a practice edits its configuration -- and the consent gate would fail open or shut
  // depending on which row came back first.
  const { data } = await admin.from("practice_configuration")
    .select("ai_assistant_enabled, ai_assistant_enabled_by, ai_assistant_enabled_at, ai_assistant_notice_version")
    .eq("workspace_id", workspaceId).eq("is_effective", true).maybeSingle();
  const status = aiStatus();
  return {
    enabled: !!data?.ai_assistant_enabled,
    enabledBy: data?.ai_assistant_enabled_by ?? null,
    enabledAt: data?.ai_assistant_enabled_at ?? null,
    noticeVersion: data?.ai_assistant_notice_version ?? null,
    // STALE CONSENT IS NOT CONSENT. If the disclosure has changed since somebody agreed to it, the
    // practice is treated as not having agreed to the current one.
    noticeCurrent: data?.ai_assistant_notice_version === AI_NOTICE_VERSION,
    // WHETHER A PROVIDER IS EVEN CONFIGURED, said plainly rather than shown as a green "Online" dot.
    configured: status.configured,
    provider: status.provider,
    // The real model, not a product name. The comp says "Competen Clinical LLM v2.1"; there is no such
    // model and no bespoke clinical model anywhere in this product.
    model: status.models?.reasoning ?? null,
    notice: AI_NOTICE,
    noticeVersionCurrent: AI_NOTICE_VERSION,
  };
}

export async function setAssistantEnabled(admin: any, ctx: WorkspaceContext, args: {
  enabled: boolean; acknowledgedNoticeVersion?: string; correlationId: string;
}): Promise<EngineResult<{ enabled: boolean }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "turning this on is a practice setting" };

  // TURNING IT ON REQUIRES ACKNOWLEDGING THE CURRENT DISCLOSURE. Enabling a disclosure of patient data
  // by passing a boolean, without the person having been shown what they are agreeing to, would make the
  // consent record a decoration.
  if (args.enabled && args.acknowledgedNoticeVersion !== AI_NOTICE_VERSION)
    return {
      ok: false, status: 400, code: "NOTICE_NOT_ACKNOWLEDGED",
      message: `the current disclosure (${AI_NOTICE_VERSION}) has to be acknowledged to switch this on`,
    };

  // THE EFFECTIVE ROW ONLY. Updating every version would rewrite the practice's own history, so a
  // superseded configuration would start claiming a consent that was given later.
  const { data: updated, error } = await admin.from("practice_configuration").update({
    ai_assistant_enabled: args.enabled,
    ai_assistant_enabled_by: args.enabled ? ctx.userId : null,
    ai_assistant_enabled_at: args.enabled ? new Date().toISOString() : null,
    ai_assistant_notice_version: args.enabled ? AI_NOTICE_VERSION : null,
  }).eq("workspace_id", ctx.workspaceId).eq("is_effective", true).select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  // AN UPDATE THAT MATCHED NOTHING IS NOT A SUCCESS. PostgREST reports no error for a filter that hits
  // zero rows, so without this the practice would be told the assistant was on while the flag stayed
  // off -- the silent-write class recorded against migrations 167 and 186.
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NO_EFFECTIVE_CONFIGURATION", message: "this practice has no effective configuration row to write to" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId,
    eventType: args.enabled ? "practice.ai_enabled" : "practice.ai_disabled",
    payload: { noticeVersion: args.enabled ? AI_NOTICE_VERSION : null }, correlationId: args.correlationId,
  });
  return { ok: true, data: { enabled: args.enabled } };
}

// ── GROUNDING ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the record content the answer must be built from, and the list of sources that content came
 * from.
 *
 * THE SOURCE LIST IS THE EXPLAINABILITY FEATURE. The comp has an "Explain" button beside a rationale the
 * model writes about itself, which is just more generated text. What actually explains an answer is the
 * input: every source below is a row in this practice that the reader can open.
 */
async function buildContext(admin: any, ctx: WorkspaceContext, args: {
  task: TaskKey; encounterId?: string | null; patientId?: string | null;
}): Promise<{ text: string; grounding: GroundingSource[]; patientId: string | null } | null> {
  const lines: string[] = [];
  const grounding: GroundingSource[] = [];

  if (args.encounterId) {
    const e = await getEncounter(admin, ctx.workspaceId, args.encounterId);
    if (!e) return null;

    lines.push(`CONSULTATION on ${String(e.encounter.started_at).slice(0, 10)}, status ${e.encounter.status}.`);
    if (e.encounter.reason_for_visit) lines.push(`Reason given: ${e.encounter.reason_for_visit}`);
    if (e.patient) {
      const age = e.patient.birth_date
        ? Math.floor((Date.now() - Date.parse(e.patient.birth_date)) / (365.25 * 86400000))
        : e.patient.age_estimate_years;
      lines.push(`PATIENT: ${e.patient.display_name}${age != null ? `, ${age}` : ""}, ${e.patient.sex}.`);
      grounding.push({ kind: "patient", id: e.patient.id, label: e.patient.display_name, href: `/practice/patients/${e.patient.id}` });
    }
    grounding.push({
      kind: "encounter", id: e.encounter.id,
      label: `Consultation ${String(e.encounter.started_at).slice(0, 10)}`,
      href: `/practice/encounters/${e.encounter.id}`,
    });

    for (const n of e.notes as any[]) {
      lines.push(`NOTE (${n.note_type}):\n${n.body}`);
      grounding.push({ kind: "note", id: n.id, label: `${n.note_type} note`, href: `/practice/encounters/${e.encounter.id}` });
    }
    for (const d of e.diagnoses as any[]) {
      lines.push(`DIAGNOSIS RECORDED: ${d.label} (${d.certainty}${d.is_primary ? ", primary" : ""})`);
      grounding.push({ kind: "diagnosis", id: d.id, label: d.label });
    }
    for (const t of e.treatments as any[]) {
      lines.push(`TREATMENT RECORDED: ${t.label}${t.dose ? ` ${t.dose}` : ""}${t.route ? ` ${t.route}` : ""}${t.frequency ? ` ${t.frequency}` : ""}${t.duration ? ` for ${t.duration}` : ""} (${t.status})`);
      grounding.push({ kind: "treatment", id: t.id, label: t.label });
    }
    return { text: lines.join("\n\n"), grounding, patientId: e.encounter.patient_id };
  }

  if (args.patientId) {
    const { data: patient } = await admin.from("practice_patient")
      .select("id, display_name, sex, birth_date, age_estimate_years")
      .eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!patient) return null;

    lines.push(`PATIENT: ${patient.display_name}, ${patient.sex}.`);
    grounding.push({ kind: "patient", id: patient.id, label: patient.display_name, href: `/practice/patients/${patient.id}` });

    const timeline = await patientTimeline(admin, ctx.workspaceId, patient.id, 30);
    for (const e of timeline.encounters as any[]) {
      const dx = (timeline.diagnosesByEncounter[e.id] ?? []).map((d: any) => d.label).join(", ");
      lines.push(`${String(e.started_at).slice(0, 10)} -- ${e.reason_for_visit ?? "no reason recorded"}${dx ? ` -- ${dx}` : ""} (${e.status})`);
      grounding.push({
        kind: "encounter", id: e.id, label: `Consultation ${String(e.started_at).slice(0, 10)}`,
        href: `/practice/encounters/${e.id}`,
      });
    }
    if (timeline.encounters.length === 0) lines.push("No previous consultations recorded here.");
    return { text: lines.join("\n"), grounding, patientId: patient.id };
  }

  return null;
}

/**
 * The system prompt.
 *
 * THIS IS THE SAFETY MECHANISM THAT CANNOT BE PROVEN BY A TEST, and it is written accordingly. A harness
 * can assert that it CONTAINS these constraints and that nothing reaches the record; it cannot assert
 * that a model obeyed them. That limit is stated on the page rather than hidden, because a practitioner
 * needs to know it.
 */
export function systemPrompt(task: TaskKey): string {
  const shared = [
    "You are helping a clinician work with records they wrote themselves, inside their own practice software.",
    "",
    "THE ONE RULE: reorganise what is in the RECORD below. Never introduce a clinical fact that is not already there.",
    "",
    "Specifically, you must NOT:",
    "- suggest a diagnosis that has not been recorded, or rank diagnoses by likelihood",
    "- suggest, change or comment on any drug, dose, route or frequency",
    "- mention drug interactions, contraindications or red flags",
    "- cite or refer to any guideline, trial, textbook or external source -- you have none, and naming one you cannot produce is a fabrication",
    "- state how confident you are, or how reliable the answer is",
    "- state or imply anything about the patient that the record does not say",
    "",
    "If the record does not contain what is being asked for, say exactly that in one sentence. An honest gap is useful; a plausible filler is dangerous.",
    "Write in British English, plainly, and no longer than the content justifies.",
  ];
  const perTask: Record<TaskKey, string> = {
    summarise_encounter: "Summarise this consultation for the clinician who wrote it. Lead with what was found and what was decided.",
    summarise_history: "Summarise this patient's history from the consultations listed. Say what recurs and what changed over time. Do not speculate about what was not recorded.",
    draft_referral: "Draft a referral letter from this consultation for the clinician to correct and sign. Leave a clearly marked blank wherever the record does not give you something a letter needs -- do not invent a recipient, a hospital or a reason.",
    patient_instructions: "Rewrite the recorded plan so the patient can read it. Keep to what was actually decided, at about a reading age of twelve, and add no advice of your own.",
    tidy_note: "Expand the clinician's shorthand into full sentences. Change no clinical meaning, add nothing, and drop nothing.",
    ask: "Answer the clinician's question about the record below, using only what it contains.",
  };
  return `${shared.join("\n")}\n\nTASK: ${perTask[task]}`;
}

// ── THE CALL ─────────────────────────────────────────────────────────────────────────────────────────

export async function runAssistant(admin: any, ctx: WorkspaceContext, args: {
  task: TaskKey; question?: string; encounterId?: string | null; patientId?: string | null;
  sessionId?: string | null; correlationId: string;
}): Promise<EngineResult<{
  sessionId: string; messageId: string; answer: string; grounding: GroundingSource[];
  model: string | null; provider: string | null;
}>> {
  const task = ASSISTANT_TASKS.find(t => t.key === args.task);
  if (!task) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown task: ${args.task}` };

  // THE CONSENT GATE COMES FIRST, before any record is read and certainly before anything leaves this
  // system. Checking it after assembling the context would mean the disclosure had already happened in
  // memory by the time the answer was "no".
  const settings = await assistantSettings(admin, ctx.workspaceId);
  if (!settings.enabled)
    return {
      ok: false, status: 403, code: "AI_NOT_ENABLED",
      message: "the assistant is off for this practice -- somebody with settings access has to turn it on, and doing so discloses record content to a third-party provider",
    };
  if (!settings.noticeCurrent)
    return {
      ok: false, status: 403, code: "NOTICE_CHANGED",
      message: "what the assistant discloses has changed since this practice agreed to it, so it needs agreeing to again",
    };
  if (!settings.configured)
    return { ok: false, status: 503, code: "AI_NOT_CONFIGURED", message: "no model provider is configured for this deployment" };

  const context = await buildContext(admin, ctx, args);
  // NO UNGROUNDED MODE. Without a record there is nothing to reorganise, and answering anyway would be
  // answering from the model's own memory -- which is the thing this module refuses to do.
  if (!context)
    return {
      ok: false, status: 400, code: "NOTHING_TO_GROUND_IN",
      message: "open a consultation or a patient first -- the assistant works from a record, not from general knowledge",
    };

  const question = (args.question ?? "").trim();
  if (task.key === "ask" && question.length < 3)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "ask a question" };

  let sessionId = args.sessionId ?? null;
  if (!sessionId) {
    const { data, error } = await admin.from("practice_ai_session").insert({
      workspace_id: ctx.workspaceId, user_id: ctx.userId,
      patient_id: context.patientId, encounter_id: args.encounterId ?? null,
      task: task.key, title: task.label,
    }).select("id").single();
    if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
    sessionId = data.id as string;
  }

  const asked = question || task.label;
  await admin.from("practice_ai_message").insert({
    workspace_id: ctx.workspaceId, session_id: sessionId, role: "practitioner",
    body: asked, created_by: ctx.userId,
  });

  // READING A PATIENT'S RECORD IN ORDER TO SEND IT SOMEWHERE IS A DISCLOSURE, and is logged as one --
  // distinctly from an ordinary view, so an access review can find every occasion record content left
  // this system.
  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "encounter",
    subjectId: args.encounterId ?? null, patientId: context.patientId,
    action: "export", route: "/practice/assistant",
    detail: `AI assistant (${task.key}): record content sent to ${settings.provider ?? "provider"}`,
    correlationId: args.correlationId,
  });

  const result = await generate({
    system: systemPrompt(task.key),
    user: `${question ? `QUESTION: ${question}\n\n` : ""}RECORD:\n${context.text}`,
    tier: "reasoning", maxTokens: 1200,
    context: { userId: ctx.userId, tenantId: ctx.workspaceId, operation: `practice_ai_${task.key}` },
  });

  if (!result.ok) {
    await admin.from("practice_ai_message").insert({
      workspace_id: ctx.workspaceId, session_id: sessionId, role: "assistant",
      body: "", status: result.error === "refusal" ? "refusal" : result.error === "not_configured" ? "not_configured" : "failed",
      error_detail: "detail" in result ? result.detail ?? null : null,
      grounding: context.grounding, created_by: ctx.userId,
    });
    return { ok: false, status: 502, code: "AI_FAILED", message: `the assistant could not answer (${result.error})` };
  }

  const { data: message, error: messageError } = await admin.from("practice_ai_message").insert({
    workspace_id: ctx.workspaceId, session_id: sessionId, role: "assistant",
    body: result.text,
    // THE REAL MODEL ID, as the provider reported it for this exact response.
    model: result.model, provider: settings.provider,
    grounding: context.grounding,
    input_tokens: result.usage.input, output_tokens: result.usage.output,
    status: "ok", created_by: ctx.userId,
  }).select("id").single();
  if (messageError) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: messageError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.ai_answered",
    // The TASK and the model, never the answer: the workspace trail is readable by anybody holding
    // access.review, and an answer about a consultation is clinical content.
    payload: { sessionId, task: task.key, model: result.model, sources: context.grounding.length },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      sessionId, messageId: message.id as string, answer: result.text,
      grounding: context.grounding, model: result.model, provider: settings.provider,
    },
  };
}

// ── HISTORY AND FEEDBACK ─────────────────────────────────────────────────────────────────────────────

/**
 * The caller's own sessions.
 *
 * ALWAYS THEIR OWN. There is no parameter for whose conversations to read: a session carries a
 * clinician's questions about patients they were treating, and reading somebody else's is a different
 * question with a different answer about consent.
 */
export async function listSessions(admin: any, ctx: WorkspaceContext, limit = 20) {
  const { data } = await admin.from("practice_ai_session")
    .select("id, task, title, patient_id, encounter_id, created_at")
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
    .order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as any[];
}

export async function sessionMessages(admin: any, ctx: WorkspaceContext, sessionId: string) {
  const { data: session } = await admin.from("practice_ai_session")
    .select("id, user_id, task, title, encounter_id, patient_id, created_at")
    .eq("id", sessionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!session || session.user_id !== ctx.userId) return null;

  const { data } = await admin.from("practice_ai_message")
    .select("id, role, body, model, provider, grounding, status, error_detail, helpful, created_at")
    .eq("session_id", sessionId).order("created_at");
  return { session, messages: (data ?? []) as any[] };
}

export async function rateMessage(admin: any, ctx: WorkspaceContext, args: {
  messageId: string; helpful: boolean; note?: string;
}): Promise<EngineResult<{ rated: true }>> {
  const { data: m } = await admin.from("practice_ai_message")
    .select("id, session_id").eq("id", args.messageId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!m) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data: s } = await admin.from("practice_ai_session")
    .select("user_id").eq("id", m.session_id).maybeSingle();
  if (!s || s.user_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's conversation" };

  await admin.from("practice_ai_message")
    .update({ helpful: args.helpful, feedback_note: args.note?.trim() || null }).eq("id", m.id);
  return { ok: true, data: { rated: true } };
}

/**
 * What the practice can see about its own AI use.
 *
 * COUNTS, and the one figure that matters most is the number of times record content left this system.
 */
export async function assistantUsage(admin: any, ctx: WorkspaceContext) {
  const [{ count: sessions }, { count: answers }, { count: failures }, { count: helpful }, { count: unhelpful }] = await Promise.all([
    admin.from("practice_ai_session").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
    admin.from("practice_ai_message").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("role", "assistant").eq("status", "ok"),
    admin.from("practice_ai_message").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("role", "assistant").neq("status", "ok"),
    admin.from("practice_ai_message").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("helpful", true),
    admin.from("practice_ai_message").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("helpful", false),
  ]);
  return {
    sessions: sessions ?? 0, answers: answers ?? 0, failures: failures ?? 0,
    ratedHelpful: helpful ?? 0, ratedUnhelpful: unhelpful ?? 0,
    // THE FIELD THAT SAYS WHAT THIS MODULE CANNOT DO. A client cannot render a reliability figure,
    // because none is computed and the payload says why.
    accuracyMeasured: false,
    accuracyNote: "Nothing here measures whether an answer was correct. Ratings are opinions the practitioner recorded, not a score.",
  };
}
