// ── SBAR HANDOVER TASK ── SCHOLAR-CE-2026 CE-04 ────────────────────────────────────────────────────────────────
//
// A decision point of kind "handover": the learner writes a handover for the CURRENT patient state in four labelled
// boxes (Situation, Background, Assessment, Recommendation). PURE. No I/O, no AI, no clock.
//
// ⚠ MARKING IS CODE FIRST. Each section must be present and non-trivial, and the blueprint's expected handover
// elements (each with the terms that may stand for it) must be mentioned. That gives part marks, deterministically.
// Optional AI feedback is a labelled comment beside the marks and never changes them.
// ⚠ The expected elements and the pass mark are server-side only. learnerView carries the kind and nothing of them.
// ⚠ FORMATIVE. A practice mark, never competence.

export const HANDOVER_SECTIONS = ["situation", "background", "assessment", "recommendation"] as const;
export type HandoverSection = typeof HANDOVER_SECTIONS[number];
export const HANDOVER_LABEL: Record<HandoverSection, string> = { situation: "Situation", background: "Background", assessment: "Assessment", recommendation: "Recommendation" };
/** The one-line prompt under each box. Generic: no profession, no condition. */
export const HANDOVER_HELP: Record<HandoverSection, string> = {
  situation: "Who you are, who the patient is, and what is happening now.",
  background: "The relevant history and what has happened so far.",
  assessment: "What you found and what you think the problem is.",
  recommendation: "What you need, from whom, and how soon.",
};
export type HandoverSections = Record<HandoverSection, string>;
export const HANDOVER_SECTION_MAX = 900;
export const HANDOVER_DEFAULTS = { minWords: 4, passMark: 0.7, sectionWeight: 0.3 } as const;
export const HANDOVER_MARKING_NOTE = "Marked by checking each section is written and the key points are mentioned. Practice only: your own words are never penalised for how they are phrased beyond that.";

/** One thing a good handover mentions. `terms` are the words that may stand for it (synonyms). `section`: where it belongs, when it matters. */
export type HandoverElement = { id: string; label: string; section?: HandoverSection | null; terms: string[]; weight?: number };
export type HandoverSpec = { elements: HandoverElement[]; minWords?: number; passMark?: number };

export const isHandoverSection = (v: unknown): v is HandoverSection => typeof v === "string" && (HANDOVER_SECTIONS as readonly string[]).includes(v);

/** Pure: the four boxes joined into the one text a written answer is kept as (435 and 423 hold a written answer as text). */
export function composeHandover(s: Partial<HandoverSections>): string {
  return HANDOVER_SECTIONS.map(k => `${HANDOVER_LABEL[k].toUpperCase()}:\n${(s[k] ?? "").replace(/\r\n/g, "\n").trim().slice(0, HANDOVER_SECTION_MAX)}`).join("\n\n");
}

/** Pure: a kept handover text read back into its four boxes. null when it is not in the composed form. */
export function parseHandover(text: unknown): HandoverSections | null {
  if (typeof text !== "string") return null;
  const out: Partial<HandoverSections> = {};
  const labels = HANDOVER_SECTIONS.map(k => HANDOVER_LABEL[k].toUpperCase());
  const at = labels.map(l => text.indexOf(`${l}:\n`));
  if (at.some((i, n) => i < 0 || (n > 0 && i <= at[n - 1]))) return null;
  HANDOVER_SECTIONS.forEach((k, n) => {
    const from = at[n] + labels[n].length + 2;
    const to = n + 1 < labels.length ? at[n + 1] : text.length;
    out[k] = text.slice(from, to).trim();
  });
  return out as HandoverSections;
}

/** Pure: lower case, punctuation to spaces, light plural stemming, single-spaced. Both sides of a match go through it. */
export function normaliseText(t: string): string {
  return ` ${t.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim().split(" ").filter(Boolean).map(w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ")} `;
}
/** Pure: does the text mention the term (whole words, in order)? */
export const mentions = (normalisedText: string, term: string): boolean => {
  const t = normaliseText(term).trim();
  return t.length > 0 && normalisedText.includes(` ${t} `);
};
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export type HandoverMark = {
  /** 0 to 1: part marks. */
  score: number; correct: boolean;
  sections: Record<HandoverSection, boolean>;
  found: string[]; missed: string[];
};

