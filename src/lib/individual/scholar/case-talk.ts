/* eslint-disable @typescript-eslint/no-explicit-any */
// ── TALK TO THE PATIENT, AND THE AI NOTES AROUND A CASE ── SCHOLAR-CE-2026 CE-04 ───────────────────────────────────
//
// SERVER-ONLY (it reads blueprints). The server side of the conversation loop. The rules of what the voice may know and
// say are src/lib/cases/conversation.ts (pure, tested). This file only loads the session, checks the gates, makes the AI
// call through THE SAME PATH case feedback uses, and keeps the result (migration 880).
//
// ⚠ THE SAME AI PATH. A private play: scholarAiRunner, activity "evaluate", the "reasoning" tier, through the Holdings
// allowance with the clinical-risk subject (as a written answer's feedback does). A library play: resolveOwner
// "case.live_with_stored" and scholarOwnedRunner counted against the session (as libraryReasoningFeedback does). Nothing
// here chooses a model, a tier or an owner of its own.
// ⚠ BOUNDED. At most the policy's questions per stage (scholar_case_conversation_turns), one reply of at most 220
// tokens each, and the last six turns of context.
// ⚠ FAIL CLOSED, AND PLAIN. AI help off, no allowance, a provider down, 880 absent, the switch off: the answer is a plain
// reason and the case plays on exactly as before. Nothing is guessed and no reply is made up.
// ⚠ NEVER A FACT. A reply is simulated speech: not marked, not kept as a finding, not evidence. Labelled wherever shown.

import { resolveOwner } from "@/lib/ai/consumption";
import { caseSessionRecord, sessionAttemptSource } from "@/lib/cases/library";
import { conversationEnabled, resolveToken, type Blueprint } from "@/lib/cases/blueprint";
import {
  COMMUNICATION_NOTE_LABEL, CONVERSATION_LABEL, buildCommunicationNoteRequest, buildVoiceRequest, cleanCommunicationNote, cleanQuestion, reviewQuestions,
  screenReply, turnState, type QuestionReview,
} from "@/lib/cases/conversation";
import { expectedHandoverText, markHandover, parseHandover } from "@/lib/cases/handover";
import type { IndividualContext } from "../guard";
import { loadIndividualPolicy } from "../policy";
import { findPatientIdentifiers } from "./extract";
import { activityState, getScholarAiStanding } from "./ai-standing";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarOwnedRunner, scholarRequestId, scholarRisk, type ScholarAiRun } from "./http";
import { getPrivateCase, getPrivateCaseSession, insertCaseConversation, listCaseConversation, type ConversationEntry } from "./store";
import { markHandoverAnswer } from "./clinical";

export const TALK_PROMPT_VERSIONS = { voice: "scholar-case-voice-v1", note: "scholar-case-comm-note-v1", handover: "scholar-case-handover-note-v1" } as const;
export const TALK_UNAVAILABLE = "Conversation unavailable";
const OPERATION = "individual_scholar_case_conversation";

export type TalkKind = "private" | "library";
/** What the server knows of a session for the conversation. SERVER-SIDE ONLY: it carries the blueprint. */
export type TalkSource = {
  kind: TalkKind; sessionId: string; blueprint: Blueprint; reached: string[]; revealed: string[]; status: "active" | "completed"; competencyIds: string[]; title: string;
};

/** The caller's own session, from the database. null: not theirs. */
export async function loadTalkSource(admin: any, userId: string, kind: TalkKind, sessionId: string): Promise<TalkSource | null> {
  if (kind === "private") {
    const s = await getPrivateCaseSession(admin, userId, sessionId);
    const c = s ? await getPrivateCase(admin, userId, s.session.caseId) : null;
    if (!s || !c) return null;
    return { kind, sessionId, blueprint: c.blueprint as Blueprint, reached: s.session.reachedStageIds, revealed: s.session.revealedFactIds, status: s.session.status, competencyIds: c.competencyIds ?? [], title: c.title };
  }
  const l = await sessionAttemptSource(admin, userId, sessionId);
  if (!l) return null;
  return {
    kind, sessionId, blueprint: l.blueprint, reached: l.reached, revealed: l.revealed, status: l.status === "completed" ? "completed" : "active",
    competencyIds: [...new Set(l.blueprint.learningObjectives.flatMap(o => o.competencyIds))], title: l.blueprint.title,
  };
}

