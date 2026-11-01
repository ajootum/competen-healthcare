import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { pdfSafe, pdfUnencodable } from "@/lib/individual/documents/pdf";
import { parseTeachAnswer } from "./teach-format";

// ── SAVED LEARNING: THE PDF DOWNLOAD ── owner instruction 1 Nov 2026 (item 2) ───────────────────────────────────────────
//
// Pure assembly: a learner's own saved lessons (learning-export-service.ts) in, the bytes of one PDF out. No I/O but the
// bundled Unicode font files, no clock of its own (generatedAt is the document's date), and NO AI: every word is a word
// already stored -- the saved teaching, the lesson's title and objective, the citations, the stored metadata of an
// external work -- or a fixed label of this file. Nothing here imports src/lib/ai (learning-export.test.ts proves it).
//
// PROVENANCE IS NEVER BLURRED. Each kind of content sits under its own label:
//   From your uploaded material   the material's title and the section, page or slide each passage came from
//   AI-generated teaching         the saved teaching, private and formative, not clinically reviewed
//   External research             metadata only (title, journal, year, authors, DOI / PMID / link) and the short excerpt
//                                 already stored. Never full text.
//   Your notes                    anything the learner wrote themselves (their own flashcards and card notes, and the
//                                 notes and highlights of the personal library, migration 820)
// The one model is exportBlocks(): the tests read it, the renderer draws it.

export const EXPORT_PROVENANCE = {
  material: "From your uploaded material",
  ai: "AI-generated teaching (private, formative — not clinically reviewed)",
  beyond: "AI-generated background beyond your material (not from your material, not verified)",
  external: "External research",
  notes: "Your notes",
} as const;
export type ProvenanceKind = keyof typeof EXPORT_PROVENANCE;

export const EXPORT_FOOTER = "Private learning record — not an assessment of competence";
export const EXPORT_NOTICE =
  "This is your own document, made from what you have saved in Competen Scholar. Nothing in it is an assessment, a grade or evidence of competence. "
  + "Teaching marked AI-generated was written by AI from your material, is private to you for your own study, and has not been clinically reviewed: check it against your course materials. "
  + "External research lists the work only (its details and, where stored, a short excerpt), never its full text.";

// ── THE INPUT ──

export type ExportCitation = { tag: string; text: string };
export type ExportExternal = {
  title: string; journal: string | null; year: number | string | null; authors: string[]; doi: string | null; pmid: string | null; url: string | null; excerpt: string | null;
};
export type ExportGoverned = { title: string; code: string | null; outcome: string | null; library: boolean };
export type ExportTeaching = {
  /** "Teach me", "Explain this" ... */
  actionLabel: string; depth: string | null; savedAt: string; content: string; background: string | null; flags: string[];
  model: string | null; promptVersion: string | null;
  citations: ExportCitation[]; governed: ExportGoverned[]; external: ExportExternal[];
};
export type ExportNote = { kind: "flashcard" | "note" | "highlight"; text: string; savedAt: string | null; detail?: string | null };
export type ExportLesson = {
  title: string; objective: string | null; step: number | null; sessionTitle: string | null;
  material: { title: string; uploadedAt: string | null }[]; sections: string[];
  teachings: ExportTeaching[]; notes: ExportNote[];
};
export type ExportScope = "lesson" | "material" | "study" | "selected" | "topic" | "range";
export type LearningExportInput = {
  scope: ExportScope; title: string; learner: string | null; generatedAt: string;
  /** A connected study session's stated objective, where it has one. */
  objective?: string | null;
  lessons: ExportLesson[];
};

