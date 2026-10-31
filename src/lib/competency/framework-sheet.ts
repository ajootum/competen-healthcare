import { MAX_CRITERIA, parseCompetency, RISKS, type DraftPackage, type PackageCriterion } from "./authoring";

// ── SPREADSHEET TO PACKAGE ── FRAMEWORK-DESIGN-STUDIO-02 S1, capability 5 (G9) ─────────────────────────────────────
//
// No-code bulk entry: a CSV (from any spreadsheet) with ONE ROW PER CRITERION, competency fields repeated on each of
// its rows (or left blank after the first), becomes a DraftPackage for an APPEND import (authoring.ts). A competency
// with no criteria is one row with the criterion columns blank. Every problem is reported with its spreadsheet row
// (the header is row 1), and a sheet with any problem produces no package. Profession-agnostic: the components are
// the registry's, passed in, matched by code or label.
//
// criterion_code is the author's own reference: unique in the sheet, and kept as the criterion's source reference
// when source_ref is blank. area travels on the domain (S3 adds Areas; ignored until then). Pure, but it reuses
// authoring.ts validation (a server module), so it parses on the server: POST .../authoring/sheet with dryRun.

export const SHEET_COLUMNS = ["framework_code", "area", "domain", "competency_code", "competency_name", "description", "expected_level_score",
  "risk_category", "component", "criterion_code", "criterion_text", "source_ref"] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type SheetError = { row: number; column: SheetColumn | null; message: string };
export type SheetCompetency = { row: number; code: string; name: string; domain: string; area: string | null; criteria: Record<string, number> };
export type SheetResult = { package: DraftPackage | null; errors: SheetError[]; competencies: SheetCompetency[]; rows: number };

const REQUIRED: SheetColumn[] = ["framework_code", "domain", "competency_code", "competency_name"];

/** Pure: RFC 4180 CSV (quotes, doubled quotes, CR/LF, a leading BOM) into records. */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, ""), out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out;
}

const cellOut = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Pure: records as CSV (CRLF, quoted where needed). */
export const toCsv = (rows: readonly (readonly string[])[]) => rows.map(r => r.map(cellOut).join(",")).join("\r\n") + "\r\n";

/** Pure: the template -- the header and two example rows of one competency, using the registry's first components. */
export function templateCsv(components: readonly string[] = []): string {
  const a = components[0] ?? "component_code", b = components[1] ?? a;
  const base = ["EXAMPLE-FW", "Core Practice", "Communication", "EX-COM-001", "Communicates clearly with the people they serve",
    "Shares information in a way the person can understand and act on.", "3", "standard"];
  return toCsv([
    [...SHEET_COLUMNS],
    [...base, a, "EX-COM-001-1", "Explains the purpose of an activity before starting it", "Source document, section 1"],
    [...base, b, "EX-COM-001-2", "Checks that the person has understood the information given", "Source document, section 1"],
  ]);
}

/**
 * Pure: a CSV into an append package for `frameworkCode`. components: the ACTIVE registry, code -> label. Rows that
 * are entirely blank are skipped. Any error = no package.
 */
