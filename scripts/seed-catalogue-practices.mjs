// Seeds one Clinical Practice per Core Nursing domain — the container each CPU
// needs (a CPU requires a practice_id). Domains already match the Clinical
// Practice Catalogue's 15 domain chapters; practices were missing, which blocked
// the CPU importer.
//
// One practice per domain is the deliberate starting point: Catalogue Volume 1
// lists CPUs directly under domain chapters and does not enumerate a finer
// practice layer. Split these later if the Catalogue defines sub-practices.
//
// Idempotent. Run: node scripts/seed-catalogue-practices.mjs --confirm
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

if (!process.argv.includes("--confirm")) {
  console.error("This script WRITES to the database in .env.local. Re-run with --confirm to proceed.");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Domain name fragment → { practice name, catalogue code prefix }
const PRACTICES = [
  ["Assessment",                 "Clinical Assessment",                    "ASM"],
  ["Airway",                     "Airway Management",                      "AIR"],
  ["Breathing",                  "Respiratory Care",                       "BRE"],
  ["Circulation",                "Cardiovascular Care",                    "CIR"],
  ["Disability",                 "Neurological Assessment",                "DIS"],
  ["Exposure",                   "Skin and Wound Care",                    "EXP"],
  ["Renal",                      "Renal Care",                             "REN"],
  ["GI",                         "Gastrointestinal and Nutritional Care",  "GAS"],
  ["Medication Safety",          "Medication Management",                  "MED"],
  ["Infection Prevention",       "Infection Prevention and Control",       "IPC"],
  ["Family",                     "Psychosocial and Mental Health Care",    "FAM"],
  ["Quality",                    "Quality and Patient Safety",             "QLT"],
  ["Communication",              "Communication and Teamwork",             "COM"],
  ["End-of-Life",                "End-of-Life and Palliative Care",        "EOL"],
  ["Neonatal",                   "Neonatal Care",                          "NEO"],
];

const { data: fw } = await db.from("frameworks")
  .select("id, name, framework_domains(id, name)")
  .eq("name", "Core Nursing").maybeSingle();
if (!fw) { console.error("Framework 'Core Nursing' not found."); process.exit(1); }

const domains = fw.framework_domains ?? [];
let created = 0, skipped = 0, unmatched = [];

for (const [fragment, practiceName, prefix] of PRACTICES) {
  const domain = domains.find(d => d.name.toLowerCase().includes(fragment.toLowerCase()));
  if (!domain) { unmatched.push(fragment); continue; }

  const { data: existing } = await db.from("practices")
    .select("id").eq("domain_id", domain.id).eq("name", practiceName).maybeSingle();
  if (existing) { skipped++; continue; }

  const { error } = await db.from("practices").insert({
    domain_id: domain.id,
    name: practiceName,
    code: `PRA-${prefix}-001`,
    description: `Clinical practice grouping the ${prefix} Clinical Practice Units for ${domain.name.replace(/^Domain \d+:\s*/, "")}.`,
    sort_order: 1,
  });
  if (error) { console.error(`  ${practiceName}: ${error.message}`); continue; }
  created++;
  console.log(`  + ${domain.name} → ${practiceName} (PRA-${prefix}-001)`);
}

console.log(`\nPractices created: ${created} · already present: ${skipped}`);
if (unmatched.length) console.log(`No matching domain for: ${unmatched.join(", ")}`);
console.log("CPU imports can now target these practices.");
