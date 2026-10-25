/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReflectionTemplate } from "../lcpd-config";
import { myRecords } from "@/lib/learning/record";
import { saveReflection } from "./needs-store";

// ── REFLECTIONS ON LEARNING, AND THE IMPACT THE PERSON REPORTS ── LCPD-01 LCPD-3, migration 491 ──────────────────────
//
// A reflection is Stage 2's private reflection (470, written only through needs-store saveReflection). Stage 4 adds which
// thing it is about -- one CPD entry, or one Holdings learning record -- and the impact the person reports:
//
//   completed    "I completed it"          understood   "I understood it"          applied   "I applied it in practice"
//
// and never a fourth: independently verified practice impact is not something a person can report, so 491 has no value
// for it. The course record is never touched (LCPD-4: "without modifying the authoritative course record").
//
// ⚠ PRIVATE. Reflections are read here only for their own person. Nothing shares them: 491's Passport table carries
// learning records, never reflections.

export type Impact = "completed" | "understood" | "applied";
export const IMPACT_LABEL: Record<Impact, string> = {
  completed: "Learning completed",
  understood: "Learning understood",
  applied: "Learning applied in practice",
};
export const NOT_VERIFIED_IMPACT = "Reported by you. Not independently verified, and not a verification of clinical competence.";

export type Subject = { cpdId: string } | { learningRecordId: string };
export const subjectKey = (s: Subject) => ("cpdId" in s ? `cpd:${s.cpdId}` : `rec:${s.learningRecordId}`);
export type LearningReflection = { linkId: string; reflectionId: string; impact: Impact; templateLabel: string | null; body: string; createdAt: string };

/** The person's reflections on learning, by subject. null = unreadable. `available` false = 491 is absent here. */
export async function loadLearningReflections(admin: any, userId: string): Promise<{ available: boolean; bySubject: Map<string, LearningReflection[]> } | null> {
  try {
    const { data, error } = await admin.from("individual_professional_learning_reflection")
      .select("id, reflection_id, cpd_id, learning_record_id, impact, created_at, individual_professional_reflection!inner(template_label, body)")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
    if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? { available: false, bySubject: new Map() } : null;
    const bySubject = new Map<string, LearningReflection[]>();
    for (const r of data ?? []) {
      const key = r.cpd_id ? `cpd:${r.cpd_id}` : `rec:${r.learning_record_id}`;
      const ref = Array.isArray(r.individual_professional_reflection) ? r.individual_professional_reflection[0] : r.individual_professional_reflection;
      bySubject.set(key, [...(bySubject.get(key) ?? []), { linkId: r.id, reflectionId: r.reflection_id, impact: r.impact, templateLabel: ref?.template_label ?? null, body: ref?.body ?? "", createdAt: r.created_at }]);
    }
    return { available: true, bySubject };
  } catch { return null; }
}

/** Pure: the reflection's text from a template's prompts and the person's answers. Unanswered prompts are left out. */
export function composeReflection(t: ReflectionTemplate, answers: readonly unknown[]): string {
  return t.prompts.map((p, i) => [p, typeof answers[i] === "string" ? (answers[i] as string).trim() : ""] as const)
    .filter(([, a]) => a).map(([p, a]) => `${p}\n${a}`).join("\n\n");
}

/** Pure: a reflection request, or why not. */
export function parseLearningReflection(b: any, templates: readonly ReflectionTemplate[]): { ok: true; value: { subject: Subject; template: ReflectionTemplate; body: string; impact: Impact } } | { ok: false; error: string } {
  const id = /^[0-9a-f-]{36}$/i;
  const subject: Subject | null = typeof b?.cpdId === "string" && id.test(b.cpdId) ? { cpdId: b.cpdId } : typeof b?.learningRecordId === "string" && id.test(b.learningRecordId) ? { learningRecordId: b.learningRecordId } : null;
  if (!subject) return { ok: false, error: "Choose the learning to reflect on." };
  const template = templates.find(t => t.code === b?.template);
  if (!template) return { ok: false, error: "Choose a reflection template." };
  const body = composeReflection(template, Array.isArray(b?.answers) ? b.answers : []);
  if (body.length < 3 || body.length > 5000) return { ok: false, error: "Answer at least one prompt (up to 5,000 characters in all)." };
  const impact = (["completed", "understood", "applied"] as const).find(x => x === b?.impact) ?? null;
  if (!impact) return { ok: false, error: "Say what the learning amounted to: completed, understood or applied." };
  return { ok: true, value: { subject, template, body, impact } };
}

type W = { ok: true; id: string } | { ok: false; status: number; error: string };

/**
 * Save a reflection on one CPD entry or learning record of THIS person. The subject is checked to be theirs first; the
 * reflection goes through Stage 2's writer; then the 491 link. A link that cannot be written leaves a private, unlinked
 * reflection the person still has (never a lost one).
 */
export async function saveLearningReflection(admin: any, userId: string, v: { subject: Subject; template: ReflectionTemplate; body: string; impact: Impact }): Promise<W> {
  // A learning record is checked through Competen Learning's own reader (myRecords), not its table (LEARNING-01 H1).
  const own = "cpdId" in v.subject
    ? await admin.from("individual_professional_cpd").select("id").eq("id", v.subject.cpdId).eq("user_id", userId).maybeSingle()
    : await myRecords(admin, userId).then(rs => ({ data: rs?.some(r => r.id === (v.subject as { learningRecordId: string }).learningRecordId) ? {} : null, error: rs === null ? true : null }));
  if (own.error) return { ok: false, status: 503, error: "That learning could not be checked just now. Nothing has changed." };
  if (!own.data) return { ok: false, status: 404, error: "That learning is not on your record." };
  const r = await saveReflection(admin, userId, null, { body: v.body, template_code: v.template.code, template_label: v.template.label });
  if (!r.ok || !r.id) return r.ok ? { ok: false, status: 500, error: "The reflection could not be saved." } : r;
  const { data, error } = await admin.from("individual_professional_learning_reflection").insert({
    user_id: userId, reflection_id: r.id, impact: v.impact,
    cpd_id: "cpdId" in v.subject ? v.subject.cpdId : null, learning_record_id: "learningRecordId" in v.subject ? v.subject.learningRecordId : null,
  }).select("id").single();
  if (error || !data) return { ok: false, status: /does not exist|schema cache|could not find/i.test(error?.message ?? "") ? 409 : 500, error: "Your reflection was saved privately, but it could not be linked to this learning just now." };
  return { ok: true, id: data.id };
}

/** Change the impact the person reports on one of their own links. */
export async function setImpact(admin: any, userId: string, linkId: string, impact: unknown): Promise<W> {
  const i = (["completed", "understood", "applied"] as const).find(x => x === impact);
  if (!i) return { ok: false, status: 422, error: "Choose completed, understood or applied." };
  const { data, error } = await admin.from("individual_professional_learning_reflection").update({ impact: i, updated_at: new Date().toISOString() })
    .eq("id", linkId).eq("user_id", userId).select("id").maybeSingle();
  if (error) return { ok: false, status: 503, error: "That could not be saved just now." };
  return data ? { ok: true, id: data.id } : { ok: false, status: 404, error: "That reflection is not yours." };
}
