// SCHOLAR-PERSONAL-AI-EXPERIENCE-01: the STRUCTURED ANSWER a Scholar Personal AI reply is shown as. Pure and client-safe:
// no React, no server imports. The model is prompted to write a small markdown subset (headings, paragraphs, bullet and
// numbered lists, **bold**, pipe tables, GitHub-alert callouts, and one optional fenced ```practice JSON block); this
// parses it into blocks the UI renders as React text. Nothing here ever produces HTML, so model text cannot inject markup.
//
// parseAnswer is re-run on every streamed chunk. It never throws, and while `streaming` it hides what is still half
// written (an incomplete trailing table row or marker line, an open practice fence) rather than flashing it.
//
// Citation tags: [S n] the learner's own notes (the same tag teach-format.ts citedTags/citationSegments read), [R n] a
// governed reference, [E n] research evidence.
//
// SCHOLAR-PAI-RESEARCH-01: a "> [!BACKGROUND]" callout is general AI explanation that is NOT from the learner's notes, and a
// final "NOT COVERED: a; b" line names what the notes did not cover. parseAnswer lifts that line out of the shown text and
// returns its items as `notCovered`; splitNotCovered does the same for the server (which sends them as a field).

export type AnswerBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "callout"; kind: CalloutKind; lines: string[] }
  | ({ type: "flow" } & FlowData)
  | ({ type: "map" } & MapData)
  | ({ type: "timeline" } & TimelineData);

export type DiagramBlock = Extract<AnswerBlock, { type: "flow" | "map" | "timeline" }>;
export type FlowKind = "step" | "decision" | "start" | "end";
export type MapGroup = "cause" | "feature" | "treatment" | "other";
export type DiagramEdge = { from: string; to: string; label?: string };
export type FlowData = { title: string; direction: "down" | "right"; nodes: Array<{ id: string; label: string; kind: FlowKind }>; edges: DiagramEdge[] };
export type MapData = { title: string; center: string; nodes: Array<{ id: string; label: string; group: MapGroup }>; edges: DiagramEdge[] };
export type TimelineData = { title: string; events: Array<{ at: string; label: string }> };

export type CalloutKind = "caution" | "key" | "summary" | "memory" | "example" | "record" | "background";

export type Practice = {
  flashcard?: { front: string; back: string };
  mcq?: { stem: string; options: string[]; answer: number; explanation: string };
  reasoning?: { scenario: string; question: string; modelAnswer: string };
};

export const PRACTICE_CAPS = { front: 300, back: 600, stem: 500, option: 200, explanation: 800, scenario: 1200, question: 400, modelAnswer: 1500 } as const;

/** The id a concept-map edge uses for the centre node. */
export const MAP_CENTER_ID = "center";
export const DIAGRAM_CAPS = { nodes: 12, edges: 16, events: 10, label: 80, edgeLabel: 30, title: 80, at: 30, perAnswer: 2 } as const;

const CALLOUT_RE = /^>\s*\[!(caution|key|summary|memory|example|record|background)\]\s*(.*)$/i;
const NOT_COVERED_RE = /^\s*NOT COVERED\s*:\s*(.*)$/i;
const NOT_COVERED_WORDS = "NOT COVERED:";
export const NOT_COVERED_CAPS = { items: 6, item: 120 } as const;

/**
 * Pure. The "NOT COVERED: a; b" line(s) lifted out of an answer: the text without them (unchanged when there are none) and
 * the items, cleaned (no tags or bold marks, one line, capped, no repeats). While `streaming`, a last line that is still only
 * the start of the marker is dropped too, so it never flashes.
 */
