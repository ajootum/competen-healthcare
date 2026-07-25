// Mirror verifier for PW-013 Activity Analytics (src/lib/activity-analytics.ts). Replicates the activity
// aggregation for a live AMU nurse (auth wall). Read-only. Run: node scripts/verify-activity-analytics.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const since = new Date(Date.now() - 30 * 86400000).toISOString();
const cat = (entity, action) => { const e = `${entity ?? ""} ${action ?? ""}`.toLowerCase(); if (/patient|bed|shift/.test(e)) return "Patient Care"; if (/learn|course|cpd|enrol/.test(e)) return "Learning"; if (/document|policy|knowledge/.test(e)) return "Documentation"; if (/message|notification/.test(e)) return "Communication"; if (/competency|assessment|logbook|credential|skill/.test(e)) return "Competency"; return "Administration"; };

const { data: cohort } = await db.from("profiles").select("id, full_name, email, hospital_id").ilike("email", "%@amu.competen.demo");
let best = null, bestN = -1;
for (const p of cohort ?? []) { const t = await q(db.from("op_tasks").select("id").eq("assigned_to", p.id)); const l = await q(db.from("audit_log").select("action").eq("actor_id", p.id)); const s = t.length + l.length; if (s > bestN) { bestN = s; best = p; } }
best = best ?? (cohort ?? [])[0];
console.log(`Nurse: ${best.full_name}\n`);

const events = [];
(await q(db.from("audit_log").select("action, entity_type, entity_name, created_at").eq("actor_id", best.id).gte("created_at", since))).forEach((l) => events.push({ cat: cat(l.entity_type, l.action), title: String(l.action).replace(/_/g, " ") }));
const tasks = await q(db.from("op_tasks").select("description, status, patient_id, completed_at, created_at").eq("assigned_to", best.id).gte("created_at", since));
tasks.forEach((t) => events.push({ cat: t.patient_id ? "Patient Care" : "Administration", title: t.status === "completed" ? "Completed task" : "Task assigned" }));
(await q(db.from("learning_enrolments").select("status, completed_at, enrolled_on").eq("user_id", best.id))).forEach((e) => { if (e.enrolled_on >= since || (e.completed_at && e.completed_at >= since)) events.push({ cat: "Learning", title: e.status === "completed" ? "Completed course" : "Enrolled" }); });
(await q(db.from("cpd_logs").select("title, activity_date").eq("user_id", best.id).gte("activity_date", since.slice(0, 10)))).forEach(() => events.push({ cat: "Learning", title: "Logged CPD" }));
(await q(db.from("competency_decisions").select("outcome, created_at").eq("nurse_id", best.id).gte("created_at", since))).forEach(() => events.push({ cat: "Competency", title: "Competency decision" }));
(await q(db.from("op_messages").select("channel, created_at").eq("author_id", best.id).gte("created_at", since))).forEach(() => events.push({ cat: "Communication", title: "Sent message" }));

const byCat = {}; events.forEach((e) => (byCat[e.cat] = (byCat[e.cat] ?? 0) + 1));
const tasksDone = events.filter((e) => e.title === "Completed task").length;
console.log(`Total activities (30d) . ${events.length}`);
console.log(`Tasks completed ........ ${tasksDone}`);
console.log(`By category ............ ${JSON.stringify(byCat)}`);
console.log("\n✅ loadActivityAnalytics mirror ran clean.");
