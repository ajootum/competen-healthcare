import { parseRels } from "./slide-images";

// ── PICTURES INSIDE A WORD FILE, IN THEIR PLACE ── SCHOLAR-VISUAL-001 phase 2, piece C ──────────────────────────────────────
//
// Pure. A Word file has no reliable page numbers, so its sections are numbered, and a picture belongs to the section holding the text just before it.
// This file reads the order of text and pictures from document.xml, and finds that text in the sections as stored. It reads no picture and calls no AI.
// The pictures are the ORIGINAL bytes of the file (material-visuals-io.ts).

export type WordPicture = {
  /** The part inside the file, word/media/...; null for a picture linked from outside the file, or a chart or diagram. */
  part: string | null;
  /** The text just before it, with spaces removed, for finding its place. Empty when it comes before any text. */
  before: string;
  /** How many characters of the document's text (spaces removed) come before it. A count, not a share: the stored text can run on past the body, with footnotes. */
  offset: number;
};

/** How much of the text before a picture is used to find its place. Long enough to be one place, short enough to survive small differences. */
const ANCHOR_CHARS = 60;
/** Tried next when the longer text is not found: something inside it reads differently in the stored text. */
const SHORT_ANCHOR_CHARS = 20;

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
/** Spaces and list bullets differ between Word's XML and the text as stored, and carry nothing about place. */
const bare = (s: string) => s.replace(/[\s•\u00a0]+/g, "");
/** The stored text as above, and without the footnote markers ("[1]") the reader adds, which document.xml does not hold. */
const bareStored = (s: string) => bare(s).replace(/\[\d{1,4}\]/g, "");

/**
 * Pure. Word writes a shape twice inside AlternateContent, a modern form and a fallback for older readers. One is kept, so a picture counts once: the modern
 * form, unless only the fallback holds the picture (ink is written that way).
 */
function oneFormOfEachShape(xml: string): string {
  const picture = /<(?:a:blip|v:imagedata)\b|<a:graphicData\b/;
  return xml
    .replace(/<mc:Fallback\b[^>]*?\/>/g, "")
    .replace(/<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>\s*<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/g, (_, choice: string, fallback: string) => (picture.test(choice) || !picture.test(fallback) ? choice : fallback));
}

/** Pure. A relationship target, relative to word/, as a part name. Null unless it lands inside word/media/: a target that climbs out is never opened. */
export function wordMediaPart(target: string): string | null {
  const t = target.replace(/\\/g, "/");
  const parts = t.startsWith("/") ? t.slice(1).split("/") : ["word", ...t.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") { if (!out.length) return null; out.pop(); continue; }
    out.push(p);
  }
  const name = out.join("/");
  return /^word\/media\/[^/]+$/.test(name) ? name : null;
}

/**
 * Pure. Every picture in document.xml, in document order, each with the text before it. Word writes a shape twice, a modern form and an old one for older
 * readers, inside AlternateContent: the fallback is left out, so a picture counts once.
 */
export function wordPictures(documentXml: string, relsXml: string | null): WordPicture[] {
  const rels = relsXml ? parseRels(relsXml) : new Map<string, { target: string; image: boolean; external: boolean }>();
  const xml = oneFormOfEachShape(documentXml);
  // A chart or a diagram is content too. It has no picture to show, so it goes in the list as one that cannot be shown, and the learner is told.
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<(?:a:blip|v:imagedata)\b[^>]*?\br:(?:embed|link|id|pict)\s*=\s*"([^"]+)"|<a:graphicData\b[^>]*\buri="[^"]*(chart|diagram)[^"]*"/g;
  const seen: { text: number; id: string | null }[] = [];
  let text = "";
  for (const m of xml.matchAll(token)) {
    if (m[2]) seen.push({ text: text.length, id: m[2] });
    else if (m[3]) seen.push({ text: text.length, id: null });
    else text += bare(decode(m[1] ?? ""));
  }
  const out: WordPicture[] = [];
  for (const s of seen) {
    if (s.id === null) { out.push({ part: null, before: text.slice(Math.max(0, s.text - ANCHOR_CHARS), s.text), offset: s.text }); continue; }
    const rel = rels.get(s.id);
    if (!rel || !rel.image) continue;
    out.push({
      part: rel.external ? null : wordMediaPart(rel.target),
      before: text.slice(Math.max(0, s.text - ANCHOR_CHARS), s.text),
      offset: s.text,
    });
  }
  return out;
}

/**
 * Pure. The section (its ordinal) each picture belongs to, in the same order, never moving backwards. Its text is looked for from the place of the picture
 * before it, nearest to where it should be. Text that cannot be found (a stored file can be cut at the size limit, or a text box can be read differently) falls
 * back to that place itself. A picture before any text goes with the first section.
 */
export function placeWordPictures(pictures: readonly Pick<WordPicture, "before" | "offset">[], chunks: readonly { ordinal: number; content: string }[]): number[] {
  if (!chunks.length) return [];
  const ordered = chunks.slice().sort((a, b) => a.ordinal - b.ordinal);
  const texts = ordered.map(c => bareStored(c.content));
  const ends: number[] = [];
  let joined = "";
  for (const t of texts) { joined += t; ends.push(joined.length); }
  const sectionAt = (pos: number) => {
    // `pos` is the last character of the text before the picture.
    const i = ends.findIndex(e => pos < e);
    return ordered[i < 0 ? ordered.length - 1 : i].ordinal;
  };
  let from = 0;
  let last = ordered[0].ordinal;
  let previous = -1;
  return pictures.map(p => {
    let place: number;
    // No text since the picture before: the same place.
    if (p.offset === previous) return last;
    previous = p.offset;
    if (!p.before) place = ordered[0].ordinal;
    else {
      // Teaching notes repeat themselves, so the same words can be in many places: of all the matches, the one nearest to where the picture should be.
      // The last character of the text before it, so a picture at the end of a section stays with that section.
      const expected = Math.min(Math.max(0, p.offset - 1), Math.max(0, joined.length - 1));
      const nearest = (anchor: string) => {
        let best = -1;
        for (let at = joined.indexOf(anchor, from); at >= 0; at = joined.indexOf(anchor, at + 1)) {
          if (best < 0 || Math.abs(at + anchor.length - 1 - expected) < Math.abs(best + anchor.length - 1 - expected)) best = at;
        }
        return best < 0 ? null : best + anchor.length;
      };
      const end = nearest(p.before) ?? nearest(p.before.slice(-SHORT_ANCHOR_CHARS));
      if (end !== null) { from = end; place = sectionAt(end - 1); }
      else place = sectionAt(expected);
    }
    last = Math.max(last, place);
    return last;
  });
}