export function splitNotCovered(text: string, opts?: { streaming?: boolean }): { text: string; items: string[] } {
  const src = String(text ?? "");
  const lines = src.split(/\r\n?|\n/);
  const last = lines[lines.length - 1]?.trim().toUpperCase() ?? "";
  const partial = !!opts?.streaming && last.length >= 4 && last.length < NOT_COVERED_WORDS.length && NOT_COVERED_WORDS.startsWith(last);
  const items: string[] = [];
  let found = false;
  const kept = lines.filter((l, i) => {
    if (partial && i === lines.length - 1) { found = true; return false; }
    const m = NOT_COVERED_RE.exec(l);
    if (!m) return true;
    found = true;
    for (const part of m[1].split(";")) {
      const t = part.replace(/\[[SRE]\d{1,3}\]/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
      if (t && !items.some(x => x.toLowerCase() === t.toLowerCase()) && items.length < NOT_COVERED_CAPS.items) items.push(t.length > NOT_COVERED_CAPS.item ? t.slice(0, NOT_COVERED_CAPS.item).trimEnd() : t);
    }
    return false;
  });
  return found ? { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(), items } : { text: src, items: [] };
}
const SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^(#{2,3})\s+(.*\S)\s*$/;
const FENCE_RE = /^\s*```/;
const PRACTICE_OPEN_RE = /^\s*```\s*practice\s*$/i;
const DIAGRAM_OPEN_RE = /^\s*```\s*(flow|map|timeline)\s*$/i;
const FENCE_CLOSE_RE = /^\s*```\s*$/;

/** Pure. Text cut into plain runs, **bold** runs and citation tags. An unterminated ** stays as text. */
export function inlineSegments(text: string): Array<{ t: "text" | "bold" | "cite"; v: string; tag?: string }> {
  const out: Array<{ t: "text" | "bold" | "cite"; v: string; tag?: string }> = [];
  const push = (t: "text" | "bold", v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === t) last.v += v; else out.push({ t, v });
  };
  // Citations are cut out of a run first; inside **bold** the words stay bold and the chip stays a chip.
  const withCites = (run: string, t: "text" | "bold") => {
    let at = 0;
    for (const m of run.matchAll(/\[([SRE])(\d{1,3})\]/g)) {
      push(t, run.slice(at, m.index));
      out.push({ t: "cite", v: m[2], tag: m[1] });
      at = m.index! + m[0].length;
    }
    push(t, run.slice(at));
  };
  let at = 0;
  for (const m of text.matchAll(/\*\*(\S(?:[^]*?\S)?)\*\*/g)) {
    withCites(text.slice(at, m.index), "text");
    withCites(m[1], "bold");
    at = m.index! + m[0].length;
  }
  withCites(text.slice(at), "text");
  return out;
}

const clip = (s: unknown, cap: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > cap ? t.slice(0, cap).trimEnd() : t;
};

/** Pure. The practice JSON, validated part by part; an invalid part is dropped, and null when nothing valid is left. */
export function parsePractice(json: string): Practice | null {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const p: Practice = {};

  const fc = o.flashcard as Record<string, unknown> | undefined;
  if (fc && typeof fc === "object") {
    const front = clip(fc.front, PRACTICE_CAPS.front), back = clip(fc.back, PRACTICE_CAPS.back);
    if (front && back) p.flashcard = { front, back };
  }

  const q = o.mcq as Record<string, unknown> | undefined;
  if (q && typeof q === "object" && Array.isArray(q.options)) {
    const stem = clip(q.stem, PRACTICE_CAPS.stem), explanation = clip(q.explanation, PRACTICE_CAPS.explanation);
    const options = q.options.map(x => clip(x, PRACTICE_CAPS.option));
    const answer = q.answer;
    if (stem && explanation && options.length >= 3 && options.length <= 5 && options.every((x): x is string => !!x)
      && typeof answer === "number" && Number.isInteger(answer) && answer >= 0 && answer < options.length) {
      p.mcq = { stem, options, answer, explanation };
    }
  }

  const r = o.reasoning as Record<string, unknown> | undefined;
  if (r && typeof r === "object") {
    const scenario = clip(r.scenario, PRACTICE_CAPS.scenario), question = clip(r.question, PRACTICE_CAPS.question);
    const modelAnswer = clip(r.modelAnswer ?? r.model_answer, PRACTICE_CAPS.modelAnswer);
    if (scenario && question && modelAnswer) p.reasoning = { scenario, question, modelAnswer };
  }

  return p.flashcard || p.mcq || p.reasoning ? p : null;
}

// ---- Diagram blocks (SCHOLAR-COMPANION-01 P2): ```flow, ```map and ```timeline fences hold small JSON documents. Each is
// validated here, part by part; the UI draws only what survives. A diagram that is invalid or empty is omitted silently.

const ID_RE = /^[a-z0-9_-]{1,20}$/;
const FLOW_KINDS: readonly FlowKind[] = ["step", "decision", "start", "end"];
const MAP_GROUPS: readonly MapGroup[] = ["cause", "feature", "treatment", "other"];

/** One-line text: whitespace collapsed, clipped to the cap, null when empty or not a string. */
const oneLine = (s: unknown, cap: number): string | null => (typeof s === "string" ? clip(s.replace(/\s+/g, " "), cap) : null);
const idOf = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  return ID_RE.test(s) ? s : null;
};
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function readJson(json: string): Record<string, unknown> | null {
  try { return asObject(JSON.parse(json)); } catch { return null; }
}

