// SCHOLAR-GO-DEEPER-001 (owner instruction, 6 Nov 2026): THE STRUCTURED GO DEEPER ANSWER, and how it is read back. Pure and
// client-safe: no server imports, so the Learn workspace reads the same parser the engine (generation.ts checkDeeperAnswer) writes with.
//
// "Simplify the presentation, not the science." One round teaches ONE major concept the lesson has not yet given, in sections the
// topic earns (no forced sections). It is written in labelled lines, each label at the start of its own line:
//   FOCUS QUESTION:        the question this round explores
//   COVERS:                one line on what it covers
//   SECTION: kind | source | heading     then its paragraphs, lists, a table ('| a | b |' rows, the first the header) or a flow ('FLOW: a -> b -> c')
//   CHECK YOUR REASONING:  '- ' a question ending with its [S n], optionally followed by 'a) ...' options
//   KEY TAKEAWAYS:         '- ' one line each
// ⚠ EVERY SECTION SAYS WHERE IT COMES FROM. `notes`: cited to the learner's own sections and checked against them. `scholar`:
// Scholar's own explanation beyond the notes, never cited, never figures or doses, and never presented as a research finding
// (generation.ts checkDeeperAnswer). Published research is not a section: it stays in its own FROM RESEARCH part with its own check.
// ⚠ ADDITIVE. An earlier Go deeper round (scholar-learn-deeper-v2, written in Teach me's parts) carries none of these labels:
// parseDeeperAnswer returns null and it is shown exactly as it always was. Nothing saved is rewritten or retired.

import type { ExplanationDepth } from "./config";

export const DEEPER_KINDS = ["principle", "science", "compare", "application", "misconception", "safety", "limits", "advanced"] as const;
export type DeeperKind = (typeof DEEPER_KINDS)[number];
export type DeeperSource = "notes" | "scholar";
export type DeeperBlock =
  | { t: "p"; text: string }
  | { t: "list"; items: string[] }
  | { t: "table"; rows: string[][] }
  | { t: "flow"; steps: string[] };
export type DeeperSection = { kind: DeeperKind; source: DeeperSource; title: string; blocks: DeeperBlock[] };
export type DeeperQuestion = { text: string; options: string[] };
export type DeeperParts = { focus: string; covers: string | null; sections: DeeperSection[]; questions: DeeperQuestion[]; takeaways: string[] };

export const DEEPER_LABEL = { focus: "FOCUS QUESTION:", covers: "COVERS:", section: "SECTION:", check: "CHECK YOUR REASONING:", takeaways: "KEY TAKEAWAYS:" } as const;
export const DEEPER_MAX_QUESTIONS = 2;
export const DEEPER_MAX_OPTIONS = 4;
export const DEEPER_MAX_SECTIONS = 7;
export const DEEPER_MAX_TAKEAWAYS = 5;

// ── THE THREE LEVELS (the decision is recorded in docs/programme/SCHOLAR-GO-DEEPER-001.md) ──
// Each level IS an existing depth, so a round's level is already stored (the artefact's depth), already in its saved key, and the
// learner's depth preference already says where to start. No new column, no second selector behind the first, no migration.
export type GoDeeperLevelKey = "understand" | "explore" | "advanced";
export const GO_DEEPER_LEVELS: readonly { key: GoDeeperLevelKey; depth: ExplanationDepth; label: string; hint: string }[] = [
  { key: "understand", depth: "brief", label: "Understand", hint: "The principle and the mechanism that explains it, with every term explained." },
  { key: "explore", depth: "standard", label: "Explore", hint: "Scientific mechanisms, meaningful comparisons and practical applications, with research findings where they are available." },
  { key: "advanced", depth: "detailed", label: "Advanced", hint: "Finer mechanisms, competing explanations, the limits of what is known, and harder application." },
];
export const levelOfDepth = (depth: string | null | undefined) => GO_DEEPER_LEVELS.find(l => l.depth === depth) ?? GO_DEEPER_LEVELS[1];

