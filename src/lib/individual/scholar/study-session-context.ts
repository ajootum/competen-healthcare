import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import { words } from "./learner-context";

// ── THE TUTOR'S VIEW OF ONE STUDY SESSION ── SCHOLAR-SESSION-AI-02 slice C, owner ruling D4 ──────────────────────────
//
// Pure. The learner's own connected study session (a 414 Learn session with 740's connected flag), turned into a short
// block the Personal AI uses to choose emphasis. It goes into the prompt under the SAME rule as buildLearnerContext
// (CONTEXT_PREAMBLE): it steers what to focus on and how to pitch it, and is never grounding, never cited, never quoted.
// Factual clinical explanations stay grounded in the learner's notes; the grounding check is not given this block.
//
// ⚠ PRIORITY (D4), highest first: focus, relevant source references, recent misconceptions, formative feedback,
//   progress. Over the cap, the lowest-priority section loses its last item first, then the next section up.
// ⚠ DETERMINISTIC. Every list is sorted here with a full tie-break and cut to a fixed limit, so the same records
//   always give the same block, whatever order they were read in.
// ⚠ WORDS ONLY (as buildLearnerContext): codes and digits are removed. A figure about the learner (a score, a count)
//   would invite one the passages lack; progress is said in words ("step three of five").
// ⚠ SCREENED. Any item carrying a patient-identifier shape (raw, before digits are stripped) is left out whole.
// ⚠ ONLY WHAT IS NAMED BELOW is read from the input. Nothing about who the learner is, nothing from Professional,
//   an employer or another learner: the input type has no such field and anything extra passed in is ignored.
// ⚠ NO PASSAGE TEXT. Sources are material titles and section topics only; the passages reach the AI on their own.
// ⚠ NOT FORMAL EVIDENCE (D5). Practice results here are formative and say nothing about competence. Written-answer
//   feedback (SCHOLAR-WRITTEN-FEEDBACK-01) is the AI's formative feedback, labelled so: never self-assessment, never verified.

/** D4: the block is held to about this many characters (roughly 750 input tokens). */
export const STUDY_CONTEXT_MAX_CHARS = 3000;

/** Fixed limits, so the selection never depends on how much was read. */
export const STUDY_CONTEXT_LIMITS = {
  competencies: 5, sources: 6, topicsPerSource: 4, missed: 6, unsure: 4, mistakes: 3, osce: 3, gapsPerOsce: 5, suggestionsPerOsce: 3, written: 3, pointsPerWritten: 2, stemChars: 160, itemChars: 200,
} as const;

export type StudySessionContextInput = {
  focus: { title: string; objective: string | null; competencies: readonly string[] };
  /** The session's materials, in session order (`order`), with the topics of its sections. */
  sources: readonly { material: string; order: number; topics: readonly string[] }[];
  /** Questions in the session's sections answered wrongly. `still`: the latest answer was wrong too. */
  missed: readonly { id: string; stem: string; topic: string | null; at: string | null; still: boolean }[];
  /** Rubric misconceptions recorded against the missed questions (the learner's own revision items). */
  mistakes: readonly string[];
  /** Steps whose informal check came back "not yet", by the step's topic. */
  unsure: readonly { topic: string; at: string }[];
  /** Formative OSCE feedback from runs linked to the session: gaps and revision suggestions. */
  osce: readonly { id: string; station: string | null; at: string; gaps: readonly { text: string; critical: boolean; mark: "partly" | "missed" }[]; suggestions: readonly string[] }[];
  /**
   * SCHOLAR-WRITTEN-FEEDBACK-01: formative AI feedback kept on the learner's written answers in the session's sections
   * (written-feedback.ts): what it said was missing, any mistaken idea, what to revise next, or its summary. Headlines
   * only: never the verdict or a mark, and never self-assessment or verification.
   */
  written?: readonly { id: string; stem: string; topic: string | null; at: string; missing: readonly string[]; misconceptions: readonly string[]; next: string | null; summary: string | null }[];
  progress: { stepsDone: number; stepsTotal: number; completed: boolean; stagesTouched: readonly string[] } | null;
};

