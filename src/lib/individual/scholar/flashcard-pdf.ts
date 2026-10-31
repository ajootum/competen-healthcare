import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { pdfSafe } from "@/lib/individual/documents/pdf";
import type { CardOrigin, CitationMeta, FlashcardView } from "./flashcards";
import { cardSensitiveFlag, type SensitiveFlag } from "./flashcard-sensitive";

// ── SCHOLAR FLASHCARDS: THE DOWNLOADS ── SCHOLAR-FLASHCARDS-01 s8-12, refined by SCHOLAR-FLASHCARDS-QA-01 (31 Oct 2026) ──
//
// Pure assembly: a selection of the learner's own cards (flashcard-service.ts loadCardSelection) in, the bytes of one PDF
// out. No I/O, no clock of its own (the selection's generatedAt is the document's date), and NO AI: every word in these
// files is a word already on the learner's cards -- front, back, explanation, objective, key points, topic, sources --
// or a fixed label of this file. The same selection always gives the same bytes.
//
// Every card keeps ONE number, its place in the selection (Card 1 .. n), in every format: the deck, both printed sides,
// the guide's sections, its Points to verify and its checklist pointers.
//
//   deck   A -- the deck: a title page header (topics, sources, notice), then every card with Question and Answer
//              labelled and laid out apart, its topic, where it came from and what kind of card it is.
//   print  B -- printable cards, A4. layout=duplex (default): eight to a sheet (2 x 4) with dashed cut lines, questions
//              on the front page, answers on the next page mirrored left-right, so a long-edge flip puts each answer
//              behind its question. layout=fold (single-sided foldable; "single" is the older name): five a page,
//              question | answer side by side either side of a FOLD line; cut the rows, fold each card on the line.
//   guide  C -- the revision guide, guide=comprehensive (default) or guide=concise:
//              comprehensive: cover, contents (six cards or more), Key Concepts, Questions and Answers, Clinical
//                Application, Points to Verify, Quick Revision Checklist, References.
//              concise: cover, contents, Key Concepts, Questions and Answers (short answers, no explanations), Points
//                to Verify, Quick Revision Checklist, References. (Points to Verify is a safety list: never left out.)
//              ⚠ NO DUPLICATION (QA-01 item 5). In the comprehensive guide a card is in ONE section: cards whose own
//              rubric says application or clinical reasoning are in Clinical Application, every other card in
//              Questions and Answers; each topic in Questions and Answers names its cards that are in Clinical
//              Application ("Applied in section 3: Card 8"). The concise guide has no Clinical Application, so
//              Questions and Answers holds every card once. Sections with nothing to hold are left out, never invented.
//
// ⚠ CLINICALLY SENSITIVE CONTENT (QA-01 item 3, flashcard-sensitive.ts): a card stating a paediatric respiratory rate,
// an oxygen saturation target, emergency respiratory assessment, COPD deterioration or any numeric clinical threshold,
// dose or target is FLAGGED -- its words unchanged -- with a marker on the card in every format and a line in the
// guide's Points to Verify. A Competen library card keeps its clinically reviewed standing in the marker.
// ⚠ ORIGIN ON EVERY CARD (item 9): AI-written from notes, Competen library (clinically reviewed), or written by the
// learner -- on the card itself in the deck, on both printed faces, and in the guide.
// ⚠ PAGE BREAKS (item 10): a card is never split across pages, and a heading is kept with what follows it (Flow
// keeps headings pending until the next block is placed). buildFlashcardPdfLayout returns where each block went.
//
// ⚠ FONT. The same library and fonts as the Professional Document Studio (src/lib/individual/documents/pdf.ts): pdf-lib
// with the standard Helvetica family, which encodes Windows-1252 only. Common clinical symbols are spelled out first
// (arrows, >=, subscript digits as in SpO2, Greek letters), then documents/pdf.ts pdfSafe draws anything left as "?"
// rather than failing. Embedding a Unicode font remains the recorded Document Studio follow-up.

export type FlashcardExportFormat = "deck" | "print" | "guide";
export const FLASHCARD_EXPORT_FORMATS: readonly FlashcardExportFormat[] = ["deck", "print", "guide"];
export type PrintLayout = "duplex" | "fold";
export const PRINT_LAYOUTS: readonly PrintLayout[] = ["duplex", "fold"];
/** Pure. A layout as a request names it: fold (or its older name single), else duplex. */
export const asPrintLayout = (v: string | null | undefined): PrintLayout => (v === "fold" || v === "single" ? "fold" : "duplex");
export type GuideVariant = "comprehensive" | "concise";
export const GUIDE_VARIANTS: readonly GuideVariant[] = ["comprehensive", "concise"];
export const asGuideVariant = (v: string | null | undefined): GuideVariant => (v === "concise" ? "concise" : "comprehensive");

/** On every page of every download. */
export const FLASHCARD_PDF_DISCLAIMER =
  "For education and revision only — not verified clinical knowledge or proof of competence. Check recognised references and current local clinical guidelines.";

/** What kind of card it is, short enough for a printed card face. */
export const ORIGIN_SHORT: Record<CardOrigin, string> = {
  notes: "AI-written from your notes · not clinically reviewed",
  library: "Competen library · clinically reviewed",
  learner: "Written by you · not clinically reviewed",
};

export type FlashcardPdfInput = {
  cards: readonly FlashcardView[];
  /** The deck or guide title (exportTitle). */
  title: string;
  /** ISO time the selection was read: the document's date. */
  generatedAt: string;
  /** Cards in the selection beyond the per-download cap, left out and said so. */
  omitted?: number;
};
export type FlashcardPdfOptions = { layout?: PrintLayout | "single"; guide?: GuideVariant };

// ── TEXT THE STANDARD FONTS CAN DRAW ──

const SPELL: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "↑": "(up)", "↓": "(down)", "≥": ">=", "≤": "<=", "≈": "~", "≠": "!=", "−": "-",
  "‐": "-", "‑": "-", "′": "'", "″": "\"", "✓": "", "✔": "", "✗": "x", "✘": "x", "α": "alpha", "β": "beta",
  "γ": "gamma", "δ": "delta", "Δ": "delta", "ε": "epsilon", "θ": "theta", "κ": "kappa", "λ": "lambda", "μ": "µ", "π": "pi",
  "σ": "sigma", "Σ": "sum", "ω": "omega", "Ω": "ohm", "℃": "°C", "⁰": "0", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-",
};
/** Pure. One paragraph as the standard fonts draw it: symbols spelled out, whitespace collapsed, the rest via pdfSafe. */
export const pdfText = (s: string) =>
  pdfSafe([...(s ?? "")].map(ch => SPELL[ch] ?? (ch >= "₀" && ch <= "₉" ? String(ch.charCodeAt(0) - 0x2080) : ch)).join("")).trim();
