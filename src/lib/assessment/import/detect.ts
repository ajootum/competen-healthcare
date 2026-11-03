/**
 * Instrument import: DETERMINISTIC detection of an instrument's structure in one sheet. Pure (no I/O, client-safe, tested
 * against the owner's acceptance workbook). No AI: every decision below is a rule a person can read, and every rule that
 * had to guess records a flag instead of inventing a value.
 *
 * What it looks for, in order:
 *   1. identifier rows at the top (Name:, Unit:, Date:),
 *   2. a rating scale block (a title such as "Level of Achievement", then rows of value + description, with an optional
 *      label column such as "Competence Level"),
 *   3. the header row of the criteria table (section, number, criterion, rating values 0..N, NA, Yes/No/Partial, free
 *      text columns, a sign-off column), with an option sub-header row under a grouped header ("Match?" over Yes/No/Partial),
 *   4. the body: sections (a text in the section column, or a non-numeric text in the number column), subsections
 *      (a heading ending with a colon), items (a number and a text), sub-points (an enumerated or indented text under an
 *      item), and anything else as UNPLACED text,
 *   5. a title and instructions from the rows above the header, else the sheet name (flagged).
 * A sheet with no criteria table is reported as a record log or unknown, never silently turned into an instrument.
 */
import {
  COLUMN_LETTER, type ColumnUse, type DetectedColumn, type DetectedItem, type DetectedLevel, type DetectedOption, type DetectedScale,
  type DetectedSection, type FieldHint, type GridCell, type ImportFlag, type SheetDraft, type SheetGrid,
} from "./types";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9 ./()-]{0,40}:$/;
const OPTION = /^(yes|no|partial|partially|met|not met|unmet|compliant|non-?compliant|n\/?a|not applicable|pass|fail|achieved|not achieved)$/i;
const NA = /^(n\/?a|not applicable)$/i;
const SCALE_TITLE = /level of achievement|achievement|rating scale|scoring scale|\bscale\b|\bgrade\b|\bscore\b|competence level|proficiency/i;
const SCALE_LABEL_COL = /competence level|proficiency level|\blevel\b|\blabel\b|\bstage\b/i;
const HEADER_WORD = /criteri|element|standard|practice|section|requirement|item|statement|finding|evidence|comment|initial|signature|action|discrep|deficien|match|\bna\b|n\/a|score|rating|grade|outcome|result|remark|observ/i;
const H_SIGNOFF = /initial|signature|sign(ed)?[ -]?off|verified by|auditor name/i;
const H_CRITERION = /criteri|element|standard|practice|statement|\bitem\b|description|activity|indicator|question/i;
const H_SECTION = /section|requirement|\barea\b|domain|category|policy|dimension|component/i;
const H_NUMBER = /^(no\.?|#|number|s\/?n|sn|item no\.?|ref\.?)$/i;
const H_TEXT = /evidence|comment|finding|discrepanc|deficienc|action|note|remark|observation|reason|justification/i;
const ENUMERATOR = /^([a-z]|[ivx]{1,4}|\d{1,2})\s*[).:-]$|^[-*•]$/i;

// A boolean, NOT a type predicate: as a predicate its false branch narrowed a GridCell to never (CI tsc, TS2339).
const isInt = (c: GridCell | null): boolean => !!c && c.n !== null && Number.isInteger(c.n) && c.n >= 0 && c.n <= 999;
const own = (c: GridCell | null, r: number): c is GridCell => !!c && c.origin.r === r;
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function fieldKeyFrom(label: string, hint: FieldHint): string {
  if (hint) return hint;
  const s = slug(label);
  const k = /^[a-z]/.test(s) ? s : `f_${s}`;
  return k.length >= 2 ? k : "field";
}

export function fieldHintFor(header: string): FieldHint {
  const h = header.toLowerCase();
  if (/document/.test(h) && /finding|note|record/.test(h)) return "documented_finding";
  if (/bedside|observed|independent|direct/.test(h) && /finding|observation/.test(h)) return "observed_finding";
  if (/discrepan|action/.test(h)) return "discrepancy_action";
  if (/evidence|comment|deficien|remark|note/.test(h)) return "evidence_comments";
  return null;
}

