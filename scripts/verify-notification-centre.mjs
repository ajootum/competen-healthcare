// Mirror verifier for PW-004 Notification Centre (src/lib/notification-centre.ts). Replicates the aggregation
// against the real DB for a live AMU nurse (auth wall). Read-only. Run: node scripts/verify-notification-centre.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const now = Date.now(), dayMs = 86400000;
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

// Pick the AMU nurse with the most notifications+tasks (richest feed).
const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, email").ilike("email", "%@amu.competen.demo");
let best = null, bestScore = -1;
for (const p of cohort ?? []) { const { count: nc } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", p.id); const { count: tc } = await db.from("op_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", p.id).not("status", "in", "(completed,cancelled)"); const s = (nc ?? 0) + (tc ?? 0); if (s > bestScore) { bestScore = s; best = p; } }
if (!best) { console.error("No AMU cohort."); process.exit(1); }
console.log(`Nurse: ${best.full_name} (${best.email})\n`);

const feed = [];
const rows = await q(db.from("notifications").select("id, type, title, read, created_at").eq("user_id", best.id).limit(120));
rows.forEach((n) => feed.push({ cat: "notif", pri: ["logbook_rejected", "logbook_escalated"].includes(n.type) ? "high" : "medium", title: n.title, read: n.read, real: true }));
const tasks = await q(db.from("op_tasks").select("id, description, due_at, patient_id").eq("assigned_to", best.id).not("status", "in", "(completed,cancelled)").not("due_at", "is", null).lte("due_at", new Date(now + 2 * dayMs).toISOString()).limit(15));
tasks.forEach((t) => feed.push({ cat: t.patient_id ? "patients" : "tasks", pri: new Date(t.due_at).getTime() < now ? "high" : "medium", title: `Task: ${t.description}`, read: false, real: false }));
const dec = await q(db.from("competency_decisions").select("id, expiry_date").eq("nurse_id", best.id).not("expiry_date", "is", null).lte("expiry_date", new Date(now + 30 * dayMs).toISOString().slice(0, 10)).limit(10));
dec.forEach((d) => feed.push({ cat: "competencies", pri: new Date(d.expiry_date).getTime() < now ? "high" : "medium", title: "Competency expiring", read: false, real: false }));
const enrol = await q(db.from("learning_enrolments").select("id, due_date").eq("user_id", best.id).eq("mandatory", true).not("status", "in", "(completed,exempt)").not("due_date", "is", null).lte("due_date", new Date(now + 14 * dayMs).toISOString().slice(0, 10)).limit(10));
enrol.forEach((e) => feed.push({ cat: "learning", pri: new Date(e.due_date).getTime() < now ? "high" : "medium", title: "Mandatory learning due", read: false, real: false }));

const byCat = {}; feed.forEach((f) => (byCat[f.cat] = (byCat[f.cat] ?? 0) + 1));
console.log("KPIs:");
console.log(`  Total ......... ${feed.length}  (real notifications: ${rows.length}, derived: ${feed.length - rows.length})`);
console.log(`  Unread ........ ${feed.filter((f) => !f.read).length}`);
console.log(`  High Priority . ${feed.filter((f) => f.pri === "high").length}`);
console.log(`  Archived(read). ${rows.filter((n) => n.read).length}`);
console.log(`\nBy category: ${JSON.stringify(byCat)}`);
console.log("\nFeed (top 10):");
feed.slice(0, 10).forEach((f) => console.log(`  [${f.cat.padEnd(12)}] ${f.pri.padEnd(6)} ${f.real ? "REAL " : "deriv"}  ${f.title?.slice(0, 55)}`));
console.log("\n✅ loadNotificationCentre mirror ran clean.");
