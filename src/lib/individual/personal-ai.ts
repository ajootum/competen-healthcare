/* eslint-disable @typescript-eslint/no-explicit-any */
import { runPersonalAssistant, type AssistantMode, type AssistantOutcome, type DataScope } from "@/lib/ai/personal-assistant";
import type { ExperienceKey } from "./experiences";
import { systemPrompt, recordContext } from "./assistant";
import { loadIndividualPassport } from "./passport";
import { loadProfessionalRecord } from "./professional/record";
import { professionalContext, taskInstruction, type ActivityNotes } from "./professional/assistant";
import { CPD_ACTIVITY_LABEL } from "./professional/vocabulary";

// ── THE PERSONAL AI IN SCHOLAR AND PROFESSIONAL ── COMPETEN IND-007 owner decision D3 ─────────────────────────
//
// The Individual side of the one Holdings Personal AI (src/lib/ai/personal-assistant.ts). Holdings decides the
// mode, the scopes the product's profile allows, the identifier screen, the clinical risk and the allowance. This
// file supplies what only Individual knows: the one persona both experiences share (./assistant.ts), the
// instruction for each mode, and the person's own data -- loaded here, and only for the scopes Holdings allowed.

const MODE_INSTRUCTION: Record<"teach" | "ask" | "development", string[]> = {
  teach: [
    "Mode: Teach me.",
    "- Teach the topic the person names, step by step, at a level a student can follow: start from what they need to know first, then build up.",
    "- Where study material is given, teach from it and say which part you are using. Where it is silent or seems wrong, say so rather than filling the gap.",
    "- End with one short question that checks their understanding.",
  ],
  ask: [
    "Mode: Ask about my material.",
    "- Answer the person's question about the study material given. Ground the answer in that material and say where it does not cover the question or seems wrong.",
  ],
  development: [
    "Mode: Professional development.",
    "- Help with professional development: learning needs, CPD choices, career steps and reflective practice, in general terms.",
  ],
};

/** The system prompt an experience and mode run with: the shared persona and rules, then the mode. Also what D5 evaluates. */
export function assistantSystemPrompt(experience: ExperienceKey, mode: AssistantMode): string {
  const instruction = mode === "cpd_plan" || mode === "reflection" ? taskInstruction(mode) : MODE_INSTRUCTION[mode].join("\n");
  return `${systemPrompt(experience)}\n\n${instruction}`;
}

/** Study material the Scholar workspace has already authorised for this person (its own guard). */
export type StudyContext = { text?: string | null; competencyIds?: readonly string[]; topicTerms?: readonly string[] };

/** Pure: the user message for a mode, from the grounding and what the person asked. */
export function assistantUserMessage(mode: AssistantMode, grounding: readonly string[], input: { question?: string | null; activity?: ActivityNotes | null }): string {
  const ask = mode === "cpd_plan" ? "Suggest a CPD plan for me."
    : mode === "reflection" ? `Draft a reflection on this activity.\nActivity: ${input.activity!.title} (${CPD_ACTIVITY_LABEL[input.activity!.activityType as keyof typeof CPD_ACTIVITY_LABEL] ?? input.activity!.activityType}).\nMy notes: ${input.activity!.notes ?? "none given"}`
    : mode === "teach" ? `Teach me: ${input.question}` : `My question: ${input.question}`;
  return `${grounding.length ? `My Competen record:\n${grounding.join("\n")}\n\n` : ""}${ask}`;
}

/** One request to the personal AI from Scholar or Professional. The caller has applied its guard and its quota. */
export async function runIndividualAssistant(admin: any, r: {
  userId: string; fullName: string | null; live: readonly ExperienceKey[]; experience: ExperienceKey; mode?: unknown; requestId: string;
  question?: string | null; activity?: ActivityNotes | null; study?: StudyContext | null;
}): Promise<AssistantOutcome> {
  const studyFor = (scopes: readonly DataScope[]) => (scopes.includes("study_context") ? r.study ?? null : null);
  return runPersonalAssistant(admin, {
    userId: r.userId, product: r.experience, mode: r.mode, requestId: r.requestId,
    screen: [r.question ?? "", r.activity?.title ?? "", r.activity?.notes ?? "", r.study?.text ?? ""],
    // The subject, for the clinical risk classification. The record is not the subject, so it is not classified.
    // A CPD plan has no question: its subject is the task itself.
    risk: (mode, scopes) => {
      const study = studyFor(scopes);
      return { text: [mode === "cpd_plan" ? "CPD plan" : "", r.question ?? "", r.activity?.title ?? "", r.activity?.notes ?? "", study?.text ?? ""].join("\n"), topicTerms: study?.topicTerms, competencyIds: study?.competencyIds };
    },
    compose: async (mode, scopes) => {
      if ((mode === "teach" || mode === "ask" || mode === "development") && !r.question) return { error: "Ask a question.", status: 400 };
      if (mode === "reflection" && !r.activity) return { error: "Name the activity to reflect on.", status: 400 };
      const today = new Date().toISOString().slice(0, 10);
      const grounding: string[] = [];
      if (scopes.includes("passport")) grounding.push(recordContext({ name: r.fullName, experience: r.experience, live: r.live, passport: await loadIndividualPassport(admin, r.userId, today) }));
      if (scopes.includes("professional_record")) grounding.push(professionalContext(await loadProfessionalRecord(admin, r.userId), today));
      const study = studyFor(scopes);
      if (study?.text) grounding.push(`Study material (from the person's own Scholar workspace):\n${study.text.slice(0, 6000)}`);
      return { system: assistantSystemPrompt(r.experience, mode), user: assistantUserMessage(mode, grounding, r) };
    },
  });
}