export type TalkGate = { ok: true } | { ok: false; reason: string; status?: number };

/** Why the conversation cannot be used right now, in the student's words, or ok. Switch, case, 880, then the student's AI. */
export async function talkGate(ctx: IndividualContext, src: TalkSource | null, opts: { needAi: boolean }): Promise<TalkGate> {
  if (!src) return { ok: false, reason: "No such session.", status: 404 };
  if (!conversationEnabled(src.blueprint)) return { ok: false, reason: "This case has no one to talk to.", status: 404 };
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarCaseConversation !== "on") return { ok: false, reason: "Talking to the patient is not switched on right now." };
  if (opts.needAi) {
    const st = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate");
    if (!st.available) return { ok: false, reason: st.message ?? "AI help is not available right now." };
    const pre = await aiPreflight(ctx);
    if (pre) return { ok: false, reason: String(((await pre.json().catch(() => ({}))) as { error?: string }).error ?? "AI help is not available right now.") };
  }
  return { ok: true };
}

/** One AI runner for this session, the same path case feedback uses. Its refusal, in the student's words, is read after the call. */
async function talkRunner(ctx: IndividualContext, req: Request, src: TalkSource, text: string, part: string): Promise<{ run: ScholarAiRun; refusal: () => string | null }> {
  if (src.kind === "private") {
    const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, { text, passages: [], competencyIds: src.competencyIds }), part);
    // Where it was asked (a simulated conversation in a study case): framing only, as a written answer's feedback does.
    Object.assign(ai.risk, { intentContext: { surface: "apply" as const, lessonTitle: src.title, objective: "Talk with the simulated patient in a practice case", materialTopics: ai.risk.topicTerms ?? [] } });
    return { run: ai.run, refusal: () => { const r = ai.refusal(); return r ? refusalWords(r).message : null; } };
  }
  const owner = await resolveOwner(ctx.admin, "case.live_with_stored", "scholar", { userId: ctx.userId });
  if ("refused" in owner) return { run: async () => ({ ok: false, error: "failed", detail: "metered" }) as any, refusal: () => String(owner.refused) };
  const ai = scholarOwnedRunner(ctx.admin, {
    owner, activity: "evaluate", requestId: `${scholarRequestId(ctx, req)}:${part}`,
    risk: await scholarRisk(ctx.admin, ctx.userId, { text, passages: [], competencyIds: src.competencyIds }), record: caseSessionRecord(src.sessionId),
  });
  return { run: ai.run, refusal: () => { const r = ai.refusal(); return r ? `The AI allowance for this is not available (${r}).` : null; } };
}

export type TalkStateView = {
  speaker: "patient" | "caregiver";
  label: string;
  /** null when the conversation can be used; else the plain reason. */
  unavailable: string | null;
  stage: { used: number; cap: number; left: number; full: boolean } | null;
  turns: { stageId: string; stageTitle: string; question: string; reply: string }[];
  /** After the case: the code review of the key questions, and the AI note when one was made. */
  debrief: { asked: QuestionReview["asked"]; missed: QuestionReview["missed"]; note: { label: string; text: string } | null } | null;
};

const stageTitle = (b: Blueprint, id: string) => b.stages.find(s => s.id === id)?.title ?? id;
const currentStage = (src: TalkSource) => src.reached[src.reached.length - 1] ?? src.blueprint.stages[0]?.id ?? "";

