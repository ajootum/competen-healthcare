// COMPETEN — Clinical Operations Engine functional test (COE-001, Phase 1)
// Proves the Shift Operations Centre pipeline against the LIVE app: open shift →
// deploy staff → add bed → register operational patient → competency-gated patient
// assignment (+ emergency override) → escalation → safety alert, plus permission
// and tenant-isolation checks. Requires migration 038 applied + code deployed.
// Run: node scripts/coe-test.mjs   (TEST_BASE overrides the target)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.env.TEST_BASE || "https://competenhealthcare.com";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PW = "Coe-" + randomBytes(9).toString("base64url");
const created = { users: [], hospitals: [], orgs: [] };
const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass }); console.log(`${pass ? "  PASS" : "* FAIL"} ${name}${detail ? "  — " + detail : ""}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  return (r.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).filter(c => c && !c.endsWith("=")).join("; ");
}
async function api(method, path, { cookie, json } = {}) {
  const headers = {}; if (cookie) headers.Cookie = cookie; if (json !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
  let data = null; const t = await r.text(); try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { status: r.status, data };
}
async function mkUser(tag, role, roles, hospital_id, organisation_id) {
  const email = `coe-${tag}@interaction.test`;
  try { const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); const old = (data?.users ?? []).find(u => u.email === email); if (old) { await admin.from("profiles").delete().eq("id", old.id); await admin.auth.admin.deleteUser(old.id); } } catch {}
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  await admin.from("profiles").upsert({ id: u.user.id, email, full_name: `COE ${tag}`, role, roles, hospital_id, organisation_id });
  created.users.push(u.user.id);
  return { id: u.user.id, email };
}
async function cleanup() {
  console.log("\nCleaning up ...");
  for (const t of ["op_patient_assignments", "op_patients", "op_beds", "op_shift_staff", "op_shifts", "op_escalations", "op_safety_alerts"]) { try { await admin.from(t).delete().in("hospital_id", created.hospitals); } catch {} }
  try { await admin.from("competency_decisions").delete().in("nurse_id", created.users); } catch {}
  try { await admin.from("audit_log").delete().in("actor_id", created.users); } catch {}
  try { await admin.from("notifications").delete().in("user_id", created.users); } catch {}
  for (const id of created.users) { try { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); } catch {} }
  try { await admin.from("hospitals").delete().in("id", created.hospitals); } catch {}
  try { await admin.from("organisations").delete().in("id", created.orgs); } catch {}
  console.log("Cleanup done.");
}

async function run() {
  const probe = await admin.from("op_shifts").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message)) { console.log(`\n⚠  op_* tables not found — apply migration 038 first (${probe.error.message}).`); return; }

  console.log(`\nSeeding on ${BASE} ...`);
  const { data: orgA } = await admin.from("organisations").insert({ name: "COE Org A", hq_country: "Kenya" }).select("id").single();
  const { data: orgB } = await admin.from("organisations").insert({ name: "COE Org B", hq_country: "Kenya" }).select("id").single();
  created.orgs.push(orgA.id, orgB.id);
  const { data: hA } = await admin.from("hospitals").insert({ name: "COE Hospital A", country: "Kenya", organisation_id: orgA.id }).select("id").single();
  const { data: hB } = await admin.from("hospitals").insert({ name: "COE Hospital B", country: "Kenya", organisation_id: orgB.id }).select("id").single();
  created.hospitals.push(hA.id, hB.id);
  const { data: dept } = await admin.from("departments").insert({ hospital_id: hA.id, name: "COE ICU" }).select("id").single();

  const adminA = await mkUser("adminA", "hospital_admin", ["hospital_admin"], hA.id, orgA.id);
  const adminB = await mkUser("adminB", "hospital_admin", ["hospital_admin"], hB.id, orgB.id);
  const validated = await mkUser("validated", "nurse", ["nurse"], hA.id, orgA.id);
  const unvalidated = await mkUser("unvalidated", "nurse", ["nurse"], hA.id, orgA.id);
  // Give the "validated" nurse a current passing competency decision.
  await admin.from("competency_decisions").insert({ nurse_id: validated.id, outcome: "competent", hospital_id: hA.id });

  const cookie = await login(adminA.email);
  const cookieB = await login(adminB.email);
  const nurseCookie = await login(validated.email);

  // ── Shift
  const shift = await api("POST", "/api/operations/shifts", { cookie, json: { department_id: dept.id, shift_type: "night" } });
  check("Open a shift", shift.status === 201 && shift.data?.id, `status ${shift.status}`);
  const shiftId = shift.data?.id;
  const act = await api("PATCH", `/api/operations/shifts?id=${shiftId}`, { cookie, json: { status: "active" } });
  check("Activate the shift", act.status === 200 && act.data?.status === "active", `status ${act.status}`);
  const deploy = await api("POST", "/api/operations/shift-staff", { cookie, json: { shift_id: shiftId, staff_id: validated.id, role: "nurse" } });
  check("Deploy staff onto the shift", deploy.status === 201, `status ${deploy.status}`);

  // ── Bed + operational patient
  const bed = await api("POST", "/api/operations/beds", { cookie, json: { label: "COE Bay-1", department_id: dept.id, bed_type: "critical_care" } });
  check("Add a bed", bed.status === 201, `status ${bed.status}`);
  const patient = await api("POST", "/api/operations/patients", { cookie, json: { label: "Bay 1 · A.B.", department_id: dept.id, bed_id: bed.data?.id, acuity_level: "high" } });
  check("Register operational patient", patient.status === 201, `status ${patient.status}`);
  const patientId = patient.data?.id;
  const { data: bedRow } = await admin.from("op_beds").select("status").eq("id", bed.data?.id).single();
  check("Bed marked occupied on admission", bedRow?.status === "occupied", `bed ${bedRow?.status}`);

  // ── Competency-gated assignment
  const asgOk = await api("POST", "/api/operations/assignments", { cookie, json: { patient_id: patientId, staff_id: validated.id } });
  check("Assign competency-validated clinician", asgOk.status === 201 && asgOk.data?.competency_validated === true, `status ${asgOk.status} validated=${asgOk.data?.competency_validated}`);

  const asgBlocked = await api("POST", "/api/operations/assignments", { cookie, json: { patient_id: patientId, staff_id: unvalidated.id, assignment_type: "supporting" } });
  check("Non-validated clinician blocked without override", asgBlocked.status === 422 && asgBlocked.data?.requires_override, `status ${asgBlocked.status}`);
  const asgOverride = await api("POST", "/api/operations/assignments", { cookie, json: { patient_id: patientId, staff_id: unvalidated.id, assignment_type: "supporting", override_reason: "Emergency cover" } });
  check("Override allows assignment (records override)", asgOverride.status === 201 && asgOverride.data?.competency_validated === false, `status ${asgOverride.status}`);

  // Reassign primary → previous primary ended (one active responsible clinician)
  await admin.from("competency_decisions").insert({ nurse_id: adminA.id, outcome: "competent", hospital_id: hA.id });
  await api("POST", "/api/operations/assignments", { cookie, json: { patient_id: patientId, staff_id: adminA.id, assignment_type: "primary" } });
  const { data: primaries } = await admin.from("op_patient_assignments").select("id").eq("patient_id", patientId).eq("assignment_type", "primary").eq("status", "active");
  check("Reassigning primary ends the previous primary", (primaries ?? []).length === 1, `${(primaries ?? []).length} active primary`);

  // ── Escalation + safety alert
  const esc = await api("POST", "/api/operations/escalations", { cookie, json: { level: 4, summary: "COE deterioration", patient_id: patientId } });
  check("Raise a level-4 escalation (emergency severity)", esc.status === 201 && esc.data?.severity === "emergency" && esc.data?.response_deadline, `status ${esc.status} sev=${esc.data?.severity}`);
  const escRes = await api("PATCH", `/api/operations/escalations?id=${esc.data?.id}`, { cookie, json: { status: "resolved", resolution: "Stabilised" } });
  check("Resolve the escalation", escRes.status === 200 && escRes.data?.status === "resolved", `status ${escRes.status}`);
  const alert = await api("POST", "/api/operations/safety-alerts", { cookie, json: { category: "fall_risk", severity: "high", patient_id: patientId } });
  check("Raise a safety alert", alert.status === 201, `status ${alert.status}`);

  // ── Permission
  const forbid = await api("POST", "/api/operations/shifts", { cookie: nurseCookie, json: { shift_type: "day" } });
  check("Plain nurse cannot open a shift (permission)", forbid.status === 403, `status ${forbid.status}`);

  // ── Tenant isolation
  const bList = await api("GET", "/api/operations/shifts", { cookie: cookieB });
  const bShifts = bList.data?.shifts ?? [];
  check("Tenant-B admin does not see tenant-A shifts", !bShifts.some(s => s.id === shiftId), bShifts.some(s => s.id === shiftId) ? "LEAK" : "clean");
  const bAssign = await api("POST", "/api/operations/assignments", { cookie: cookieB, json: { patient_id: patientId, staff_id: validated.id } });
  check("Tenant-B admin cannot assign tenant-A patient", bAssign.status === 403 || bAssign.status === 404, `status ${bAssign.status}`);

  // ── Audit
  const { data: al } = await admin.from("audit_log").select("action").in("actor_id", created.users);
  const actions = new Set((al ?? []).map(a => a.action));
  check("Operations actions audited", actions.has("open_shift") && actions.has("assign_patient") && actions.has("raise_escalation"), [...actions].filter(a => a.startsWith("open") || a.startsWith("assign") || a.startsWith("raise") || a.startsWith("deploy") || a.startsWith("register")).join(","));
}

(async () => {
  let ok = true;
  try { await run(); } catch (e) { console.error("\nHARNESS ERROR:", e.message); ok = false; } finally { await cleanup(); }
  const pass = results.filter(r => r.pass).length, fail = results.length - pass;
  console.log(`\n================ CLINICAL OPERATIONS ENGINE TEST ================`);
  console.log(`${results.length} checks · ${pass} passed · ${fail} failed`);
  if (fail) for (const r of results.filter(x => !x.pass)) console.log(`  * ${r.name}`);
  process.exit(ok && fail === 0 ? 0 : 1);
})();