const paras = (s: string | null | undefined) => (s ?? "").split(/\n+/).map(pdfText).filter(Boolean);
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const uniq = (xs: readonly string[]) => { const seen = new Set<string>(); return xs.filter(x => { const k = flat(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };

/** Pure. A short excerpt: at most `words` words of a source quote, never the whole passage. */
export function excerpt(quote: string | null | undefined, words = 25): string | null {
  const w = pdfText(quote ?? "").split(" ").filter(Boolean);
  if (!w.length) return null;
  return w.length <= words ? w.join(" ") : `${w.slice(0, words).join(" ")}…`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Pure. 2026-10-31T... as 31 October 2026 (UTC: the same file wherever it is made). */
export const longDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** Pure. The topic a card is filed under in the downloads: its topic, else its document. */
export const topicOf = (c: FlashcardView) => c.topic?.trim() || c.material.title;

/** Pure. A card's clinically sensitive flag (flashcard-sensitive.ts), dates as the downloads write them. */
export const flagOf = (c: FlashcardView): SensitiveFlag | null => cardSensitiveFlag(c, longDate);

/** Pure. The title of a download: the one deck named, the decks named, else the topic, competency or document chosen, else all cards. */
export function exportTitle(sel: { decks: readonly { title: string }[]; cards: readonly FlashcardView[] }, by: { topic?: string | null; competencyId?: string | null; materialId?: string | null }): string {
  if (sel.decks.length === 1) return sel.decks[0].title;
  if (sel.decks.length > 1) { const t = sel.decks.map(d => d.title).join(" + "); return t.length <= 80 && sel.decks.length <= 3 ? t : `${sel.decks.length} decks`; }
  if (by.topic) return by.topic;
  if (by.competencyId) return sel.cards.find(c => c.competency?.id === by.competencyId)?.competency?.title ?? "Competency cards";
  if (by.materialId) return sel.cards.find(c => c.material.id === by.materialId)?.material.title ?? "Document cards";
  return "All cards";
}

/**
 * Pure. A safe attachment name: Competen-Scholar-<title>-<kind>-<date>.pdf, ASCII letters, digits and hyphens only.
 * kind: flashcards, printable-cards (double-sided), printable-cards-foldable, revision-guide, revision-guide-concise.
 */
export function exportFilename(title: string, format: FlashcardExportFormat, generatedAt: string, opts: FlashcardPdfOptions = {}): string {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 -]+/g, " ").trim().replace(/[\s-]+/g, "-").slice(0, 60).replace(/-+$/, "") || "cards";
  const kind = format === "deck" ? "flashcards"
    : format === "print" ? (asPrintLayout(opts.layout) === "fold" ? "printable-cards-foldable" : "printable-cards")
      : asGuideVariant(opts.guide) === "concise" ? "revision-guide-concise" : "revision-guide";
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : "undated";
  return `Competen-Scholar-${slug}-${kind}-${day}.pdf`;
}

// ── PRINTED SHEETS: WHICH CARD GOES WHERE ──

export const PRINT_COLS = 2;
export const PRINT_ROWS = 4;
export const PRINT_FOLD_ROWS = 5;
/** @deprecated the older name of PRINT_FOLD_ROWS. */
export const PRINT_SINGLE_ROWS = PRINT_FOLD_ROWS;

/**
 * Pure. Duplex sheets: slot k (row-major, k = row * cols + col) of each front page holds card s * 8 + k; the back page
 * holds the same card at (row, cols - 1 - col), the mirror a long-edge flip makes, so each answer prints behind its
 * question. null is an empty slot.
 */
export function duplexSheets(count: number, cols = PRINT_COLS, rows = PRINT_ROWS): { front: (number | null)[]; back: (number | null)[] }[] {
  const per = cols * rows;
  const out: { front: (number | null)[]; back: (number | null)[] }[] = [];
  for (let s = 0; s * per < count; s++) {
    const front = Array.from({ length: per }, (_, k) => (s * per + k < count ? s * per + k : null));
    const back = Array.from({ length: per }, (_, k) => { const r = Math.floor(k / cols), c = k % cols; return front[r * cols + (cols - 1 - c)]; });
    out.push({ front, back });
  }
  return out;
}

/** Pure. Foldable pages: each row is one card, question left and answer right of the fold line. */
export function foldSheets(count: number, rows = PRINT_FOLD_ROWS): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i += rows) out.push(Array.from({ length: Math.min(rows, count - i) }, (_, k) => i + k));
  return out;
}
/** @deprecated the older name of foldSheets. */
export const singleSheets = foldSheets;

// ── THE QUICK REVISION CHECKLIST: "I CAN ..." FROM THE CARDS' OWN OBJECTIVES AND KEY POINTS ──

const DOING = new Set(["describe", "explain", "state", "recall", "recognise", "recognize", "identify", "list", "apply", "escalate", "assess",
  "calculate", "interpret", "distinguish", "differentiate", "compare", "outline", "define", "name", "demonstrate", "perform", "record",
  "document", "measure", "monitor", "prioritise", "prioritize", "use", "count", "give", "select", "choose", "manage", "respond", "discuss",
  "summarise", "summarize", "check", "plan", "evaluate", "relate", "link", "position", "administer", "observe", "report", "take", "start"]);
const BRITISH: Record<string, string> = { recognize: "recognise", prioritize: "prioritise", summarize: "summarise" };
/** Lower-case a leading ordinary word ("Tachypnoea" -> "tachypnoea"), never an acronym or a mixed-case term ("SpO2", "COPD"). */
const lowerLead = (s: string) => s.replace(/^([A-Z][a-z]+)\b/, w => w.toLowerCase());

/**
 * Pure. One self-assessment line, "I can ...": an objective or key point that starts with a doing word becomes
 * "I can <it>"; one that does not gets a verb -- "state" where it holds a figure, else `verb` (recognise for a topic
 * about recognising, else explain). The words are the card's own. Deterministic.
 */
export function canDo(s: string, verb: "explain" | "recognise" = "explain"): string {
  const t = pdfText(s).replace(/[.;:,\s]+$/, "");
  if (!t) return t;
  if (/^i can\b/i.test(t)) return `I can${t.slice(5)}`;
  const first = t.split(" ")[0], lower = first.toLowerCase();
  if (DOING.has(lower)) return `I can ${BRITISH[lower] ?? lower}${t.slice(first.length)}`;
  return `I can ${/\d/.test(t) ? "state" : verb} ${lowerLead(t)}`;
}

// ── THE REVISION GUIDE: WHAT GOES IN, FROM THE CARDS ALONE ──

/** One source used: its citation, the sections of it the cards rest on (notes), a short excerpt or note, and how many cards. */
export type GuideReference = { citation: string; sections: string[]; detail: string | null; cards: number };
export type NumberedCard = { n: number; card: FlashcardView };
export type GuidePlan = {
  variant: GuideVariant;
  /** Every topic with every card, in selection order (Key Concepts, Checklist). */
  topics: { label: string; cards: FlashcardView[] }[];
  keyConcepts: { label: string; objectives: string[]; points: string[] }[];
  /** Questions and Answers: each topic's cards that are NOT in Clinical Application, and the numbers of those that are. */
  qa: { label: string; cards: NumberedCard[]; applied: number[] }[];
  /** Comprehensive only: cards whose own rubric is application or clinical reasoning. Empty: the section is left out. */
  clinical: NumberedCard[];
  /** Cards flagged clinically sensitive (flashcard-sensitive.ts). Empty: the section is left out. */
  verify: (NumberedCard & { flag: SensitiveFlag })[];
  checklist: { label: string; items: string[] }[];
  references: { notes: GuideReference[]; library: GuideReference[]; framework: GuideReference[]; external: GuideReference[]; ownCards: number };
};