const labelRe = (words: string) => new RegExp(`^[\\s*_#>-]*${words}\\s*:[\\s*_]*`, "i");
const RE = { focus: labelRe("focus\\s+question"), covers: labelRe("covers"), section: labelRe("section"), check: labelRe("check\\s+your\\s+reasoning"), takeaways: labelRe("key\\s+takeaways") };
const AFTER_THE_ROUND = /^[\s*_#>-]*(?:FROM RESEARCH|BEYOND THE NOTES|CHECK THIS):?/i;
const FLOW_RE = /^[\s*_]*flow\s*:[\s*_]*/i;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const OPTION_RE = /^\s*[-*•]?\s*\(?([a-d])[).]\s+/i;
const clean = (s: string) => s.replace(/\*\*|__/g, "").trim();

/** A section line: kind | source | heading. An unknown source is `notes`, so it must pass the stricter check; an unknown kind is `science`. */
function sectionHead(rest: string): Pick<DeeperSection, "kind" | "source" | "title"> {
  const bits = clean(rest).split("|").map(x => x.trim());
  const kind = (DEEPER_KINDS as readonly string[]).includes(bits[0]?.toLowerCase()) ? bits[0].toLowerCase() as DeeperKind : "science";
  const source: DeeperSource = bits[1]?.toLowerCase() === "scholar" ? "scholar" : "notes";
  const title = bits.length >= 3 ? bits.slice(2).join(" ") : bits[bits.length - 1] ?? "";
  return { kind, source, title: title.trim() };
}

function blocksOf(lines: readonly string[]): DeeperBlock[] {
  const out: DeeperBlock[] = [];
  let para: string[] = [], rows: string[][] = [], list: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join(" ") });
    if (list.length) out.push({ t: "list", items: list });
    if (rows.length >= 2 && rows.every(r => r.length === rows[0].length)) out.push({ t: "table", rows });
    else if (rows.length) out.push({ t: "list", items: rows.map(r => r.join(": ")) }); // a malformed table still reads, as lines
    para = []; rows = []; list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flush(); continue; }
    if (l.startsWith("|")) {
      if (para.length || list.length) flush();
      if (/^\|[\s:|-]+\|?$/.test(l)) continue; // the markdown separator row
      rows.push(l.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => clean(c)));
      continue;
    }
    if (FLOW_RE.test(l)) {
      flush();
      const steps = l.replace(FLOW_RE, "").split(/\s*(?:->|→)\s*/).map(clean).filter(Boolean);
      if (steps.length >= 2) out.push({ t: "flow", steps });
      else if (steps.length) out.push({ t: "p", text: steps[0] });
      continue;
    }
    if (BULLET_RE.test(l)) {
      if (para.length || rows.length) flush();
      list.push(clean(l.replace(BULLET_RE, "")));
      continue;
    }
    if (list.length || rows.length) flush();
    para.push(clean(l));
  }
  flush();
  return out;
}

/** Pure. The labelled parts of a structured Go deeper round, or null when it has no focus question and no section (an earlier round). */
export function parseDeeperAnswer(text: string): DeeperParts | null {
  if (!text) return null;
  const focusLines: string[] = [], coversLines: string[] = [], check: string[] = [], take: string[] = [];
  const sections: (Pick<DeeperSection, "kind" | "source" | "title"> & { lines: string[] })[] = [];
  let at: "focus" | "covers" | "section" | "check" | "takeaways" | null = null;
  for (const line of text.split("\n")) {
    // The other parts of a saved answer are not the round's (generation.ts splitLearnAnswer): research above all must never run on into a takeaway.
    if (AFTER_THE_ROUND.test(line)) break;
    if (RE.focus.test(line)) { at = "focus"; focusLines.push(line.replace(RE.focus, "")); continue; }
    if (RE.covers.test(line)) { at = "covers"; coversLines.push(line.replace(RE.covers, "")); continue; }
    if (RE.section.test(line)) { at = "section"; sections.push({ ...sectionHead(line.replace(RE.section, "")), lines: [] }); continue; }
    if (RE.check.test(line)) { at = "check"; const rest = line.replace(RE.check, "").trim(); if (rest) check.push(rest); continue; }
    if (RE.takeaways.test(line)) { at = "takeaways"; const rest = line.replace(RE.takeaways, "").trim(); if (rest) take.push(rest); continue; }
    if (at === "focus") focusLines.push(line);
    else if (at === "covers") coversLines.push(line);
    else if (at === "section") sections[sections.length - 1].lines.push(line);
    else if (at === "check") check.push(line);
    else if (at === "takeaways") take.push(line);
  }
  const focus = clean(focusLines.join(" "));
  if (!focus || !sections.length) return null;
  const questions: DeeperQuestion[] = [];
  for (const l of check) {
    if (!l.trim()) continue;
    if (OPTION_RE.test(l) && questions.length) { questions[questions.length - 1].options.push(clean(l.replace(OPTION_RE, ""))); continue; }
    if (BULLET_RE.test(l) || !questions.length) questions.push({ text: clean(l.replace(BULLET_RE, "")), options: [] });
    else questions[questions.length - 1].text += ` ${clean(l)}`;
  }
  const takeaways: string[] = [];
  for (const l of take) {
    if (!l.trim()) continue;
    if (BULLET_RE.test(l) || !takeaways.length) takeaways.push(clean(l.replace(BULLET_RE, "")));
    else takeaways[takeaways.length - 1] += ` ${clean(l)}`;
  }
  return {
    focus, covers: clean(coversLines.join(" ")) || null,
    sections: sections.map(s => ({ kind: s.kind, source: s.source, title: s.title, blocks: blocksOf(s.lines) })).filter(s => s.blocks.length > 0),
    questions, takeaways,
  };
}

