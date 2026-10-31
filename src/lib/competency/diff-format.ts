import type { FieldChange, FrameworkDiff } from "./framework-diff";

// ── FRAMEWORK-DESIGN-STUDIO-02 S2: the words of the Compare and spreadsheet preview screens ────────────────────────
// Pure and client-safe. The server decides what changed (framework-diff.ts, framework-sheet.ts); these only say it.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const FIELD_LABEL: Record<FieldChange["field"], string> = {
  code: "Code", name: "Name", description: "Description", learningOutcomes: "Learning outcomes", expectedLevelId: "Expected level",
  riskCategory: "Risk", practiceId: "Practice", cpuId: "Clinical practice unit",
};
export const fieldLabel = (f: FieldChange["field"]) => FIELD_LABEL[f] ?? f;

/** Pure: a changed field's value as one readable string. Lists read one item per line; nothing set reads "Not set". */
export function formatValue(v: unknown, lookup?: (id: string) => string | undefined): string {
  if (v === null || v === undefined || v === "") return "Not set";
  if (Array.isArray(v)) return v.length ? v.map(x => String(x)).join("\n") : "Not set";
  const s = String(v);
  return lookup?.(s) ?? s;
}

/** Pure: one line saying what the comparison found. */
export function diffSummary(d: FrameworkDiff): string {
  if (d.unchanged) return "No difference from the published version.";
  const c = d.counts, parts: string[] = [];
  if (c.competenciesAdded) parts.push(`${plural(c.competenciesAdded, "competency", "competencies")} added`);
  if (c.competenciesRemoved) parts.push(`${plural(c.competenciesRemoved, "competency", "competencies")} removed`);
  if (c.competenciesChanged) parts.push(`${plural(c.competenciesChanged, "competency", "competencies")} changed`);
  if (c.criteriaAdded) parts.push(`${plural(c.criteriaAdded, "criterion", "criteria")} added`);
  if (c.criteriaRetired) parts.push(`${plural(c.criteriaRetired, "criterion", "criteria")} retired`);
  if (c.criteriaRemoved) parts.push(`${plural(c.criteriaRemoved, "criterion", "criteria")} removed`);
  if (c.criteriaTextChanged) parts.push(`${plural(c.criteriaTextChanged, "criterion", "criteria")} reworded`);
  if (c.criteriaMoved) parts.push(`${plural(c.criteriaMoved, "criterion", "criteria")} moved`);
  if (d.domains.added.length) parts.push(`${plural(d.domains.added.length, "domain")} added`);
  if (d.domains.removed.length) parts.push(`${plural(d.domains.removed.length, "domain")} removed`);
  if (d.domains.renamed.length) parts.push(`${plural(d.domains.renamed.length, "domain")} renamed`);
  if (d.domains.reordered) parts.push("domain order changed");
  if (d.sectionOrderChanged) parts.push("section order changed");
  return parts.length ? `${parts.join(", ")}.` : "Only names, descriptions or order changed.";
}

// ── The spreadsheet preview (POST /api/hq/competency/authoring/sheet, dryRun) ──
export type SheetError = { row: number | null; column: string | null; message: string };
export type SheetPreview = {
  framework: { id: string; code: string; name: string } | null;
  adds: {
    competencies: { row: number; code: string; name: string; domain: string; area?: string | null; criteria: Record<string, number>; newDomain: boolean | null }[];
    criteria: { byComponent: Record<string, number>; total: number };
    domains: string[];
  };
  unchanged: number | null;
  errors: SheetError[];
};

/** Pure: a row error as one line. A problem that belongs to no row says so. */
export function formatSheetError(e: SheetError): string {
  const where = e.row ? `Row ${e.row}${e.column ? `, ${e.column}` : ""}` : e.column ? e.column : "Sheet";
  return `${where}: ${e.message}`;
}

/** Pure: the preview's headline. With any error nothing can be imported, and it says so. */
export function previewSummary(p: SheetPreview): string {
  const n = p.adds.competencies.length;
  const base = `${plural(n, "competency", "competencies")} and ${plural(p.adds.criteria.total, "criterion", "criteria")} would be added${p.adds.domains.length ? `, with ${plural(p.adds.domains.length, "new domain")}` : ""}`;
  const same = p.unchanged ? ` ${plural(p.unchanged, "competency", "competencies")} already in the draft stay untouched.` : "";
  return p.errors.length
    ? `${plural(p.errors.length, "problem")} found. Nothing can be imported until the sheet is corrected.${same}`
    : `${base}.${same}`;
}

/** Pure: whether the preview may be confirmed. */
export const canConfirm = (p: SheetPreview | null) => !!p && p.errors.length === 0 && p.adds.competencies.length > 0;
