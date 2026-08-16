import * as XLSX from "xlsx";
import type { GeneratedReport } from "@/lib/practice/report-engine";

// CPR-PI-001 v2 s12 "Formats" -- the XLSX rendering of a generated report.
//
// ONE WRITER OVER THE SAME GeneratedReport THE CSV USES. This file decides workbook LAYOUT and
// nothing else: every figure arrives already computed by report-engine.ts, so a spreadsheet can
// never disagree with the CSV or the screen. The definition block is the FIRST sheet for the same
// reason it is the CSV's first lines -- a forwarded file keeps its header while the screen that
// explained it stays behind.
//
// SheetJS was already in package.json (unused since the platform-ops report builder was planned);
// adopting it beats hand-rolling a zip container in a clinical product.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Excel refuses sheet names over 31 chars or containing []:*?/\ -- sanitise, then dedupe. */
function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Section";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 25)} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

export function reportXlsx(r: GeneratedReport): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const defRows: (string | number)[][] = [
    ["CompetenPractice report", r.definition.templateName],
    ["Practice", r.definition.practiceName],
    ["Period", `${r.definition.fromDay} to ${r.definition.toDay}`],
    ["Generated", r.definition.generatedAtIso],
    ["Filters", r.definition.filters],
    ["Identified", r.definition.identified ? "yes -- treat as confidential" : "no -- counts without names"],
    ["Not anonymised: a count of one identifies somebody to anyone who knows this practice.", ""],
  ];
  if (r.definition.metrics.length > 0) {
    defRows.push(["", ""], ["Metric definitions", ""]);
    for (const m of r.definition.metrics)
      defRows.push([`${m.id} v${m.version}`, `${m.displayName} -- ${m.definition}`]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(defRows), sheetName("Definition", used));

  for (const s of r.sections) {
    const rows: (string | number)[][] = s.unavailable
      ? [["Unavailable", s.unavailable]]
      : [
          ...(s.columns.length > 0 ? [s.columns as (string | number)[]] : []),
          ...s.rows,
        ];
    if (s.note) rows.push(["Note", s.note]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName(s.title, used));
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
