// ── THE CASE DEBRIEF: WHAT WENT WELL, WHAT WAS MISSED, WHAT WAS UNSAFE ── LEARNING-CLOSE-2026-11 CE-04 (SALE-13) ─────────
//
// PURE. One deterministic review of a FINISHED case attempt, built from the blueprint and what the session recorded: the
// decisions and their keys, the safety criteria, the SBAR handover marks, the findings never asked for, the deterioration
// timeline's escalation windows, and the key questions to the simulated patient. No AI, no I/O. The same record always
// gives the same review, so it can be shown again on any device and kept with the attempt.
//
// ⚠ AFTER THE CASE ONLY. Every line names a key, an expected point or a window, so it is built only once the case is
// complete (the callers check). It is never sent while the case is open.
// ⚠ FORMATIVE. Practice feedback from a simulation, never an assessment and never verified competence.

import type { Blueprint } from "./blueprint";
import { markHandover, parseHandover } from "./handover";
import { escalationSentence, type EscalationOutcome } from "./timeline";

export const CASE_REVIEW_LABEL = "Debrief from a simulated case: practice feedback only. It is not an assessment and not evidence of clinical competence.";
export const CASE_REVIEW_CAPS = { perList: 20, line: 300 } as const;

export type ReviewAnswer = { decisionPointId: string; chosen: readonly string[]; text?: string | null };
export type CaseReview = { label: string; wentWell: string[]; missed: string[]; unsafe: string[] };

const cut = (s: string) => (s.length > CASE_REVIEW_CAPS.line ? `${s.slice(0, CASE_REVIEW_CAPS.line - 1)}…` : s);
const short = (s: string, n = 90) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * Pure: the review of one finished attempt. `escalations` (CE-04C) and `questions` (CE-04A key questions) are optional;
 * without them those lines are simply absent, never guessed.
 */
export function caseReview(b: Blueprint, x: {
  answers: readonly ReviewAnswer[]; revealed: readonly string[]; reached: readonly string[];
  escalations?: readonly EscalationOutcome[] | null;
  questions?: { asked: { label: string }[]; missed: { label: string }[] } | null;
}): CaseReview {
  const wentWell: string[] = [], missed: string[] = [], unsafe: string[] = [];
  const by = new Map(x.answers.map(a => [a.decisionPointId, a]));
  for (const d of b.decisionPoints) {
    const a = by.get(d.id);
    if (!a) continue;
    const where = short(d.prompt);
    if (d.kind === "handover") {
      const parts = parseHandover(a.text ?? null);
      if (!parts) continue;
      const m = markHandover(d.handover, parts);
      const label = (id: string) => d.handover?.elements.find(e => e.id === id)?.label ?? id;
      if (m.found.length) wentWell.push(`Your handover covered: ${m.found.map(label).join("; ")}.`);
      if (m.missed.length) missed.push(`Your handover did not mention: ${m.missed.map(label).join("; ")}.`);
      const empty = Object.entries(m.sections).filter(([, ok]) => !ok).map(([k]) => k[0].toUpperCase() + k.slice(1));
      if (empty.length) missed.push(`Handover sections left thin or empty: ${empty.join(", ")}.`);
      continue;
    }
    if (d.kind === "free_text") continue;                    // a written answer is not marked by code
    const key = d.options.filter(o => o.correct).map(o => o.id);
    const right = key.length > 0 && key.every(k => a.chosen.includes(k)) && a.chosen.every(c => key.includes(c));
    if (right) wentWell.push(`${where}: you chose the expected answer.`);
    else missed.push(`${where}: the expected answer was ${d.options.filter(o => o.correct).map(o => `"${short(o.text, 80)}"`).join(" and ")}.`);
  }
  for (const c of b.safetyCriteria) {
    const a = by.get(c.decisionPointId);
    if (!a) continue;
    if ((c.mustSelect ?? []).some(o => !a.chosen.includes(o)) || (c.mustNotSelect ?? []).some(o => a.chosen.includes(o))) unsafe.push(`Safety: ${c.text}`);
  }
  const visible = new Set([...x.revealed, ...b.facts.filter(f => f.revealedAt === "start" || x.reached.includes(f.revealedAt)).map(f => f.id)]);
  for (const st of b.stages) if (x.reached.includes(st.id)) for (const r of st.reveals) visible.add(r);
  const askable = new Set(b.decisionPoints.filter(d => by.has(d.id)).flatMap(d => d.permittedReveals));
  const never = b.facts.filter(f => askable.has(f.id) && !visible.has(f.id));
  const neverCritical = never.filter(f => f.safetyCritical).map(f => f.label);
  const neverOther = never.filter(f => !f.safetyCritical).map(f => f.label);
  if (neverCritical.length) missed.push(`You did not ask for these important findings: ${neverCritical.join("; ")}.`);
  if (neverOther.length) missed.push(`You could also have asked for: ${neverOther.join("; ")}.`);
  const asked = [...askable].filter(id => x.revealed.includes(id)).map(id => b.facts.find(f => f.id === id)?.label).filter((l): l is string => !!l);
  if (asked.length) wentWell.push(`You asked for: ${asked.join("; ")}.`);
  for (const e of x.escalations ?? []) {
    if (e.timeliness === "pending") continue;
    if (e.recognised) wentWell.push(`You recognised the deterioration (${e.label}).`);
    else missed.push(`The deterioration was not recognised (${e.label}).`);
    const line = escalationSentence(e);
    if (e.timeliness === "on_time") wentWell.push(line);
    else if (e.timeliness === "late" || e.timeliness === "missed") (e.safetyCritical ? unsafe : missed).push(line);
  }
  if (x.questions?.asked.length) wentWell.push(`You asked the patient about: ${x.questions.asked.map(q => q.label).join("; ")}.`);
  if (x.questions?.missed.length) missed.push(`You did not ask the patient about: ${x.questions.missed.map(q => q.label).join("; ")}.`);
  const cap = (xs: string[]) => [...new Set(xs)].slice(0, CASE_REVIEW_CAPS.perList).map(cut);
  return { label: CASE_REVIEW_LABEL, wentWell: cap(wentWell), missed: cap(missed), unsafe: cap(unsafe) };
}