/** Pure: mark a handover. Sections present and non-trivial (30%), then the expected elements by weight (70%). */
export function markHandover(spec: HandoverSpec | null | undefined, s: Partial<HandoverSections>): HandoverMark {
  const minWords = spec?.minWords ?? HANDOVER_DEFAULTS.minWords;
  const sections = Object.fromEntries(HANDOVER_SECTIONS.map(k => { const t = (s[k] ?? "").trim(); return [k, t.length >= 12 && words(t) >= minWords]; })) as Record<HandoverSection, boolean>;
  const sectionShare = HANDOVER_SECTIONS.filter(k => sections[k]).length / HANDOVER_SECTIONS.length;
  const els = spec?.elements ?? [];
  const norm = Object.fromEntries(HANDOVER_SECTIONS.map(k => [k, normaliseText(s[k] ?? "")])) as Record<HandoverSection, string>;
  const all = normaliseText(HANDOVER_SECTIONS.map(k => s[k] ?? "").join(" . "));
  const found: string[] = [], missed: string[] = [];
  let got = 0, total = 0;
  for (const e of els) {
    const w = e.weight && e.weight > 0 ? e.weight : 1;
    total += w;
    const hay = e.section && isHandoverSection(e.section) ? norm[e.section] : all;
    if ((e.terms ?? []).some(t => mentions(hay, t))) { got += w; found.push(e.id); } else missed.push(e.id);
  }
  const share = els.length ? got / total : sectionShare;
  const score = Math.round((els.length ? HANDOVER_DEFAULTS.sectionWeight * sectionShare + (1 - HANDOVER_DEFAULTS.sectionWeight) * share : sectionShare) * 1000) / 1000;
  return { score, correct: score >= (spec?.passMark ?? HANDOVER_DEFAULTS.passMark), sections, found, missed };
}

/** Pure: problems with a handover spec as an author wrote it. Empty when sound. */
export function handoverProblems(h: unknown, id: string): string[] {
  const p: string[] = [];
  const o = h as HandoverSpec | null | undefined;
  if (!o || typeof o !== "object" || !Array.isArray(o.elements) || !o.elements.length) return [`decision ${id}: a handover needs its expected elements`];
  if (o.elements.length > 20) p.push(`decision ${id}: at most 20 expected handover elements`);
  const seen = new Set<string>();
  for (const e of o.elements) {
    if (!e || typeof e.id !== "string" || !/^[a-z][a-z0-9_-]{0,30}$/.test(e.id) || seen.has(e.id)) p.push(`decision ${id}: every handover element needs its own id`);
    else seen.add(e.id);
    if (typeof e?.label !== "string" || !e.label.trim() || e.label.length > 200) p.push(`decision ${id}: handover element ${e?.id ?? "?"} needs a label`);
    if (!Array.isArray(e?.terms) || !e.terms.length || e.terms.length > 12 || !e.terms.every((t: unknown) => typeof t === "string" && t.trim().length > 0 && t.length <= 60)) p.push(`decision ${id}: handover element ${e?.id ?? "?"} needs 1 to 12 short terms`);
    if (e?.section != null && !isHandoverSection(e.section)) p.push(`decision ${id}: handover element ${e?.id ?? "?"} names an unknown section`);
    if (e?.weight !== undefined && !(typeof e.weight === "number" && e.weight > 0 && e.weight <= 10)) p.push(`decision ${id}: handover element ${e?.id ?? "?"} weight is above 0 and at most 10`);
  }
  if (o.minWords !== undefined && !(Number.isInteger(o.minWords) && o.minWords >= 1 && o.minWords <= 30)) p.push(`decision ${id}: minWords is 1 to 30`);
  if (o.passMark !== undefined && !(typeof o.passMark === "number" && o.passMark > 0 && o.passMark <= 1)) p.push(`decision ${id}: passMark is above 0 and at most 1`);
  return p;
}

/** Pure: what a handover is expected to contain, as plain lines for an AI feedback call (server-side only). */
export const expectedHandoverText = (spec: HandoverSpec | null | undefined): string =>
  (spec?.elements ?? []).map(e => `${e.section ? `${HANDOVER_LABEL[e.section]}: ` : ""}${e.label}`).join("\n");

/** What a learner sees of the marking after submitting a handover: which boxes were written and which key points were found or missed. */
export type HandoverResultView = {
  score: number; correct: boolean;
  sections: { key: HandoverSection; label: string; written: boolean }[];
  found: string[]; missed: string[];
  note: string;
};

/** Pure: the marking of a kept handover text, for display after answering. null when the text is not a composed handover. */
export function handoverResultView(spec: HandoverSpec | null | undefined, text: unknown): HandoverResultView | null {
  const parts = parseHandover(text);
  if (!parts) return null;
  const m = markHandover(spec, parts);
  const label = (id: string) => spec?.elements.find(e => e.id === id)?.label ?? id;
  return {
    score: m.score, correct: m.correct,
    sections: HANDOVER_SECTIONS.map(k => ({ key: k, label: HANDOVER_LABEL[k], written: m.sections[k] })),
    found: m.found.map(label), missed: m.missed.map(label), note: HANDOVER_MARKING_NOTE,
  };
}
