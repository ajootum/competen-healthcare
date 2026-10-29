/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CFCA-STUDIO-P1 -- build the DRAFT IMPORT PACKAGE for the Competen Nursing Competency Framework (NUR-CCF) from the
 * owner's source workbook. It READS a file and WRITES a JSON package and a discrepancy report. It touches no database.
 *
 *   npx tsx scripts/build-nur-ccf-package.ts "<path to CCHU Nursing Practice Competency Assessment.xlsx>" <out-dir>
 *
 * The package is imported through Competency Authoring's existing draft import (src/lib/competency/authoring.ts,
 * importDraftPackage): one DRAFT shared framework, every competency "not clinically reviewed", nothing approved,
 * published or offered.
 *
 * ⚠ THE SOURCE'S OWN WORDS. Every criterion is one row, in the workbook's wording (whitespace collapsed only), with
 * its component (A Clinical Skills, B Knowledge, C Knowledge Application) and its sheet and row. Nothing is
 * summarised, merged or corrected. The only joins: a list of sub-items written on the rows under one criterion
 * (for example the four procedures under Hydrocephalus A2) is kept on that criterion, in order. Where the source
 * looks inconsistent (a repeated criterion, a missing component, a spelling) it is REPORTED for clinical review,
 * never rewritten.
 *
 * ⚠ NO DUPLICATE PARENTS. Each area names the existing shared competencies it extends (Core Nursing, Intensive and
 * Progressive Care, Neurosurgical Nursing) by name. The import links them with an "inherited" dependency and leaves
 * the parent records exactly as they are.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as XLSX from "xlsx";

const SHEET = "CCHU Competency Assessment";
const COMP: Record<string, string> = { A: "clinical_skills", B: "knowledge", C: "knowledge_application" };
const CORE = "Core Nursing", IPC = "Intensive and Progressive Care", NEURO = "Neurosurgical Nursing";
const p = (framework: string, competency: string) => ({ framework, competency });
const D = {
  airway: "Airway", breathing: "Breathing", circulation: "Circulation", neuro: "Disability (Neuro)", skin: "Exposure / Skin / Wound Care",
  renal: "Renal", gi: "GI & Nutrition", ipc: "Infection Prevention & Control", psych: "Family, Psychosocial & Mental Health",
  quality: "Quality & Safety", comms: "Communication & Teamwork", eol: "End-of-Life & Palliative Care", neonatal: "Neonatal Care",
};
const D2 = p(CORE, "Maintains Airway Safety"), D3 = p(CORE, "Provides Safe Respiratory Care"), D4 = p(CORE, "Provides Safe Hemodynamic Care"),
  D5 = p(CORE, "Performs Neurological Assessment and Monitoring"), D6 = p(CORE, "Manages Skin and Wound Care"), D7 = p(CORE, "Manages Renal Care"),
  D8 = p(CORE, "Manages GI and Nutritional Care"), D10 = p(CORE, "Applies Infection Prevention and Control"), D11 = p(CORE, "Provides Psychosocial and Family Care"),
  D12 = p(CORE, "Contributes to Quality and Safety"), D13 = p(CORE, "Communicates and Collaborates Effectively"), D14 = p(CORE, "Provides End-of-Life and Palliative Care"),
  D15 = p(CORE, "Provides Neonatal Care"), VENT = p(IPC, "Manages Mechanical Ventilation"), AIRWAY = p(IPC, "Manages Advanced Airway"),
  HAEMO = p(IPC, "Manages Hemodynamic Monitoring"), NEUROCRIT = p(IPC, "Manages Neurocritical Care"), NSURG = p(NEURO, "Provides Neurosurgical Care");