// ── TEXT HELPERS ──

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const exportDate = (iso: string | null | undefined) => {
  if (!iso) return "date not recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const clean = (s: string | null | undefined) => (s ?? "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const inline = (s: string) => clean(s).replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,;:])/g, "$1$2").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n) > n / 2 ? s.lastIndexOf(" ", n) : n).replace(/[\s,;:]+$/, "")}…`);

// ── THE BLOCKS ──

export type Block =
  | { t: "title" | "h1" | "h2" | "h3" | "p" | "small" | "bullet"; text: string }
  | { t: "label"; kind: ProvenanceKind; text: string }
  | { t: "kv"; k: string; v: string }
  | { t: "rule" }
  | { t: "break" };

/** Pure. The markdown subset a saved answer carries (headings, bullets, numbered lines, bold, code), as plain blocks. */
export function markdownBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { const p = inline(para.join(" ")); if (p) out.push({ t: "p", text: p }); para = []; };
  for (const raw of clean(text).split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = line.match(/^#{1,6}\s+(.+)$/);
    if (h) { flush(); out.push({ t: "h3", text: inline(h[1]) }); continue; }
    const b = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (b) { flush(); out.push({ t: "bullet", text: inline(b[1]) }); continue; }
    para.push(line);
  }
  flush();
  return out;
}

/** Pure. One saved teaching as blocks: the structured Teach me parts where it has them, otherwise its markdown. */
export function teachingBlocks(t: ExportTeaching): Block[] {
  const out: Block[] = [];
  const head = [t.actionLabel, t.depth ? `${t.depth} depth` : null, `saved ${exportDate(t.savedAt)}`].filter(Boolean).join(" · ");
  out.push({ t: "h3", text: head });
  const parts = parseTeachAnswer(t.content);
  if (parts) {
    if (parts.overview) { out.push({ t: "kv", k: "Overview", v: inline(parts.overview) }); }
    if (parts.points.length) { out.push({ t: "small", text: "Key points" }); for (const p of parts.points) out.push({ t: "bullet", text: inline(p) }); }
    if (parts.example) out.push({ t: "kv", k: "Example", v: inline(parts.example) });
    if (parts.questions.length) { out.push({ t: "small", text: "Check your understanding" }); for (const q of parts.questions) out.push({ t: "bullet", text: inline(q) }); }
  } else out.push(...markdownBlocks(t.content));
  if (t.background?.trim()) {
    out.push({ t: "label", kind: "beyond", text: EXPORT_PROVENANCE.beyond });
    out.push({ t: "p", text: inline(t.background) });
  }
  if (t.flags.length) {
    out.push({ t: "small", text: "Marked for checking by Scholar (not supported by your material):" });
    for (const f of t.flags) out.push({ t: "bullet", text: inline(f) });
  }
  if (t.governed.length) {
    out.push({ t: "small", text: "Framework references used (as saved; their review standing is not restated here)" });
    for (const g of t.governed) out.push({ t: "bullet", text: inline([g.library ? "Competen library" : "Framework", g.title, g.code ? `(${g.code})` : null, g.outcome ? `outcome: ${g.outcome}` : null].filter(Boolean).join(" ")) });
  }
  const meta = [t.model ? `model ${t.model}` : null, t.promptVersion ? `prompt ${t.promptVersion}` : null].filter(Boolean).join(" · ");
  if (meta) out.push({ t: "small", text: `Written by AI · ${meta}` });
  return out;
}

/** Pure. External research as metadata only: the work's details, its identifiers and the short excerpt already stored. */
export function externalBlocks(items: readonly ExportExternal[]): Block[] {
  if (!items.length) return [];
  const out: Block[] = [{ t: "label", kind: "external", text: `${EXPORT_PROVENANCE.external} (details of the work only, not its text)` }];
  const seen = new Set<string>();
  for (const e of items) {
    const key = (e.doi ?? e.pmid ?? e.url ?? e.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const ids = [e.doi ? `DOI ${e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : null, e.pmid ? `PMID ${e.pmid}` : null, e.url].filter(Boolean).join(" · ");
    out.push({ t: "bullet", text: inline([e.title, e.authors.length ? e.authors.slice(0, 6).join(", ") + (e.authors.length > 6 ? " et al." : "") : null, e.journal, e.year != null ? String(e.year) : null].filter(Boolean).join(". ")) });
    if (ids) out.push({ t: "small", text: ids });
    if (e.excerpt?.trim()) out.push({ t: "small", text: `Stored excerpt: “${clip(inline(e.excerpt), 300)}”` });
  }
  return out;
}