export function optionFrom(label: string): DetectedOption {
  const l = label.trim();
  const low = l.toLowerCase();
  const satisfactory = /^(yes|met|compliant|pass|achieved)$/.test(low) ? true
    : /^(no|not met|unmet|non-?compliant|fail|not achieved)$/.test(low) ? false : null;
  return { code: slug(l) || "option", label: l, satisfactory };
}

type Ctx = {
  g: SheetGrid;
  flags: ImportFlag[];
  consumed: Set<number>;
};

const flag = (ctx: Ctx, code: string, message: string, where?: string, severity: ImportFlag["severity"] = "warn") =>
  ctx.flags.push({ code, message, where, severity });

/** The cells whose value really starts on this row (a vertically merged cell counts only on its first row). */
const ownCells = (g: SheetGrid, r: number): GridCell[] => {
  const out: GridCell[] = [];
  const seen = new Set<string>();
  for (const c of g.rows[r] ?? []) {
    if (!c || c.origin.r !== r) continue;
    const k = `${c.origin.r}:${c.origin.c}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
};

const at = (g: SheetGrid, r: number, c: number): GridCell | null => g.rows[r]?.[c] ?? null;

export function detectSheet(g: SheetGrid): SheetDraft {
  const ctx: Ctx = { g, flags: [], consumed: new Set() };
  const base: SheetDraft = {
    name: g.name, index: g.index, kind: "empty", title: titleFromSheetName(g.name), titleSource: "sheet_name", instructions: [], identifiers: [],
    headerRow: null, columns: [], response: { primary: "none", allowNa: false, options: [] }, scale: null, sections: [], items: [], unplaced: [], flags: ctx.flags,
    rowsScanned: g.rowCount,
  };
  const nonEmpty: number[] = [];
  for (let r = 0; r < g.rowCount; r++) if (ownCells(g, r).length) nonEmpty.push(r);
  if (!nonEmpty.length) return base;

  // 1. identifiers
  const identifiers: string[] = [];
  for (const r of nonEmpty.slice(0, 6)) {
    const cells = ownCells(g, r);
    const labels = cells.filter((c) => IDENTIFIER.test(c.v));
    if (labels.length >= 2 && labels.length >= cells.length - 1) {
      identifiers.push(...labels.map((c) => c.v.replace(/:$/, "").trim()));
      ctx.consumed.add(r);
    }
  }

  // 3. the header row (found before the scale so the scale search knows where to stop)
  const header = findHeader(ctx, nonEmpty);

  // 2. the scale block, above the header
  const scale = header ? findScale(ctx, nonEmpty.filter((r) => r < header.row)) : findScale(ctx, nonEmpty);

  // 5. title and instructions from what is left above the header
  const above = (header ? nonEmpty.filter((r) => r < header.row) : []).filter((r) => !ctx.consumed.has(r));
  let title = base.title;
  let titleSource: SheetDraft["titleSource"] = "sheet_name";
  const instructions: string[] = [];
  for (const r of above) {
    const cells = ownCells(g, r);
    const text = cells.map((c) => c.v).join(" ").trim();
    if (!text) continue;
    if (titleSource === "sheet_name" && cells.length === 1 && text.length >= 4 && text.length <= 120 && !/:$/.test(text) && !isInt(cells[0])) {
      title = text; titleSource = "cell";
    } else {
      instructions.push(text);
    }
    ctx.consumed.add(r);
  }
  if (header && titleSource === "sheet_name") flag(ctx, "title_from_sheet_name", `No title row was found above the criteria table, so the title is taken from the sheet name "${g.name}". Change it if the instrument is called something else.`, undefined, "info");

  if (!header) {
    const looksLikeLog = isRecordLog(g, nonEmpty);
    const unplaced = nonEmpty.filter((r) => !ctx.consumed.has(r)).flatMap((r) => ownCells(g, r).map((c) => ({ row: r + 1, col: COLUMN_LETTER(c.origin.c), text: c.v })));
    flag(ctx, looksLikeLog ? "record_log" : "no_criteria_table",
      looksLikeLog
        ? "This sheet looks like a record or tally table (a header of short labels over empty rows), not an instrument with criteria. It is a record log: not registered as an instrument unless you say it is one or part of one, kept in the stored workbook, never discarded."
        : "No criteria table was recognised on this sheet (no header row with criteria, rating or response columns). Its text is listed below so nothing is lost.");
    return { ...base, kind: looksLikeLog ? "record_log" : "unknown", title, titleSource, identifiers, instructions, scale, unplaced, flags: ctx.flags };
  }

  // 6. columns
  const columns = classifyColumns(ctx, header);
  const numberCol = columns.find((c) => c.use === "number")?.col ?? null;
  const sectionCol = columns.find((c) => c.use === "section")?.col ?? null;
  let criterionCol = columns.find((c) => c.use === "criterion")?.col ?? null;

  // 4. body
  const bodyStart = header.optionRow !== null ? header.optionRow + 1 : header.row + 1;
  const last = nonEmpty[nonEmpty.length - 1];
  const sections: DetectedSection[] = [];
  const items: DetectedItem[] = [];
  const unplaced: SheetDraft["unplaced"] = [];
  let topSection: DetectedSection | null = null;
  let currentSection: DetectedSection | null = null;
  let lastItem: DetectedItem | null = null;
  const answerCols = new Set(columns.filter((c) => ["rating", "na", "option", "option_group", "text", "signoff"].includes(c.use)).map((c) => c.col));
  const keyOf = (kind: string, r: number) => `${kind}-${r + 1}`;

  // If the header named the criterion column but the body keeps its numbers there, the text is in the next column.
  if (numberCol !== null && criterionCol === numberCol) criterionCol = null;
  if (criterionCol === null && numberCol !== null) criterionCol = textColumnRightOf(g, numberCol, bodyStart, last);
  if (criterionCol === null) {
    flag(ctx, "no_criterion_column", "The criteria table has no column of item text that could be recognised. Assign the roles of the columns to continue.");
  }
  const critCol = criterionCol;

  for (let r = bodyStart; r <= last; r++) {
    const cells = ownCells(g, r);
    if (!cells.length) continue;
    const placed = new Set<number>();
    const numCell = numberCol !== null ? at(g, r, numberCol) : null;
    const numOwn = numberCol !== null && own(numCell, r) ? numCell : null;
    const secCell = sectionCol !== null && sectionCol !== numberCol ? at(g, r, sectionCol) : null;
    const critCell = critCol !== null ? at(g, r, critCol) : null;
    const critOwn = critCol !== null && own(critCell, r) ? critCell : null;

    if (secCell && own(secCell, r)) {
      topSection = { key: keyOf("s", r), row: r + 1, title: secCell.v, parentKey: null, guidance: null, include: true };
      sections.push(topSection);
      currentSection = topSection;
      placed.add(secCell.origin.c);
    }

    const numberLike = numOwn && (isInt(numOwn) || /^\d{1,3}[.)]?$/.test(numOwn.v));
    if (numberLike && numOwn) {
      const text = critOwn?.v ?? firstTextRightOf(g, r, numberCol!, answerCols)?.v ?? null;
      if (text) {
        if (!currentSection) { currentSection = { key: keyOf("s", r), row: r + 1, title: "Items", parentKey: null, guidance: null, include: true }; sections.push(currentSection); topSection = currentSection; flag(ctx, "items_before_section", "Items appear before any section heading. They are placed in a section called Items that you can rename.", `row ${r + 1}`); }
        lastItem = { key: keyOf("i", r), row: r + 1, number: numOwn.v.replace(/[.)]$/, ""), prompt: text, subPoints: [], sectionKey: currentSection.key, include: true };
        items.push(lastItem);
        placed.add(numOwn.origin.c);
        const tc = critOwn ?? firstTextRightOf(g, r, numberCol!, answerCols);
        if (tc) placed.add(tc.origin.c);
      } else {
        unplaced.push({ row: r + 1, col: COLUMN_LETTER(numOwn.origin.c), text: numOwn.v });
        placed.add(numOwn.origin.c);
      }
    } else if (numOwn && !numberLike) {
      // a heading written in the number column
      placeHeading(numOwn.v, r);
      placed.add(numOwn.origin.c);
    } else if (critOwn && ENUMERATOR.test(critOwn.v)) {
      const t = firstTextRightOf(g, r, critCol!, answerCols);
      if (t && lastItem) { lastItem.subPoints.push(t.v); placed.add(critOwn.origin.c); placed.add(t.origin.c); }
    } else if (critOwn) {
      if (/:$/.test(critOwn.v)) placeHeading(critOwn.v, r);
      else if (currentSection && items.some((i) => i.sectionKey === currentSection!.key)) {
        lastItem = { key: keyOf("i", r), row: r + 1, number: null, prompt: critOwn.v, subPoints: [], sectionKey: currentSection.key, include: true };
        items.push(lastItem);
        flag(ctx, "unnumbered_item", `Row ${r + 1} has item text without a number. It is imported as an item; remove it if it was a note.`, `row ${r + 1}`, "info");
      } else placeHeading(critOwn.v, r);
      placed.add(critOwn.origin.c);
    } else if (critCol !== null && numberCol !== null && lastItem) {
      const t = firstTextRightOf(g, r, critCol, answerCols);
      if (t && !answerCols.has(t.origin.c)) { lastItem.subPoints.push(t.v); placed.add(t.origin.c); }
    }

    for (const c of cells) {
      if (placed.has(c.origin.c)) continue;
      if (answerCols.has(c.origin.c) && c.origin.r === r) {
        // a value in a response column of a template is sample data, not structure
        unplaced.push({ row: r + 1, col: COLUMN_LETTER(c.origin.c), text: c.v });
      } else if (!placed.has(c.origin.c)) {
        unplaced.push({ row: r + 1, col: COLUMN_LETTER(c.origin.c), text: c.v });
      }
    }
  }

  function placeHeading(text: string, r: number) {
    const isSub = /:$/.test(text) && topSection !== null;
    if (isSub && topSection) {
      currentSection = { key: keyOf("ss", r), row: r + 1, title: text.replace(/:$/, "").trim(), parentKey: topSection.key, guidance: null, include: true };
      sections.push(currentSection);
    } else {
      topSection = { key: keyOf("s", r), row: r + 1, title: text.replace(/:$/, "").trim(), parentKey: null, guidance: null, include: true };
      sections.push(topSection);
      currentSection = topSection;
    }
  }

  // A sole sub-heading that opens a section before any direct item is the section's guidance, not a subsection.
  for (const s of sections.filter((x) => x.parentKey === null)) {
    const children = sections.filter((x) => x.parentKey === s.key);
    const direct = items.filter((i) => i.sectionKey === s.key);
    if (children.length === 1 && direct.length === 0) {
      const child = children[0];
      s.guidance = child.title;
      for (const i of items) if (i.sectionKey === child.key) i.sectionKey = s.key;
      sections.splice(sections.indexOf(child), 1);
    }
  }

  // 7. response design
  const ratingCols = columns.filter((c) => c.use === "rating");
  const optionCols = columns.filter((c) => c.use === "option");
  const naCol = columns.find((c) => c.use === "na");
  const response: SheetDraft["response"] = { primary: "none", allowNa: !!naCol || optionCols.some((c) => NA.test(c.value ?? "")), options: [] };
  if (ratingCols.length >= 2) {
    response.primary = "rating_scale";
    if (!scale) flag(ctx, "scale_without_descriptions", `Rating columns ${ratingCols.map((c) => c.value).join(", ")} were found but no block describing what each value means. The scale is created with the values only; add the descriptions in Checklist Studio.`);
    else {
      const colValues = ratingCols.map((c) => c.value);
      const scaleValues = scale.levels.map((l) => l.value);
      if (colValues.join(",") !== scaleValues.join(",")) flag(ctx, "scale_values_differ", `The rating columns (${colValues.join(", ")}) and the scale block (${scaleValues.join(", ")}) do not list the same values. The scale block is used; check it.`);
    }
    if (optionCols.length) flag(ctx, "options_beside_rating", `Response options ${optionCols.map((c) => c.value).join(", ")} sit beside the rating columns. They are kept as columns to decide on.`);
  } else if (optionCols.length >= 2) {
    response.primary = "multiple_choice";
    response.options = optionCols.filter((c) => !NA.test(c.value ?? "")).map((c) => optionFrom(c.value ?? c.header));
    if (response.options.some((o) => o.satisfactory === null)) flag(ctx, "partial_option", `The option "${response.options.find((o) => o.satisfactory === null)?.label}" carries no pass or fail meaning yet. Scoring decides how it counts; set that in Checklist Studio.`, undefined, "info");
  } else {
    flag(ctx, "no_response_columns", "No rating or response option columns were recognised. Each item is imported as Yes / No until you choose a response type.");
  }
  if (scale && ratingCols.length < 2) flag(ctx, "scale_without_columns", "A scale block was found but no rating columns. The scale is imported as a draft scale all the same.", undefined, "info");
  for (const c of columns.filter((x) => x.use === "unknown")) flag(ctx, "unknown_column", `Column ${c.letter} "${c.header}" could not be classified. Choose what it is.`, `column ${c.letter}`);
  for (const c of columns.filter((x) => x.use === "signoff")) flag(ctx, "signoff_column", `Column ${c.letter} "${c.header}" is a sign-off. The engine records who answered and when, so it is not imported as an item field.`, `column ${c.letter}`, "info");
  if (identifiers.length) flag(ctx, "identifiers", `Form identifiers found: ${identifiers.join(", ")}. These describe the person and occasion of an assessment, which the engine records on each use, so they are kept in the instrument summary and not as items.`, undefined, "info");
  if (unplaced.length) flag(ctx, "unplaced_text", `${unplaced.length} cell${unplaced.length === 1 ? "" : "s"} of text could not be placed in the structure. They are listed under Unplaced text: nothing is discarded.`);
  if (items.some((i) => i.subPoints.length)) flag(ctx, "sub_points", `${items.filter((i) => i.subPoints.length).length} item${items.filter((i) => i.subPoints.length).length === 1 ? " has" : "s have"} sub-points. They are imported as the item's expected performance list.`, undefined, "info");
  if (scale) {
    const unlabeled = scale.levels.filter((l) => !l.label);
    if (unlabeled.length) flag(ctx, "scale_levels_unlabeled", `Scale value${unlabeled.length === 1 ? "" : "s"} ${unlabeled.map((l) => l.value).join(", ")} ${unlabeled.length === 1 ? "has" : "have"} no level name in the workbook. ${unlabeled.length === 1 ? "It keeps its" : "They keep their"} description only; name ${unlabeled.length === 1 ? "it" : "them"} in Checklist Studio if the scale should.`, undefined, "info");
  }

  const kind: SheetDraft["kind"] = items.length >= 1 && critCol !== null ? "instrument" : "unknown";
  if (kind !== "instrument") flag(ctx, "no_items", "A header row was found but no numbered items under it.");
  return { ...base, kind, title, titleSource, instructions, identifiers, headerRow: header.row + 1, columns, response, scale, sections, items, unplaced, flags: ctx.flags };
}

export function titleFromSheetName(name: string): string {
  return name.replace(/^\s*\d+\s*[-._:)]?\s*/, "").trim() || name.trim();
}

