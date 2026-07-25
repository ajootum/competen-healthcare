// Mirror verifier for PW-014 P0 foundation. Replicates resolveEntitlements() gating over REAL profiles and probes
// the domain_events outbox provisioning state. Read-only. Run: node scripts/verify-orchestration.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Registry (mirror of src/lib/orchestration/registry.ts gating).
const PORTALS = [["portal:assessor", ["assessor"]], ["portal:educator", ["educator"]], ["portal:hospital_admin", ["hospital_admin"]], ["portal:super_admin", ["super_admin"]]];
const ORG = [
  ["workspace:supervisor", ["assessor", "hospital_admin", "super_admin"], ["chief_officer", "org_admin", "manager", "shift_supervisor", "charge_nurse", "leader"]],
  ["workspace:unit-manager", ["hospital_admin", "super_admin"], ["chief_officer", "org_admin", "manager"]],
  ["workspace:competency-office", ["hospital_admin", "educator", "super_admin"], ["chief_officer", "org_admin", "governance_committee", "competency_coordinator"]],
  ["workspace:quality-accreditation", ["hospital_admin", "super_admin", "assessor"], ["chief_officer", "org_admin", "quality_manager", "governance_committee"]],
  ["workspace:human-resources", ["hospital_admin", "super_admin"], ["chief_officer", "org_admin", "hr_manager"]],
  ["workspace:hospital-executive", ["hospital_admin", "super_admin"], ["chief_officer", "org_admin"]],
  ["workspace:organisation-admin", ["hospital_admin", "super_admin"], ["chief_officer", "org_admin", "it_admin"]],
  ["workspace:enterprise-governance", ["hospital_admin", "super_admin"], ["chief_officer", "org_admin", "governance_committee"]],
];
const entitled = (roles, orgRoles) => {
  const out = ["personal"];
  for (const [k, ar] of PORTALS) if (ar.some((r) => roles.includes(r))) out.push(k);
  for (const [k, ar, or] of ORG) if (ar.some((r) => roles.includes(r)) && or.some((r) => orgRoles.includes(r))) out.push(k);
  return out;
};
const rolesOf = (p) => (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
const orgRolesOf = (p) => (p.org_roles?.length ? p.org_roles : [p.org_role]).filter(Boolean);

// 1) Outbox provisioning probe. NOTE: a head:true count query swallows the "table not found" error, so probe
// with a real (non-head) select and inspect error.message explicitly.
let provisioned = false;
try { const { error } = await db.from("domain_events").select("id").limit(1); provisioned = !error; } catch { provisioned = false; }
console.log(`domain_events outbox: ${provisioned ? "✅ provisioned (migration 102 applied)" : "⏳ NOT provisioned — run migration 102 in the Supabase SQL editor"}\n`);

// 2) Real AMU nurse.
const { data: cohort } = await db.from("profiles").select("id, full_name, role, roles, org_role, org_roles").ilike("email", "%@amu.competen.demo").limit(3);
for (const p of (cohort ?? []).slice(0, 1)) console.log(`Nurse ${p.full_name}: roles=${JSON.stringify(rolesOf(p))} org=${JSON.stringify(orgRolesOf(p))}\n  entitled → ${entitled(rolesOf(p), orgRolesOf(p)).join(", ")}`);

// 3) Any real non-nurse / multi-role user.
const { data: staff } = await db.from("profiles").select("id, full_name, role, roles, org_role, org_roles").or("role.neq.nurse,org_roles.not.is.null").limit(3);
console.log("");
for (const p of staff ?? []) { const r = rolesOf(p), o = orgRolesOf(p); if (r.length === 1 && r[0] === "nurse" && !o.length) continue; console.log(`Staff ${p.full_name}: roles=${JSON.stringify(r)} org=${JSON.stringify(o)}\n  entitled → ${entitled(r, o).join(", ")}`); }

// 4) Synthetic proof — a manager admin unlocks the operational workspaces.
console.log("\nSynthetic {roles:[hospital_admin], org:[manager]}:\n  entitled →", entitled(["hospital_admin"], ["manager"]).join(", "));
console.log("Synthetic {roles:[nurse], org:[]} (pure clinician):\n  entitled →", entitled(["nurse"], []).join(", "));
console.log("\n✅ resolveEntitlements gating mirror ran clean.");
