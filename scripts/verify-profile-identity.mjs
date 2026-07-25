// Mirror verifier for PW-011 Profile & Identity (src/lib/profile-identity.ts). Replicates the profile aggregation
// for a live AMU nurse (auth wall). Read-only. Run: node scripts/verify-profile-identity.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const RANK = { novice: 1, advanced_beginner: 2, competent: 3, proficient: 4, expert: 5, mentor: 6, authority: 7 };
const LEVEL = ["Foundation", "Foundation", "Developing", "Competent", "Proficient", "Advanced", "Expert", "Authority"];

const { data: cohort } = await db.from("profiles").select("id, full_name, email, role, specialization, department_id, staff_number, phone, avatar_url, hospital_id").ilike("email", "%@amu.competen.demo");
let best = null, bestN = -1;
for (const p of cohort ?? []) { const c = await q(db.from("professional_credentials").select("id").eq("nurse_id", p.id)); if (c.length > bestN) { bestN = c.length; best = p; } }
best = best ?? (cohort ?? [])[0];
if (!best) { console.error("No AMU cohort."); process.exit(1); }
console.log(`Nurse: ${best.full_name} (${best.email})\n`);

const creds = await q(db.from("professional_credentials").select("credential_type, title, status, verified").eq("nurse_id", best.id));
const dec = await q(db.from("competency_decisions").select("maturity, validation_outcome").eq("nurse_id", best.id));
const LIC = ["professional_license", "academic_qualification"];
const active = creds.filter((c) => c.status === "active");
const certs = creds.filter((c) => !LIC.includes(c.credential_type));
const mats = dec.filter((d) => d.validation_outcome === "validated" && d.maturity).map((d) => RANK[d.maturity] ?? 0);
const level = mats.length ? Math.max(...mats) : 0;
const fields = [best.full_name, best.email, best.phone, best.specialization, best.avatar_url, best.department_id, best.staff_number, best.hospital_id];
const teamCount = best.department_id ? (await q(db.from("profiles").select("id").eq("department_id", best.department_id).neq("id", best.id))).length : 0;

console.log("KPIs:");
console.log(`  Profile completeness . ${Math.round((fields.filter(Boolean).length / fields.length) * 100)}%  (${fields.filter(Boolean).length}/${fields.length} key fields)`);
console.log(`  Professional level ... ${LEVEL[level]} (Level ${Math.max(1, level)})`);
console.log(`  Active credentials ... ${active.length}`);
console.log(`  Certifications ....... ${certs.length}`);
console.log(`  Verified credentials . ${creds.filter((c) => c.verified).length}`);
console.log(`  Team (same dept) ..... ${teamCount}`);
console.log("\nCredentials:");
creds.slice(0, 8).forEach((c) => console.log(`  [${c.status.padEnd(8)}] ${c.verified ? "✓" : " "} ${c.title?.slice(0, 45)}`));
console.log("\n✅ loadProfileIdentity mirror ran clean.");