/** Pure. A cited work as the guide lists it: what is recorded of it, dates written out. */
export function referenceLine(m: CitationMeta): string {
  const ids = [m.doi ? `doi:${m.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : null, m.pmid ? `PMID ${m.pmid}` : null, m.url].filter(Boolean);
  const standing = m.status ? `${m.status}${m.reviewedAt ? ` ${longDate(m.reviewedAt)}` : ""}` : null;
  return [`${m.title}${m.code ? ` (${m.code})` : ""}`, [m.publisher, m.version ? `version ${m.version}` : null].filter(Boolean).join(", ") || null,
    m.year, ids.length ? ids.join(", ") : null, m.licence, m.access, standing].filter(Boolean).join(". ");
}

/** Pure. Everything the guide says, taken from the cards: nothing written, nothing inferred. */
export function guidePlan(cards: readonly FlashcardView[], variant: GuideVariant = "comprehensive"): GuidePlan {
  const numbered = cards.map((card, i) => ({ n: i + 1, card }));
  const by = new Map<string, FlashcardView[]>();
  for (const c of cards) by.set(topicOf(c), [...(by.get(topicOf(c)) ?? []), c]);
  const topics = [...by].map(([label, cs]) => ({ label, cards: cs }));
  const keyConcepts = topics.map(t => {
    const objectives = uniq(t.cards.map(c => c.objective ?? "").filter(Boolean));
    const keys = uniq(t.cards.flatMap(c => c.keyPoints));
    const points = keys.length ? keys.slice(0, 12) : uniq(t.cards.map(c => c.explanation ?? "").filter(Boolean)).slice(0, 6);
    return { label: t.label, objectives: objectives.slice(0, 8), points };
  }).filter(k => k.objectives.length || k.points.length);
  const isClinical = (c: FlashcardView) => variant === "comprehensive" && (c.level === "application" || c.level === "reasoning");
  const clinical = numbered.filter(x => isClinical(x.card));
  const qa = topics.map(t => {
    const mine = numbered.filter(x => topicOf(x.card) === t.label);
    return { label: t.label, cards: mine.filter(x => !isClinical(x.card)), applied: mine.filter(x => isClinical(x.card)).map(x => x.n) };
  });
  const verify = numbered.flatMap(x => { const flag = flagOf(x.card); return flag ? [{ ...x, flag }] : []; });
  const checklist = topics.map(t => {
    const objectives = uniq(t.cards.map(c => c.objective ?? "").filter(Boolean));
    const keys = uniq(t.cards.flatMap(c => c.keyPoints));
    const verb = objectives.some(o => /^recogni[sz]e\b/i.test(o.trim())) ? "recognise" as const : "explain" as const;
    const items = objectives.length || keys.length ? uniq([...objectives, ...keys].map(s => canDo(s, verb))) : uniq(t.cards.map(c => `I can answer without looking: ${pdfText(c.front)}`));
    return { label: t.label, items: items.slice(0, 10) };
  });
  const refs = { notes: new Map<string, GuideReference>(), library: new Map<string, GuideReference>(), framework: new Map<string, GuideReference>(), external: new Map<string, GuideReference>() };
  let ownCards = 0;
  for (const c of cards) {
    if (c.origin === "learner") ownCards++;
    const seen = new Set<string>();
    for (const s of c.sources) {
      // Notes are listed by document (the sections under it); the library by item and version; a reference by itself.
      const group = s.origin === "notes" ? "notes" : s.origin === "library" ? "library" : s.reference?.kind === "external" ? "external" : "framework";
      const key = s.origin === "notes" ? `${s.materialId ?? c.material.id}` : s.origin === "library" ? s.libraryVersionId ?? s.citation : s.referenceIds.join(",") || s.citation;
      const m = refs[group];
      const r = m.get(key) ?? {
        citation: s.origin === "notes" ? c.material.title : s.reference ? referenceLine(s.reference) : s.citation, sections: [], cards: 0,
        detail: s.origin === "external" && !s.reference ? `Linked to ${c.material.title}` : null,
      };
      if (s.origin === "notes") {
        const section = s.citation.startsWith(`${c.material.title}, `) ? s.citation.slice(c.material.title.length + 2) : s.citation;
        if (!r.sections.includes(section)) r.sections.push(section);
        if (!r.detail && excerpt(s.quote)) r.detail = `"${excerpt(s.quote)}"`;
      }
      if (!seen.has(`${group}|${key}`)) r.cards++;
      seen.add(`${group}|${key}`);
      m.set(key, r);
    }
  }
  return {
    variant, topics, keyConcepts, qa, clinical, verify, checklist,
    references: { notes: [...refs.notes.values()], library: [...refs.library.values()], framework: [...refs.framework.values()], external: [...refs.external.values()], ownCards },
  };
}

// ── DRAWING ──

const A4: [number, number] = [595.28, 841.89];
const [W, H] = A4;
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const C = {
  ink: hex("#1F2330"), muted: hex("#5F6470"), faint: hex("#8A8F9C"), accent: hex("#4B32A8"), accentDeep: hex("#33227A"),
  accentSoft: hex("#EEEAFB"), accentMid: hex("#B9AEEA"), answer: hex("#1E7A55"), answerSoft: hex("#E3F4EC"), rule: hex("#D9D6E8"),
  warn: hex("#8A4B00"), warnSoft: hex("#FFF3DC"), warnMid: hex("#E0A040"),
  white: rgb(1, 1, 1),
};
type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
const lead = (size: number) => size * 1.32;

/** Where each block of a download went: the tests read it (no card split, headings kept, faces aligned). */
export type LayoutBox = {
  kind: "heading" | "subheading" | "card" | "face" | "bullet" | "text";
  page: number; top: number; bottom: number; x: number; w: number;
  card?: number; side?: "Q" | "A"; label?: string;
};

/** Pure-ish (fonts only). Wrapped lines of one clean paragraph; a word longer than the line is broken by characters. */
function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(" ").filter(Boolean)) {
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
const wrapAll = (text: string | null | undefined, font: PDFFont, size: number, max: number) => paras(text).flatMap(p => wrap(p, font, size, max));
/** One line, cut with an ellipsis to fit. */
function clip(text: string, font: PDFFont, size: number, max: number): string {
  const t = pdfText(text);
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  let i = t.length;
  while (i > 0 && font.widthOfTextAtSize(`${t.slice(0, i).trimEnd()}…`, size) > max) i--;
  return `${t.slice(0, i).trimEnd()}…`;
}

function wordmark(page: PDFPage, f: Fonts, x: number, y: number, size = 11, centred = false) {
  const label = "Competen Scholar";
  const w = 18 + f.bold.widthOfTextAtSize(label, size);
  const x0 = centred ? x - w / 2 : x;
  // A small mortarboard: the diamond and the band under it.
  page.drawSvgPath("M 0 4.5 L 7 0 L 14 4.5 L 7 9 Z", { x: x0, y: y + size * 0.85, color: C.accent });
  page.drawSvgPath("M 3 7 L 3 11 Q 7 13.5 11 11 L 11 7 L 7 9.5 Z", { x: x0, y: y + size * 0.85, color: C.accentDeep });
  page.drawText(label, { x: x0 + 18, y, size, font: f.bold, color: C.accentDeep });
}

function badge(page: PDFPage, f: Fonts, kind: "Q" | "A", x: number, y: number, s = 16) {
  page.drawRectangle({ x, y, width: s, height: s, color: kind === "Q" ? C.accentSoft : C.answerSoft });
  const size = s * 0.62;
  page.drawText(kind, { x: x + (s - f.bold.widthOfTextAtSize(kind, size)) / 2, y: y + s * 0.28, size, font: f.bold, color: kind === "Q" ? C.accent : C.answer });
}

/** A small warning triangle with "!" (the standard fonts have no warning sign), its base at (x, y). */
function warnIcon(page: PDFPage, f: Fonts, x: number, y: number, s = 8) {
  page.drawSvgPath(`M 0 ${s} L ${s / 2} 0 L ${s} ${s} Z`, { x, y: y + s, color: C.warnMid });
  page.drawText("!", { x: x + s / 2 - f.bold.widthOfTextAtSize("!", s * 0.8) / 2, y: y + s * 0.12, size: s * 0.8, font: f.bold, color: C.white });
}

/** Footer on every page from `from` (a cover carries the disclaimer in its own notice): the disclaimer and "Page n of m". */
function stampFooters(pdf: PDFDocument, f: Fonts, opts: { from?: number; margin?: number } = {}) {
  const pages = pdf.getPages();
  const m = opts.margin ?? 50;
  pages.forEach((pg, i) => {
    if (i < (opts.from ?? 0)) return;
    const label = `Page ${i + 1} of ${pages.length}`;
    const size = 7;
    const lines = wrap(pdfText(FLASHCARD_PDF_DISCLAIMER), f.regular, size, W - 2 * m - 70);
    let y = 22 + (lines.length - 1) * lead(size);
    pg.drawLine({ start: { x: m, y: y + 11 }, end: { x: W - m, y: y + 11 }, thickness: 0.5, color: C.rule });
    for (const ln of lines) { pg.drawText(ln, { x: m, y, size, font: f.regular, color: C.muted }); y -= lead(size); }
    pg.drawText(label, { x: W - m - f.regular.widthOfTextAtSize(label, 8), y: 22, size: 8, font: f.regular, color: C.muted });
  });
}

async function newDoc(title: string, subject: string, generatedAt: string): Promise<{ pdf: PDFDocument; f: Fonts }> {
  const pdf = await PDFDocument.create();
  const [regular, bold, italic] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold), pdf.embedFont(StandardFonts.HelveticaOblique),
  ]);
  const at = new Date(generatedAt);
  const when = Number.isNaN(at.getTime()) ? new Date(0) : at;
  pdf.setTitle(pdfText(title));
  pdf.setAuthor("Competen Scholar");
  pdf.setSubject(pdfText(subject));
  pdf.setKeywords(["Competen Scholar", "flashcards", "formative"]);
  pdf.setCreator("Competen Scholar");
  pdf.setProducer("Competen Scholar (pdf-lib)");
  pdf.setCreationDate(when);
  pdf.setModificationDate(when);
  return { pdf, f: { regular, bold, italic } };
}

/**
 * A flowing page writer for the deck and the guide: margins, a cursor, page breaks that keep a block together. A
 * heading is PENDING until the next block is placed, and both go on the same page: a heading is never left at the foot
 * of a page.
 */
class Flow {
  page!: PDFPage;
  y = 0;
  readonly left = 50;
  readonly width = W - 100;
  readonly top = H - 54;
  readonly bottom = 62;
  private pending: { h: number; draw: () => void }[] = [];
  constructor(readonly pdf: PDFDocument, readonly f: Fonts, readonly trace: LayoutBox[] = []) {}
  get pageIndex() { return this.pdf.getPageCount() - 1; }
  newPage() { this.page = this.pdf.addPage(A4); this.y = this.top; return this.page; }
  /** Room for h below any pending headings; then the headings are drawn. */
  room(h: number) {
    const ph = this.pending.reduce((s, p) => s + p.h, 0);
    if (this.y - ph - h < this.bottom && this.y < this.top) this.newPage();
    const ps = this.pending;
    this.pending = [];
    for (const p of ps) p.draw();
  }
  get pendingHeight() { return this.pending.reduce((s, p) => s + p.h, 0); }
  /** Draw any pending headings now (the end of a section with nothing after them). */
  flush() { if (this.pending.length) this.room(0); }
  get usable() { return this.top - this.bottom; }
  /** Wrapped lines, broken across pages line by line. */
  text(s: string | null | undefined, o: { font?: PDFFont; size?: number; color?: RGB; indent?: number; after?: number; width?: number } = {}) {
    const font = o.font ?? this.f.regular, size = o.size ?? 10, indent = o.indent ?? 0;
    let first: LayoutBox | null = null;
    for (const ln of wrapAll(s, font, size, (o.width ?? this.width) - indent)) {
      this.room(lead(size));
      first ??= { kind: "text", page: this.pageIndex, top: this.y, bottom: this.y, x: this.left, w: this.width };
      this.y -= lead(size);
      this.page.drawText(ln, { x: this.left + indent, y: this.y + size * 0.25, size, font, color: o.color ?? C.ink });
    }
    if (first) this.trace.push({ ...first, bottom: this.y });
    this.y -= o.after ?? 3;
  }
  height(s: string | null | undefined, font: PDFFont, size: number, width: number) { return wrapAll(s, font, size, width).length * lead(size); }
  heading(n: number | null, title: string, onPlace?: () => void) {
    const size = 17;
    this.pending.push({ h: 8 + lead(size) + 12, draw: () => {
      onPlace?.();
      const top = this.y;
      this.y -= 8;
      const label = n === null ? title : `${n}  ${title}`;
      this.y -= lead(size);
      this.page.drawText(pdfText(label), { x: this.left, y: this.y + 4, size, font: this.f.bold, color: C.accentDeep });
      this.page.drawLine({ start: { x: this.left, y: this.y - 3 }, end: { x: this.left + this.width, y: this.y - 3 }, thickness: 1.2, color: C.accent });
      this.y -= 12;
      this.trace.push({ kind: "heading", page: this.pageIndex, top, bottom: this.y, x: this.left, w: this.width, label: title });
    } });
  }
  /** Text kept with what follows it (a section's opening line, "Key points:"): pending like a heading. */
  keepText(s: string, o: { font?: PDFFont; size?: number; color?: RGB; after?: number } = {}) {
    const font = o.font ?? this.f.regular, size = o.size ?? 10, lines = wrapAll(s, font, size, this.width), after = o.after ?? 3;
    this.pending.push({ h: lines.length * lead(size) + after, draw: () => {
      for (const ln of lines) { this.y -= lead(size); this.page.drawText(ln, { x: this.left, y: this.y + size * 0.25, size, font, color: o.color ?? C.ink }); }
      this.y -= after;
    } });
  }
  subheading(title: string, onPlace?: () => void) {
    const size = 12, lines = wrapAll(title, this.f.bold, size, this.width);
    this.pending.push({ h: 4 + lines.length * lead(size) + 4, draw: () => {
      onPlace?.();
      const top = this.y;
      this.y -= 4;
      for (const ln of lines) { this.y -= lead(size); this.page.drawText(ln, { x: this.left, y: this.y + size * 0.25, size, font: this.f.bold, color: C.ink }); }
      this.y -= 4;
      this.trace.push({ kind: "subheading", page: this.pageIndex, top, bottom: this.y, x: this.left, w: this.width, label: title });
    } });
  }
  /** One bullet (or tick box), its lines kept together on one page. */
  bullet(s: string, o: { size?: number; color?: RGB; box?: boolean; font?: PDFFont } = {}) {
    const size = o.size ?? 10, indent = 16, font = o.font ?? this.f.regular;
    const lines = wrapAll(s, font, size, this.width - indent - 4);
    this.room(Math.min(lines.length * lead(size), this.usable / 3));
    const top = this.y, page = this.pageIndex;
    lines.forEach((ln, i) => {
      this.room(lead(size));
      this.y -= lead(size);
      if (i === 0) {
        if (o.box) this.page.drawRectangle({ x: this.left + 3, y: this.y + 1.5, width: 8, height: 8, borderColor: C.accent, borderWidth: 0.9 });
        else this.page.drawCircle({ x: this.left + 6, y: this.y + size * 0.55, size: 1.7, color: C.accent });
      }
      this.page.drawText(ln, { x: this.left + indent, y: this.y + size * 0.25, size, font, color: o.color ?? C.ink });
    });
    this.trace.push({ kind: "bullet", page, top, bottom: this.y, x: this.left, w: this.width });
    this.y -= o.box ? 4 : 2;
  }
  noticeBox(lines: string[]) {
    const size = 8.5, pad = 9;
    const wrapped = lines.flatMap(l => wrap(pdfText(l), this.f.regular, size, this.width - 2 * pad - 6));
    const h = wrapped.length * lead(size) + 2 * pad;
    this.room(h + 6);
    this.page.drawRectangle({ x: this.left, y: this.y - h, width: this.width, height: h, color: C.accentSoft });
    this.page.drawRectangle({ x: this.left, y: this.y - h, width: 3, height: h, color: C.accent });
    let y = this.y - pad;
    for (const ln of wrapped) { y -= lead(size); this.page.drawText(ln, { x: this.left + pad + 6, y: y + size * 0.3, size, font: this.f.regular, color: C.accentDeep }); }
    this.y -= h + 10;
  }
}

/**
 * A question and answer pair, kept together on one page: Q and A badges, the answer, its explanation (unless short),
 * a clinically sensitive marker where flagged, and its source with what kind of card it is.
 */
function qaBlock(fl: Flow, c: FlashcardView, n: number, o: { header?: string; boxed: boolean; short?: boolean }) {
  const f = fl.f, pad = o.boxed ? 12 : 0, inner = fl.width - 2 * pad - 24;
  const flag = flagOf(c);
  const fs = o.boxed ? 12 : 11, bs = o.boxed ? 11 : 10, ms = 8.5;
  const front = wrapAll(c.front, f.bold, fs, inner);
  const back = wrapAll(c.back, f.regular, bs, inner);
  let expl = o.short ? [] : wrapAll(c.explanation, f.italic, 9.5, inner - 6);
  const mark = flag ? wrapAll(flag.marker, f.bold, ms, inner - 14) : [];
  const src = wrapAll(`Source: ${sourceLine(c)}`, f.regular, 8, inner);
  const head = o.boxed ? lead(9) + 6 : 0;
  const measure = () => head + 2 * pad + lead(9) + 4 + front.length * lead(fs) + 10 + lead(9) + 4 + back.length * lead(bs)
    + (expl.length ? 6 + lead(8.5) + expl.length * lead(9.5) : 0) + (mark.length ? 8 + mark.length * lead(ms) + 4 : 0) + 6 + src.length * lead(8);
  // A card taller than a page (rare: a very long explanation) keeps what fits of its explanation.
  while (measure() > fl.usable - fl.pendingHeight - 10 && expl.length) expl = expl.slice(0, -1);
  const h = measure();
  fl.room(h + 8);
  const p = fl.page, x = fl.left, top = fl.y;
  fl.trace.push({ kind: "card", page: fl.pageIndex, top, bottom: top - h, x, w: fl.width, card: n });
  if (o.boxed) {
    p.drawRectangle({ x, y: top - h, width: fl.width, height: h, color: C.white, borderColor: C.rule, borderWidth: 0.9 });
    p.drawRectangle({ x: x + 0.5, y: top - head - pad + 4, width: fl.width - 1, height: head + pad - 4.5, color: C.accentSoft });
  }
  let y = top - pad;
  if (o.boxed) {
    y -= lead(9);
    p.drawText(pdfText(o.header ?? `Card ${n}`), { x: x + pad, y: y + 6.5, size: 9, font: f.bold, color: C.accent });
    const t = clip(topicOf(c), f.regular, 9, fl.width / 2);
    p.drawText(t, { x: x + fl.width - pad - f.regular.widthOfTextAtSize(t, 9), y: y + 6.5, size: 9, font: f.regular, color: C.muted });
    y -= 6;
  }
  const tx = x + pad + 24;
  const label = (k: "Q" | "A", text: string) => {
    y -= lead(9) + 4;
    badge(p, f, k, x + pad, y - 1, 16);
    p.drawText(text, { x: tx, y: y + 3, size: 9, font: f.bold, color: k === "Q" ? C.accent : C.answer });
  };
  label("Q", o.boxed ? "Question" : `Question · Card ${n}`);
  for (const ln of front) { y -= lead(fs); p.drawText(ln, { x: tx, y: y + 3, size: fs, font: f.bold, color: C.ink }); }
  y -= 10;
  p.drawLine({ start: { x: tx, y: y + 5 }, end: { x: x + fl.width - pad, y: y + 5 }, thickness: 0.5, color: C.rule, dashArray: [3, 2] });
  label("A", "Answer");
  for (const ln of back) { y -= lead(bs); p.drawText(ln, { x: tx, y: y + 3, size: bs, font: f.regular, color: C.ink }); }
  if (expl.length) {
    y -= 6 + lead(8.5);
    p.drawText("Explanation", { x: tx, y: y + 3, size: 8.5, font: f.bold, color: C.muted });
    for (const ln of expl) { y -= lead(9.5); p.drawText(ln, { x: tx + 6, y: y + 3, size: 9.5, font: f.italic, color: C.muted }); }
  }
  if (mark.length) {
    y -= 8;
    const mh = mark.length * lead(ms) + 4;
    p.drawRectangle({ x: tx - 4, y: y - mh, width: inner + 4, height: mh, color: C.warnSoft });
    warnIcon(p, f, tx, y - lead(ms) + 1, 8);
    let my = y;
    for (const ln of mark) { my -= lead(ms); p.drawText(ln, { x: tx + 13, y: my + 3, size: ms, font: f.bold, color: C.warn }); }
    y -= mh;
  }
  y -= 6;
  for (const ln of src) { y -= lead(8); p.drawText(ln, { x: tx, y: y + 3, size: 8, font: f.regular, color: C.faint }); }
  fl.y = top - h - (o.boxed ? 12 : 14);
}

/** Pure. Where a card came from, in one line: its citations, then what kind of card it is (its origin label). */
export function sourceLine(c: FlashcardView): string {
  const cites = uniq(c.sources.map(s => s.citation));
  return [cites.length ? cites.join("; ") : c.origin === "learner" ? "Written by you" : "No source recorded", c.originLabel].join(" · ");
}

function originSummary(cards: readonly FlashcardView[]): string {
  const docs = uniq(cards.filter(c => c.origin === "notes").map(c => c.material.title));
  const lib = cards.filter(c => c.origin === "library").length;
  const own = cards.filter(c => c.origin === "learner").length;
  const ext = cards.filter(c => c.sources.some(s => s.origin === "external")).length;
  const parts = [
    docs.length ? `your notes (${docs.join(", ")})` : null,
    ext ? `approved references linked to your notes (${ext} card${ext === 1 ? "" : "s"})` : null,
    lib ? `the Competen library (${lib} card${lib === 1 ? "" : "s"})` : null,
    own ? `cards you wrote (${own})` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "none recorded";
}
const topicList = (cards: readonly FlashcardView[]) => { const t = uniq(cards.map(topicOf)); return t.length > 6 ? `${t.slice(0, 6).join(", ")} and ${t.length - 6} more` : t.join(", "); };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const sensitiveNote = (cards: readonly FlashcardView[]) => {
  const n = cards.filter(c => flagOf(c)).length;
  return n ? `${plural(n, "card")} ${n === 1 ? "is" : "are"} marked clinically sensitive (a value, target or threshold, or emergency assessment): check ${n === 1 ? "it" : "them"} against current local guidelines.` : null;
};

function deckHeader(fl: Flow, input: FlashcardPdfInput, kind: string) {
  const f = fl.f;
  wordmark(fl.page, f, fl.left, fl.y - 12);
  fl.y -= 30;
  fl.text(input.title, { font: f.bold, size: 22, color: C.accentDeep, after: 2 });
  fl.text(`${kind} · ${plural(input.cards.length, "card")} · Created ${longDate(input.generatedAt)}`, { size: 10, color: C.muted, after: 6 });
  if (input.cards.length) {
    fl.text(`Topics: ${topicList(input.cards)}`, { size: 9.5, color: C.ink, after: 1 });
    fl.text(`Sources: ${originSummary(input.cards)}`, { size: 9.5, color: C.ink, after: 6 });
  }
  const notes = [FLASHCARD_PDF_DISCLAIMER, "Private to you: made only from your own cards. Formative revision, not an assessment."];
  const s = sensitiveNote(input.cards);
  if (s) notes.push(s);
  if (input.omitted) notes.push(`This download holds the first ${input.cards.length} cards of ${input.cards.length + input.omitted}: the most one download may hold. Download a smaller deck for the rest.`);
  fl.noticeBox(notes);
}

// ── A: THE DECK ──

async function buildDeck(input: FlashcardPdfInput, trace: LayoutBox[]): Promise<Uint8Array> {
  const { pdf, f } = await newDoc(input.title, "Flashcard deck", input.generatedAt);
  const fl = new Flow(pdf, f, trace);
  fl.newPage();
  deckHeader(fl, input, "Flashcard deck");
  if (!input.cards.length) fl.text("There are no cards in this selection.", { color: C.muted });
  input.cards.forEach((c, i) => qaBlock(fl, c, i + 1, { boxed: true, header: `Card ${i + 1} of ${input.cards.length}` }));
  stampFooters(pdf, f);
  return pdf.save();
}

// ── B: PRINTABLE CARDS ──

type Fit = { size: number; blocks: { lines: string[]; font: PDFFont; size: number; color: RGB }[]; height: number };
/** The largest size (13 down to 6.5) at which the blocks fit; failing that, the first block alone, clipped. */
function fitBlocks(blocks: { text: string | null; font: PDFFont; scale: number; color: RGB }[], w: number, h: number): Fit {
  const try1 = (bs: typeof blocks, size: number): Fit => {
    const out = bs.filter(b => paras(b.text).length).map(b => ({ lines: wrapAll(b.text, b.font, size * b.scale, w), font: b.font, size: size * b.scale, color: b.color }));
    return { size, blocks: out, height: out.reduce((s, b, i) => s + b.lines.length * lead(b.size) + (i ? 5 : 0), 0) };
  };
  for (const bs of [blocks, blocks.slice(0, 1)])
    for (let size = 13; size >= 6.5; size -= 0.5) { const r = try1(bs, size); if (r.height <= h) return r; }
  const r = try1(blocks.slice(0, 1), 6.5);
  const keep = Math.max(1, Math.floor(h / lead(6.5)));
  if (r.blocks[0] && r.blocks[0].lines.length > keep) {
    const ls = r.blocks[0].lines.slice(0, keep);
    ls[keep - 1] = clip(`${ls[keep - 1]} …`, r.blocks[0].font, 6.5, w);
    r.blocks[0].lines = ls;
    r.height = keep * lead(6.5);
  }
  return r;
}

function drawFit(p: PDFPage, fit: Fit, x: number, top: number, h: number) {
  let y = top - (h - fit.height) / 2;
  fit.blocks.forEach((b, i) => {
    if (i) y -= 5;
    for (const ln of b.lines) { y -= lead(b.size); p.drawText(ln, { x, y: y + b.size * 0.3, size: b.size, font: b.font, color: b.color }); }
  });
}

/** Printed card faces: a print marker short enough for a card (the full one is in the deck and the guide). */
const PRINT_MARKER = "Check current local guidelines: clinically sensitive value";
const PRINT_MARKER_TAIL = { notes: "not clinically reviewed", learner: "not clinically reviewed", library: "clinically reviewed" } as const;

/**
 * One face of a printed card. Head: Q or A and the card number (the same number on both faces). Foot: on the question,
 * its topic and what kind of card it is; on the answer, where it came from and what kind of card it is, with the
 * clinically sensitive marker above them where flagged (and a warning sign beside the number on both faces).
 */
function printFace(p: PDFPage, f: Fonts, c: FlashcardView, n: number, side: "Q" | "A", x: number, y: number, w: number, h: number) {
  const pad = 13, fsz = 6.5;
  const top = y + h - pad;
  const flag = flagOf(c);
  badge(p, f, side, x + pad, top - 15, 15);
  p.drawText(side === "Q" ? "Question" : "Answer", { x: x + pad + 20, y: top - 10.5, size: 8.5, font: f.bold, color: side === "Q" ? C.accent : C.answer });
  const num = `#${n}`;
  const nx = x + w - pad - f.bold.widthOfTextAtSize(num, 9);
  p.drawText(num, { x: nx, y: top - 10.5, size: 9, font: f.bold, color: C.faint });
  if (flag) warnIcon(p, f, nx - 13, top - 12, 9);
  const foot: { text: string; color: RGB; font: PDFFont }[] = side === "Q"
    ? [{ text: topicOf(c), color: C.faint, font: f.regular }, { text: ORIGIN_SHORT[c.origin], color: C.muted, font: f.bold }]
    : [
      ...(flag ? wrap(pdfText(`${PRINT_MARKER}; ${flag.reviewed ? PRINT_MARKER_TAIL.library : PRINT_MARKER_TAIL[c.origin]}.`), f.bold, fsz, w - 2 * pad).slice(0, 2).map(t => ({ text: t, color: C.warn, font: f.bold })) : []),
      { text: uniq(c.sources.map(s => s.citation)).join("; ") || (c.origin === "learner" ? "Written by you" : "No source recorded"), color: C.faint, font: f.regular },
      { text: ORIGIN_SHORT[c.origin], color: C.muted, font: f.bold },
    ];
  let fy = y + pad - 2;
  for (const ln of [...foot].reverse()) { p.drawText(clip(ln.text, ln.font, fsz, w - 2 * pad), { x: x + pad, y: fy, size: fsz, font: ln.font, color: ln.color }); fy += lead(fsz); }
  const bodyTop = top - 24, bodyH = h - 2 * pad - 24 - foot.length * lead(fsz) - 4;
  const fit = fitBlocks(side === "Q"
    ? [{ text: c.front, font: f.bold, scale: 1, color: C.ink }]
    : [{ text: c.back, font: f.regular, scale: 1, color: C.ink }, { text: c.explanation, font: f.italic, scale: 0.8, color: C.muted }],
  w - 2 * pad, bodyH);
  drawFit(p, fit, x + pad, bodyTop, bodyH);
}

const cut = { thickness: 0.6, color: hex("#9AA0AC"), dashArray: [4, 3] };
/** The print margin and grid: the same on every page and both sides, so a duplex flip lands each face on its question. */
export const PRINT_GRID = { mx: 28.35, top: H - 62, bottom: 56 } as const;

async function buildPrint(input: FlashcardPdfInput, layout: PrintLayout, trace: LayoutBox[]): Promise<Uint8Array> {
  const { pdf, f } = await newDoc(input.title, layout === "duplex" ? "Printable flashcards, double-sided" : "Printable flashcards, single-sided foldable", input.generatedAt);
  const { mx, top: gridTop, bottom: gridBottom } = PRINT_GRID;
  const header = (p: PDFPage, left: string, right: string, hint: string) => {
    wordmark(p, f, mx, H - 30, 9.5);
    const lx = mx + 18 + f.bold.widthOfTextAtSize("Competen Scholar", 9.5) + 6;
    p.drawText(clip(`· ${left}`, f.bold, 9, W / 2 - 60), { x: lx, y: H - 30, size: 9, font: f.bold, color: C.ink });
    const r = clip(right, f.regular, 8.5, W / 2 - 60);
    p.drawText(r, { x: W - mx - f.regular.widthOfTextAtSize(r, 8.5), y: H - 30, size: 8.5, font: f.regular, color: C.muted });
    p.drawText(clip(hint, f.regular, 7.5, W - 2 * mx), { x: mx, y: H - 45, size: 7.5, font: f.regular, color: C.muted });
  };
  const face = (p: PDFPage, idx: number, side: "Q" | "A", x: number, y: number, w: number, h: number) => {
    printFace(p, f, input.cards[idx], idx + 1, side, x, y, w, h);
    trace.push({ kind: "face", page: pdf.getPageCount() - 1, top: y + h, bottom: y, x, w, card: idx + 1, side });
  };
  if (!input.cards.length) {
    const p = pdf.addPage(A4);
    header(p, input.title, "", "There are no cards in this selection.");
  }
  if (layout === "duplex") {
    const cw = (W - 2 * mx) / PRINT_COLS, ch = (gridTop - gridBottom) / PRINT_ROWS;
    const grid = (p: PDFPage) => {
      for (let c = 0; c <= PRINT_COLS; c++) p.drawLine({ start: { x: mx + c * cw, y: gridBottom }, end: { x: mx + c * cw, y: gridTop }, ...cut });
      for (let r = 0; r <= PRINT_ROWS; r++) p.drawLine({ start: { x: mx, y: gridTop - r * ch }, end: { x: W - mx, y: gridTop - r * ch }, ...cut });
    };
    const sheets = duplexSheets(input.cards.length);
    sheets.forEach((s, si) => {
      for (const side of ["Q", "A"] as const) {
        const p = pdf.addPage(A4);
        header(p, input.title, `Sheet ${si + 1} of ${sheets.length} · ${side === "Q" ? "Front: questions" : "Back: answers"}`,
          side === "Q" ? "Print double-sided, flipping on the LONG edge: each answer lands behind its question. Cut along the dashed lines. Card numbers match on both sides."
            : "Answers, mirrored left to right so they land behind their questions when printed double-sided (flip on long edge).");
        grid(p);
        (side === "Q" ? s.front : s.back).forEach((idx, k) => {
          if (idx === null) return;
          const r = Math.floor(k / PRINT_COLS), c = k % PRINT_COLS;
          face(p, idx, side, mx + c * cw, gridTop - (r + 1) * ch, cw, ch);
        });
      }
    });
  } else {
    // Single-sided foldable: the fold line is the page's centre line, so both halves of a card are the same size and
    // meet on it exactly; folding along it puts the answer behind its question, the right way up.
    const fold = W / 2, cw = fold - mx, ch = (gridTop - gridBottom) / PRINT_FOLD_ROWS;
    const pages = foldSheets(input.cards.length);
    pages.forEach((rows, pi) => {
      const p = pdf.addPage(A4);
      header(p, input.title, `Page ${pi + 1} of ${pages.length} · Question | Answer · fold`,
        "Single-sided: cut along the dashed lines around each card, then fold it on the FOLD line so the question and the answer (the same number) are back to back.");
      const bottom = gridTop - rows.length * ch;
      for (const x of [mx, W - mx]) p.drawLine({ start: { x, y: bottom }, end: { x, y: gridTop }, ...cut });
      p.drawLine({ start: { x: fold, y: bottom }, end: { x: fold, y: gridTop }, thickness: 0.8, color: C.accentMid, dashArray: [1.5, 2.5] });
      for (let r = 0; r <= rows.length; r++) p.drawLine({ start: { x: mx, y: gridTop - r * ch }, end: { x: W - mx, y: gridTop - r * ch }, ...cut });
      rows.forEach((idx, r) => {
        const y = gridTop - (r + 1) * ch;
        face(p, idx, "Q", mx, y, cw, ch);
        face(p, idx, "A", fold, y, cw, ch);
        // "FOLD" on the line, in each card, in a gap of its own so it never sits on the card's words.
        const lbl = "FOLD", ls = 6, lw = f.bold.widthOfTextAtSize(lbl, ls);
        p.drawRectangle({ x: fold - lw / 2 - 2, y: y + ch - 26, width: lw + 4, height: 9, color: C.white });
        p.drawText(lbl, { x: fold - lw / 2, y: y + ch - 23.5, size: ls, font: f.bold, color: C.accent });
      });
    });
  }
  if (input.omitted) {
    const p = pdf.getPages()[0];
    p.drawText(clip(`First ${input.cards.length} cards of ${input.cards.length + input.omitted}: the most one download may hold.`, f.bold, 7.5, W - 2 * mx), { x: mx, y: H - 55, size: 7.5, font: f.bold, color: C.accent });
  }
  stampFooters(pdf, f, { margin: mx });
  return pdf.save();
}

// ── C: THE REVISION GUIDE ──

function cover(pdf: PDFDocument, f: Fonts, input: FlashcardPdfInput, variant: GuideVariant) {
  const p = pdf.addPage(A4);
  wordmark(p, f, W / 2, H - 110, 15, true);
  const titleLines = wrapAll(input.title, f.bold, 32, W - 160);
  let y = H - 290 + (titleLines.length - 1) * lead(32) / 2;
  for (const ln of titleLines) { p.drawText(ln, { x: (W - f.bold.widthOfTextAtSize(ln, 32)) / 2, y, size: 32, font: f.bold, color: C.accentDeep }); y -= lead(32); }
  const centre = (s: string, size: number, font: PDFFont, color: RGB, gap: number) => {
    for (const ln of wrapAll(s, font, size, W - 160)) { y -= gap; p.drawText(ln, { x: (W - font.widthOfTextAtSize(ln, size)) / 2, y, size, font, color }); gap = lead(size); }
  };
  centre("Revision Guide", 16, f.regular, C.ink, 10);
  centre(variant === "concise" ? "Concise: key concepts, short answers, checklist" : "Comprehensive: with explanations and clinical application", 10, f.italic, C.muted, 16);
  const topics = topicList(input.cards);
  if (topics) centre(topics, 11, f.regular, C.muted, 22);
  centre(`Created ${longDate(input.generatedAt)} · ${plural(input.cards.length, "card")}`, 10, f.regular, C.muted, 18);
  if (input.omitted) centre(`The first ${input.cards.length} of ${input.cards.length + input.omitted} cards: the most one download may hold.`, 9, f.italic, C.muted, 16);
  // The educational-use notice.
  const bw = W - 160, size = 9;
  const notice = [FLASHCARD_PDF_DISCLAIMER, "Private to you: made only from your own cards. Formative revision, not an assessment."];
  const s = sensitiveNote(input.cards);
  if (s) notice.push(`${s} See Points to Verify.`);
  const lines = notice.flatMap(l => wrap(pdfText(l), f.regular, size, bw - 24));
  const bh = lines.length * lead(size) + 30;
  const by = 250;
  p.drawRectangle({ x: 80, y: by, width: bw, height: bh, color: C.accentSoft });
  p.drawText("Educational use", { x: 92, y: by + bh - 16, size: 9, font: f.bold, color: C.accentDeep });
  let ly = by + bh - 18;
  for (const ln of lines) { ly -= lead(size); p.drawText(ln, { x: 92, y: ly, size, font: f.regular, color: C.accentDeep }); }
  // The wave of the mock-up, in two tones.
  p.drawSvgPath(`M 0 70 C 160 20 360 120 ${W} 30 L ${W} 200 L 0 200 Z`, { x: 0, y: 200, color: C.accentMid });
  p.drawSvgPath(`M 0 110 C 180 60 380 150 ${W} 80 L ${W} 200 L 0 200 Z`, { x: 0, y: 200, color: C.accent });
}

/** From this many cards a guide has contents and starts each section on its own page. */
export const LONG_GUIDE_CARDS = 6;
const cardList = (ns: readonly number[]) => ns.map(n => `Card ${n}`).join(", ");

async function buildGuide(input: FlashcardPdfInput, variant: GuideVariant, trace: LayoutBox[]): Promise<Uint8Array> {
  const { pdf, f } = await newDoc(`${input.title} - Revision Guide${variant === "concise" ? " (concise)" : ""}`, `Revision guide, ${variant}`, input.generatedAt);
  const plan = guidePlan(input.cards, variant);
  cover(pdf, f, input, variant);
  const fl = new Flow(pdf, f, trace);
  const toc: { title: string; page: number; level: 0 | 1 }[] = [];
  const at = (title: string, level: 0 | 1 = 0) => () => toc.push({ title, page: pdf.getPageCount() - 1, level });
  const clinicalNo = () => sections.findIndex(s => s.title === "Clinical Application") + 1;
  const sections: { title: string; draw: () => void }[] = [
    { title: "Key Concepts", draw: () => {
      if (!plan.keyConcepts.length) { fl.text("Your cards hold no learning objectives, key points or explanations yet, so there are no key concepts to list. The questions and answers follow.", { color: C.muted }); return; }
      for (const k of plan.keyConcepts) {
        fl.subheading(k.label);
        if (k.objectives.length) { fl.keepText("You should be able to:", { size: 9.5, font: f.bold, color: C.muted, after: 1 }); for (const o of k.objectives) fl.bullet(o); fl.y -= 3; }
        if (k.points.length) { fl.keepText("Key points:", { size: 9.5, font: f.bold, color: C.muted, after: 1 }); for (const pt of k.points) fl.bullet(pt); }
        fl.y -= 6;
      }
    } },
    { title: "Questions and Answers", draw: () => {
      fl.keepText(variant === "concise" ? "Every card once, with its short answer. The comprehensive guide adds explanations and the clinical application cards on their own."
        : plan.clinical.length ? `Each card appears once in this guide. Cards that ask you to apply what you know are in section ${clinicalNo()}, Clinical Application, and are named under their topic here.`
          : "Each card appears once in this guide.", { size: 9.5, color: C.muted, after: 6 });
      for (const t of plan.qa) {
        if (!t.cards.length && !t.applied.length) continue;
        fl.subheading(t.label, plan.qa.length > 1 ? at(t.label, 1) : undefined);
        for (const x of t.cards) qaBlock(fl, x.card, x.n, { boxed: false, short: variant === "concise" });
        if (t.applied.length) fl.text(`Applied in section ${clinicalNo()}, Clinical Application: ${cardList(t.applied)}.`, { size: 9, font: f.italic, color: C.accent, after: 8 });
      }
    } },
    ...(plan.clinical.length ? [{ title: "Clinical Application", draw: () => {
      fl.keepText("Your cards that ask you to apply what you know, exactly as they are written, each with its card number. Work out your answer before reading on.", { size: 9.5, color: C.muted, after: 8 });
      plan.clinical.forEach((x, i) => qaBlock(fl, x.card, x.n, { boxed: true, header: `Scenario ${i + 1} · Card ${x.n}` }));
    } }] : []),
    ...(plan.verify.length ? [{ title: "Points to Verify", draw: () => {
      fl.keepText("These cards state a clinically sensitive value (a number, target, threshold or dose) or cover emergency respiratory assessment, paediatric respiratory rates, oxygen saturation targets or COPD deterioration. They were found by a fixed rule and are unchanged. Check each against current local guidelines before relying on it.", { size: 9.5, color: C.muted, after: 6 });
      for (const v of plan.verify) {
        const standing = v.flag.reviewed ? v.flag.marker : `${ORIGIN_SHORT[v.card.origin]}.`;
        fl.bullet(`Card ${v.n} · ${topicOf(v.card)}: ${v.flag.labels.join("; ")}${v.flag.values.length ? ` (${v.flag.values.join(", ")})` : ""}. ${standing}`, { box: true });
      }
    } }] : []),
    { title: "Quick Revision Checklist", draw: () => {
      fl.keepText("Tick each one when you can do it without looking. Each line is from your own cards' objectives and key points.", { size: 9.5, color: C.muted, after: 6 });
      for (const k of plan.checklist) { fl.subheading(k.label); for (const it of k.items) fl.bullet(it, { box: true }); fl.y -= 4; }
    } },
    { title: "References", draw: () => {
      const r = plan.references;
      const group = (title: string, rows: GuideReference[]) => {
        if (!rows.length) return;
        fl.subheading(title);
        for (const x of rows) {
          fl.bullet(`${x.citation} (${plural(x.cards, "card")})`);
          if (x.sections.length) fl.text(`Sections: ${x.sections.join(", ")}`, { size: 8.5, color: C.muted, indent: 16, after: 1 });
          if (x.detail) fl.text(x.detail, { size: 8.5, font: f.italic, color: C.muted, indent: 16, after: 3 });
        }
        fl.y -= 4;
      };
      group("From your notes", r.notes);
      group("From the Competen library (clinically reviewed)", r.library);
      group("Approved framework references linked to your notes", r.framework);
      group("External references", r.external);
      if (r.ownCards) { fl.subheading("Cards you wrote"); fl.bullet(`${plural(r.ownCards, "card")} in your own words: no source attached, not clinically reviewed.`); }
      if (!r.notes.length && !r.library.length && !r.framework.length && !r.external.length && !r.ownCards) fl.text("No sources are recorded on these cards.", { color: C.muted });
      fl.y -= 6;
      fl.text("Citations only: source passages are not reproduced. An excerpt is a short one from your own notes. A reference shows only what its record holds: no identifier is added that the record does not have.", { size: 8.5, color: C.muted });
    } },
  ];
  // A longer guide has contents; a longer comprehensive guide also starts each section on a new page. A short guide,
  // and every concise guide, runs on (a heading still never sits alone at the foot of a page).
  const long = input.cards.length >= LONG_GUIDE_CARDS;
  sections.forEach((s, i) => {
    if ((long && variant === "comprehensive") || i === 0) fl.newPage();
    fl.heading(i + 1, s.title, at(`${i + 1}  ${s.title}`));
    s.draw();
    fl.flush();
  });
  // Contents for a longer guide: page 2, so every later page moves on by one.
  if (long) {
    const p = pdf.insertPage(1, A4);
    for (const b of trace) b.page += 1;
    let y = H - 54 - lead(17);
    p.drawText("Contents", { x: 50, y: y + 4, size: 17, font: f.bold, color: C.accentDeep });
    p.drawLine({ start: { x: 50, y: y - 3 }, end: { x: W - 50, y: y - 3 }, thickness: 1.2, color: C.accent });
    y -= 22;
    for (const e of toc.slice(0, 48)) {
      const size = e.level ? 9.5 : 11, font = e.level ? f.regular : f.bold, x = e.level ? 74 : 50;
      y -= lead(size) + (e.level ? 0 : 6);
      const num = String(e.page + 2);
      const t = clip(e.title, font, size, W - 50 - x - 60);
      p.drawText(t, { x, y, size, font, color: e.level ? C.muted : C.ink });
      const dotsFrom = x + font.widthOfTextAtSize(t, size) + 6, dotsTo = W - 50 - f.regular.widthOfTextAtSize(num, size) - 6;
      if (dotsTo > dotsFrom) p.drawLine({ start: { x: dotsFrom, y: y + 2 }, end: { x: dotsTo, y: y + 2 }, thickness: 0.6, color: C.rule, dashArray: [1, 2.5] });
      p.drawText(num, { x: W - 50 - f.regular.widthOfTextAtSize(num, size), y, size, font: f.regular, color: C.ink });
    }
  }
  stampFooters(pdf, f, { from: 1 });
  return pdf.save();
}

/**
 * Pure assembly of one download from the learner's own cards, and where each block went. `layout` applies to print
 * only (duplex, default, or fold; "single" is fold), `guide` to the guide only (comprehensive, default, or concise).
 * The bytes depend on the input alone.
 */
export async function buildFlashcardPdfLayout(format: FlashcardExportFormat, input: FlashcardPdfInput, opts: FlashcardPdfOptions = {}): Promise<{ bytes: Uint8Array; layout: LayoutBox[] }> {
  const layout: LayoutBox[] = [];
  const bytes = format === "deck" ? await buildDeck(input, layout)
    : format === "print" ? await buildPrint(input, asPrintLayout(opts.layout), layout)
      : await buildGuide(input, asGuideVariant(opts.guide), layout);
  return { bytes, layout };
}

/** Pure assembly of one download from the learner's own cards (buildFlashcardPdfLayout without the layout). */
export async function buildFlashcardPdf(format: FlashcardExportFormat, input: FlashcardPdfInput, opts: FlashcardPdfOptions = {}): Promise<Uint8Array> {
  return (await buildFlashcardPdfLayout(format, input, opts)).bytes;
}

/** The layout's page geometry, for the tests: the flowing writer's margins (deck and guide). */
export const FLOW_MARGINS = { top: H - 54, bottom: 62, left: 50, width: W - 100 } as const;