/** Valid, unique-id nodes in order, capped. `reserved` ids may not be used by a node. */
function readNodes<T>(raw: unknown, build: (o: Record<string, unknown>, id: string, label: string) => T, reserved?: string): Array<T & { id: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), out: Array<T & { id: string; label: string }> = [];
  for (const item of raw) {
    const o = asObject(item);
    if (!o) continue;
    const id = idOf(o.id), label = oneLine(o.label, DIAGRAM_CAPS.label);
    if (!id || !label || id === reserved || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...build(o, id, label), id, label });
    if (out.length >= DIAGRAM_CAPS.nodes) break;
  }
  return out;
}

/** Edges between known ids only; no self-loops, no repeats of the same from/to pair; capped. */
function readEdges(raw: unknown, known: Set<string>): DiagramEdge[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), out: DiagramEdge[] = [];
  for (const item of raw) {
    const o = asObject(item);
    if (!o) continue;
    const from = idOf(o.from), to = idOf(o.to);
    if (!from || !to || from === to || !known.has(from) || !known.has(to) || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    const label = oneLine(o.label, DIAGRAM_CAPS.edgeLabel);
    out.push(label ? { from, to, label } : { from, to });
    if (out.length >= DIAGRAM_CAPS.edges) break;
  }
  return out;
}

/** Pure. A flowchart: at least two nodes and one edge, else null. */
export function parseFlow(json: string): FlowData | null {
  const o = readJson(json);
  if (!o) return null;
  const nodes = readNodes(o.nodes, (n) => ({ kind: (FLOW_KINDS.includes(String(n.kind).toLowerCase() as FlowKind) ? String(n.kind).toLowerCase() : "step") as FlowKind }));
  const edges = readEdges(o.edges, new Set(nodes.map(n => n.id)));
  if (nodes.length < 2 || !edges.length) return null;
  return { title: oneLine(o.title, DIAGRAM_CAPS.title) ?? "Process", direction: String(o.direction).toLowerCase() === "right" ? "right" : "down", nodes, edges };
}

/** Pure. A concept map: a centre, at least one node and one edge, else null. Edges may use "center" for the centre. */
export function parseMap(json: string): MapData | null {
  const o = readJson(json);
  if (!o) return null;
  const center = oneLine(o.center, DIAGRAM_CAPS.label);
  if (!center) return null;
  const nodes = readNodes(o.nodes, (n) => ({ group: (MAP_GROUPS.includes(String(n.group).toLowerCase() as MapGroup) ? String(n.group).toLowerCase() : "other") as MapGroup }), MAP_CENTER_ID);
  const edges = readEdges(o.edges, new Set([MAP_CENTER_ID, ...nodes.map(n => n.id)]));
  if (!nodes.length || !edges.length) return null;
  return { title: oneLine(o.title, DIAGRAM_CAPS.title) ?? "Concept map", center, nodes, edges };
}

/** Pure. A timeline: at least two events with a time and a label, else null. */
export function parseTimeline(json: string): TimelineData | null {
  const o = readJson(json);
  if (!o || !Array.isArray(o.events)) return null;
  const events: TimelineData["events"] = [];
  for (const item of o.events) {
    const e = asObject(item);
    const at = e ? oneLine(e.at, DIAGRAM_CAPS.at) : null, label = e ? oneLine(e.label, DIAGRAM_CAPS.label) : null;
    if (at && label) events.push({ at, label });
    if (events.length >= DIAGRAM_CAPS.events) break;
  }
  if (events.length < 2) return null;
  return { title: oneLine(o.title, DIAGRAM_CAPS.title) ?? "Timeline", events };
}

/** Pure. The body of a diagram fence as a block, or null when it is invalid or empty. */
export function parseDiagram(kind: "flow" | "map" | "timeline", json: string): DiagramBlock | null {
  if (kind === "flow") { const d = parseFlow(json); return d && { type: "flow", ...d }; }
  if (kind === "map") { const d = parseMap(json); return d && { type: "map", ...d }; }
  const d = parseTimeline(json);
  return d && { type: "timeline", ...d };
}