type Header = { row: number; optionRow: number | null; cells: GridCell[] };

function findHeader(ctx: Ctx, nonEmpty: number[]): Header | null {
  const { g } = ctx;
  for (const r of nonEmpty.slice(0, 60)) {
    if (ctx.consumed.has(r)) continue;
    const cells = ownCells(g, r);
    if (cells.length < 3) continue;
    const words = cells.filter((c) => HEADER_WORD.test(c.v) || OPTION.test(c.v)).length;
    const run = longestIntRun(cells);
    const score = words + (run >= 3 ? 3 : 0);
    if (score < 3) continue;
    // an option sub-header directly under a grouped header
    const next = r + 1;
    const nextCells = ownCells(g, next);
    const optionRow = nextCells.length >= 2 && nextCells.every((c) => OPTION.test(c.v) || c.v.length <= 3) && nextCells.some((c) => OPTION.test(c.v)) ? next : null;
    ctx.consumed.add(r);
    if (optionRow !== null) ctx.consumed.add(optionRow);
    return { row: r, optionRow, cells };
  }
  return null;
}

function longestIntRun(cells: GridCell[]): number {
  const sorted = [...cells].filter((c) => isInt(c)).sort((a, b) => a.origin.c - b.origin.c);
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i].n === (sorted[i - 1].n ?? -9) + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function findScale(ctx: Ctx, rows: number[]): DetectedScale | null {
  const { g } = ctx;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (ctx.consumed.has(r)) continue;
    const cells = ownCells(g, r);
    const titleCell = cells.find((c) => SCALE_TITLE.test(c.v) && !isInt(c));
    if (!titleCell) continue;
    const labelCol = cells.find((c) => c !== titleCell && SCALE_LABEL_COL.test(c.v))?.origin.c ?? null;
    const levels: DetectedLevel[] = [];
    let lastRow = r;
    for (let j = i + 1; j < rows.length; j++) {
      const rr = rows[j];
      if (rr - lastRow > 2) break;
      const cs = ownCells(g, rr);
      const valueCell = cs.find((c) => isInt(c) && c.n !== null && c.n <= 20);
      const descCell = cs.filter((c) => c !== valueCell && c.origin.c !== labelCol && c.v.length >= 8).sort((a, b) => b.v.length - a.v.length)[0];
      if (!valueCell || !descCell) break;
      const labelCell = labelCol !== null ? at(g, rr, labelCol) : null;
      levels.push({ value: valueCell.v, label: labelCell?.v ?? null, description: descCell.v, row: rr + 1 });
      lastRow = rr;
    }
    if (levels.length >= 2) {
      ctx.consumed.add(r);
      for (const l of levels) ctx.consumed.add(l.row - 1);
      return { title: titleCell.v, levels, firstRow: r + 1, lastRow: lastRow + 1 };
    }
  }
  return null;
}