/** Pure. A lesson as blocks. */
export function lessonBlocks(l: ExportLesson, n: number): Block[] {
  const out: Block[] = [{ t: "break" }, { t: "h1", text: `Lesson ${n}: ${inline(l.title)}` }];
  if (l.objective) out.push({ t: "kv", k: "Objective", v: inline(l.objective) });
  const saved = l.teachings.map(t => t.savedAt).filter(Boolean).sort();
  out.push({ t: "kv", k: "Saved", v: saved.length ? (saved.length > 1 && saved[0] !== saved[saved.length - 1] ? `${exportDate(saved[0])} to ${exportDate(saved[saved.length - 1])}` : exportDate(saved[0])) : "nothing saved for this lesson yet" });
  if (l.sessionTitle) out.push({ t: "kv", k: "Learning session", v: inline(l.sessionTitle) });
  // Provenance 1: the learner's own material.
  out.push({ t: "label", kind: "material", text: EXPORT_PROVENANCE.material });
  if (l.material.length) for (const m of l.material) out.push({ t: "bullet", text: `${inline(m.title)} (uploaded ${exportDate(m.uploadedAt)})` });
  else out.push({ t: "p", text: "The material this lesson came from is no longer in your library." });
  if (l.sections.length) out.push({ t: "kv", k: "Sections", v: l.sections.map(inline).join("; ") });
  // Provenance 2: the saved teaching.
  if (!l.teachings.length) out.push({ t: "p", text: "No teaching has been saved for this lesson yet. Teaching you ask for in Learn is kept here once it is saved." });
  else {
    out.push({ t: "label", kind: "ai", text: EXPORT_PROVENANCE.ai });
    for (const t of l.teachings) {
      out.push(...teachingBlocks(t));
      if (t.citations.length) {
        out.push({ t: "label", kind: "material", text: `${EXPORT_PROVENANCE.material}: where this teaching came from` });
        for (const c of t.citations) out.push({ t: "bullet", text: `[${c.tag}] ${inline(c.text)}` });
      } else out.push({ t: "small", text: "No source sections are recorded for this teaching." });
      out.push(...externalBlocks(t.external));
    }
  }
  // Provenance 4: the learner's own words.
  if (l.notes.length) {
    out.push({ t: "label", kind: "notes", text: EXPORT_PROVENANCE.notes });
    for (const nt of l.notes) {
      out.push({ t: "bullet", text: `${nt.kind === "flashcard" ? "Flashcard you wrote: " : nt.kind === "highlight" ? "You highlighted: " : ""}${inline(nt.text)}` });
      if (nt.detail) out.push({ t: "small", text: inline(nt.detail) });
    }
  }
  return out;
}

const SCOPE_WORDS: Record<ExportScope, string> = {
  lesson: "one saved lesson", material: "all saved lessons for one material", study: "a connected study session",
  selected: "saved lessons you chose", topic: "saved lessons on one topic", range: "saved lessons from a date range",
};

/** Pure. The whole document as blocks: the header (learner's own document, date, sources and versions), then each lesson. */
export function exportBlocks(input: LearningExportInput): Block[] {
  const out: Block[] = [{ t: "title", text: inline(input.title) }];
  out.push({ t: "small", text: "Your saved learning — Competen Scholar" });
  out.push({ t: "kv", k: "Your document", v: input.learner ? `Made for ${inline(input.learner)}, for your own study` : "Made for you, for your own study" });
  out.push({ t: "kv", k: "Generated", v: exportDate(input.generatedAt) });
  out.push({ t: "kv", k: "Contents", v: `${input.lessons.length} lesson${input.lessons.length === 1 ? "" : "s"} (${SCOPE_WORDS[input.scope]})` });
  if (input.objective) out.push({ t: "kv", k: "Study objective", v: inline(input.objective) });
  const mats = new Map<string, string | null>();
  for (const l of input.lessons) for (const m of l.material) mats.set(m.title, m.uploadedAt);
  if (mats.size) out.push({ t: "kv", k: "Source material", v: [...mats].map(([t, u]) => `${inline(t)} (uploaded ${exportDate(u)})`).join("; ") });
  const versions = new Set<string>();
  for (const l of input.lessons) for (const t of l.teachings) if (t.promptVersion) versions.add(t.promptVersion);
  if (versions.size) out.push({ t: "kv", k: "Teaching versions", v: [...versions].sort().join(", ") });
  out.push({ t: "p", text: EXPORT_NOTICE });
  if (!input.lessons.length) out.push({ t: "p", text: "Nothing has been saved here yet. Lessons you work through in Learn appear in this file once their teaching is saved." });
  input.lessons.forEach((l, i) => out.push(...lessonBlocks(l, i + 1)));
  return out;
}

