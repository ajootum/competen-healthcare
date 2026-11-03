// Instrument import: an .xlsx workbook as plain grids. Server only (the xlsx library). The workbook is UNTRUSTED input:
// nothing here evaluates a formula, follows a link or reads a style, and the caller caps the size before this runs.
import * as XLSX from "xlsx";
import type { CellRef, GridCell, SheetGrid } from "./types";

const MAX_ROWS = 2000;
const MAX_COLS = 120;

const cellText = (cell: XLSX.CellObject): { v: string; n: number | null } | null => {
  if (cell.v === null || cell.v === undefined) return null;
  if (cell.t === "n" && typeof cell.v === "number") return Number.isFinite(cell.v) ? { v: numberText(cell.v), n: cell.v } : null;
  if (cell.t === "b") return { v: cell.v ? "TRUE" : "FALSE", n: null };
  if (cell.t === "d" && cell.v instanceof Date) return { v: cell.v.toISOString().slice(0, 10), n: null };
  const s = String(cell.v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  const asNum = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  return { v: s, n: asNum !== null && Number.isFinite(asNum) ? asNum : null };
};

const numberText = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

/** Every sheet of the workbook as a grid with merges filled. Empty sheets come back with rowCount 0. */
export function readWorkbookGrids(data: ArrayBuffer | Uint8Array): SheetGrid[] {
  const wb = XLSX.read(data, { type: data instanceof Uint8Array ? "buffer" : "array", cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, cellDates: true, sheetStubs: false });
  return wb.SheetNames.map((name, index) => gridOf(name, index, wb.Sheets[name]));
}

function gridOf(name: string, index: number, ws: XLSX.WorkSheet | undefined): SheetGrid {
  const rows: (GridCell | null)[][] = [];
  if (!ws) return { name, index, rows, rowCount: 0, colCount: 0 };
  let maxR = -1;
  let maxC = -1;
  const put = (r: number, c: number, cell: GridCell) => {
    if (r >= MAX_ROWS || c >= MAX_COLS) return;
    (rows[r] ??= [])[c] = cell;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  };
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith("!")) continue;
    const ref = XLSX.utils.decode_cell(addr);
    const t = cellText(ws[addr] as XLSX.CellObject);
    if (!t) continue;
    put(ref.r, ref.c, { v: t.v, n: t.n, origin: { r: ref.r, c: ref.c } });
  }
  for (const m of ws["!merges"] ?? []) {
    const anchor = rows[m.s.r]?.[m.s.c];
    if (!anchor) continue;
    const origin: CellRef = { r: m.s.r, c: m.s.c };
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) {
      if (r === m.s.r && c === m.s.c) continue;
      put(r, c, { v: anchor.v, n: anchor.n, origin });
    }
  }
  const rowCount = maxR + 1;
  const colCount = maxC + 1;
  for (let r = 0; r < rowCount; r++) { rows[r] ??= []; for (let c = 0; c < colCount; c++) rows[r][c] ??= null; }
  return { name, index, rows, rowCount, colCount };
}
