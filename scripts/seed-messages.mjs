// Seed a realistic op_messages history for the AMU hospital so the PW-005 Messaging Hub (and the SSW
// Communication centre) render authentic channels/threads matching the mockup: team channels, a broadcast,
// a patient-handover channel and a direct message, authored by real cohort members over the last ~2 days.
// Idempotent (clears AMU op_messages first). Run:  node scripts/seed-messages.mjs --confirm
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

if (!process.argv.includes("--confirm")) { console.error("WRITES to the DB in .env.local. Re-run with --confirm."); process.exit(1); }
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, role").ilike("email", "%@amu.competen.demo");
const H = (cohort ?? []).find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU cohort — run scripts/seed-cohort.mjs --confirm first."); process.exit(1); }
const people = (cohort ?? []).filter((p) => p.hospital_id === H);
if (people.length < 3) { console.error("Need at least 3 cohort members."); process.exit(1); }
const pick = (i) => people[i % people.length];
const now = Date.now(), min = 60000, hr = 3600000;
const at = (ms) => new Date(now - ms).toISOString();

// channel, context_type, [ [authorIndex, body, msAgo] ... ]
const THREADS = [
  ["ICU – Night Shift Team", "team", [
    [0, "Good morning team. Please review today's assignments and update me on any risks.", 2 * hr + 20 * min],
    [1, "Bed 3 is a high risk – sepsis monitoring ongoing.", 2 * hr + 5 * min],
    [2, "Bed 7 – post-op observation. Stable overnight.", 2 * hr],
    [0, "Thanks team. Please ensure hourly observations for Bed 3 and escalate any deterioration.", 90 * min],
    [3, "Will do. Handover notes updated in the system.", 40 * min],
  ]],
  ["Ward 3 Nursing Team", "team", [
    [1, "Morning all — medication round starting at 08:00, please confirm availability.", 5 * hr],
    [4, "Confirmed. I'll take beds 1–6.", 4 * hr + 40 * min],
    [2, "Taking 7–12. All charts printed.", 4 * hr + 30 * min],
  ]],
  ["Quality & Safety Updates", "general", [
    [0, "New Infection Prevention policy published — please acknowledge in Policies & Procedures by Friday.", 26 * hr],
    [0, "Reminder: hand hygiene audit this week. Target 95% compliance.", 20 * hr],
  ]],
  ["Patient Care Handover", "patient", [
    [3, "Handover for Bed 5: stable, IV fluids continuing, review medication at 14:00.", 3 * hr],
    [1, "Noted. Family updated and comfortable with the plan.", 2 * hr + 30 * min],
  ]],
  ["Learning & Development", "general", [
    [4, "Reminder: mandatory Moving & Handling refresher is due this month.", 30 * hr],
    [0, "Sepsis Management study session Thursday 13:00 — sign up in My Learning Centre.", 22 * hr],
  ]],
  ["Dr. Michael Patel", "direct", [
    [2, "Hi — could you please review the lab results for Bed 7 when you get a moment?", 3 * hr + 10 * min],
    [0, "Looking now. Potassium slightly low — I'll adjust the fluids and note it.", 2 * hr + 55 * min],
  ]],
];

await db.from("op_messages").delete().eq("hospital_id", H);
const rows = [];
for (const [channel, ctx, msgs] of THREADS) {
  for (const [ai, body, ago] of msgs) {
    const author = pick(ai);
    rows.push({ hospital_id: H, channel, context_type: ctx, body, author_id: author.id, author_name: author.full_name, created_at: at(ago) });
  }
}
const { error } = await db.from("op_messages").insert(rows);
if (error) { console.error("Insert failed:", error.message); process.exit(1); }
console.log(`✅ Seeded ${rows.length} messages across ${THREADS.length} channels for AMU hospital ${H}.`);
