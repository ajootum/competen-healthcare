import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envPath = "C:/Users/USER/Documents/Competent/competen-healthcare/.env.local";
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

for (const q of ["hand hygiene", "medication reconciliation", "oxygen therapy"]) {
  const { data, error } = await db.rpc("search_ckcm", { q, max_results: 5 });
  console.log("Q:", q);
  if (error) console.log("  ERROR:", error.message);
  else if (!data.length) console.log("  (no hits)");
  else for (const r of data) console.log(`  [${r.object_type}] ${r.title} (rank ${Number(r.rank).toFixed(3)})`);
}

const { count: edges } = await db.from("knowledge_edges").select("id", { count: "exact" }).limit(1);
const { count: resources } = await db.from("learning_resources").select("id", { count: "exact" }).limit(1);
const { count: links } = await db.from("resource_competencies").select("resource_id", { count: "exact" }).limit(1);
console.log(`\nknowledge_edges=${edges} learning_resources=${resources} resource_competency_links=${links}`);