/** The 30 source areas, in source order: the source title(s), the competency name, its domain and its parents. */
const AREAS: { titles: string[]; name: string; domain: string; parents: { framework: string; competency: string }[] }[] = [
  { titles: ["RESPIRATORY ASSESSMENT"], name: "Respiratory Assessment", domain: D.breathing, parents: [D3] },
  { titles: ["RESPIRATORY INTERVENTIONS"], name: "Respiratory Interventions", domain: D.breathing, parents: [D3, D2] },
  { titles: ["RESPIRATORY EMERGENCIES"], name: "Respiratory Emergencies", domain: D.airway, parents: [D2] },
  { titles: ["BASIC BLOOD GAS INTERPRETATION"], name: "Basic Blood Gas Interpretation", domain: D.breathing, parents: [D3, VENT] },
  { titles: ["CONCEPTS OF VENTILATION"], name: "Concepts of Ventilation", domain: D.breathing, parents: [VENT] },
  { titles: ["CARE OF THE VENTILATED PATIENT"], name: "Care of the Ventilated Patient", domain: D.breathing, parents: [VENT, AIRWAY] },
  { titles: ["NASAL HIGH FLOW THERAPY"], name: "Nasal High Flow Therapy", domain: D.breathing, parents: [D3] },
  { titles: ["NON-INVASIVE VENTILATION"], name: "Non-Invasive Ventilation", domain: D.breathing, parents: [] },
  { titles: ["CARE OF THE CHILD WITH A TRACHEOSTOMY"], name: "Care of the Child with a Tracheostomy", domain: D.airway, parents: [D2] },
  { titles: ["HEMODYNAMIC ASSESSMENT"], name: "Hemodynamic Assessment", domain: D.circulation, parents: [D4, HAEMO] },
  { titles: ["HEMODYNAMIC EMERGENCY"], name: "Hemodynamic Emergency", domain: D.circulation, parents: [D4] },
  { titles: ["FLUID MANAGEMENT"], name: "Fluid Management", domain: D.circulation, parents: [D4, D7] },
  { titles: ["NEUROLOGICAL ASSESSMENT"], name: "Neurological Assessment", domain: D.neuro, parents: [D5] },
  { titles: ["NEUROLOGICAL EMERGENCY"], name: "Neurological Emergency", domain: D.neuro, parents: [D5] },
  { titles: ["PAIN ASSESSMENT AND MANAGEMENT"], name: "Pain Assessment and Management", domain: D.neuro, parents: [] },
  { titles: ["SEDATION AND NEUROMASCULAR BLOCKING AGENTS"], name: "Sedation and Neuromascular Blocking Agents", domain: D.neuro, parents: [] },
  { titles: ["HYDROCEPHALUS"], name: "Hydrocephalus", domain: D.neuro, parents: [NSURG, NEUROCRIT] },
  { titles: ["NEURO TUMORS"], name: "Neuro Tumors", domain: D.neuro, parents: [NSURG] },
  { titles: ["RENAL CARE"], name: "Renal Care", domain: D.renal, parents: [D7] },
  { titles: ["GASTROINTESTINAL CARE"], name: "Gastrointestinal Care", domain: D.gi, parents: [D8] },
  { titles: ["NUTRITION"], name: "Nutrition", domain: D.gi, parents: [D8] },
  { titles: ["PSYCHOSOCIAL, MENTAL HEALTH & WELLBEING"], name: "Psychosocial, Mental Health & Wellbeing", domain: D.psych, parents: [D11] },
  { titles: ["SKIN INTEGRITY AND WOUND CARE"], name: "Skin Integrity and Wound Care", domain: D.skin, parents: [D6] },
  { titles: ["SAFETY CHECKS"], name: "Safety Checks", domain: D.quality, parents: [] },
  { titles: ["INFECTION PREVENTION & CONTROL"], name: "Infection Prevention & Control", domain: D.ipc, parents: [D10] },
  { titles: ["MANUAL HANDLING, FALLS AND VTE PREVENTION", "MANUAL HANDLING, FALLS & VTE"], name: "Manual Handling, Falls and VTE Prevention", domain: D.quality, parents: [] },
  { titles: ["COMMUNICATION & TEAMWORK"], name: "Communication & Teamwork", domain: D.comms, parents: [D13] },
  { titles: ["NEONATAL CARE"], name: "Neonatal Care", domain: D.neonatal, parents: [D15] },
  { titles: ["END OF LIFE AND PALLIATIVE CARE"], name: "End of Life and Palliative Care", domain: D.eol, parents: [D14] },
  { titles: ["QUALITY AND SAFETY"], name: "Quality and Safety", domain: D.quality, parents: [D12] },
];
const DOMAIN_ORDER = Object.values(D);
// Spellings in the source, reported for clinical review (never corrected here).
const SPELLINGS = [/neuromascular/i, /mordified/i, /\bpratice\b/i, /backrounds/i, /compentently/i, /understands utilises/i, /has understands/i, /safety demonstrate/i, /\bliase\b/i];

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

export function parseWorkbook(file: string) {
  const wb = XLSX.read(readFileSync(file), { type: "buffer" });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`The workbook has no sheet "${SHEET}".`);
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: "A", blankrows: false, defval: "" });
  const byTitle = new Map(AREAS.flatMap(a => a.titles.map(t => [t, a] as const)));
  const found = new Map<(typeof AREAS)[number], { criteria: { component: string; n: number; text: string; row: number }[]; rows: number[] }>();
  const unknown: string[] = [], joined: string[] = [];
  let area: (typeof AREAS)[number] | null = null, comp: string | null = null;
  for (const r of rows) {
    const row = (r.__rowNum__ ?? 0) + 1;
    const a = clean(r.A), b = clean(r.B), c = clean(r.C), d = clean(r.D);
    if (a && /^[A-Z][A-Z ,&/()\-]+$/.test(a) && a !== "AREA") {
      // A repeated title continues the same area, mid-component (Tracheostomy restarts its title at criterion A13).
      const next = byTitle.get(a) ?? null;
      if (next !== area) comp = null;
      area = next;
      if (!area) { unknown.push(`${a} (row ${row})`); continue; }
      if (!found.has(area)) found.set(area, { criteria: [], rows: [] });
      found.get(area)!.rows.push(row);
    }
    if (!area) continue;
    if (COMP[b] && /[A-Z]{4}/.test(c)) { comp = COMP[b]; continue; }
    if (!comp || !d) continue;
    const list = found.get(area)!.criteria;
    if (/^\d+$/.test(c)) list.push({ component: comp, n: +c, text: d, row });
    else if (list.length) { list[list.length - 1].text += ` ${d}`; joined.push(`${area.name}: row ${row} ("${d}") kept on criterion ${list[list.length - 1].component} #${list[list.length - 1].n} (row ${list[list.length - 1].row})`); }
  }
  return { found, unknown, joined };
}