/** Pure. The canonical text of a structured round: what is shown, saved and parsed back. Empty parts are left out. */
export function composeDeeperAnswer(p: DeeperParts): string {
  const out: string[] = [`${DEEPER_LABEL.focus} ${p.focus.trim()}`];
  if (p.covers?.trim()) out.push(`${DEEPER_LABEL.covers} ${p.covers.trim()}`);
  for (const s of p.sections) {
    const body = s.blocks.map(b => b.t === "p" ? b.text
      : b.t === "list" ? b.items.map(x => `- ${x}`).join("\n")
        : b.t === "flow" ? `FLOW: ${b.steps.join(" -> ")}`
          : b.rows.map(r => `| ${r.join(" | ")} |`).join("\n")).join("\n\n");
    out.push(`${DEEPER_LABEL.section} ${s.kind} | ${s.source} | ${s.title}\n${body}`);
  }
  if (p.questions.length) out.push(`${DEEPER_LABEL.check}\n${p.questions.map(q => [`- ${q.text}`, ...q.options.map((o, i) => `  ${"abcd"[i]}) ${o}`)].join("\n")).join("\n")}`);
  if (p.takeaways.length) out.push(`${DEEPER_LABEL.takeaways}\n${p.takeaways.map(x => `- ${x}`).join("\n")}`);
  return out.join("\n\n");
}

/** Pure. A section's words as one text (no labels, table bars or arrows): what the checks and the risk rules read. */
export function deeperSectionText(s: Pick<DeeperSection, "blocks">): string {
  return s.blocks.map(b => b.t === "p" ? b.text : b.t === "list" ? b.items.join("\n") : b.t === "flow" ? b.steps.join("\n") : b.rows.map(r => r.join("\n")).join("\n")).join("\n");
}

/** Pure. The round as plain reading: for Read aloud and a saved lesson's text. No labels, no bars. */
export function deeperPlainText(p: DeeperParts): string {
  return [
    p.focus, p.covers ?? "",
    ...p.sections.map(s => `${s.title}\n${deeperSectionText(s)}`),
    ...(p.takeaways.length ? [`Key takeaways\n${p.takeaways.join("\n")}`] : []),
  ].filter(Boolean).join("\n\n");
}

/** Pure. Only what is cited to the learner's own sections: a saved round must never become "notes" through Scholar's own explanation. */
export function deeperNotesOnlyText(p: DeeperParts): string {
  const notes = p.sections.filter(s => s.source === "notes").map(s => `${s.title}\n${deeperSectionText(s)}`);
  return [...notes, ...p.takeaways.filter(t => /\[S\d+\]/.test(t))].join("\n\n");
}

/** A takeaway with no citation is Scholar's own, and says so wherever it is shown. */
export const takeawayLine = (t: string) => (/\[S\d+\]/.test(t) ? t : `${t} (Scholar’s explanation)`);

/** Pure. A saved answer's research part, which the round's parser stops short of, or null. */
export function deeperResearchText(content: string): string | null {
  const m = /^[\s*_#>-]*FROM RESEARCH:?[\s*_]*([\s\S]*?)(?=^[\s*_#>-]*(?:BEYOND THE NOTES|CHECK THIS):?|(?![\s\S]))/im.exec(content);
  return m?.[1].trim() || null;
}

/** Pure. A saved round read as text, each section saying where it comes from. */
export function deeperSourcedText(p: DeeperParts): string {
  return [
    p.focus, p.covers ?? "",
    ...p.sections.map(s => `${s.title} (${s.source === "notes" ? "From your notes" : "Scholar’s explanation, not from your notes"})\n${deeperSectionText(s)}`),
    ...(p.takeaways.length ? [`Key takeaways\n${p.takeaways.map(takeawayLine).join("\n")}`] : []),
  ].filter(Boolean).join("\n\n");
}

/** When a heading fails the checks, the section keeps its place under one of these. */
export const DEEPER_NEUTRAL_HEADING: Record<DeeperKind, string> = {
  principle: "The principle", science: "The science", compare: "A comparison", application: "In practice", misconception: "A common misconception", safety: "Safety", limits: "The limits", advanced: "Further detail",
};

/** The headings the page shows: the card, the grey block, the source of each section and the evidence footer. */
export const GO_DEEPER_COPY = {
  card: "Go Deeper",
  subtitle: "Scientific understanding · Clinical application",
  levels: "Explore at your level",
  focus: "The question we are exploring",
  check: "Check your reasoning",
  takeaways: "Key takeaways",
  footer: "Sources and evidence",
  notes: "From your notes",
  scholar: "Scholar’s explanation",
  scholarNote: "General teaching by AI, beyond your notes. Not checked against published research.",
  research: "From published research",
  ai: "AI-generated, not clinically reviewed",
} as const;

/** Pure. The plain statement of what this round rests on. Said on every structured round, so the limit is never left to inference. */
export function deeperEvidenceStatement(has: { research: "shown" | "looked" | "none"; scholar: boolean }): string {
  const notes = "Sections marked “From your notes” are cited to your own material.";
  const scholar = has.scholar ? " Sections marked “Scholar’s explanation” are general teaching written by AI: they are not from your notes and have not been checked against published research, so check them with your course." : "";
  const research = has.research === "shown"
    ? " The part marked “From published research” rests only on the abstracts listed here, and abstracts alone cannot settle a question."
    : has.research === "looked"
      ? " Published research was looked for this round, but nothing from it is shown here, so nothing here is a verified research finding."
      : " No published research was consulted for this round, so nothing here is a verified research finding.";
  return `${notes}${scholar}${research}`;
}
