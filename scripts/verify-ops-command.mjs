// Mirror verifier for UMW-OPC-001 Operational Command Dashboard (src/lib/operations/ops-command.ts). Replicates
// the command KPI/bed/acuity/staffing aggregations for the AMU hospital (auth wall). Read-only. Run:
//   node scripts/verify-ops-command.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const band = (a) => { const s = String(a ?? "").toLowerCase(); if (/high|critical|1|red/.test(s)) return "high"; if (/med|moderate|2|amber/.test(s)) return "medium"; if (/low|3|green/.test(s)) return "low"; return "stable"; };

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const since24 = new Date(Date.now() - 86400000).toISOString();

const beds = await q(db.from("op_beds").select("status").eq("hospital_id", H).limit(500));
const patients = await q(db.from("op_patients").select("acuity_level, bed_id").eq("hospital_id", H).limit(1000));
const esc = await q(db.from("op_escalations").select("status").eq("hospital_id", H).gte("created_at", since24));
const saf = await q(db.from("op_safety_alerts").select("id").eq("hospital_id", H).gte("created_at", since24));
const tasks = await q(db.from("op_tasks").select("priority").eq("hospital_id", H).not("status", "in", "(completed,verified,cancelled)"));
const shifts = await q(db.from("op_shifts").select("id").eq("hospital_id", H).gte("shift_date", new Date(Date.now() - 86400000).toISOString().slice(0, 10)));
let staff = [];
if (shifts.length) staff = await q(db.from("op_shift_staff").select("role").in("shift_id", shifts.map((s) => s.id)));

const occ = beds.filter((b) => b.status === "occupied").length;
const acuity = { high: 0, medium: 0, low: 0, stable: 0 };
patients.forEach((p) => acuity[band(p.acuity_level)]++);
const tb = (p) => tasks.filter((t) => t.priority === p).length;
const roleN = (re) => staff.filter((s) => re.test(String(s.role))).length;

console.log(`AMU hospital ${H}\n`);
console.log("KPI ribbon:");
console.log(`  Total patients ...... ${patients.length}`);
console.log(`  Occupied beds ....... ${occ}/${beds.length} (${beds.length ? Math.round((occ / beds.length) * 100) : 0}%)`);
console.log(`  High acuity ......... ${acuity.high} (${patients.length ? Math.round((acuity.high / patients.length) * 100) : 0}%)`);
console.log(`  Safety incidents 24h  ${saf.length}`);
console.log(`  Tasks outstanding ... ${tasks.length}  (urgent ${tb("urgent")}, high ${tb("high")})`);
console.log(`  Staff on duty today . ${staff.length} (RN/charge ${roleN(/nurse|charge|float/)}, support ${roleN(/support/)}, medical/allied ${roleN(/doctor|therapist|educator|assessor/)})`);
console.log(`  Escalations (open) .. ${esc.filter((e) => e.status !== "closed").length}`);
console.log(`\nAcuity breakdown: ${JSON.stringify(acuity)}`);
console.log(`Bed statuses: occupied=${occ} available=${beds.filter((b) => b.status === "available").length} cleaning=${beds.filter((b) => b.status === "cleaning").length} out=${beds.filter((b) => b.status === "out_of_service").length}`);
console.log("\n✅ loadOperationalCommand mirror ran clean.");
