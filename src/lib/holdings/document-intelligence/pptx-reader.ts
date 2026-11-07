import { createHash } from "node:crypto";
import { drawingText, openOfficeZip, slidePartNames } from "@/lib/individual/scholar/extract";
import { decorativeReason, isRepeated, VISUAL_DEFAULTS, type DeckScan } from "@/lib/individual/scholar/material-visuals";
import { mediaPart, parseRels } from "@/lib/individual/scholar/slide-images";
import { slidePageMap } from "@/lib/individual/scholar/slide-render";
import { scanDeck } from "@/lib/individual/scholar/material-visuals-io";
import type { Block, CanonicalAsset, CanonicalUnit, VisualClass } from "./canonical";
import { slideToUnit, type SlideParts } from "./pptx-canonical";
import type { UnitFacts } from "./quality";

// ── A STORED POWERPOINT, READ ONCE ── COMPETEN-DIG-001 s2.1, PHASE 1 ──────────────────────────────────────────────────────
//
// The native engine, around what already exists: the archive screen (extract.openOfficeZip), the slide numbering (extract.slidePartNames),
// the deck order (slide-render.slidePageMap), the pictures measured once (material-visuals-io.scanDeck), the decorative rule (material-visuals).
// Nothing is reimplemented. One slide that cannot be read costs that slide alone.

export type DeckReading = { units: CanonicalUnit[]; assets: CanonicalAsset[]; facts: UnitFacts[]; scan: DeckScan | null };
export type DeckFailure = { ok: false; reason: "unreadable" | "unsafe"; detail: string };

const sha16 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const relatedTarget = (target: string): string | null => {
  const clean = target.startsWith("/") ? target.slice(1) : target.startsWith("../") ? `ppt/${target.slice(3)}` : `ppt/slides/${target}`;
  return clean.includes("..") ? null : clean;
};

/** Pure, for the facts: tables by their grid, and how many charts and diagrams the slide's own XML names, by regular expression, independent of the tree reader. */
export function slideFactsOf(n: number, xml: string): UnitFacts {
  const tables = [...xml.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>/g)].map(m => ({ rows: (m[0].match(/<a:tr\b/g) ?? []).length, cols: (m[0].match(/<a:gridCol\b/g) ?? []).length }));
  return {
    n, words: drawingText(xml), tables,
    figures: (xml.match(/<p:pic\b/g) ?? []).length,
    charts: (xml.match(/\buri="[^"]*\/drawingml\/2006\/chart"/g) ?? []).length,
    diagrams: (xml.match(/\buri="[^"]*\/drawingml\/2006\/diagram"/g) ?? []).length,
  };
}

export async function readDeck(bytes: Uint8Array, engine: string, only?: readonly number[]): Promise<{ ok: true; reading: DeckReading } | DeckFailure> {
  const z = await openOfficeZip(bytes);
  if (!z.ok) return z;
  const { zip } = z;
  const names = slidePartNames(Object.keys(zip.files));
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const presRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  const positions = presentation && presRels ? slidePageMap(presentation, presRels, names) : null;
  const scan = await scanDeck(bytes);
  const units: CanonicalUnit[] = [];
  const facts: UnitFacts[] = [];
  const perMedia = new Map<string, Set<number>>();
  for (const p of scan?.pictures ?? []) perMedia.set(p.media, (perMedia.get(p.media) ?? new Set()).add(p.n));
  const assets = new Map<string, CanonicalAsset>();
  for (const [i, name] of names.entries()) {
    const n = i + 1;
    if (only && !only.includes(n)) continue;
    const xml = await zip.file(name)!.async("string");
    facts.push(slideFactsOf(n, xml));
    const relsXml = await zip.file(name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")?.async("string");
    const rels = parseRels(relsXml ?? "");
    const media = new Map<string, { part: string | null; external: boolean }>();
    const related = new Map<string, string>();
    let notesXml: string | null = null;
    for (const [id, r] of rels) {
      if (r.image || r.external) media.set(id, { part: r.external ? null : mediaPart(r.target), external: r.external });
      else if (/(^|\/)charts\/chart\d*\.xml$|(^|\/)diagrams\/data\d*\.xml$/.test(r.target)) {
        const part = relatedTarget(r.target);
        const text = part ? await zip.file(part)?.async("string") : undefined;
        if (text) related.set(id, text);
      } else if (/notesSlides\/notesSlide\d+\.xml$/.test(r.target)) {
        const part = relatedTarget(r.target);
        notesXml = (part ? await zip.file(part)?.async("string") : undefined) ?? null;
      }
    }
    const parts: SlideParts = { related, media };
    const { unit } = slideToUnit({ n, part: name, xml, notesXml, parts, position: positions?.get(n) ?? null }, engine);
    // Each figure's id becomes the digest of the picture's own bytes, so one picture on many slides is one asset.
    const blocks: Block[] = [];
    for (const b of unit.blocks) {
      if (b.type !== "figure") { blocks.push(b); continue; }
      const rel = rels.get(relOf(xml, b.source.shapeId) ?? "");
      const part = rel && !rel.external ? mediaPart(rel.target) : null;
      const fact = part ? scan?.pictures.find(p => p.media === part && p.n === n) : null;
      if (!part || !fact) { blocks.push({ type: "unread", what: rel?.external ? "linked_picture" : "unsupported_picture", source: b.source }); continue; }
      const id = fact.sha;
      const existing = assets.get(id);
      if (existing) { if (!existing.units.includes(n)) existing.units.push(n); }
      else {
        const decorative = decorativeReason(fact, VISUAL_DEFAULTS.minPx) !== null || isRepeated(perMedia.get(part)?.size ?? 0, names.length);
        const cls: VisualClass = decorative ? "decorative" : "unknown";
        assets.set(id, {
          id, units: [n], class: cls, classReason: decorative ? "existing decorative rule" : "not classified: treated as clinical",
          representations: [{ role: "original", path: part, sha256: id, bytes: fact.bytes, format: formatOf(fact.kind), width: fact.width, height: fact.height, lossless: true, location: "inside_source" }],
        });
      }
      blocks.push({ ...b, assetId: id });
    }
    units.push({ ...unit, blocks, status: unit.status === "complete" && blocks.some(b => b.type === "unread") ? "partial" : unit.status });
  }
  return { ok: true, reading: { units, assets: [...assets.values()], facts, scan } };
}

/** The relationship id of the picture on the shape with this id. */
function relOf(xml: string, shapeId: string | null): string | null {
  if (!shapeId) return null;
  for (const m of xml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)) {
    if (new RegExp(`<p:cNvPr\\b[^>]*\\bid="${shapeId}"`).test(m[0])) return /<a:blip\b[^>]*\br:(?:embed|link)="([^"]+)"/.exec(m[0])?.[1] ?? null;
  }
  return null;
}

const formatOf = (k: string | null): CanonicalAsset["representations"][number]["format"] =>
  k === "png" ? "png" : k === "jpeg" || k === "jpg" ? "jpeg" : k === "webp" ? "webp" : k === "gif" ? "gif" : k === "tiff" ? "tiff" : k === "bmp" ? "bmp" : "other";

export { sha16 };
