// SQIE 998: the shared samples for hasSafetyMarkers (unit test) and ckri_question_has_safety_markers (VERIFY-998, generated from this
// list by scripts/sqie-hq/build-verify-998.ts), so the page and the database are held to one rule.

export type MarkerSample = { name: string; content: unknown; markers: boolean };

export const MARKER_SAMPLES: MarkerSample[] = [
  { name: "mcq, no markers", markers: false, content: { format: "mcq", stem: "Which?", options: ["a", "b"], correct_index: 0, answerKey: { format: "mcq" } } },
  { name: "short, safetyCritical false, empty unsafe", markers: false, content: { format: "short", answerKey: { format: "short", accepted: ["x"], safetyCritical: false, unsafe: [] } } },
  { name: "short, safety-critical", markers: true, content: { format: "short", answerKey: { format: "short", accepted: ["x"], safetyCritical: true } } },
  { name: "short, unsafe answers", markers: true, content: { format: "short", answerKey: { format: "short", accepted: ["x"], unsafe: ["give it IV push"] } } },
  { name: "safetyCritical the string true is not a marker", markers: false, content: { answerKey: { safetyCritical: "true" } } },
  { name: "unsafe as a string is not a marker", markers: false, content: { answerKey: { unsafe: "give it" } } },
  { name: "calculation, safety-critical", markers: true, content: { format: "calculation", answerKey: { format: "calculation", accepted: ["66 mmHg"], value: 66, unit: "mmHg", safetyCritical: true } } },
  { name: "calculation, not safety-critical", markers: false, content: { format: "calculation", answerKey: { format: "calculation", accepted: ["66 mmHg"], value: 66, unit: "mmHg", safetyCritical: false } } },
  { name: "extended, safety-critical key point", markers: true, content: { format: "extended", rubric: { keyPoints: ["Call for help", "Start CPR"] }, answerKey: { format: "extended", safetyCriticalPoints: [0] } } },
  { name: "extended, empty safety-critical points", markers: false, content: { format: "extended", rubric: { keyPoints: ["a"] }, answerKey: { format: "extended", safetyCriticalPoints: [] } } },
  { name: "structured, a safety-critical part", markers: true, content: { format: "structured", answerKey: { format: "structured", parts: [{ prompt: "a", marks: 1 }, { prompt: "b", marks: 2, safetyCritical: true }] } } },
  { name: "structured, a part with a safety-critical criterion and unsafe answers", markers: true, content: { format: "structured", answerKey: { format: "structured", parts: [
    { prompt: "a", marks: 1 },
    { prompt: "b", marks: 2, unsafe: ["Give the next dose anyway"], criteria: [{ text: "Withholds the dose", weight: 2, safetyCritical: true }, { text: "Rechecks the level", weight: 1 }] },
  ] } } },
  { name: "structured, criteria without a safety-critical one", markers: false, content: { format: "structured", answerKey: { format: "structured", parts: [{ prompt: "a", marks: 1, criteria: [{ text: "x", weight: 1, safetyCritical: false }] }, { prompt: "b", marks: 1 }] } } },
  { name: "parts that are not an array", markers: false, content: { answerKey: { parts: { safetyCritical: true } } } },
  { name: "no answer key", markers: false, content: { format: "short" } },
];