function main() {
  const [file, out] = process.argv.slice(2);
  if (!file || !out) { console.error("usage: build-nur-ccf-package.ts <workbook.xlsx> <out-dir>"); process.exit(2); }
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  const { found, unknown, joined } = parseWorkbook(file);
  const missing = AREAS.filter(a => !found.has(a)).map(a => a.name);
  if (unknown.length || missing.length) { console.error(`Unmapped source areas: ${unknown.join("; ") || "none"}. Areas not found: ${missing.join("; ") || "none"}.`); process.exit(1); }

  const flags: string[] = [];
  const domains = DOMAIN_ORDER.map(name => ({ name, competencies: [] as any[] }));
  AREAS.forEach((a, i) => {
    const f = found.get(a)!;
    const code = `NUR-CCF-${String(i + 1).padStart(3, "0")}`;
    const seen = new Map<string, number>();
    for (const k of f.criteria) {
      const key = k.text.toLowerCase();
      if (seen.has(key)) flags.push(`${code} ${a.name}: ${k.component} #${k.n} (row ${k.row}) repeats row ${seen.get(key)} word for word.`); else seen.set(key, k.row);
      for (const s of SPELLINGS) if (s.test(k.text)) flags.push(`${code} ${a.name}: row ${k.row} spelling as in source ("${k.text.match(s)![0]}").`);
    }
    for (const [c, label] of [["clinical_skills", "Clinical Skills"], ["knowledge", "Knowledge"], ["knowledge_application", "Knowledge Application"]] as const)
      if (!f.criteria.some(k => k.component === c)) flags.push(`${code} ${a.name}: no ${label} criteria in the source.`);
    if (a.titles.length > 1 || f.rows.length > 1) flags.push(`${code} ${a.name}: the source writes this area in ${f.rows.length} blocks (rows ${f.rows.join(", ")}${a.titles.length > 1 ? `, titled ${a.titles.map(t => `"${t}"`).join(" and ")}` : ""}). Imported as one competency.`);
    if (SPELLINGS.some(s => s.test(a.titles[0]))) flags.push(`${code}: the area title is spelled as in the source ("${a.titles[0]}").`);
    domains.find(d => d.name === a.domain)!.competencies.push({
      code, name: a.name, description: null, learningOutcomes: [], expectedLevel: null, riskCategory: "standard",
      criteria: f.criteria.map(k => ({ component: k.component, text: k.text, sourceRef: `${SHEET}!D${k.row}` })), parents: a.parents,
    });
  });
  const pkg = {
    framework: { code: "NUR-CCF", name: "Competen Nursing Competency Framework", layer: "profession", profession: "Nursing",
      description: "The Competen nursing competency areas, each assessed in Clinical Skills, Knowledge and Knowledge Application. Imported as a draft from the 2025 source workbook. Not clinically reviewed." },
    domains: domains.filter(d => d.competencies.length),
    provenance: { source: basename(file), sheet: SHEET, sha256: sha, modified: statSync(file).mtime.toISOString(), built: new Date().toISOString(),
      instruction: "CFCA-STUDIO-P1 criteria import (owner GO 29 Oct 2026)", baseline: "WORK-FRAMEWORK-RECONCILIATION.md" },
  };
  const all = pkg.domains.flatMap(d => d.competencies);
  const n = (c: string) => all.reduce((s, x) => s + x.criteria.filter((k: any) => k.component === c).length, 0);
  const summary = { competencies: all.length, criteria: all.reduce((s, x) => s + x.criteria.length, 0), clinical_skills: n("clinical_skills"),
    knowledge: n("knowledge"), knowledge_application: n("knowledge_application"), parents: all.reduce((s, x) => s + x.parents.length, 0), domains: pkg.domains.length };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "NUR-CCF-draft-package.json"), JSON.stringify(pkg, null, 1));
  writeFileSync(join(out, "NUR-CCF-source-flags.md"), [
    `# NUR-CCF source flags for clinical review`, ``, `Source: ${basename(file)} (sha256 ${sha}), sheet "${SHEET}".`, ``,
    `Counts: ${JSON.stringify(summary)}`, ``, `## Flags (${flags.length})`, ...flags.map(f => `- ${f}`), ``,
    `## Sub-items kept on their criterion (${joined.length})`, ...joined.map(j => `- ${j}`), ``,
  ].join("\n"));
  console.log(JSON.stringify(summary));
}
if (process.argv[1] && /build-nur-ccf-package/.test(process.argv[1])) main();
