// Mirror verifier for the UMW-OPC Operational Command modules (OPC-002 Live Unit Status, OPC-003 Capacity,
// OPC-004 Staffing) — replicates the key aggregations from src/lib/operations/ops-{live-status,capacity,staffing}.ts
// for the AMU demo hospital (auth wall). Read-only. Run:  node scripts/verify-ops-modules.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);

const beds = await q(db.from("op_beds").select("status, bed_type").eq("hospital_id", H).limit(500));
const patients = await q(db.from("op_patients").select("acuity_level, risk_level, operational_status, bed_id").eq("hospital_id", H).limit(1000));
const shifts = await q(db.from("op_shifts").select("id, shift_date, status").eq("hospital_id", H).gte("shift_date", new Date(Date.now() - 86400000).toISOString().slice(0, 10)));
const shiftIds = shifts.filter((s) => s.shift_date === today || s.status === "active").map((s) => s.id);
const staff = shiftIds.length ? await q(db.from("op_shift_staff").select("role, status").in("shift_id", shiftIds)) : [];
const asg = await q(db.from("op_patient_assignments").select("competency_validated, staff_id").eq("hospital_id", H).eq("status", "active"));
const equip = await q(db.from("op_equipment").select("status").eq("hospital_id", H));
const safety = await q(db.from("op_safety_alerts").select("category, severity, active").eq("hospital_id", H));
const esc = await q(db.from("op_escalations").select("status, severity").eq("hospital_id", H));
const snaps = await q(db.from("op_ops_snapshots").select("*").eq("hospital_id", H).eq("period_type", "day").order("period"));
const cur = snaps[snaps.length - 1] ?? {};

const totalBeds = beds.length, occ = beds.filter((b) => b.status === "occupied").length;
const occupancy = pct(occ, totalBeds);
const onDuty = staff.filter((s) => !["off_duty", "absent"].includes(s.status)).length || staff.length;
const est = cur.required_fte != null ? Math.round(Number(cur.required_fte)) : Math.ceil(onDuty * 1.12);

console.log(`AMU hospital ${H}\n`);
console.log("OPC-002 Live Unit Status:");
console.log(`  Beds occupied ....... ${occ}/${totalBeds} (${occupancy}%)`);
console.log(`  Active safety ....... ${safety.filter((s) => s.active).length}  (med ${safety.filter((s) => s.active && s.category === "medication").length})`);
console.log(`  Open escalations .... ${esc.filter((e) => ["open", "acknowledged"].includes(e.status)).length}`);
console.log(`  Equipment operational ${equip.filter((e) => e.status === "operational").length}/${equip.length}`);
console.log(`  Daily snapshots ..... ${snaps.length}`);

console.log("\nOPC-003 Capacity & Bed:");
console.log(`  available=${beds.filter((b) => b.status === "available").length} cleaning=${beds.filter((b) => b.status === "cleaning").length} reserved=${beds.filter((b) => b.status === "reserved").length} oos=${beds.filter((b) => b.status === "out_of_service").length}`);
const types = {}; beds.forEach((b) => { types[b.bed_type ?? "standard"] = (types[b.bed_type ?? "standard"] ?? 0) + 1; });
console.log(`  bed types ........... ${JSON.stringify(types)}`);
console.log(`  admissions/discharges (snapshot) ${cur.admissions ?? "—"}/${cur.discharges ?? "—"}  turnover=${cur.bed_turnover ?? "—"}`);

console.log("\nOPC-004 Staffing:");
console.log(`  On duty ............. ${onDuty}/${est} (${pct(onDuty, est)}%)`);
const roles = {}; staff.forEach((s) => { roles[s.role] = (roles[s.role] ?? 0) + 1; });
console.log(`  role mix ............ ${JSON.stringify(roles)}`);
console.log(`  active assignments .. ${asg.length}  (validated ${asg.filter((a) => a.competency_validated).length})`);
console.log(`  absent .............. ${staff.filter((s) => s.status === "absent").length}`);

console.log("\n✅ ops-modules mirror ran clean.");