export type StudySessionSection = "focus" | "sources" | "misconceptions" | "feedback" | "progress";
/** D4 order, highest priority first. */
export const STUDY_SECTION_ORDER: readonly StudySessionSection[] = ["focus", "sources", "misconceptions", "feedback", "progress"];

export const STUDY_CONTEXT_HEADER = "MY STUDY SESSION (what I chose to study and how my practice has gone; educational context only, not clinical evidence, never a source to cite):";

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const spell = (n: number) => SMALL[Math.max(0, Math.floor(n))] ?? "many";

/** One item: screened raw, then words only, trimmed. "" when it must be left out. */
function clean(raw: string | null | undefined, max: number = STUDY_CONTEXT_LIMITS.itemChars): string {
  const s = typeof raw === "string" ? raw : "";
  if (!s.trim() || findPatientIdentifiers(s).length) return "";
  const w = words(s);
  return w.length > max ? `${w.slice(0, max - 3).replace(/\s+\S*$/, "")}...` : w;
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Distinct non-empty items, first kept, in the given order. */
const distinct = (xs: readonly string[]) => { const seen = new Set<string>(); return xs.filter(x => x && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true)); };

type Section = { name: StudySessionSection; head: string; items: string[]; join: string };

function sections(input: StudySessionContextInput): Section[] {
  const L = STUDY_CONTEXT_LIMITS;
  const f = input.focus;
  const focus = distinct([
    clean(f.title) ? `I am studying: ${clean(f.title)}.` : "",
    clean(f.objective) ? `My objective: ${clean(f.objective)}.` : "",
    (() => { const c = distinct([...f.competencies].map(x => clean(x)).sort(cmp)).slice(0, L.competencies); return c.length ? `Competencies: ${c.join("; ")}.` : ""; })(),
  ]);

  const sources = distinct([...input.sources].sort((a, b) => a.order - b.order || cmp(a.material, b.material)).map(s => {
    const m = clean(s.material);
    if (!m) return "";
    const t = distinct([...s.topics].map(x => clean(x)).sort(cmp)).slice(0, L.topicsPerSource);
    return t.length ? `${m} (sections on ${t.join(", ")})` : m;
  })).slice(0, L.sources);

  // Still wrong first, then most recent, then by id: a fixed order whatever the read order was.
  const missed = distinct([...input.missed]
    .sort((a, b) => Number(b.still) - Number(a.still) || cmp(b.at ?? "", a.at ?? "") || cmp(a.id, b.id))
    .map(q => { const stem = clean(q.stem, L.stemChars); if (!stem) return ""; const t = clean(q.topic); return `${t ? `${t}: ` : ""}${stem}${q.still ? "" : " (right since)"}`; }))
    .slice(0, L.missed).map(x => `I missed: ${x}`);
  const mistakes = distinct([...input.mistakes].map(x => clean(x)).sort(cmp)).slice(0, L.mistakes).map(x => `A mistake to avoid: ${x}`);
  const unsure = distinct([...input.unsure].sort((a, b) => cmp(b.at, a.at) || cmp(a.topic, b.topic)).map(u => clean(u.topic))).slice(0, L.unsure).map(x => `My check was not yet right on: ${x}`);

  const feedback = [...input.osce].sort((a, b) => cmp(b.at, a.at) || cmp(a.id, b.id)).slice(0, L.osce).map(o => {
    const gaps = [...o.gaps].sort((a, b) => Number(b.critical) - Number(a.critical) || cmp(a.mark, b.mark) || cmp(a.text, b.text))
      .map(g => { const t = clean(g.text); return t ? `${t} (${g.mark === "missed" ? "missed" : "partly done"}${g.critical ? ", critical" : ""})` : ""; });
    const g = distinct(gaps).slice(0, L.gapsPerOsce);
    const have = new Set(g.map(x => x.toLowerCase()));
    const s = distinct([...o.suggestions].map(x => clean(x)).filter(x => ![...have].some(h => h.startsWith(x.replace(/^learn:\s*/i, "").toLowerCase())))).slice(0, L.suggestionsPerOsce);
    if (!g.length && !s.length) return "";
    const station = clean(o.station);
    return `OSCE practice${station ? ` on ${station}` : ""}: ${[g.length ? `gaps: ${g.join("; ")}` : "", s.length ? `suggested next: ${s.join("; ")}` : ""].filter(Boolean).join(". ")}`;
  }).filter(Boolean);

  // Formative AI feedback on written answers: newest first, then by id. Headlines only, each part screened and cut.
  const written = distinct([...(input.written ?? [])].sort((a, b) => cmp(b.at, a.at) || cmp(a.id, b.id)).map(w => {
    const stem = clean(w.stem, L.stemChars);
    if (!stem) return "";
    const pick = (xs: readonly string[]) => distinct([...xs].map(x => clean(x))).slice(0, L.pointsPerWritten);
    const missing = pick(w.missing), wrong = pick(w.misconceptions), next = clean(w.next), summary = clean(w.summary);
    const said = [missing.length ? `missing ${missing.join("; ")}` : "", wrong.length ? `mistaken idea ${wrong.join("; ")}` : "", next ? `revise next ${next}` : ""].filter(Boolean);
    const body = said.length ? said.join(". ") : summary;
    if (!body) return "";
    const t = clean(w.topic);
    return `Formative AI feedback on my written answer${t ? ` on ${t}` : ""} to "${stem}": ${body}`;
  })).slice(0, L.written);

  const p = input.progress;
  const progress = !p ? [] : distinct([
    p.completed ? "I have finished the learning steps." : p.stepsTotal > 0 ? `I have done ${spell(Math.min(p.stepsDone, p.stepsTotal))} of ${spell(p.stepsTotal)} learning steps.` : "",
    (() => { const s = distinct([...p.stagesTouched].map(x => clean(x))); return s.length ? `Stages I have used in this session: ${s.join(", ")}.` : ""; })(),
  ]);

  return [
    { name: "focus", head: "", items: focus, join: " " },
    { name: "sources", head: "Sources I am studying from: ", items: sources, join: "; " },
    { name: "misconceptions", head: "", items: [...missed, ...unsure, ...mistakes], join: "\n" },
    { name: "feedback", head: "", items: [...feedback, ...written], join: "\n" },
    { name: "progress", head: "", items: progress, join: " " },
  ];
}

const render = (ss: readonly Section[]) => {
  const body = ss.filter(s => s.items.length).map(s => `${s.head}${s.items.join(s.join)}${s.head && !/[.]$/.test(s.items[s.items.length - 1]) ? "." : ""}`);
  return body.length ? `${STUDY_CONTEXT_HEADER}\n${body.join("\n")}` : "";
};

/**
 * Pure. The study-session block and which sections it kept, or null when there is nothing worth saying. Over
 * `max`, items are taken from the lowest-priority section first (its last item first), then the next one up.
 */
export function buildStudySessionContext(input: StudySessionContextInput, max: number = STUDY_CONTEXT_MAX_CHARS): { text: string; sections: StudySessionSection[] } | null {
  const ss = sections(input);
  let text = render(ss);
  for (let i = ss.length - 1; i >= 0 && text.length > max; i--) {
    while (ss[i].items.length && text.length > max) { ss[i].items.pop(); text = render(ss); }
  }
  if (!text) return null;
  // A last guard only: with the fixed limits above the focus alone is far below the cap.
  if (text.length > max) text = text.slice(0, max);
  return { text, sections: ss.filter(s => s.items.length).map(s => s.name) };
}