/** The panel's state: the conversation so far, the cap, and why it is unavailable if it is. Never an AI call. */
export async function talkState(ctx: IndividualContext, src: TalkSource): Promise<TalkStateView | { error: string; status: number }> {
  const gate = await talkGate(ctx, src, { needAi: src.status === "active" });
  if (!gate.ok && gate.status === 404) return { error: gate.reason, status: 404 };
  const list = await listCaseConversation(ctx.admin, ctx.userId, src.kind, src.sessionId);
  const policy = await loadIndividualPolicy(ctx.admin);
  const entries: ConversationEntry[] = list.ok ? list.data : [];
  const turns = entries.filter(e => e.kind === "turn" && e.stageId);
  const b = src.blueprint;
  const unavailable = !list.ok && list.notProvisioned ? "The place conversations are kept has not been installed on this environment yet. Everything else in the case works as before."
    : !list.ok ? "Your conversation could not be read just now." : !gate.ok ? gate.reason : null;
  const note = entries.find(e => e.kind === "communication_note");
  return {
    speaker: b.voice!.speaker, label: CONVERSATION_LABEL, unavailable,
    stage: src.status === "active" ? turnState(turns.map(t => ({ stageId: t.stageId! })), currentStage(src), policy.scholarCaseConversationTurns) : null,
    turns: turns.map(t => ({ stageId: t.stageId!, stageTitle: stageTitle(b, t.stageId!), question: t.question ?? "", reply: t.reply })),
    debrief: src.status === "completed" && turns.length
      ? { ...reviewQuestions(b, turns.map(t => t.question ?? "")), note: note ? { label: COMMUNICATION_NOTE_LABEL, text: note.reply } : null }
      : null,
  };
}

export type AskResult =
  | { ok: true; turn: { stageId: string; question: string; reply: string; screened: boolean }; stage: { used: number; cap: number; left: number; full: boolean }; label: string }
  | { ok: false; error: string; status: number; unavailable?: boolean };

/** One question to the patient. The grounded prompt, the AI call on the case-feedback path, the reply screen, then it is kept. */
export async function askPatient(ctx: IndividualContext, req: Request, src: TalkSource | null, questionRaw: unknown): Promise<AskResult> {
  const gate = await talkGate(ctx, src, { needAi: true });
  if (!gate.ok) return { ok: false, error: gate.reason, status: gate.status ?? 200, unavailable: gate.status === undefined };
  const s = src!;
  if (s.status !== "active") return { ok: false, error: "The case is finished, so there is no more conversation.", status: 409 };
  const q = cleanQuestion(questionRaw);
  if (!q.ok) return { ok: false, error: q.error, status: 400 };
  if (findPatientIdentifiers(q.question).length) return { ok: false, error: "That looks like it identifies a patient. Remove it and try again.", status: 422 };
  const list = await listCaseConversation(ctx.admin, ctx.userId, s.kind, s.sessionId);
  if (!list.ok) return { ok: false, unavailable: true, status: 200, error: list.notProvisioned ? "The place conversations are kept has not been installed on this environment yet. Everything else in the case works as before." : "Your conversation could not be read just now." };
  const policy = await loadIndividualPolicy(ctx.admin);
  const turns = list.data.filter(e => e.kind === "turn" && e.stageId);
  const stageId = currentStage(s);
  const cap = turnState(turns.map(t => ({ stageId: t.stageId! })), stageId, policy.scholarCaseConversationTurns);
  if (cap.full) return { ok: false, error: `You have used your ${cap.cap} questions for this stage. Carry on with the case.`, status: 200, unavailable: false };

  const state = { reachedStageIds: s.reached, revealedFactIds: s.revealed };
  const history = turns.filter(t => t.stageId === stageId).map(t => ({ question: t.question ?? "", reply: t.reply }));
  const request = buildVoiceRequest(s.blueprint, state, history, q.question);
  const runner = await talkRunner(ctx, req, s, q.question, `t${turns.length + 1}`);
  const r = await runner.run({
    system: request.system, user: request.user, tier: "reasoning", maxTokens: 220,
    context: { userId: ctx.userId, attribution: { scope: "person" }, operation: OPERATION },
  } as any);
  const refused = runner.refusal();
  if (refused || !r.ok) {
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, s.sessionId, { kind: s.kind, outcome: refused ? "refused" : `error:${(r as any).error}` });
    return { ok: false, unavailable: true, status: 200, error: refused ?? "The patient could not answer just now. Try again shortly." };
  }
  const screened = screenReply(s.blueprint, state, r.text);
  const kept = await insertCaseConversation(ctx.admin, ctx.userId, {
    kind: s.kind, sessionId: s.sessionId, entry: "turn", stageId, question: q.question, reply: screened.reply, screened: !screened.ok,
    model: r.model, promptVersion: TALK_PROMPT_VERSIONS.voice,
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, s.sessionId, { kind: s.kind, outcome: kept.ok ? (screened.ok ? "turn" : `turn_screened:${screened.reason}`) : `not_kept:${kept.reason}`, model: r.model, prompt_version: TALK_PROMPT_VERSIONS.voice });
  if (!kept.ok) return { ok: false, unavailable: true, status: 200, error: kept.reason === "not_provisioned" ? "The place conversations are kept has not been installed on this environment yet. Everything else in the case works as before." : "That could not be recorded just now, so the reply is not shown. Try again." };
  return { ok: true, turn: { stageId, question: q.question, reply: screened.reply, screened: !screened.ok }, stage: turnState([...turns.map(t => ({ stageId: t.stageId! })), { stageId }], stageId, policy.scholarCaseConversationTurns), label: CONVERSATION_LABEL };
}

