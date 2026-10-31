// ── THE SCHOLAR LEARNING SPACES AND THE EIGHT-STAGE JOURNEY ── Scholar HFE redesign, 2026-10-26 ────────
//
// The words and the order of My Learning's spaces (Library, Learn, Revise, Apply, Evaluate, Progress) and of
// the eight-stage journey (docs/COMPETEN-SCHOLAR-PRODUCT-ARCHITECTURE.md), read by the tab bar, every
// space's header and the journey dialog -- so they cannot disagree. Copy is the agreed prototype's.
//
// ⚠ THIS MODULE IMPORTS NOTHING (the experiences.ts rule): client and server components both read it.
//
// ⚠ THE STAGES ARE A GUIDE, NOT A ROUTE. Nothing here gates a page: every space is reachable at any time,
// and a suggestion never locks the next step.

export type ScholarSpaceKey = "library" | "learn" | "revise" | "apply" | "evaluate" | "progress";

export type ScholarSpace = {
  key: ScholarSpaceKey;
  /** Path below /individual/scholar. */
  segment: string;
  /** The tab's label. */
  tab: string;
  eyebrow: string;
  title: string;
  intro: string;
  /** Other paths below /individual/scholar that belong to this space (its tab is current on them). */
  also?: readonly string[];
};

export const SCHOLAR_SPACES: readonly ScholarSpace[] = [
  { key: "library", segment: "study", tab: "Library", eyebrow: "Your library", title: "My Learning",
    intro: "Your materials, connected to what you want to learn." },
  { key: "learn", segment: "study/learn", tab: "Learn", eyebrow: "Source-grounded study", title: "Learn",
    intro: "Understand your notes. Keep the evidence in view.", also: ["study/saved"] },
  { key: "revise", segment: "study/revise", tab: "Revise", eyebrow: "Recall & retention", title: "Revise",
    intro: "Return to what needs attention, on your schedule." },
  { key: "apply", segment: "study/apply", tab: "Apply", eyebrow: "Clinical reasoning", title: "Apply",
    intro: "Recognise, interpret, prioritise, decide and explain.", also: ["study/apply/osce"] },
  { key: "evaluate", segment: "study/evaluate", tab: "Evaluate", eyebrow: "Reflect on your evidence", title: "Evaluate",
    intro: "See what your practice supports, and where evidence is still thin." },
  { key: "progress", segment: "study/progress", tab: "Progress", eyebrow: "Your learning over time", title: "Progress",
    intro: "Practised, remembered and reflected on. Always distinct from verified competence." },
];

export const scholarSpace = (key: ScholarSpaceKey): ScholarSpace => SCHOLAR_SPACES.find(s => s.key === key)!;

const under = (path: string, segment: string) => path === segment || path.startsWith(`${segment}/`);

/**
 * The space a path below /individual/scholar belongs to (the current tab), or null outside My Learning.
 * The most specific space wins, so study/learn is Learn and study/<material id> is the Library.
 */
export function spaceOfPath(path: string): ScholarSpaceKey | null {
  const p = path.replace(/^\/individual\/scholar\/?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  let best: { key: ScholarSpaceKey; len: number } | null = null;
  for (const s of SCHOLAR_SPACES) {
    for (const seg of [s.segment, ...(s.also ?? [])]) {
      if (under(p, seg) && (!best || seg.length > best.len)) best = { key: s.key, len: seg.length };
    }
  }
  return best?.key ?? null;
}

/** What every formative surface says, where the learner reads it (shared principle: formative is never verified). */
export const FORMATIVE_NOTICE = "Formative learning only · Private to you · Not verified clinical competence";

export type ScholarStage = { name: string; summary: string };

/** docs/COMPETEN-SCHOLAR-PRODUCT-ARCHITECTURE.md, in its order. Interconnected, not compulsory steps. */
export const SCHOLAR_STAGES: readonly ScholarStage[] = [
  { name: "Join", summary: "Your shared Individual identity, entitlements and educational context, set during onboarding." },
  { name: "Upload", summary: "Add your own study material." },
  { name: "Classify", summary: "Concepts and suggested competency links, organised from your material and kept for your review." },
  { name: "Learn", summary: "Have your material explained, with the source in view." },
  { name: "Revise", summary: "Recall and retention, on a schedule." },
  { name: "Apply", summary: "Clinical reasoning and the wider application of what you know." },
  { name: "Evaluate", summary: "What your learning evidence supports, and where it is still thin." },
  { name: "Progress", summary: "Your learning over time, and what to do next." },
];
