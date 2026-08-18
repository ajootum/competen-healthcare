import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-010 §7 — THE PRODUCT DATA INVENTORY, derived from the schema.
//
// §7: "Maintain product data inventory/classification AT A GOVERNED LEVEL: identity, Practice
// configuration, patient-related product data, documents, communications, commercial, telemetry/audit
// and other approved classes."
//
// ⚠ WHAT THIS PRODUCT STORES IS A FACT. WHY, AND FOR HOW LONG, IS A POLICY.
//
// "Clinical encounters are held in these tables" is checkable by anybody with the schema. "They are
// retained for seven years under this lawful basis" is a governance decision nobody has made, and no
// amount of reading the code will produce it. So this module derives the first and never the second —
// gov_data_class holds purpose, retention rule, sharing model and lawful basis, and it holds no rows.
//
// ⚠ AND AMBIGUOUS TABLES ARE COUNTED, NOT GUESSED.
//
// A name like practice_encounter classifies itself. Plenty do not, and assigning them by feel would
// turn an inventory into an opinion while keeping the typography of a fact. Anything the patterns below
// do not clearly match is reported as UNCLASSIFIED — which is a useful governance figure in its own
// right, because §7 asks for an inventory and the honest state of one is "this much is known".
//
// ⚠ null ON A FAILED READ, NEVER ZERO. Same rule the rest of this module follows.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** §7's governed classes. Mirrors gov_data_class.category so the derived and recorded views agree. */
export const DATA_CATEGORIES = [
  "identity", "practice_configuration", "patient_related", "documents",
  "communications", "commercial", "telemetry_audit", "other",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export const DATA_CATEGORY_LABEL: Record<DataCategory, string> = {
  identity: "Identity",
  practice_configuration: "Practice configuration",
  patient_related: "Patient-related product data",
  documents: "Documents",
  communications: "Communications",
  commercial: "Commercial",
  telemetry_audit: "Telemetry and audit",
  other: "Other approved classes",
};

/**
 * ⚠ ORDER MATTERS AND IS DELIBERATE. A table matches the FIRST pattern that claims it, so the narrower
 * clinical patterns are tested before the broad `practice_` ones. `practice_clinical_document` is a
 * document AND patient-related; §7 lists documents as their own class, so documents win — and that
 * choice is written here rather than left to whichever rule happened to run first.
 */
const PATTERNS: { category: DataCategory; test: RegExp }[] = [
  // ⚠ NOT `^mos_`. That claimed every operational-substrate table as telemetry, including
  // mos_corrective_action and mos_support_case — which are support RECORDS with owners and lifecycles,
  // not observations. A prefix is a convenient handle and a poor classifier: it groups by who built the
  // table rather than by what is in it, and §7's categories are about the latter.
  { category: "telemetry_audit", test: /^(mos_event|mos_journey|plat_ai_requests)|_audit_event$|_access_log$/ },
  { category: "documents", test: /document|note_template|_attachment/ },
  { category: "communications", test: /thread|message|notification|contact_log|_comms?_/ },
  { category: "commercial", test: /invoice|payment|charge|receipt|price|plan|subscription|billing/ },
  {
    category: "patient_related",
    test: /patient|encounter|appointment|procedure|treatment|follow_up|clinical|diagnos|medication|measurement|allerg|vital|consent/,
  },
  { category: "identity", test: /^profiles$|membership|role_|invitation|_person|practitioner|user_/ },
  { category: "practice_configuration", test: /^practice_(workspace|configuration|location|facility|setting)/ },
];

/**
 * ⚠ THE SCOPE, AND THE MISTAKE THAT MADE IT EXPLICIT.
 *
 * The first version of this classified all 641 tables in the database and reported 440 of them
 * unclassified. It was wrong in a way that mattered: this repository holds the WHOLE Competen estate —
 * the competency platform, hospital, enterprise and recruitment lines — and PD-010 governs Competen
 * Practice alone. An inventory spanning all of it would assert that Practice holds data belonging to
 * other product lines, which is a false privacy claim made by an accident of scanning.
 *
 * The misclassifications were the tell: `assessment_plans` and `cmo_plans` matched "plan" and landed
 * under Commercial. Both are competency-platform tables. A broad regex over the wrong population
 * produces confident nonsense, and it looks exactly like data.
 *
 * So the inventory is scoped to the Practice data plane, and everything else is reported as OUT OF
 * SCOPE rather than unclassified — a different statement, and the true one.
 */
const IN_SCOPE = /^(practice_|mos_)/;

export type DataInventory = {
  byCategory: { category: DataCategory; label: string; tables: number; sample: string[] }[];
  /** ⚠ In-scope tables no pattern claimed. Not "other" — unclassified is a different statement. */
  unclassified: number;
  unclassifiedSample: string[];
  /** In the database and belonging to another product line. Named, so the scope is visible. */
  outOfScope: number;
  inScopeTables: number;
  totalTables: number;
  migrationsScanned: number;
} | null;

/**
 * Read the product's data classes from its own schema.
 *
 * ⚠ THIS DESCRIBES CATEGORIES, NEVER INSTANCES. It reads table NAMES out of migration DDL and never
 * queries a row, so nothing it returns can contain a patient, a document or a message. §7 permits
 * privacy governance to inspect control and evidence state and not routine clinical content, and the
 * cheapest way to honour that is never to hold the connection that could breach it.
 */
export function loadDataInventory(root = process.cwd()): DataInventory {
  try {
    const dir = join(root, "supabase", "migrations");
    const files = readdirSync(dir).filter(f => f.endsWith(".sql"));
    if (files.length === 0) return null;

    let sql = "";
    for (const f of files) sql += readFileSync(join(dir, f), "utf8") + "\n";
    const code = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

    const tables = [...new Set(
      [...code.matchAll(/create table if not exists (\w+)/gi)].map(m => m[1].toLowerCase()),
    )].sort();
    if (tables.length === 0) return null;

    const buckets = new Map<DataCategory, string[]>();
    const unclassified: string[] = [];
    let outOfScope = 0;
    let inScope = 0;

    for (const t of tables) {
      // gov_* is this module's own governance record-keeping, not product data it governs. Counting it
      // would inflate the inventory with the inventory.
      if (t.startsWith("gov_")) continue;
      if (!IN_SCOPE.test(t)) { outOfScope += 1; continue; }
      inScope += 1;
      const hit = PATTERNS.find(p => p.test.test(t));
      if (!hit) { unclassified.push(t); continue; }
      buckets.set(hit.category, [...(buckets.get(hit.category) ?? []), t]);
    }

    return {
      byCategory: DATA_CATEGORIES.map(c => ({
        category: c,
        label: DATA_CATEGORY_LABEL[c],
        tables: (buckets.get(c) ?? []).length,
        sample: (buckets.get(c) ?? []).slice(0, 4),
      })),
      unclassified: unclassified.length,
      unclassifiedSample: unclassified.slice(0, 6),
      outOfScope,
      inScopeTables: inScope,
      totalTables: tables.length,
      migrationsScanned: files.length,
    };
  } catch {
    return null;
  }
}
