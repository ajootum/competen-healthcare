import { createHash } from "node:crypto";

// ── THE CANONICAL LEARNING DOCUMENT ── COMPETEN-DIG-001 s2.2, PHASE 1 (architecture and benchmark only) ──────────────────
//
// One document, converted once, that Learn, Revise, Apply, Evaluate, Personal AI and research-grounded teaching can all read.
// ⚠ NOTHING IN THE APP IMPORTS THIS YET. It runs only in the proof of concept (scripts/dig-poc). Production is unchanged.
//
//   units[].blocks  the structured truth: reading order, tables, figures, each with an exact source reference
//   markdown        derived from the blocks by toMarkdown, never edited apart from them and never the only copy
//   assets          every visual, with the bytes of the original preserved by digest, and only the representations justified
//   interpretations what AI said about the document. Never a block: source and interpretation cannot be confused by construction
//
// A unit is a slide, a page or a section, numbered as Scholar numbers it today (extract.slidePartNames), so "slide 33" means the
// same part everywhere. Where the deck's running order differs, position says so.

export const CANONICAL_SCHEMA = "competen.canonical-document";
export const CANONICAL_VERSION = 1;

export type UnitKind = "slide" | "page" | "section";

/** Where a block came from in the file. EMU for a slide, points for a page; null where the format has no geometry. */
export type SourceRef = {
  unit: number;
  /** The package part or page object. */
  part: string | null;
  shapeId: string | null;
  shapeName: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  /** Inside a group, the group's id at each depth. */
  groupPath: string[];
};

export type TableCell = { text: string; rowSpan: number; colSpan: number; merged: boolean };
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string; source: SourceRef }
  | { type: "paragraph"; text: string; source: SourceRef }
  | { type: "list"; items: { level: number; text: string }[]; source: SourceRef }
  | { type: "table"; rows: TableCell[][]; source: SourceRef }
  | { type: "figure"; assetId: string; alt: string; crop: { l: number; t: number; r: number; b: number } | null; source: SourceRef }
  /** Values read from the chart's own part, never from a picture of it. */
  | { type: "chart"; title: string; categories: string[]; series: { name: string; values: string[] }[]; source: SourceRef }
  /** SmartArt nodes, read from the diagram's own part. */
  | { type: "diagram"; nodes: string[]; source: SourceRef }
  /** Something is there that this conversion could not read. Said, never dropped. */
  | { type: "unread"; what: "embedded" | "media" | "ink" | "unsupported_picture" | "linked_picture" | "drawing" | "other"; source: SourceRef }
  | { type: "notes"; text: string; source: SourceRef };

export type UnitStatus = "complete" | "partial" | "blank" | "failed";
export type CanonicalUnit = {
  n: number;
  /** Place in the deck's running order, or null where the file has none or it could not be read. */
  position: number | null;
  hidden: boolean;
  status: UnitStatus;
  /** Which engine produced this unit: after a targeted recovery, units of one document can differ. */
  engine: string;
  blocks: Block[];
};

/** Why a visual may or may not be optimised (visual-policy.ts). `unknown` is handled as clinical. */
export type VisualClass = "clinical_scientific" | "general" | "decorative" | "unknown";
export type AssetRepresentation = {
  role: "original" | "display" | "thumbnail" | "whole_unit";
  path: string | null;
  sha256: string;
  bytes: number;
  format: "webp" | "jpeg" | "png" | "svg" | "gif" | "tiff" | "bmp" | "other";
  width: number | null;
  height: number | null;
  lossless: boolean;
  /** The original stays inside the source file until something needs it on its own. */
  location: "inside_source" | "stored";
};
export type CanonicalAsset = { id: string; units: number[]; class: VisualClass; classReason: string; representations: AssetRepresentation[] };

/** Stored apart from blocks and invalidated apart from them. */
export type Interpretation = {
  id: string;
  kind: "transcription" | "explanation" | "classification";
  unit: number | null;
  assetId: string | null;
  text: string;
  model: string;
  promptVersion: string;
  /** The digest of what was read, so it can be dropped only when that changes. */
  inputSha256: string;
  tokens: { input: number; output: number } | null;
  at: string;
};

export type EngineRun = { engine: string; version: string; role: "primary" | "fallback" | "recovery" | "render"; units: number[] | "all"; ok: boolean; reason: string | null; ms: number | null; peakMb: number | null };
export type QualityIssue = { unit: number | null; check: QualityCheck; detail: string };
export type QualityCheck = "text_completeness" | "unit_order" | "table_structure" | "visual_preservation" | "source_refs" | "labels" | "separation";
export type QualityReport = { passed: boolean; textRecall: number | null; issues: QualityIssue[] };

export type CanonicalDocument = {
  schema: typeof CANONICAL_SCHEMA;
  schemaVersion: number;
  source: { sha256: string; bytes: number; mime: string; unit: UnitKind; units: number };
  /** What makes this conversion reusable: see conversionKey. */
  conversion: { key: string; pipelineVersion: string; configVersion: number; requirement: FidelityRequirement; engines: EngineRun[] };
  units: CanonicalUnit[];
  assets: CanonicalAsset[];
  interpretations: Interpretation[];
  quality: QualityReport;
};

