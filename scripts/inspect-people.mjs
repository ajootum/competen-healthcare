import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: profiles } = await db.from("profiles").select("id, full_name, role, roles, org_role, hospital_id, department_id");
for (const p of profiles ?? []) {
  console.log(`${p.id.slice(0, 8)}  role=${p.role}  roles=${JSON.stringify(p.roles)}  org=${p.org_role ?? "-"}  hosp=${p.hospital_id?.slice(0, 8) ?? "-"}  dept=${p.department_id?.slice(0, 8) ?? "-"}  ${p.full_name}`);
}
const { data: hospitals } = await db.from("hospitals").select("id, name");
console.log("\nHospitals:", (hospitals ?? []).map(h => `${h.id.slice(0, 8)} ${h.name}`).join(" | "));
const { data: depts, error: dErr } = await db.from("departments").select("id, name, hospital_id");
console.log("Departments:", dErr ? `ERR ${dErr.message}` : (depts ?? []).map(d => `${d.id.slice(0, 8)} ${d.name}`).join(" | ") || "(none)");
const { data: lvls } = await db.from("scoring_levels").select("score, label, is_passing").eq("scale_id", "00000000-0000-0000-0000-000000000001").order("score");
console.log("Scoring levels:", (lvls ?? []).map(l => `${l.score}=${l.label}${l.is_passing ? "✓" : ""}`).join(" | "));