/** A short paragraph for the model's prompt: when a diagram earns its place and exactly how to write one. */
export const DIAGRAM_FORMAT_GUIDE = [
  "DIAGRAMS (optional). Add a diagram only when a process, pathway, causal web or time course is central to the learning objective and a picture teaches it better than the text. At most one per answer; never decorative; never to repeat a table or list you already wrote. Diagrams are educational simulations of general knowledge only: never draw a care pathway for a real patient or give patient-specific directions.",
  "A diagram is a fenced block labelled flow, map or timeline that holds one JSON object and nothing else. Put it after the sentence that introduces it, and explain the key point in normal text as well.",
  "A process or algorithm is a flow block (kind is start, step, decision or end; direction is down or right):",
  "```flow",
  '{"title":"...","direction":"down","nodes":[{"id":"a","label":"...","kind":"start"},{"id":"b","label":"...","kind":"decision"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"a","label":"no"}]}',
  "```",
  'A causal or concept web is a map block (group is cause, feature, treatment or other; an edge may start or end at "center"):',
  "```map",
  '{"title":"...","center":"Central idea","nodes":[{"id":"x","label":"...","group":"cause"}],"edges":[{"from":"x","to":"center","label":"leads to"}]}',
  "```",
  "A time course is a timeline block, in time order:",
  "```timeline",
  '{"title":"...","events":[{"at":"0-6 h","label":"..."},{"at":"6-24 h","label":"..."}]}',
  "```",
  "Rules: write strict JSON (double quotes, no comments, no trailing commas), and close each block with ``` on its own line. Ids are 1-20 characters of a-z, 0-9, - or _. At most 12 nodes, 16 edges or 10 events. Labels at most 80 characters, edge labels at most 30. Edges must use ids you defined. Keep labels short phrases.",
].join("\n");

// A table row is cells between pipes; \| is a literal pipe.
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}
const isPipeRow = (l: string) => l.trim().startsWith("|");
const isCompleteRow = (l: string) => { const t = l.trim(); return t.length > 1 && t.endsWith("|") && !t.endsWith("\\|"); };

type Ctx = { diagrams: number; pending: boolean };

