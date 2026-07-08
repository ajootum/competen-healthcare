// Probes the live Supabase database to report which CKCM migrations are applied
// and how much data exists. Reads .env.local like the app does; never prints keys.
// Run: node scripts/check-db-state.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env vars in .env.local"); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

const MIGRATIONS = [
  ["011 structural spine",      ["practices", "clinical_practice_units", "assessment_blueprints", "evidence_matrix", "competency_decisions"]],
  ["012 governance depth",      ["governance_committees", "change_requests", "knowledge_edges"]],
  ["013 metadata",              ["taxonomies", "tags", "object_tags"]],
  ["014 learning pathways",     ["learning_resources", "learning_pathways", "pathway_items"]],
  ["015 plans/authorizations",  ["assessment_plans", "clinical_authorizations"]],
  ["016 credentials/curricula", ["professional_credentials", "curricula"]],
  ["017 knowledge graph/vector",["knowledge_embeddings"]],
  ["018 FTS/recognitions",      ["professional_recognitions"]],
];

// GET (not HEAD) — HEAD responses carry no error body, so missing tables
// would look like they exist.
async function tableExists(t) {
  const { error } = await db.from(t).select("id").limit(1);
  return !error;
}

console.log("=== Migration status ===");
for (const [label, tables] of MIGRATIONS) {
  const results = await Promise.all(tables.map(tableExists));
  const ok = results.every(Boolean);
  const partial = !ok && results.some(Boolean);
  console.log(`${ok ? "APPLIED " : partial ? "PARTIAL " : "MISSING "} ${label}${partial ? ` (missing: ${tables.filter((_, i) => !results[i]).join(", ")})` : ""}`);
}

// FTS function (018 part 2)
const { error: ftsErr } = await db.rpc("search_ckcm", { q: "oxygen", max_results: 3 });
console.log(`${ftsErr ? "MISSING " : "APPLIED "} 018 search_ckcm() function${ftsErr ? ` — ${ftsErr.message}` : ""}`);

console.log("\n=== Data counts ===");
const COUNTS = ["frameworks", "framework_domains", "framework_competencies", "competency_skills",
  "practices", "clinical_practice_units", "profiles", "competency_cycles", "assessments",
  "competency_decisions", "knowledge_edges", "learning_resources", "audit_log"];
for (const t of COUNTS) {
  const { count, error } = await db.from(t).select("id", { count: "exact" }).limit(1);
  console.log(`${t.padEnd(24)} ${error ? "n/a (" + error.message + ")" : count}`);
}

// Demo seed present?
const { data: demo } = await db.from("frameworks").select("id").eq("name", "Demo: Oxygen Therapy (CKCM)").maybeSingle();
console.log(`\nDemo seed: ${demo ? "PRESENT" : "not seeded"}`);
