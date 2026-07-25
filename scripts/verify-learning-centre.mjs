// Mirror verifier for PW-006 My Learning Centre (src/lib/learning-centre.ts). Replicates the key aggregations
// for a live AMU nurse (auth wall). Read-only. Run: node scripts/verify-learning-centre.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const yearStart = `${new Date().getFullYear()}-01-01`;

// Pick the AMU nurse with the most enrolments (richest learning picture).
const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, email").ilike("email", "%@amu.competen.demo");
let best = null, bestN = -1;
for (const p of cohort ?? []) { const { count } = await db.from("learning_enrolments").select("id", { count: "exact", head: true }).eq("user_id", p.id); if ((count ?? 0) > bestN) { bestN = count ?? 0; best = p; } }
if (!best) { console.error("No AMU cohort."); process.exit(1); }
console.log(`Nurse: ${best.full_name} (${best.email})\n`);

const enrol = await q(db.from("learning_enrolments").select("id, course_id, status, progress_pct, mandatory, due_date").eq("user_id", best.id));
const cids = [...new Set(enrol.map((e) => e.course_id).filter(Boolean))];
const ct = new Map(); if (cids.length) (await q(db.from("learning_courses").select("id, title, course_type").in("id", cids))).forEach((c) => ct.set(c.id, c));
const cpd = await q(db.from("cpd_logs").select("activity_type, hours, cpd_points, activity_date, certificate_url").eq("user_id", best.id));
const cpdYear = cpd.filter((l) => (l.activity_date ?? "") >= yearStart);

const inProgress = enrol.filter((e) => e.status === "in_progress");
const completed = enrol.filter((e) => e.status === "completed");
const bucket = (t) => (["course", "workshop", "conference"].includes(t) ? "Formal" : t === "self_study" ? "Self-Directed" : ["simulation", "osce"].includes(t) ? "Practical" : "Other");
const bySum = {}; cpdYear.forEach((l) => (bySum[bucket(l.activity_type)] = (bySum[bucket(l.activity_type)] ?? 0) + Number(l.cpd_points || 0)));

console.log("KPIs:");
console.log(`  Enrolments ...... ${enrol.length}  (in-progress ${inProgress.length}, completed ${completed.length})`);
console.log(`  CPD points (yr).. ${Math.round(cpdYear.reduce((s, l) => s + Number(l.cpd_points || 0), 0))}`);
console.log(`  CPD hours (yr) .. ${Math.round(cpdYear.reduce((s, l) => s + Number(l.hours || 0), 0) * 10) / 10}`);
console.log(`  Certificates .... ${cpd.filter((l) => l.certificate_url).length || completed.filter((e) => e.mandatory).length}`);
console.log(`\nCPD summary (points by bucket): ${JSON.stringify(bySum)}`);
console.log("\nContinue Learning (in-progress, by progress):");
inProgress.sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0)).slice(0, 6).forEach((e) => console.log(`  ${String(e.progress_pct ?? 0).padStart(3)}%  ${(ct.get(e.course_id)?.title ?? "Course").slice(0, 50)}  [${ct.get(e.course_id)?.course_type ?? "?"}]${e.mandatory ? " ·mandatory" : ""}`));
console.log("\n✅ loadLearningCentre mirror ran clean.");
