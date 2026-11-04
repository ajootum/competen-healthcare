// PRACTISE THIS LESSON: the draft of the learner's own flashcard (learn-practice.tsx OwnCard), from the lesson's own words.
// The front and the back must belong together. A lesson's check question has no answer in the lesson (only the AI
// judgement gives one), so it is never used as the front: the front asks for the key points and the back lists them,
// one per line, cut at a whole point within the back's 600 characters. With no key points, the lesson's objective.
// The learner edits the draft before saving; saving records it as their own card (not AI-made, not clinically reviewed).

const FRONT_MAX = 300;
const BACK_MAX = 600;

/** Pure. Citation tags out, whitespace runs to one space, trimmed and cut. */
const plain = (s: string, max: number) => s.replace(/\s*\[[SRE]\d+\]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Pure. The own-card draft for one lesson step. */
export function draftOwnCard(title: string | null | undefined, points: readonly string[], objective: string | null | undefined): { front: string; back: string } {
  const name = plain(title || "", 120) || "this lesson";
  const lines: string[] = [];
  for (const raw of points) {
    const text = plain(raw, BACK_MAX);
    if (!text) continue;
    if ([...lines, `- ${text}`].join("\n").length > BACK_MAX) break;
    lines.push(`- ${text}`);
  }
  if (lines.length) return { front: `What are the key points of ${name}?`.slice(0, FRONT_MAX), back: lines.join("\n") };
  return { front: `What is ${name} about?`.slice(0, FRONT_MAX), back: plain(objective || "", BACK_MAX) };
}