function parseBlocks(lines: string[], streaming: boolean, ctx: Ctx): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  // While streaming the last line may be a fragment of a marker; hide it until it is whole.
  if (streaming && lines.length) {
    const last = lines[lines.length - 1];
    // A bare ``` that closes an open fence is whole, not a fragment of an opener.
    const closes = FENCE_CLOSE_RE.test(last) && lines.slice(0, -1).filter(l => FENCE_RE.test(l)).length % 2 === 1;
    if (!closes && (/^\s*#{1,3}$/.test(last) || /^>\s*\[[^\]]*$/.test(last) || /^\s*`{1,2}$/.test(last) || /^\s*```[a-z]*$/i.test(last))) lines = lines.slice(0, -1);
  }
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ type: "paragraph", text: para.join(" ") }); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }

    // A flow, map or timeline fence is a diagram: valid ones become blocks (at most two per answer), invalid ones vanish,
    // and one still being written is only flagged (the UI shows a placeholder, never the half-written JSON).
    const dm = DIAGRAM_OPEN_RE.exec(line);
    if (dm) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !FENCE_CLOSE_RE.test(lines[j])) body.push(lines[j++]);
      if (ctx.diagrams < DIAGRAM_CAPS.perAnswer) {
        if (j >= lines.length && streaming) ctx.pending = true;
        else {
          const d = parseDiagram(dm[1].toLowerCase() as "flow" | "map" | "timeline", body.join("\n"));
          if (d) { blocks.push(d); ctx.diagrams++; }
        }
      }
      i = j; // the closing fence (or the end)
      continue;
    }

    // Any code fence other than practice is plain text, verbatim lines.
    if (FENCE_RE.test(line)) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !FENCE_RE.test(lines[j])) body.push(lines[j++]);
      const text = body.join("\n").trim();
      if (text) blocks.push({ type: "paragraph", text });
      i = j; // the closing fence (or the end)
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) { flush(); blocks.push({ type: "heading", level: h[1].length === 2 ? 2 : 3, text: h[2].trim() }); continue; }

    const co = CALLOUT_RE.exec(trimmed);
    if (co) {
      flush();
      const content: string[] = [];
      if (co[2].trim()) content.push(co[2].trim());
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith(">")) {
        const t = lines[j].trim().replace(/^>\s?/, "").trim();
        if (t) content.push(t);
        j++;
      }
      if (content.length) blocks.push({ type: "callout", kind: co[1].toLowerCase() as CalloutKind, lines: content });
      i = j - 1;
      continue;
    }

    if (isPipeRow(line)) {
      const next = lines[i + 1];
      if (next !== undefined && SEPARATOR_RE.test(next) && !(streaming && i + 1 === lines.length - 1 && !isCompleteRow(next))) {
        flush();
        const header = splitRow(line);
        const rows: string[][] = [];
        let j = i + 2;
        for (; j < lines.length && isPipeRow(lines[j]); j++) {
          const cells = splitRow(lines[j]);
          // The last row of a streaming answer is half-written until it ends in a pipe and has every cell.
          if (streaming && j === lines.length - 1 && (!isCompleteRow(lines[j]) || cells.length < header.length)) continue;
          rows.push(Array.from({ length: header.length }, (_, k) => cells[k] ?? ""));
        }
        blocks.push({ type: "table", header, rows });
        i = j - 1;
        continue;
      }
      // A pipe line that is not (yet) a table: while streaming and still the last line, wait for its separator.
      if (streaming && i >= lines.length - 2 && (next === undefined || SEPARATOR_RE.test(next) || /^\s*\|?[\s:|-]*$/.test(next))) { flush(); continue; }
    }

    const b = BULLET_RE.exec(line), n = b ? null : NUMBERED_RE.exec(line);
    if (b || n) {
      flush();
      const ordered = !!n;
      const items: string[] = [];
      const take = (l: string) => (ordered ? NUMBERED_RE.exec(l) : BULLET_RE.exec(l));
      let j = i;
      while (j < lines.length) {
        const m = take(lines[j]);
        if (m) { if (m[1].trim()) items.push(m[1].trim()); j++; continue; }
        // An indented line that is not a marker continues the item before it.
        if (items.length && /^\s+\S/.test(lines[j]) && !BULLET_RE.test(lines[j]) && !NUMBERED_RE.test(lines[j])) {
          items[items.length - 1] += " " + lines[j].trim(); j++; continue;
        }
        break;
      }
      if (items.length) blocks.push({ type: "list", ordered, items });
      i = j - 1;
      continue;
    }

    // A plain > quote has no callout marker: its words are a paragraph.
    para.push(trimmed.startsWith(">") ? trimmed.replace(/^>\s?/, "").trim() : trimmed);
  }
  flush();
  return blocks.filter(x => !(x.type === "paragraph" && !x.text));
}

/** Pure. The blocks, the practice set (if the last part is a valid ```practice fence) and whether one is still being written. */
export function parseAnswer(text: string, opts?: { streaming?: boolean }): { blocks: AnswerBlock[]; practice: Practice | null; practicePending: boolean; diagramPending: boolean; notCovered: string[] } {
  const streaming = !!opts?.streaming;
  const ctx: Ctx = { diagrams: 0, pending: false };
  let notCovered: string[] = [];
  try {
    const split = splitNotCovered(String(text ?? ""), { streaming });
    notCovered = split.items;
    const lines = split.text.replace(/\r\n?/g, "\n").split("\n");
    const open = lines.findIndex(l => PRACTICE_OPEN_RE.test(l));
    if (open < 0) { const blocks = parseBlocks(lines, streaming, ctx); return { blocks, practice: null, practicePending: false, diagramPending: ctx.pending, notCovered }; }
    let close = -1;
    for (let j = open + 1; j < lines.length; j++) if (FENCE_CLOSE_RE.test(lines[j])) { close = j; break; }
    const before = parseBlocks(lines.slice(0, open), false, ctx);
    if (close < 0) {
      // Open fence: while streaming the content is hidden; otherwise the model never closed it, so try what is there.
      if (streaming) return { blocks: before, practice: null, practicePending: true, diagramPending: false, notCovered };
      return { blocks: before, practice: parsePractice(lines.slice(open + 1).join("\n")), practicePending: false, diagramPending: false, notCovered };
    }
    const after = parseBlocks(lines.slice(close + 1), streaming, ctx);
    return { blocks: [...before, ...after], practice: parsePractice(lines.slice(open + 1, close).join("\n")), practicePending: false, diagramPending: ctx.pending, notCovered };
  } catch {
    return { blocks: [{ type: "paragraph", text: String(text ?? "") }], practice: null, practicePending: false, diagramPending: false, notCovered };
  }
}