/** The file name: the title in plain ASCII and the date. */
export function exportFilename(title: string, generatedAt: string): string {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "saved-learning";
  const d = new Date(generatedAt);
  return `scholar-${slug}-${Number.isNaN(d.getTime()) ? "undated" : d.toISOString().slice(0, 10)}.pdf`;
}

// ── DRAWING ──

const A4: [number, number] = [595.28, 841.89];
const [W, H] = A4;
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const C = {
  ink: hex("#1F2330"), muted: hex("#5F6470"), accent: hex("#4B32A8"), accentDeep: hex("#33227A"), rule: hex("#D9D6E8"),
  prov: {
    material: { fg: hex("#1E5E8A"), bg: hex("#E4F0F8") },
    ai: { fg: hex("#4B32A8"), bg: hex("#EEEAFB") },
    beyond: { fg: hex("#8A4B00"), bg: hex("#FFF3DC") },
    external: { fg: hex("#1E7A55"), bg: hex("#E3F4EC") },
    notes: { fg: hex("#7A2E5E"), bg: hex("#F8E6F0") },
  } satisfies Record<ProvenanceKind, { fg: RGB; bg: RGB }>,
};
const lead = (size: number) => size * 1.34;
const FONT_DIR = path.join(process.cwd(), "src/lib/individual/documents/fonts");
type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

/** The text a font can draw: characters it has no glyph for become "?" (the standard fonts keep pdfSafe). */
function makeSafe(unicode: boolean) {
  const glyphs = new Map<PDFFont, Set<number>>();
  return (s: string, font: PDFFont) => {
    const t = s.replace(/\s+/g, " ");
    if (!unicode) return pdfSafe(t);
    let has = glyphs.get(font);
    if (!has) { has = new Set(font.getCharacterSet()); glyphs.set(font, has); }
    return [...t].map(ch => (has!.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  };
}

function wrapText(text: string, font: PDFFont, size: number, max: number, safe: (s: string, f: PDFFont) => string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of safe(text, font).split(" ").filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max) { cur = next; continue; }
    if (cur) out.push(cur);
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > max && rest.length > 1) {
      let i = rest.length;
      while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > max) i--;
      out.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    cur = rest;
  }
  if (cur) out.push(cur);
  return out;
}

/** The characters this export would print as "?" even with the Unicode fonts: none are common; the tests read this. */
export const exportUnencodable = (blocks: readonly Block[]) => pdfUnencodable(blocks.map(b => ("text" in b ? b.text : b.t === "kv" ? `${b.k} ${b.v}` : "")));