function classifyColumns(ctx: Ctx, h: Header): DetectedColumn[] {
  const { g } = ctx;
  const run = longestIntRun(h.cells);
  const out: DetectedColumn[] = [];
  const optionCells = h.optionRow !== null ? ownCells(g, h.optionRow) : [];
  const grouped = new Set(optionCells.map((c) => at(g, h.row, c.origin.c)?.origin.c).filter((x): x is number => x !== undefined));
  for (const c of h.cells.sort((a, b) => a.origin.c - b.origin.c)) {
    const header = c.v;
    let use: ColumnUse = "unknown";
    let value: string | null = null;
    if (grouped.has(c.origin.c)) use = "option_group";
    else if (isInt(c) && run >= 3) { use = "rating"; value = c.v; }
    else if (NA.test(header)) { use = "na"; value = header; }
    else if (OPTION.test(header)) { use = "option"; value = header; }
    else if (H_SIGNOFF.test(header)) use = "signoff";
    else if (H_NUMBER.test(header)) use = "number";
    else if (/section|requirement|policy/i.test(header)) use = "section";
    else if (H_CRITERION.test(header)) use = "criterion";
    else if (H_TEXT.test(header)) use = "text";
    else if (H_SECTION.test(header)) use = "section";
    const hint = use === "text" ? fieldHintFor(header) : null;
    out.push({ col: c.origin.c, letter: COLUMN_LETTER(c.origin.c), header, use, value, fieldKey: use === "text" ? fieldKeyFrom(header, hint) : null, fieldLabel: use === "text" ? header.replace(/\s*\(.*\)\s*$/, "").trim() || header : null, fieldHint: hint, groupHeader: null });
  }
  for (const oc of optionCells) {
    const parent = at(g, h.row, oc.origin.c);
    const groupHeader = parent?.v ?? null;
    const use: ColumnUse = NA.test(oc.v) ? "na" : "option";
    out.push({ col: oc.origin.c, letter: COLUMN_LETTER(oc.origin.c), header: oc.v, use, value: oc.v, fieldKey: null, fieldLabel: null, fieldHint: null, groupHeader });
  }
  // the same field key twice is not allowed on an item
  const seen = new Map<string, number>();
  for (const c of out) if (c.fieldKey) { const n = (seen.get(c.fieldKey) ?? 0) + 1; seen.set(c.fieldKey, n); if (n > 1) c.fieldKey = `${c.fieldKey}_${n}`.slice(0, 40); }
  // criterion: when several columns qualify, keep the first and demote the rest to text
  const crit = out.filter((c) => c.use === "criterion");
  for (const c of crit.slice(1)) { c.use = "text"; c.fieldHint = fieldHintFor(c.header); c.fieldKey = fieldKeyFrom(c.header, c.fieldHint); c.fieldLabel = c.header; }
  // number column: the body says where the numbers are
  if (!out.some((c) => c.use === "number")) {
    const numberCol = inferNumberColumn(g, h, out);
    if (numberCol !== null) {
      const existing = out.find((c) => c.col === numberCol);
      if (existing && (existing.use === "section" || existing.use === "criterion" || existing.use === "unknown")) {
        if (existing.use === "section") flag(ctx, "section_and_number_column", `Column ${existing.letter} "${existing.header}" holds the section headings and the item numbers. Text in it is read as a heading, a number as an item.`, `column ${existing.letter}`, "info");
        existing.use = "number";
      } else if (!existing) {
        out.push({ col: numberCol, letter: COLUMN_LETTER(numberCol), header: "", use: "number", value: null, fieldKey: null, fieldLabel: null, fieldHint: null, groupHeader: null });
      }
    }
  }
  return out.sort((a, b) => a.col - b.col);
}

