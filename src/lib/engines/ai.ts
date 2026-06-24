/**
 * AI Engine
 * Utilities for AI tutoring and content generation.
 */

export type AiRole = "tutor" | "assessor" | "content-generator";

export interface TutorMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function buildSystemPrompt(role: AiRole, context?: Record<string, string>): string {
  const base = {
    tutor: `You are a clinical nursing tutor specialising in East African healthcare.
You help nurses understand competencies, CPD requirements, and clinical knowledge.
You use Socratic questioning to guide understanding. Keep answers concise and relevant to clinical practice.`,

    assessor: `You are an experienced clinical assessor.
You help evaluate nursing performance against competency frameworks.
You provide structured, fair, and constructive feedback based on observable behaviours.`,

    "content-generator": `You are a nurse educator creating high-quality learning content for East African nurses.
Generate content that is evidence-based, contextually appropriate, and structured for professional development.`,
  }[role];

  if (!context) return base;
  const ctx = Object.entries(context).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${base}\n\nContext:\n${ctx}`;
}

export function buildTutorPrompt(topic: string, nurseLevel?: string): string {
  const level = nurseLevel ? ` The nurse is at the ${nurseLevel} level.` : "";
  return `Explain "${topic}" in the context of clinical nursing practice in East Africa.${level} Be practical and include a real-world example.`;
}

export function buildQuestionGenPrompt(topic: string, difficulty: "easy" | "medium" | "hard", count = 5): string {
  return `Generate ${count} multiple-choice questions about "${topic}" for nurses at ${difficulty} difficulty.
Format as JSON array: [{question, options: [A,B,C,D], correct: "A"|"B"|"C"|"D", explanation}].`;
}

export function buildScenarioGenPrompt(topic: string, setting: string): string {
  return `Create a branching clinical scenario about "${topic}" set in a ${setting} healthcare setting in East Africa.
Include: patient presentation, 3 decision points with 2-3 options each, correct path explanation, and learning objectives. Format as structured JSON.`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