/** The AI note on communication, once, after the case is finished. The code review of key questions is given with it either way. */
export async function communicationNote(ctx: IndividualContext, req: Request, src: TalkSource | null): Promise<TalkStateView | { error: string; status: number; unavailable?: boolean }> {
  const gate = await talkGate(ctx, src, { needAi: true });
  if (!gate.ok) return { error: gate.reason, status: gate.status ?? 200, unavailable: gate.status === undefined };
  const s = src!;
  if (s.status !== "completed") return { error: "The note on your communication comes when the case is finished.", status: 409 };
  const list = await listCaseConversation(ctx.admin, ctx.userId, s.kind, s.sessionId);
  if (!list.ok) return { error: "Your conversation could not be read just now.", status: 200, unavailable: true };
  const turns = list.data.filter(e => e.kind === "turn");
  if (!turns.length) return { error: "There was no conversation to comment on.", status: 409 };
  if (!list.data.some(e => e.kind === "communication_note")) {
    const review = reviewQuestions(s.blueprint, turns.map(t => t.question ?? ""));
    const request = buildCommunicationNoteRequest(turns.map(t => ({ question: t.question ?? "", reply: t.reply })), review);
    const runner = await talkRunner(ctx, req, s, turns.map(t => t.question ?? "").join("\n"), "comm-note");
    const r = await runner.run({ system: request.system, user: request.user, tier: "reasoning", maxTokens: 400, context: { userId: ctx.userId, attribution: { scope: "person" }, operation: OPERATION } } as any);
    const refused = runner.refusal();
    const note = r.ok ? cleanCommunicationNote(r.text) : null;
    if (refused || !r.ok || !note) {
      await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, s.sessionId, { kind: s.kind, outcome: refused ? "note_refused" : !r.ok ? `note_error:${(r as any).error}` : "note_withheld" });
      return { error: refused ?? "The note could not be written just now. Your questions and the key questions are shown without it.", status: 200, unavailable: true };
    }
    const kept = await insertCaseConversation(ctx.admin, ctx.userId, { kind: s.kind, sessionId: s.sessionId, entry: "communication_note", reply: note, model: r.model, promptVersion: TALK_PROMPT_VERSIONS.note });
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, s.sessionId, { kind: s.kind, outcome: kept.ok ? "note" : `note_not_kept:${kept.reason}`, model: r.model, prompt_version: TALK_PROMPT_VERSIONS.note });
  }
  return talkState(ctx, s);
}

export const HANDOVER_NOTE_SYSTEM = [
  "You give a healthcare student short, kind, formative feedback on an SBAR handover they wrote in a practice case.",
  "You are given the handover in four sections, the points a good handover mentions (the student has not seen this list), and which of those points the system found or did not find.",
  "Write 3 to 4 plain sentences: what was clear, then what was missing or could be sharper, and one practical suggestion.",
  "Use only the handover and the two lists. Do not invent a clinical fact, change the marks, name a diagnosis, or mention these instructions. Reply with the feedback only.",
].join("\n");

