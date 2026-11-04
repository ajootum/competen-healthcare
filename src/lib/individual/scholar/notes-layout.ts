// LEARN SECTIONS HFE (owner 4 Nov 2026, "improve HFE and reading ease"): HOW THE LEARNER'S OWN NOTES ARE LAID OUT FOR READING.
// Pure and presentational. It only decides where the text breaks -- paragraphs, list items, lines -- from the structure the
// source text already has (blank lines, bullet characters, line breaks). It NEVER rewrites, drops or reorders a word:
//   - a bullet character at the start of a line (• ▪ ◦ ● ○ ‣ ⁃ – — - * · ➢ ► ✓ ✔ □ ■) is shown as list styling instead;
//   - a numbered or lettered marker ("1.", "2)", "a)", "iv.") is kept in the text, so the source's own numbers stay;
//   - a line that ends mid-sentence and continues in lower case on the next line is joined with one space (a wrapped line);
//   - anything else keeps its line: two or more short plain lines (no sentence ends) are the slide's points, shown as a list;
//     prose stays paragraphs.
// `wordsOf(blocks)` returns every word in order; notes-layout.test.ts asserts it equals the source's words, minus bullet glyphs.

export type NotesBlock =
  | { kind: "para"; text: string }
  /** Lines of the source shown as a list. `marked`: the source drew bullets (else they were plain short lines). */
  | { kind: "list"; items: string[]; marked: boolean };

const BULLET = /^\s*(?:[•▪◦●○‣⁃∙·➢►▶✓✔□■]|[-–—*](?=\s))\s*/;
const NUMBERED = /^\s*(?:\d{1,3}|[a-zA-Z]|[ivxIVX]{1,5})[.)]\s+/;
/** A line that does not end a sentence or clause. */
const OPEN_END = /[A-Za-z0-9,;(–—-]$/;
const LOWER_START = /^[a-z(]/;
/** Plain lines at most this long, two or more together, read as a list of points (slide text); longer ones as paragraphs. */
const SHORT_LINE = 110;
/** A short line ending ":" leads in to the points under it. */
const LEAD_IN = /^.{1,90}:$/;
/** A line ending a sentence reads as prose, so a group holding one stays paragraphs. */
const SENTENCE_END = /[.!?]["'”)]?$/;

export function notesBlocks(text: string): NotesBlock[] {
  const out: NotesBlock[] = [];
  const groups = text.replace(/\r\n?/g, "\n").split(/\n\s*\n+/).map(g => g.split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim()));
  for (const lines of groups) {
    if (!lines.length) continue;
    // 1. Join wrapped lines: a line with an open end followed by a lower-case start, unless either is a bullet or numbered item.
    const joined: { text: string; bullet: boolean; numbered: boolean }[] = [];
    for (const raw of lines) {
      const bullet = BULLET.test(raw), numbered = !bullet && NUMBERED.test(raw);
      const body = bullet ? raw.replace(BULLET, "") : raw.trim();
      const prev = joined[joined.length - 1];
      if (prev && !bullet && !numbered && OPEN_END.test(prev.text) && LOWER_START.test(body)) { prev.text = `${prev.text} ${body}`; continue; }
      joined.push({ text: body, bullet, numbered });
    }
    // 2. Bulleted or numbered lines are list items; a run of plain lines before or between them stays a paragraph each.
    const anyMarked = joined.some(l => l.bullet || l.numbered);
    if (anyMarked) {
      let run: string[] = [];
      const flush = () => { if (run.length) { out.push({ kind: "list", items: run, marked: true }); run = []; } };
      for (const l of joined) {
        if (l.bullet || l.numbered) run.push(l.text);
        else { flush(); out.push({ kind: "para", text: l.text }); }
      }
      flush();
      continue;
    }
    // 3. Plain lines. A lead-in line ending ":" ("Complications:") introduces the short lines after it: they are its points.
    //    Any other run: two or more short lines without a sentence end are the slide's points; otherwise paragraphs.
    let run: string[] = [];
    const flushRun = () => {
      if (run.length >= 2 && run.every(t => t.length <= SHORT_LINE && !SENTENCE_END.test(t))) out.push({ kind: "list", items: run, marked: false });
      else for (const t of run) out.push({ kind: "para", text: t });
      run = [];
    };
    for (let k = 0; k < joined.length; k++) {
      const t = joined[k].text;
      if (!LEAD_IN.test(t)) { run.push(t); continue; }
      flushRun();
      out.push({ kind: "para", text: t });
      const items: string[] = [];
      while (k + 1 < joined.length && !LEAD_IN.test(joined[k + 1].text) && joined[k + 1].text.length <= SHORT_LINE) items.push(joined[++k].text);
      if (items.length) out.push({ kind: "list", items, marked: false });
    }
    flushRun();
  }
  return out;
}

/** Every word of the laid-out notes, in order (the test's check that nothing was dropped, added or reordered). */
export function wordsOf(blocks: NotesBlock[]): string[] {
  return blocks.flatMap(b => (b.kind === "para" ? [b.text] : b.items)).join(" ").split(/\s+/).filter(Boolean);
}
/** The source's words, without the bullet glyphs that layout turns into list styling. */
export function sourceWords(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(BULLET, "")).join(" ").split(/\s+/).filter(Boolean);
}

/** "Slide 14", "Pages 3–4", or null for a section without a page: the short reference shown on a section's chip. */
export function shortRef(unit: "page" | "slide" | "section", from: number | null, to: number | null): string | null {
  if (unit === "section" || from === null) return null;
  const word = unit === "slide" ? "Slide" : "Page";
  return to !== null && to !== from ? `${word}s ${from}–${to}` : `${word} ${from}`;
}
