import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Template } from "../documents-config";
import { modelLines, type DocModel } from "./model";

// ── PDF RENDERING OF THE ONE MODEL ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.6 ───────────────────────────────────────
//
// A fixed-layout PDF of the same model, line for line in the same order as the DOCX: the template's page size,
// orientation, margins, typeface and colours, wrapped text, an accent rule under each section heading, the footer and
// "Page n of m" on every page, and document metadata (title, author, subject, keywords, creator, dates).
//
// ⚠ TWO FONT PATHS, CHOSEN PER DOCUMENT. The standard PDF fonts (Helvetica pairs with Arial in the DOCX, Times with Times
// New Roman) encode Windows-1252 only. A document whose text stays inside it renders with them exactly as before. A
// document with any character outside it (Greek, Cyrillic, Latin Extended names, arrows, maths symbols) embeds DejaVu
// Sans or Serif instead, subset to the glyphs used, so the character prints. What DejaVu also lacks (CJK, Ethiopic,
// Indic scripts) is still drawn as "?", and pdfUndrawable() lets the preview say so before export. The fonts live in
// ./fonts with their licence and are traced into the two routes that read them (next.config.ts).

const MM = 72 / 25.4;
const SIZES = { A4: [595.28, 841.89], Letter: [612, 792] } as const;
const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const encodable = (ch: string) => { const c = ch.codePointAt(0)!; return (c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || WIN_EXTRA.includes(ch); };
/** The text as the standard fonts can draw it. */
export const pdfSafe = (s: string) => [...s.replace(/\s+/g, " ")].map(ch => (encodable(ch) ? ch : "?")).join("");
/** Characters the standard fonts cannot draw: any one of them switches the document to the embedded Unicode font. */
export const pdfUnencodable = (lines: readonly string[]) => [...new Set([...lines.join("").replace(/\s/g, "")].filter(ch => !encodable(ch)))];

const FONT_DIR = path.join(process.cwd(), "src/lib/individual/documents/fonts");
const UNICODE_FONTS = { sans: ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf"], serif: ["DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif-Italic.ttf"] } as const;
const fontFiles = new Map<string, Promise<Buffer>>();
const fontFile = (name: string) => { let f = fontFiles.get(name); if (!f) { f = readFile(path.join(FONT_DIR, name)); fontFiles.set(name, f); f.catch(() => fontFiles.delete(name)); } return f; };
const faceOf = (t: Template) => (t.type.face === "serif" ? "serif" : "sans");

/** Characters the PDF will still print as "?": outside Windows-1252 AND missing from one of the face's Unicode fonts. */
export async function pdfUndrawable(lines: readonly string[], t: Template): Promise<string[]> {
  const odd = pdfUnencodable(lines);
  if (!odd.length) return [];
  const fonts = await Promise.all(UNICODE_FONTS[faceOf(t)].map(async n => fontkit.create(await fontFile(n))));
  return odd.filter(ch => fonts.some(f => !f.hasGlyphForCodePoint(ch.codePointAt(0)!)));
}

const colour = (h: string) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

export async function renderPdf(m: DocModel, t: Template, createdAt = new Date()): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const serif = t.type.face === "serif";
  const meta = { title: m.title, author: m.author, subject: `${m.subject}, ${m.template.name} template v${m.template.version}` };
  const unicode = pdfUnencodable([...modelLines(m), ...Object.values(meta)]).length > 0;
  let regular: PDFFont, bold: PDFFont, italic: PDFFont;
  if (unicode) {
    pdf.registerFontkit(fontkit);
    [regular, bold, italic] = await Promise.all(UNICODE_FONTS[faceOf(t)].map(async n => pdf.embedFont(await fontFile(n), { subset: true })));
  } else {
    [regular, bold, italic] = await Promise.all([
      pdf.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica),
      pdf.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold),
      pdf.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique),
    ]);
  }
  // Per font: what it has no glyph for becomes "?" (the standard path keeps pdfSafe, so its output is unchanged).
  const glyphs = new Map<PDFFont, Set<number>>();
  const safe = (s: string, font: PDFFont) => {
    if (!unicode) return pdfSafe(s);
    let has = glyphs.get(font);
    if (!has) { has = new Set(font.getCharacterSet()); glyphs.set(font, has); }
    return [...s.replace(/\s+/g, " ")].map(ch => (has.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  };
  const [w0, h0] = SIZES[t.page.size];
  const [W, H] = t.page.orientation === "landscape" ? [h0, w0] : [w0, h0];
  const mg = { top: t.page.margins.top * MM, right: t.page.margins.right * MM, bottom: t.page.margins.bottom * MM, left: t.page.margins.left * MM };
  const footerSpace = 28;
  const width = W - mg.left - mg.right;
  const base = t.type.base;
  const lead = (size: number) => size * t.type.lineSpacing * 1.15;

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - mg.top;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - mg.top; };
  const room = (h: number) => { if (y - h < mg.bottom + footerSpace) newPage(); };

  const wrap = (text: string, font: PDFFont, size: number, max: number): string[] => {
    const words = safe(text, font).split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= max) { cur = next; continue; }
      if (cur) lines.push(cur);
      // A single word longer than the line is broken by characters.
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > max && rest.length > 1) {
        let i = rest.length;
        while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > max) i--;
        lines.push(rest.slice(0, i));
        rest = rest.slice(i);
      }
      cur = rest;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };
  const text = (s: string, o: { font?: PDFFont; size?: number; colour?: string; indent?: number; after?: number; bullet?: boolean } = {}) => {
    const font = o.font ?? regular, size = o.size ?? base, indent = o.indent ?? 0;
    const lines = wrap(s, font, size, width - indent - (o.bullet ? 10 : 0));
    lines.forEach((ln, i) => {
      room(lead(size));
      y -= lead(size);
      if (o.bullet && i === 0) page.drawText("•", { x: mg.left + indent, y, size, font, color: colour(o.colour ?? t.colours.text) });
      page.drawText(ln, { x: mg.left + indent + (o.bullet ? 10 : 0), y, size, font, color: colour(o.colour ?? t.colours.text) });
    });
    y -= o.after ?? 2;
  };

  const hs = base * t.type.headingScale;
  text(m.header.name, { font: bold, size: hs * 1.5, colour: t.colours.accent, after: 4 });
  if (m.header.headline) text(m.header.headline, { colour: t.colours.muted, after: 2 });
  if (m.header.contact) text(m.header.contact, { colour: t.colours.muted, after: 2 });
  for (const s of m.sections) {
    room(lead(hs) + 16);
    y -= 10;
    text(s.title, { font: bold, size: hs, colour: t.colours.accent, after: 3 });
    page.drawLine({ start: { x: mg.left, y: y + 1 }, end: { x: W - mg.right, y: y + 1 }, thickness: 0.6, color: colour(t.colours.accent) });
    y -= 4;
    if (s.intro) text(s.intro, { font: italic, colour: t.colours.muted, after: 4 });
    for (const para of s.paragraphs) text(para, { after: 5 });
    for (const e of s.entries) {
      y -= 3;
      text(e.subtitle ? `${e.title}, ${e.subtitle}` : e.title, { font: bold, after: 1 });
      text([e.when, e.status].filter(Boolean).join(" · "), { size: base * 0.9, colour: t.colours.muted, after: 1 });
      for (const f of e.facts) text(f, { size: base * 0.95, indent: 6, bullet: true, after: 1 });
    }
  }
  if (m.legend.length) { y -= 10; text(`Status wording: ${m.legend.join("; ")}.`, { size: base * 0.85, colour: t.colours.muted }); }

  const pages = pdf.getPages();
  const fs = base * 0.8;
  pages.forEach((pg, i) => {
    let fy = mg.bottom - 2;
    if (t.footer.pageNumbers) {
      const label = `Page ${i + 1} of ${pages.length}`;
      pg.drawText(label, { x: W - mg.right - regular.widthOfTextAtSize(label, fs), y: fy, size: fs, font: regular, color: colour(t.colours.muted) });
    }
    if (m.footer) for (const ln of wrap(m.footer, regular, fs, width - 70)) { pg.drawText(ln, { x: mg.left, y: fy, size: fs, font: regular, color: colour(t.colours.muted) }); fy -= lead(fs); }
  });

  // Document properties are Unicode text strings in a PDF, so the Unicode path keeps them whole.
  const info = (s: string) => (unicode ? s.replace(/\s+/g, " ") : pdfSafe(s));
  pdf.setTitle(info(meta.title));
  pdf.setAuthor(info(meta.author));
  pdf.setSubject(info(meta.subject));
  pdf.setKeywords(["Competen", m.docType]);
  pdf.setCreator("Competen Document Studio");
  pdf.setProducer("Competen Document Studio (pdf-lib)");
  pdf.setCreationDate(createdAt);
  pdf.setModificationDate(createdAt);
  return Buffer.from(await pdf.save());
}