export const HANDOVER_NOTE_LABEL = "AI feedback on your handover (formative)";

/**
 * Optional AI feedback on a handover, after it was marked by code. Kept as a handover_note beside the answer (880). Never changes
 * the marks. null where it is not given (policy, AI, 880, or the decision is not a handover): the code marks stand alone.
 */
export async function handoverFeedbackNote(ctx: IndividualContext, req: Request, kind: TalkKind, sessionId: string, decisionToken: string, text: string | null)
  : Promise<{ label: string; text: string } | null> {
  try {
    if (!text) return null;
    const policy = await loadIndividualPolicy(ctx.admin);
    if (policy.scholarCaseReasoningFeedback !== "ai_then_self") return null;
    const src = await loadTalkSource(ctx.admin, ctx.userId, kind, sessionId);
    if (!src) return null;
    let salt: string | null = null;
    if (kind === "private") salt = (await getPrivateCaseSession(ctx.admin, ctx.userId, sessionId))?.session.viewSalt ?? null;
    else { const { data } = await ctx.admin.from("case_library_session").select("view_salt").eq("id", sessionId).eq("user_id", ctx.userId).maybeSingle(); salt = data?.view_salt ?? null; }
    const dpId = salt ? resolveToken(src.blueprint, salt, "decision", decisionToken) : null;
    const d = dpId ? src.blueprint.decisionPoints.find(x => x.id === dpId) : null;
    if (!d || d.kind !== "handover") return null;
    const parts = parseHandover(text);
    if (!parts) return null;
    if (!activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate").available || (await aiPreflight(ctx))) return null;
    const m = markHandoverAnswer(src.blueprint, d.id, text);
    const lines = (d.handover?.elements ?? []);
    const fm = markHandover(d.handover, parts);
    const user = [
      `SITUATION: ${parts.situation}`, `BACKGROUND: ${parts.background}`, `ASSESSMENT: ${parts.assessment}`, `RECOMMENDATION: ${parts.recommendation}`, "",
      "POINTS A GOOD HANDOVER MENTIONS:", expectedHandoverText(d.handover), "",
      `FOUND: ${lines.filter(e => fm.found.includes(e.id)).map(e => e.label).join("; ") || "none"}`,
      `NOT FOUND: ${lines.filter(e => fm.missed.includes(e.id)).map(e => e.label).join("; ") || "none"}`,
      `CODE MARK: ${m.score === null ? "n/a" : Math.round(m.score * 100)} percent`,
    ].join("\n");
    const runner = await talkRunner(ctx, req, src, `${d.prompt}\n${text}`, "handover");
    const r = await runner.run({ system: HANDOVER_NOTE_SYSTEM, user, tier: "reasoning", maxTokens: 350, context: { userId: ctx.userId, attribution: { scope: "person" }, operation: OPERATION } } as any);
    const note = r.ok ? cleanCommunicationNote(r.text) : null;
    const refused = runner.refusal();
    if (refused || !r.ok || !note) { await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, sessionId, { kind, outcome: refused ? "handover_refused" : "handover_withheld" }); return null; }
    const kept = await insertCaseConversation(ctx.admin, ctx.userId, { kind, sessionId, entry: "handover_note", decisionPointId: d.id, reply: note.slice(0, 4000), model: r.model, promptVersion: TALK_PROMPT_VERSIONS.handover });
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, sessionId, { kind, outcome: kept.ok ? "handover_note" : `handover_not_kept:${kept.reason}`, model: r.model, prompt_version: TALK_PROMPT_VERSIONS.handover });
    // Shown even if it could not be kept (the debrief then simply lacks it): it is the student's own feedback.
    void kept;
    return { label: HANDOVER_NOTE_LABEL, text: note.slice(0, 4000) };
  } catch {
    return null;
  }
}
