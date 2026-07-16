// One-off: adds skill-level scores to Gabriel's storyline cycle so the
// Skills Logbook has data. Idempotent (upsert on cycle+skill+assessor).
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

const { data: cycle } = await db.from("competency_cycles").select("id, nurse_id").eq("notes", "DEMO-STORYLINE").order("start_date", { ascending: false }).limit(1).single();
if (!cycle) { console.error("Storyline cycle not found"); process.exit(1); }
const { data: elisha } = await db.from("profiles").select("id").ilike("full_name", "%Elisha%").single();

const { data: comps } = await db.from("framework_competencies")
  .select("id, code, domain_id, framework_domains(framework_id), competency_skills(id, name)")
  .in("code", ["COMP-OXY-001", "COMP-OXY-002", "COMP-OXY-003"]);

// Skill scores mirror the competency outcomes: c1→5s, c2→4s, c3→2s
const scoreByComp = { "COMP-OXY-001": 5, "COMP-OXY-002": 4, "COMP-OXY-003": 2 };
const noteByComp = { "COMP-OXY-003": "Needs more supervised practice on documentation and escalation." };

const rows = [];
for (const c of comps ?? []) {
  const fwId = c.framework_domains?.framework_id;
  for (const s of c.competency_skills ?? []) {
    rows.push({
      cycle_id: cycle.id, skill_id: s.id, competency_id: c.id, domain_id: c.domain_id,
      framework_id: fwId, assessor_id: elisha?.id ?? null,
      score: scoreByComp[c.code], notes: noteByComp[c.code] ?? null,
      assessed_at: new Date().toISOString(),
    });
  }
}
const { error } = await db.from("skill_scores").upsert(rows, { onConflict: "cycle_id,skill_id,assessor_id" });
if (error) { console.error(error.message); process.exit(1); }
console.log(`Upserted ${rows.length} skill scores for cycle ${cycle.id.slice(0, 8)}`);
