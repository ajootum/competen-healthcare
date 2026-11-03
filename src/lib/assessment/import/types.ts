/**
 * Instrument import (ASMT-CATALOGUE-IMPORT-01): the shapes a workbook is turned into. Client-safe: types and constants only.
 *
 * THE DRAFT IS WHAT THE PERSON SEES, CORRECTS AND CONFIRMS. Nothing in it is written to an instrument until they register
 * it, and everything the parser could not place is kept in `unplaced` or a flag, never dropped. The parser is
 * deterministic: the same workbook gives the same draft, and no AI is involved anywhere in this folder.
 */

/** A zero-based cell position. */
export type CellRef = { r: number; c: number };

/** One cell after merges are filled: the text, the number if it was one, and the cell the value really sits in. */
export type GridCell = { v: string; n: number | null; origin: CellRef };

export type SheetGrid = {
  name: string;
  index: number;
  /** rows[r][c] is null for an empty cell. A merged range carries its anchor's value in every covered cell. */
  rows: (GridCell | null)[][];
  rowCount: number;
  colCount: number;
};

export type FlagSeverity = "info" | "warn";
export type ImportFlag = { code: string; message: string; where?: string; severity: FlagSeverity };

/** What a column of the criteria table is for. "unknown" is a real answer the person is asked to settle. */
export type ColumnRole = "section" | "number" | "criterion" | "rating" | "na" | "option" | "option_group" | "text" | "signoff" | "ignore" | "unknown";

export type FieldHint = "documented_finding" | "observed_finding" | "discrepancy_action" | "evidence_comments" | null;

export type DetectedColumn = {
  col: number;
  letter: string;
  header: string;
  role: ColumnRole;
  /** the rating value or the option label for rating / option columns */
  value: string | null;
  /** for text columns: the item field this column becomes */
  fieldKey: string | null;
  fieldLabel: string | null;
  fieldHint: FieldHint;
  /** the header cell this option sits under, for an option group */
  groupHeader: string | null;
};

export type DetectedLevel = { value: string; label: string | null; description: string; row: number };
export type DetectedScale = { title: string; levels: DetectedLevel[]; firstRow: number; lastRow: number };

export type DetectedOption = { code: string; label: string; satisfactory: boolean | null };

export type DetectedSection = {
  key: string;
  row: number;
  title: string;
  parentKey: string | null;
  guidance: string | null;
  include: boolean;
};

export type DetectedItem = {
  key: string;
  row: number;
  number: string | null;
  prompt: string;
  subPoints: string[];
  sectionKey: string | null;
  include: boolean;
};

export type SheetKind = "instrument" | "record_log" | "empty" | "unknown";

export type SheetDraft = {
  name: string;
  index: number;
  kind: SheetKind;
  title: string;
  titleSource: "cell" | "sheet_name";
  instructions: string[];
  /** respondent or form identifiers found at the top of the sheet (for example Name, Unit, Date) */
  identifiers: string[];
  headerRow: number | null;
  columns: DetectedColumn[];
  response: {
    primary: "rating_scale" | "multiple_choice" | "none";
    allowNa: boolean;
    options: DetectedOption[];
  };
  scale: DetectedScale | null;
  sections: DetectedSection[];
  items: DetectedItem[];
  /** text the parser saw and could not place: shown, never discarded */
  unplaced: { row: number; col: string; text: string }[];
  flags: ImportFlag[];
  rowsScanned: number;
};

/** One instrument to register: one or more sheets the person grouped together. */
export type ImportGroup = {
  key: string;
  title: string;
  sheets: string[];
  family: string | null;
  familySuggested: boolean;
  description: string;
  purposeCode: string | null;
  respondentRoles: string[];
  terms: { termId: string; isPrimary: boolean }[];
  /** the person confirmed this grouping */
  confirmed: boolean;
};

export type ExcludedSheet = { sheet: string; reason: string; confirmed: boolean };

export type WorkbookDraft = {
  parserVersion: number;
  fileName: string;
  sha256: string;
  byteSize: number;
  sheets: SheetDraft[];
  groups: ImportGroup[];
  excluded: ExcludedSheet[];
};

/** What registering a draft produced, kept on the import record. */
export type RegisteredInstrument = { groupKey: string; instrumentId: string; code: string; versionId: string; scaleVersionId: string | null; title: string };

export const PARSER_VERSION = 1;
export const IMPORT_BUCKET = "asmt-imports";
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;

export const ROLE_LABEL: Record<ColumnRole, string> = {
  section: "Section", number: "Item number", criterion: "Criterion / item text", rating: "Rating value", na: "Not applicable", option: "Response option",
  option_group: "Response group", text: "Free text field", signoff: "Sign-off (recorded, not an item field)", ignore: "Ignore (recorded in the import record)", unknown: "Not yet decided",
};

export const COLUMN_LETTER = (c: number): string => {
  let s = "";
  let n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};