export function parseFrameworkSheet(csv: string, opts: { frameworkCode: string; components: Record<string, string> }): SheetResult {
  const errors: SheetError[] = [];
  const fail = (row: number, column: SheetColumn | null, message: string) => { errors.push({ row, column, message }); };
  const recs = parseCsv(String(csv ?? ""));
  if (!recs.length) return { package: null, errors: [{ row: 1, column: null, message: "The sheet is empty. Start from the template." }], competencies: [], rows: 0 };
  const header = recs[0].map(h => h.trim().toLowerCase());
  const col = new Map<SheetColumn, number>();
  for (const c of SHEET_COLUMNS) { const i = header.indexOf(c); if (i >= 0) col.set(c, i); }
  const missing = SHEET_COLUMNS.filter(c => !col.has(c));
  if (missing.length) return { package: null, errors: [{ row: 1, column: null, message: `The header is missing ${missing.join(", ")}. Start from the template.` }], competencies: [], rows: 0 };

  const target = String(opts.frameworkCode ?? "").trim().toUpperCase();
  const byLabel = new Map(Object.entries(opts.components).map(([code, label]) => [String(label).trim().toLowerCase(), code]));
  const componentOf = (v: string) => (v in opts.components ? v : byLabel.get(v.toLowerCase()) ?? (v.toLowerCase() in opts.components ? v.toLowerCase() : null));

  type Comp = { row: number; code: string; name: string; description: string | null; score: number | null; risk: string; domain: string; area: string | null; criteria: PackageCriterion[] };
  const comps = new Map<string, Comp>(), domainArea = new Map<string, { area: string | null; row: number }>(), critCodes = new Map<string, number>();
  let rows = 0;
  recs.slice(1).forEach((rec, i) => {
    const row = i + 2;
    const get = (c: SheetColumn) => (rec[col.get(c)!] ?? "").trim();
    if (SHEET_COLUMNS.every(c => !get(c))) return;
    rows++;
    let bad = false;
    for (const c of REQUIRED) if (!get(c)) { fail(row, c, `${c} is required on every row.`); bad = true; }
    if (bad) return;
    const fwCode = get("framework_code").toUpperCase();
    if (fwCode !== target) fail(row, "framework_code", `framework_code ${fwCode} is not the framework you are adding to (${target}).`);
    const domain = get("domain").replace(/\s+/g, " "), area = get("area").replace(/\s+/g, " ") || null;
    if (domain.length < 2 || domain.length > 200) fail(row, "domain", "A domain name is 2 to 200 characters.");
    if (area && area.length > 200) fail(row, "area", "An area name is at most 200 characters.");
    const da = domainArea.get(domain);
    if (!da) domainArea.set(domain, { area, row });
    else if (area && da.area && area !== da.area) fail(row, "area", `Domain "${domain}" is in area "${da.area}" on row ${da.row}, and "${area}" here.`);
    else if (area && !da.area) da.area = area;

    const scoreText = get("expected_level_score"), riskText = get("risk_category").toLowerCase();
    const score = scoreText === "" ? null : Number(scoreText);
    if (score !== null && !(Number.isInteger(score) && score >= 0 && score <= 10)) fail(row, "expected_level_score", "expected_level_score is a whole number from 0 to 10, or blank.");
    if (riskText && !(RISKS as readonly string[]).includes(riskText)) fail(row, "risk_category", `risk_category is one of ${RISKS.join(", ")}, or blank.`);

    const code = get("competency_code").toUpperCase();
    let c = comps.get(code);
    if (!c) {
      const p = parseCompetency({ code, name: get("competency_name"), description: get("description") || null, riskCategory: riskText || "standard" });
      if (!p.ok) { fail(row, p.error.startsWith("A competency code") ? "competency_code" : p.error.startsWith("A competency name") ? "competency_name" : "description", p.error); return; }
      c = { row, code: p.value.code, name: p.value.name, description: p.value.description, score: Number.isInteger(score) ? score : null, risk: p.value.riskCategory, domain, area, criteria: [] };
      comps.set(code, c);
    } else {
      // The same competency on a later row: its fields repeat or are blank, never differ.
      const differs = (column: SheetColumn, now: string, then: string | null) => { if (now && now !== (then ?? "")) fail(row, column, `${code} has a different ${column} on row ${c!.row}.`); };
      differs("competency_name", get("competency_name").replace(/\s+/g, " "), c.name);
      differs("description", get("description").replace(/\s+/g, " "), c.description);
      differs("expected_level_score", scoreText, c.score === null ? null : String(c.score));
      differs("risk_category", riskText, c.risk);
      if (domain !== c.domain) fail(row, "domain", `${code} is in domain "${c.domain}" on row ${c.row}.`);
      if (area && c.area && area !== c.area) fail(row, "area", `${code} is in area "${c.area}" on row ${c.row}.`);
    }

    const compText = get("component"), text = get("criterion_text"), critCode = get("criterion_code"), sourceRef = get("source_ref");
    if (!compText && !text) {
      if (critCode || sourceRef) fail(row, "criterion_text", "A row with a criterion code or source names its criterion text and component.");
      return;
    }
    if (!compText) { fail(row, "component", "A criterion names its component (section)."); return; }
    if (!text) { fail(row, "criterion_text", "criterion_text is blank."); return; }
    const component = componentOf(compText);
    if (!component) fail(row, "component", `Unknown component "${compText}". Use one of: ${Object.keys(opts.components).join(", ") || "none is active"}.`);
    if (text.length < 3 || text.length > 2000) fail(row, "criterion_text", "A criterion is 3 to 2,000 characters.");
    if (critCode) {
      const k = critCode.toUpperCase(), first = critCodes.get(k);
      if (first) fail(row, "criterion_code", `criterion_code ${critCode} is also on row ${first}.`);
      else critCodes.set(k, row);
    }
    const ref = sourceRef || critCode || null;
    if (ref && ref.length > 300) fail(row, "source_ref", "A source reference is at most 300 characters.");
    if (component) c.criteria.push({ component, text, sourceRef: ref });
    if (c.criteria.length > MAX_CRITERIA) fail(row, "criterion_text", `${code} has more than ${MAX_CRITERIA} criteria.`);
  });
  if (!rows && !errors.length) fail(2, null, "The sheet has no rows under the header.");

  const competencies: SheetCompetency[] = [...comps.values()].map(c => ({
    row: c.row, code: c.code, name: c.name, domain: c.domain, area: domainArea.get(c.domain)?.area ?? c.area,
    criteria: c.criteria.reduce<Record<string, number>>((m, k) => ({ ...m, [k.component]: (m[k.component] ?? 0) + 1 }), {}),
  }));
  if (errors.length) return { package: null, errors: errors.sort((a, b) => a.row - b.row), competencies, rows };
  const domains = [...domainArea.keys()].map(name => ({
    name, area: domainArea.get(name)!.area,
    competencies: [...comps.values()].filter(c => c.domain === name).map(c => ({
      code: c.code, name: c.name, description: c.description, learningOutcomes: [], expectedLevel: c.score === null ? null : { score: c.score }, riskCategory: c.risk, criteria: c.criteria,
    })),
  }));
  return { package: { framework: { code: target, name: "", description: null, layer: "" }, domains, provenance: { source: "spreadsheet", rows } }, errors: [], competencies, rows };
}
