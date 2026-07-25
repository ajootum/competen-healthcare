// ============================================================================
// QUALITY SCORE SNAPSHOTS SEED (UMG-QS-001/010) — six monthly snapshots for the
// AMU ward so the Executive Quality Command Centre's performance trend + MoM
// deltas render over real history (quality_score_snapshots, migration 091).
// loadQualityCommand upserts today's snapshot live on each load; this backfills
// Dec 2025 → May 2026 trending up to the current composite. Idempotent (upsert on
// hospital_id + snapshot_date). Run:  node scripts/seed-quality-snapshots.mjs --confirm
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

if (!process.argv.includes("--confirm")) { console.error("WRITES to the DB in .env.local. Re-run with --confirm."); process.exit(1); }
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: cohort } = await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo");
const H = cohort?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU cohort — run scripts/seed-cohort.mjs --confirm first."); process.exit(1); }

// Trend the history UP TO the ward's REAL live composite (loadQualityCommand upserts today's snapshot on each
// load ≈ health 70 / quality 60 / safety 94 / compliance 68). Seeding the five prior months just below those keeps
// the trend smooth + honest rather than dropping to a fabricated 88. Recent months ending last month so the live
// snapshot (today) continues the line. [date, health, quality, safety, compliance, open_capas, overdue, crit, high_risk, ps]
const ROWS = [
  ["2026-02-01", 62, 52, 88, 61, 9, 3, 4, 6, 12],
  ["2026-03-01", 64, 54, 89, 63, 8, 2, 4, 5, 11],
  ["2026-04-01", 66, 56, 91, 64, 8, 2, 3, 5, 10],
  ["2026-05-01", 68, 58, 92, 66, 7, 2, 3, 5, 9],
  ["2026-06-01", 69, 59, 93, 67, 7, 1, 2, 5, 8],
];
const rows = ROWS.map(([snapshot_date, health_score, quality_score, safety_index, compliance_score, open_capas, overdue_capas, critical_incidents, high_risks, patient_safety_events]) =>
  ({ hospital_id: H, snapshot_date, health_score, quality_score, safety_index, compliance_score, open_capas, overdue_capas, critical_incidents, high_risks, patient_safety_events }));
// Clear stale AMU snapshots (older high-value rows) so the trend is consistent with the live composite; keep today's.
await db.from("quality_score_snapshots").delete().eq("hospital_id", H).lt("snapshot_date", "2026-07-01");
const { error } = await db.from("quality_score_snapshots").upsert(rows, { onConflict: "hospital_id,snapshot_date" });
if (error) { console.error(error.message); process.exit(1); }
console.log(`Seeded ${rows.length} monthly quality snapshots for AMU (${H}), trending to the live composite. Executive trend + deltas will now render smoothly.`);