/** The column, up to the first answer column, with the most integer cells in the body. */
function inferNumberColumn(g: SheetGrid, h: Header, cols: DetectedColumn[]): number | null {
  const firstAnswer = Math.min(...cols.filter((c) => ["rating", "na", "option", "option_group", "text", "signoff"].includes(c.use)).map((c) => c.col), g.colCount);
  const start = (h.optionRow ?? h.row) + 1;
  const counts = new Map<number, number>();
  for (let r = start; r < g.rowCount; r++) for (let c = 0; c < firstAnswer; c++) { const cell = at(g, r, c); if (own(cell, r) && isInt(cell)) counts.set(c, (counts.get(c) ?? 0) + 1); }
  let best: number | null = null;
  let bestN = 2;
  for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
  return best;
}

/** The column right of the number column that most often holds the item text. */
function textColumnRightOf(g: SheetGrid, numberCol: number, from: number, to: number): number | null {
  const counts = new Map<number, number>();
  for (let r = from; r <= to; r++) {
    const n = at(g, r, numberCol);
    if (!own(n, r) || !isInt(n)) continue;
    for (let c = numberCol + 1; c < g.colCount; c++) { const cell = at(g, r, c); if (own(cell, r) && !isInt(cell)) { counts.set(c, (counts.get(c) ?? 0) + 1); break; } }
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
  return best;
}

function firstTextRightOf(g: SheetGrid, r: number, col: number, skip: Set<number>): GridCell | null {
  for (let c = col + 1; c < g.colCount; c++) {
    const cell = at(g, r, c);
    if (own(cell, r) && !skip.has(c) && !isInt(cell)) return cell;
  }
  return null;
}

/** A header of short labels on the first row and almost nothing under it. */
function isRecordLog(g: SheetGrid, nonEmpty: number[]): boolean {
  const first = ownCells(g, nonEmpty[0]);
  if (first.length < 4 || !first.every((c) => c.v.length <= 24)) return false;
  const bodyRows = nonEmpty.slice(1);
  const bodyCells = bodyRows.reduce((n, r) => n + ownCells(g, r).length, 0);
  return bodyCells <= first.length * 2;
}
