import type { ContextOption, ProfessionalNeedsPolicy } from "../policy";
import type { Parsed } from "./validate";
import { isNeedStage, type NeedSource, type NeedStage } from "./needs-vocabulary";

// ── THE DEVELOPMENT-NEED FORM, PURE ── COMPETEN-PROFESSIONAL-NEEDS-01 N2 ─────────────────────────────────────
//
// The only required field is the title: "What would you like to develop?". Every other field is optional, read
// only when the configuration asks for it, and may be left blank to enrich later. A chosen option's label is COPIED
// (as in 450), so renaming an option never rewrites an existing need. The schema (373 and 470) remains the rule.

export type NeedColumns = {
  title: string; detail: string | null; why_it_matters: string | null; professional_context: string | null; development_interests: string | null;
  source_note: string | null; origin: NeedSource;
  category_code: string | null; category_label: string | null; motivation_code: string | null; motivation_label: string | null;
  priority_code: string | null; priority_label: string | null;
};

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return !t ? null : t.length > max ? undefined : t;
};
const pick = (opts: readonly ContextOption[], v: unknown): [string | null, string | null] | undefined => {
  if (v === undefined || v === null || v === "") return [null, null];
  const hit = typeof v === "string" ? opts.find(o => o.code === v) : undefined;
  return hit ? [hit.code, hit.label] : undefined;
};

/** Pure: a need as submitted. On an edit, fields the form did not send are not touched (partial). */
export function parseNeedForm(b: Record<string, unknown>, policy: ProfessionalNeedsPolicy, partial = false): Parsed<Partial<NeedColumns>> {
  const out: Partial<NeedColumns> = {};
  if (!partial || b.title !== undefined) {
    const t = text(b.title, 200);
    if (!t || t.length < 3) return { ok: false, error: "Say what you would like to develop, in 3 to 200 characters." };
    out.title = t;
  }
  const texts: [keyof NeedColumns, string, number, string][] = [
    ["detail", "detail", 2000, "Keep the details under 2,000 characters."],
    ["why_it_matters", "why", 2000, "Keep why it matters under 2,000 characters."],
    ["professional_context", "context", 1000, "Keep the professional context under 1,000 characters."],
    ["development_interests", "interests", 1000, "Keep development interests under 1,000 characters."],
    ["source_note", "sourceNote", 500, "Keep the source note under 500 characters."],
  ];
  for (const [col, key, max, err] of texts) {
    if (partial && b[key] === undefined) continue;
    const v = text(b[key], max);
    if (v === undefined) return { ok: false, error: err };
    (out as Record<string, unknown>)[col] = v;
  }
  if (!partial || b.source !== undefined) {
    const s = b.source;
    if (s !== undefined && s !== null && s !== "" && !policy.sources.includes(s as NeedSource)) return { ok: false, error: "Choose where the need came from from the list." };
    out.origin = (s && policy.sources.includes(s as NeedSource) ? s : "self_identified") as NeedSource;
  }
  const choices: [string, readonly ContextOption[], "category" | "motivation" | "priority", string][] = [
    ["category", policy.categories, "category", "Choose a category from the list."],
    ["motivation", policy.motivations, "motivation", "Choose a motivation from the list."],
    ["priority", policy.priorities, "priority", "Choose a priority from the list."],
  ];
  for (const [key, opts, col, err] of choices) {
    if (partial && b[key] === undefined) continue;
    const r = pick(opts, b[key]);
    if (!r) return { ok: false, error: err };
    (out as Record<string, unknown>)[`${col}_code`] = r[0];
    (out as Record<string, unknown>)[`${col}_label`] = r[1];
  }
  return { ok: true, value: out };
}

/** Pure: a stage change. Any offered stage may follow any other, except reopening when the policy forbids it. */
export function checkStageChange(from: string | null, to: unknown, policy: Pick<ProfessionalNeedsPolicy, "stages" | "reopen">): Parsed<NeedStage> {
  if (!isNeedStage(to) || !policy.stages.includes(to)) return { ok: false, error: "Choose a stage from the list." };
  const closed = (s: string | null) => s === "addressed" || s === "retired";
  if (policy.reopen === "off" && closed(from) && !closed(to)) return { ok: false, error: "An addressed or retired need cannot be reopened. Record a new need instead." };
  return { ok: true, value: to };
}

/** Pure: a private reflection. */
export function parseReflection(b: Record<string, unknown>, templates: readonly ContextOption[]): Parsed<{ body: string; template_code: string | null; template_label: string | null }> {
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (body.length < 3 || body.length > 5000) return { ok: false, error: "Write the reflection in 3 to 5,000 characters." };
  const r = pick(templates, b.template);
  if (!r) return { ok: false, error: "Choose a reflection prompt from the list." };
  return { ok: true, value: { body, template_code: r[0], template_label: r[1] } };
}

/**
 * Pure: suggestions from an AI answer. The question asks for lines "- <need> :: <why>". Anything else is ignored, at
 * most three are kept, and each must say why (its basis). An answer with none in that shape yields none.
 */
export function parseAiSuggestions(answer: string): { title: string; basis: string }[] {
  const out: { title: string; basis: string }[] = [];
  for (const line of answer.split(/\r?\n/)) {
    const m = /^\s*(?:[-*]|\d+[.)])\s*(.{3,200}?)\s*::\s*(.{3,1000})\s*$/.exec(line);
    if (!m) continue;
    const title = m[1].replace(/\*\*/g, "").trim(), basis = m[2].replace(/\*\*/g, "").trim();
    if (title.length >= 3 && basis.length >= 3) out.push({ title: title.slice(0, 200), basis: basis.slice(0, 1000) });
    if (out.length === 3) break;
  }
  return out;
}

/** The request the AI suggestion button sends, through the existing assistant (Professional development mode). */
export const AI_NEED_REQUEST = "Suggest up to three professional development needs I might consider, from my own record only. "
  + "Write each on its own line exactly as: - <what to develop> :: <why, naming the part of my record it comes from>. "
  + "Do not state or imply that I lack competence, do not invent qualifications, roles, feedback or events, and do not repeat a need I already have.";
