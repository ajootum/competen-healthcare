import { CPD_ACTIVITY_LABEL, GOAL_STATUS_LABEL, NEED_STATUS_LABEL } from "./vocabulary";
import { cpdHoursByYear } from "./progress";
import type { ProfessionalRecord } from "./record";

// ── THE PROFESSIONAL PERSONAL AI: CPD PLANNING AND REFLECTION DRAFTING ── COMPETEN-IND-007 s7 ────────────
//
// ⚠ THE FOUNDATION ASSISTANT, TWO MORE TASKS. Same gateway (generate(), plat_ai_requests, the hourly
// quota), same Professional persona and shared rules (src/lib/individual/assistant.ts systemPrompt), same
// person attribution and the same audit action, so the quota counts these calls. This file adds only the
// task instruction and the grounding lines from the person's own Professional record.
//
// ⚠ ADVISORY, AND IT WRITES NOTHING. A plan suggestion is text the person may copy into their own goals.
// A reflection draft is text they edit in the CPD form before they save it. No AI output is stored by the
// route, and nothing is remembered between requests (owner ruling D10).
//
// ⚠ GROUNDED ON THE PERSON'S OWN RECORD ONLY. Their profile, needs, goals and CPD from migration 373 --
// read by their own id -- plus the foundation Passport summary. No other person, no organisation
// aggregate, no patient data.

export type AssistTask = "cpd_plan" | "reflection";
export const isAssistTask = (v: unknown): v is AssistTask => v === "cpd_plan" || v === "reflection";

export const NOTES_MAX = 2000;

const TASK: Record<AssistTask, string[]> = {
  cpd_plan: [
    "Task: suggest a short CPD plan for the next 12 months from the development needs and goals in the record.",
    "- Suggest at most five activities. For each: the need it serves, the kind of activity, and a realistic target month.",
    "- Do not state any required number of CPD hours. The record holds no requirement from their regulator, so say they should check their regulator's current requirement themselves.",
    "- If the record has no development needs, say so and suggest how to identify two or three.",
  ],
  reflection: [
    "Task: draft a short reflective account of one CPD activity, in the first person, for the person to edit.",
    "- Use a simple structure: what I did, what I learned, how it will change my practice, what I will do next.",
    "- Use ONLY the activity details and notes the person gave. Do not invent events, patients, outcomes or feedback.",
    "- Where a part is missing from their notes, leave a short bracketed prompt such as [add an example from your practice] instead of making it up.",
    "- Never include patient-identifiable details, even if the notes contain them.",
    "- Keep it under 250 words.",
    "- Return ONLY the reflection. No introduction, no closing remarks, no separator lines and no note about editing: the person edits it in place and may save it as written.",
  ],
};

export function taskInstruction(task: AssistTask): string {
  return TASK[task].join("\n");
}

/** Pure: the person's Professional record as plain lines. Unread sections say so. */
export function professionalContext(record: ProfessionalRecord, today: string): string {
  const lines: string[] = [];
  const p = record.profile;
  if (p === null) lines.push("Professional profile: could not be read just now.");
  else if (!p) lines.push("Professional profile: not recorded yet.");
  else lines.push(`Professional profile (self-declared, not checked): ${[p.self_declared_profession, p.self_declared_registration_body, p.self_declared_registration_country].filter(Boolean).join(", ") || "blank"}.`);

  if (record.needs === null) lines.push("Development needs: could not be read just now.");
  else if (!record.needs.length) lines.push("Development needs: none recorded.");
  else lines.push(`Development needs: ${record.needs.slice(0, 12).map(n => `${n.title} (${NEED_STATUS_LABEL[n.status] ?? n.status})`).join("; ")}.`);

  if (record.goals === null) lines.push("Learning plan goals: could not be read just now.");
  else if (!record.goals.length) lines.push("Learning plan goals: none recorded.");
  else {
    const needTitle = new Map((record.needs ?? []).map(n => [n.id, n.title]));
    lines.push(`Learning plan goals: ${record.goals.slice(0, 12).map(g => `${g.title}, target ${g.target_date}, ${GOAL_STATUS_LABEL[g.status] ?? g.status}${g.need_id && needTitle.get(g.need_id) ? `, for need: ${needTitle.get(g.need_id)}` : ""}`).join("; ")}.`);
  }

  if (record.cpd === null) lines.push("CPD log: could not be read just now.");
  else if (!record.cpd.length) lines.push("CPD log: no entries yet.");
  else {
    const years = cpdHoursByYear(record.cpd).slice(0, 3).map(y => `${y.year}: ${y.hours} hours in ${y.entries} entries`).join("; ");
    lines.push(`CPD hours recorded by the person, by year: ${years}. No target is set.`);
    lines.push(`Recent CPD: ${record.cpd.slice(0, 6).map(c => `${c.title} (${CPD_ACTIVITY_LABEL[c.activity_type] ?? c.activity_type}, ${c.activity_date})`).join("; ")}.`);
  }
  lines.push(`Today is ${today}.`);
  return lines.join("\n");
}

export type ActivityNotes = { title: string; activityType: string; notes: string | null };

/** Pure: validate the reflection request's activity details. */
export function cleanActivity(b: Record<string, unknown>): ActivityNotes | null {
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 3 || title.length > 200) return null;
  const activityType = typeof b.activityType === "string" && CPD_ACTIVITY_LABEL[b.activityType] ? b.activityType : "other";
  const notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null;
  if (notes && notes.length > NOTES_MAX) return null;
  return { title, activityType, notes };
}