export async function buildLearningExportPdf(input: LearningExportInput): Promise<Uint8Array> {
  const blocks = exportBlocks(input);
  const allText = blocks.map(b => ("text" in b ? b.text : b.t === "kv" ? `${b.k} ${b.v}` : ""));
  const unicode = pdfUnencodable([...allText, EXPORT_FOOTER, input.title]).length > 0;
  const pdf = await PDFDocument.create();
  let f: Fonts;
  if (unicode) {
    pdf.registerFontkit(fontkit);
    const [regular, bold, italic] = await Promise.all(["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf"].map(async n => pdf.embedFont(await readFile(path.join(FONT_DIR, n)), { subset: true })));
    f = { regular, bold, italic };
  } else {
    const [regular, bold, italic] = await Promise.all([StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique].map(n => pdf.embedFont(n)));
    f = { regular, bold, italic };
  }
  const safe = makeSafe(unicode);
  const left = 50, width = W - 100, top = H - 62, bottom = 66;
  let page!: PDFPage;
  let y = 0;
  const newPage = () => { page = pdf.addPage(A4); y = top; };
  newPage();
  const room = (h: number) => { if (y - h < bottom) newPage(); };

  const lines = (text: string, font: PDFFont, size: number, colour: RGB, o: { indent?: number; after?: number; bullet?: boolean; keepWith?: number } = {}) => {
    const indent = (o.indent ?? 0) + (o.bullet ? 12 : 0);
    const wrapped = wrapText(text, font, size, width - indent, safe);
    room(lead(size) * Math.min(wrapped.length, 2) + (o.keepWith ?? 0));
    wrapped.forEach((ln, i) => {
      room(lead(size));
      y -= lead(size);
      if (o.bullet && i === 0) page.drawCircle({ x: left + (o.indent ?? 0) + 4, y: y + size * 0.5, size: 1.6, color: C.accent });
      page.drawText(ln, { x: left + indent, y: y + size * 0.25, size, font, color: colour });
    });
    y -= o.after ?? 3;
  };

  for (const b of blocks) {
    switch (b.t) {
      case "title": y -= 4; lines(b.text, f.bold, 20, C.accentDeep, { after: 2 }); break;
      case "h1": {
        y -= 6;
        lines(b.text, f.bold, 15, C.accentDeep, { after: 2, keepWith: 60 });
        page.drawLine({ start: { x: left, y: y + 1 }, end: { x: left + width, y: y + 1 }, thickness: 1, color: C.accent });
        y -= 6;
        break;
      }
      case "h2": lines(b.text, f.bold, 12.5, C.ink, { after: 3, keepWith: 30 }); break;
      case "h3": y -= 4; lines(b.text, f.bold, 11, C.ink, { after: 2, keepWith: 30 }); break;
      case "p": lines(b.text, f.regular, 10, C.ink, { after: 5 }); break;
      case "small": lines(b.text, f.italic, 8.8, C.muted, { after: 3 }); break;
      case "bullet": lines(b.text, f.regular, 10, C.ink, { bullet: true, indent: 4, after: 2 }); break;
      case "kv": {
        const size = 10, label = `${b.k}: `;
        const lw = f.bold.widthOfTextAtSize(safe(label, f.bold), size);
        const wrapped = wrapText(b.v, f.regular, size, width - lw, safe);
        const head = wrapped[0] ?? "";
        room(lead(size));
        y -= lead(size);
        page.drawText(safe(label, f.bold), { x: left, y: y + size * 0.25, size, font: f.bold, color: C.muted });
        page.drawText(head, { x: left + lw, y: y + size * 0.25, size, font: f.regular, color: C.ink });
        const rest = wrapped.slice(1).join(" ");
        if (rest) lines(rest, f.regular, size, C.ink, { indent: 0, after: 0 });
        y -= 3;
        break;
      }
      case "label": {
        const size = 8.6, ps = C.prov[b.kind];
        const wrapped = wrapText(b.text, f.bold, size, width - 16, safe);
        const h = wrapped.length * lead(size) + 6;
        y -= 5;
        room(h + 40);
        page.drawRectangle({ x: left, y: y - h, width, height: h, color: ps.bg });
        page.drawRectangle({ x: left, y: y - h, width: 3, height: h, color: ps.fg });
        let ly = y - 3;
        for (const ln of wrapped) { ly -= lead(size); page.drawText(ln, { x: left + 10, y: ly + size * 0.28, size, font: f.bold, color: ps.fg }); }
        y -= h + 5;
        break;
      }
      case "rule": page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: 0.5, color: C.rule }); y -= 6; break;
      case "break": if (y - 260 < bottom) newPage(); break;
    }
  }

  // Running header (from page 2) and footer on every page.
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    if (i > 0) pg.drawText(safe(`Your saved learning · generated ${exportDate(input.generatedAt)} · private`, f.regular), { x: left, y: H - 36, size: 7.5, font: f.regular, color: C.muted });
    pg.drawLine({ start: { x: left, y: 46 }, end: { x: W - left, y: 46 }, thickness: 0.5, color: C.rule });
    pg.drawText(safe(EXPORT_FOOTER, f.regular), { x: left, y: 32, size: 7.5, font: f.regular, color: C.muted });
    const label = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(label, { x: W - left - f.regular.widthOfTextAtSize(label, 8), y: 32, size: 8, font: f.regular, color: C.muted });
  });

  const at = new Date(input.generatedAt);
  const when = Number.isNaN(at.getTime()) ? new Date(0) : at;
  const info = (s: string) => (unicode ? s.replace(/\s+/g, " ") : pdfSafe(s));
  pdf.setTitle(info(input.title));
  pdf.setAuthor("Competen Scholar");
  pdf.setSubject(info("Saved learning — private learning record, not an assessment of competence"));
  pdf.setKeywords(["Competen Scholar", "saved learning", "formative"]);
  pdf.setCreator("Competen Scholar");
  pdf.setProducer("Competen Scholar (pdf-lib)");
  pdf.setCreationDate(when);
  pdf.setModificationDate(when);
  return pdf.save();
}
