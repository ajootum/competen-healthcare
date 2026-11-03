/**
 * Instrument import: the whole workbook as a draft, with the grouping the person is asked to confirm. Pure, client-safe.
 *
 * ONE SHEET IS NOT ASSUMED TO BE ONE INSTRUMENT. The default grouping is a proposal: each sheet that reads as an instrument
 * becomes its own group, every other sheet is proposed for exclusion with its reason, and nothing registers until the
 * person has confirmed every group and every exclusion. Moving a sheet into another group makes it a top-level section
 * of that instrument.
 */
import { detectSheet } from "./detect";
import { PARSER_VERSION, type ExcludedSheet, type ImportGroup, type SheetDraft, type SheetGrid, type WorkbookDraft } from "./types";

export type FamilyChoice = { code: string; label: string; isActive: boolean };

const STOP = new Set(["the", "and", "of", "for", "a", "an", "audit", "assessment", "checklist"]);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3);

/**
 * A family is SUGGESTED only when exactly one family label shares a distinctive word with the title. "Audit" and
 * "assessment" alone decide nothing, because several families carry them. Everything else is the person's choice.
 */
export function suggestFamily(title: string, families: FamilyChoice[]): string | null {
  const t = new Set(tokens(title).filter((w) => !STOP.has(w)));
  const hits = families.filter((f) => f.isActive && tokens(f.label).some((w) => !STOP.has(w) && t.has(w)));
  return hits.length === 1 ? hits[0].code : null;
}

export function draftWorkbook(grids: SheetGrid[], meta: { fileName: string; sha256: string; byteSize: number }, families: FamilyChoice[]): WorkbookDraft {
  const sheets = grids.map(detectSheet);
  const groups: ImportGroup[] = [];
  const excluded: ExcludedSheet[] = [];
  for (const s of sheets) {
    if (s.kind === "instrument") {
      const family = suggestFamily(s.title, families);
      groups.push({
        key: `g-${s.index}`, title: s.title, sheets: [s.name], family, familySuggested: family !== null, description: s.instructions.join(" ").slice(0, 2000),
        purposeCode: null, respondentRoles: [], terms: [], confirmed: false,
      });
    } else {
      excluded.push({ sheet: s.name, reason: exclusionReason(s), confirmed: false });
    }
  }
  return { parserVersion: PARSER_VERSION, fileName: meta.fileName, sha256: meta.sha256, byteSize: meta.byteSize, sheets, groups, excluded };
}

export function exclusionReason(s: SheetDraft): string {
  if (s.kind === "empty") return "The sheet is empty.";
  if (s.kind === "record_log") return "The sheet looks like a record or tally table, not an instrument with criteria.";
  return "No criteria table was recognised on the sheet.";
}

/** The draft with a sheet moved into a group (or out of every group into the excluded list). */
export function moveSheet(d: WorkbookDraft, sheet: string, toGroup: string | null): WorkbookDraft {
  const groups = d.groups.map((g) => ({ ...g, sheets: g.sheets.filter((n) => n !== sheet), confirmed: false })).filter((g) => g.sheets.length || g.key === toGroup);
  let excluded = d.excluded.filter((e) => e.sheet !== sheet);
  if (toGroup === null) {
    const s = d.sheets.find((x) => x.name === sheet);
    excluded = [...excluded, { sheet, reason: s ? (s.kind === "instrument" ? "Excluded by the person importing." : exclusionReason(s)) : "Excluded.", confirmed: false }];
  } else {
    const g = groups.find((x) => x.key === toGroup);
    if (g) g.sheets.push(sheet);
  }
  return { ...d, groups, excluded };
}

/** A new group of its own for one sheet (for example a record sheet the person says IS an instrument). */
export function newGroupFor(d: WorkbookDraft, sheet: string, families: FamilyChoice[]): WorkbookDraft {
  const s = d.sheets.find((x) => x.name === sheet);
  if (!s) return d;
  const without = moveSheet(d, sheet, null);
  const family = suggestFamily(s.title, families);
  const key = `g-${s.index}-${Date.now().toString(36)}`;
  return {
    ...without,
    excluded: without.excluded.filter((e) => e.sheet !== sheet),
    groups: [...without.groups, { key, title: s.title, sheets: [sheet], family, familySuggested: family !== null, description: s.instructions.join(" ").slice(0, 2000), purposeCode: null, respondentRoles: [], terms: [], confirmed: false }],
  };
}

/** What still blocks registration, in the person's words. Empty means ready. */
export function readinessProblems(d: WorkbookDraft): string[] {
  const out: string[] = [];
  if (!d.groups.length) out.push("Nothing is set to be registered. Choose at least one sheet to import as an instrument.");
  for (const g of d.groups) {
    const name = g.title || g.sheets.join(" + ");
    if (!g.title.trim() || g.title.trim().length < 3) out.push(`Give the instrument from ${g.sheets.join(" + ")} a title.`);
    if (!g.family) out.push(`Choose a family for "${name}".`);
    if (!g.purposeCode) out.push(`Choose a purpose for "${name}".`);
    if (!g.respondentRoles.length) out.push(`Choose who answers "${name}" (self, assessor or auditor).`);
    if (!g.confirmed) out.push(`Confirm the grouping of "${name}".`);
    const sheets = g.sheets.map((n) => d.sheets.find((s) => s.name === n)).filter((s): s is SheetDraft => !!s);
    if (!sheets.some((s) => s.items.some((i) => i.include))) out.push(`"${name}" has no items to import.`);
    for (const s of sheets) for (const c of s.columns) if (c.role === "unknown") out.push(`Decide what column ${c.letter} "${c.header}" on sheet "${s.name}" is.`);
  }
  for (const e of d.excluded) if (!e.confirmed) out.push(`Confirm that the sheet "${e.sheet}" is left out (${e.reason}).`);
  return out;
}
