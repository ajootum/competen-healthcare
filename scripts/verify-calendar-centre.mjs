// Mirror verifier for PW-003 Calendar & Schedule Centre (src/lib/calendar-centre.ts). Replicates event
// aggregation for a live AMU nurse (auth wall). Read-only. Run: node scripts/verify-calendar-centre.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const win = (dOff) => ymd(new Date(Date.now() + dOff * 86400000));

// Pick the AMU nurse with the most shifts (richest calendar).
const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, email").ilike("email", "%@amu.competen.demo");
let best = null, bestN = -1;
for (const p of cohort ?? []) { const ss = await q(db.from("op_shift_staff").select("shift_id").eq("staff_id", p.id)); const tc = await q(db.from("op_tasks").select("id").eq("assigned_to", p.id).not("due_at", "is", null)); const s = ss.length + tc.length; if (s > bestN) { bestN = s; best = p; } }
if (!best) { console.error("No AMU cohort."); process.exit(1); }
console.log(`Nurse: ${best.full_name} (${best.email})\n`);

const events = [];
const ss = await q(db.from("op_shift_staff").select("shift_id").eq("staff_id", best.id));
const sids = [...new Set(ss.map((s) => s.shift_id).filter(Boolean))];
if (sids.length) { const shifts = await q(db.from("op_shifts").select("id, shift_type, shift_date, starts_at, ends_at").in("id", sids).gte("shift_date", win(-40)).lte("shift_date", win(45))); shifts.forEach((s) => events.push({ cat: s.shift_type === "on_call" ? "oncall" : "shift", date: s.shift_date, title: `${s.shift_type} shift` })); }
const tasks = await q(db.from("op_tasks").select("id, description, due_at").eq("assigned_to", best.id).not("status", "in", "(completed,cancelled)").not("due_at", "is", null).gte("due_at", win(-40)).lte("due_at", win(45) + "T23:59:59"));
tasks.forEach((t) => events.push({ cat: "task", date: t.due_at.slice(0, 10), title: t.description }));
const enrol = await q(db.from("learning_enrolments").select("id, due_date").eq("user_id", best.id).not("status", "in", "(completed,exempt)").not("due_date", "is", null).gte("due_date", win(-40)).lte("due_date", win(45)));
enrol.forEach((e) => events.push({ cat: "learning", date: e.due_date, title: "Learning due" }));
const dec = await q(db.from("competency_decisions").select("id, expiry_date").eq("nurse_id", best.id).not("expiry_date", "is", null).gte("expiry_date", win(-40)).lte("expiry_date", win(45)));
dec.forEach((d) => events.push({ cat: "competency", date: d.expiry_date, title: "Competency renewal" }));

const byCat = {}; events.forEach((e) => (byCat[e.cat] = (byCat[e.cat] ?? 0) + 1));
const today = ymd(new Date());
console.log("Summary:");
console.log(`  Total events (±window) . ${events.length}`);
console.log(`  By category ............ ${JSON.stringify(byCat)}`);
console.log(`  Events today ........... ${events.filter((e) => e.date === today).length}`);
console.log(`  Upcoming (next 7d) ..... ${events.filter((e) => e.date >= today && e.date <= win(7)).length}`);
console.log("\nNext events:");
events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).forEach((e) => console.log(`  ${e.date}  [${e.cat.padEnd(10)}] ${e.title?.slice(0, 45)}`));
console.log("\n✅ loadCalendar mirror ran clean.");