/** text: words are enough. visual: layout must also be kept (a whole slide is drawn where it matters). */
export type FidelityRequirement = "text" | "visual";

/**
 * Pure. The cache key. The same bytes under the same rules, inside the same ownership boundary, need no second conversion. A learner's
 * scope is their own: the file a learner uploaded is never reused for another learner, even when the bytes match, so one person cannot
 * learn another holds a file. A shared scope exists only for content HQ has placed there.
 */
export function conversionKey(args: { sourceSha256: string; pipelineVersion: string; requirement: FidelityRequirement; scope: string }): string {
  return createHash("sha256").update(`${args.scope}\n${args.sourceSha256}\n${args.pipelineVersion}\n${args.requirement}`).digest("hex");
}

const cellText = (s: string) => s.replace(/\s*\n\s*/g, " <br> ").replace(/\|/g, "\\|").trim();

function gridOf(rows: readonly (readonly string[])[]): string {
  if (!rows.length) return "";
  const width = Math.max(...rows.map(r => r.length));
  const line = (r: readonly string[]) => `| ${Array.from({ length: width }, (_, i) => cellText(r[i] ?? "")).join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

/** Pure. One block as Markdown. Deterministic: the same blocks always give the same bytes. */
export function blockMarkdown(b: Block): string {
  switch (b.type) {
    case "heading": return `${"#".repeat(b.level + 1)} ${b.text}`;
    case "paragraph": return b.text;
    case "list": return b.items.map(i => `${"  ".repeat(Math.max(0, i.level))}- ${i.text}`).join("\n");
    case "table": return gridOf(b.rows.map(r => r.map(c => c.text)));
    case "figure": return `![${b.alt.replace(/[\]\n]/g, " ")}](asset:${b.assetId})`;
    case "chart": return [`Chart${b.title ? `: ${b.title}` : ""}`, gridOf([["", ...b.series.map(s => s.name)], ...b.categories.map((c, i) => [c, ...b.series.map(s => s.values[i] ?? "")])])].join("\n\n");
    case "diagram": return b.nodes.map(n => `- ${n}`).join("\n");
    case "unread": return `[Not read: ${b.what}. See the original.]`;
    case "notes": return `> Speaker notes: ${b.text.replace(/\n/g, "\n> ")}`;
  }
}

/** Pure. The whole document as Markdown, with a reference line before each unit, so any passage can be traced to its slide or page. */
export function toMarkdown(doc: Pick<CanonicalDocument, "units" | "source">): string {
  return doc.units.map(u => {
    const body = u.blocks.map(blockMarkdown).filter(Boolean).join("\n\n");
    return `<!-- ${doc.source.unit} ${u.n} -->\n${body || (u.status === "blank" ? "(blank)" : "(no readable content)")}`;
  }).join("\n\n");
}

/** Pure. The words of a block that came from the file, for checking against another reader. A figure carries only its alt text. */
export function blockWords(b: Block): string {
  switch (b.type) {
    case "heading": case "paragraph": case "notes": return b.text;
    case "list": return b.items.map(i => i.text).join("\n");
    case "table": return b.rows.flat().map(c => c.text).join("\n");
    case "figure": return b.alt;
    case "chart": return [b.title, ...b.categories, ...b.series.flatMap(s => [s.name, ...s.values])].join("\n");
    case "diagram": return b.nodes.join("\n");
    case "unread": return "";
  }
}

/** Pure. The problems with a document's own structure. Empty: it can be stored. Says nothing yet about whether it is faithful (quality.ts). */
export function validateCanonical(doc: CanonicalDocument): string[] {
  const out: string[] = [];
  if (doc.schema !== CANONICAL_SCHEMA) out.push("schema");
  if (doc.schemaVersion !== CANONICAL_VERSION) out.push("schema_version");
  if (!/^[0-9a-f]{64}$/.test(doc.source.sha256)) out.push("source_sha");
  if (doc.units.length !== doc.source.units) out.push("unit_count");
  const assets = new Set(doc.assets.map(a => a.id));
  let previous = 0;
  for (const u of doc.units) {
    if (u.n <= previous) out.push(`unit_order:${u.n}`);
    previous = u.n;
    for (const b of u.blocks) {
      if (b.source.unit !== u.n) out.push(`source_ref:${u.n}`);
      if (b.type === "figure" && !assets.has(b.assetId)) out.push(`missing_asset:${b.assetId}`);
    }
    if (u.status === "blank" && u.blocks.length) out.push(`blank_with_blocks:${u.n}`);
  }
  for (const a of doc.assets) {
    if (!a.representations.some(r => r.role === "original" || r.role === "whole_unit")) out.push(`no_original:${a.id}`);
    // A clinical or unclassified visual is never held only in a lossy form, and no lossy display may stand in for it.
    if ((a.class === "clinical_scientific" || a.class === "unknown") && a.representations.some(r => r.role === "display" && !r.lossless)) out.push(`lossy_clinical:${a.id}`);
  }
  const ids = new Set<string>();
  for (const i of doc.interpretations) {
    if (ids.has(i.id)) out.push(`interpretation_id:${i.id}`);
    ids.add(i.id);
  }
  return out;
}
