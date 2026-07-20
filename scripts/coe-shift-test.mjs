// COMPETEN — COE "My Shift + Tasks/Observations" functional test (Phase-2 slice #1)
// Proves the frontline loop against the LIVE app: coordinator deploys staff +
// assigns a patient + assigns a task + schedules an observation; the worker sees
// them via My Shift, records observations (with EWS auto-escalation), completes
// the task; plus separation-of-duties, frontline-raise, access control and tenant
// isolation. Requires migrations 038 + 039 applied + code deployed.
// Run: node scripts/coe-shift-test.mjs   (TEST_BASE overrides target)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.env.TEST_BASE || "https://competenhealthcare.com";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PW = "Shft-" + randomBytes(9).toString("base64url");
const created = { users: [], hospitals: [], orgs: [] };
const results = [];
const check = (n, pass, detail = "") => { results.push({ n, pass: !!pass }); console.log(`${pass ? "  PASS" : "* FAIL"} ${n}${detail ? "  — " + detail : ""}`); };

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
  const email = `shft-${tag}@interaction.test`;
  try { const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); const old = (data?.users ?? []).find(u => u.email === email); if (old) { await admin.from("profiles").delete().eq("id", old.id); await admin.auth.admin.deleteUser(old.id); } } catch {}
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(error.message);
  await admin.from("profiles").upsert({ id: u.user.id, email, full_name: `Shift ${tag}`, role, roles, hospital_id, organisation_id });
  created.users.push(u.user.id); return { id: u.user.id, email };
}
async function cleanup() {
  console.log("\nCleaning up ...");
  for (const t of ["op_observations", "op_patient_assignments", "op_patients", "op_beds", "op_shift_staff", "op_shifts", "op_escalations", "op_safety_alerts", "op_tasks"]) { try { await admin.from(t).delete().in("hospital_id", created.hospitals); } catch {} }
  try { await admin.from("competency_decisions").delete().in("nurse_id", created.users); } catch {}
  try { await admin.from("audit_log").delete().in("actor_id", created.users); } catch {}
  try { await admin.from("notifications").delete().in("user_id", created.users); } catch {}
  for (const id of created.users) { try { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); } catch {} }
  try { await admin.from("hospitals").delete().in("id", created.hospitals); } catch {}
  try { await admin.from("organisations").delete().in("id", created.orgs); } catch {}
  console.log("Cleanup done.");
}

async function run() {
  const probe = await admin.from("op_observations").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message)) { console.log(`\n⚠  op_observations not found — apply migration 039 first.`); return; }

  console.log(`\nSeeding on ${BASE} ...`);
  const { data: orgA } = await admin.from("organisations").insert({ name: "Shift Org A", hq_country: "Kenya" }).select("id").single();
  const { data: orgB } = await admin.from("organisations").insert({ name: "Shift Org B", hq_country: "Kenya" }).select("id").single();
  created.orgs.push(orgA.id, orgB.id);
  const { data: hA } = await admin.from("hospitals").insert({ name: "Shift Hospital A", country: "Kenya", organisation_id: orgA.id }).select("id").single();
  const { data: hB } = await admin.from("hospitals").insert({ name: "Shift Hospital B", country: "Kenya", organisation_id: orgB.id }).select("id").single();
  created.hospitals.push(hA.id, hB.id);
  const { data: dept } = await admin.from("departments").insert({ hospital_id: hA.id, name: "Shift ICU" }).select("id").single();

  const adminA = await mkUser("adminA", "hospital_admin", ["hospital_admin"], hA.id, orgA.id);
  const adminB = await mkUser("adminB", "hospital_admin", ["hospital_admin"], hB.id, orgB.id);
  const nurse = await mkUser("nurse", "nurse", ["nurse"], hA.id, orgA.id);
  const other = await mkUser("other", "nurse", ["nurse"], hA.id, orgA.id);
  await admin.from("competency_decisions").insert({ nurse_id: nurse.id, outcome: "competent", hospital_id: hA.id });

  const cookie = await login(adminA.email), cookieB = await login(adminB.email), nurseCookie = await login(nurse.email), otherCookie = await login(other.email);

  // Coordinator sets up the shift + patient + assignment
  const shift = await api("POST", "/api/operations/shifts", { cookie, json: { department_id: dept.id, shift_type: "day" } });
  await api("PATCH", `/api/operations/shifts?id=${shift.data.id}`, { cookie, json: { status: "active" } });
  await api("POST", "/api/operations/shift-staff", { cookie, json: { shift_id: shift.data.id, staff_id: nurse.id, role: "nurse" } });
  const bed = await api("POST", "/api/operations/beds", { cookie, json: { label: "Shift Bay-1", department_id: dept.id } });
  const patient = await api("POST", "/api/operations/patients", { cookie, json: { label: "Bay 1 · X.Y.", department_id: dept.id, bed_id: bed.data.id, acuity_level: "high" } });
  const pid = patient.data.id;
  const asg = await api("POST", "/api/operations/assignments", { cookie, json: { patient_id: pid, staff_id: nurse.id } });
  check("Setup: patient assigned to nurse", asg.status === 201, `status ${asg.status}`);

  const task = await api("POST", "/api/operations/tasks", { cookie, json: { assigned_to: nurse.id, patient_id: pid, description: "2-hourly turns", priority: "high" } });
  check("Coordinator assigns a task to the worker", task.status === 201, `status ${task.status}`);
  const sched = await api("POST", "/api/operations/observations", { cookie, json: { mode: "schedule", patient_id: pid, observation_type: "vital_signs" } });
  check("Coordinator schedules an observation", sched.status === 201 && sched.data?.status === "due", `status ${sched.status}`);

  // ── The worker's My Shift view
  const my = await api("GET", "/api/operations/my-shift", { cookie: nurseCookie });
  check("Worker sees their shift", my.data?.shift?.status === "active", `shift ${my.data?.shift?.status}`);
  check("Worker sees their patient", (my.data?.patients ?? []).some(p => p.op_patients.id === pid), `${(my.data?.patients ?? []).length} patient(s)`);
  check("Worker sees their task", (my.data?.tasks ?? []).some(t => t.id === task.data.id), `${(my.data?.tasks ?? []).length} task(s)`);
  check("Worker sees the due observation", (my.data?.observations ?? []).some(o => o.status === "due"), `${(my.data?.observations ?? []).length} obs`);

  // ── Recording observations + EWS auto-escalation
  const normal = await api("POST", "/api/operations/observations", { cookie: nurseCookie, json: { mode: "record", patient_id: pid, observation_type: "vital_signs", ews_score: 2, findings: { note: "stable" } } });
  check("Worker records a normal observation (no escalation)", normal.status === 201 && normal.data?.escalation_triggered === false, `escalated=${normal.data?.escalation_triggered}`);
  const high = await api("POST", "/api/operations/observations", { cookie: nurseCookie, json: { mode: "record", patient_id: pid, observation_type: "vital_signs", ews_score: 7 } });
  check("High EWS (≥7) auto-escalates", high.status === 201 && high.data?.escalation_triggered === true, `escalated=${high.data?.escalation_triggered}`);
  const { data: escs } = await admin.from("op_escalations").select("id, level, escalation_type").eq("patient_id", pid);
  check("Auto-escalation record created (level 4)", (escs ?? []).some(e => e.escalation_type === "clinical_deterioration" && e.level === 4), `${(escs ?? []).length} escalation(s)`);
  const concern = await api("POST", "/api/operations/observations", { cookie: nurseCookie, json: { mode: "record", patient_id: pid, observation_type: "neuro", concern: true } });
  check("Cause-for-concern flag auto-escalates (level 2)", concern.status === 201 && concern.data?.escalation_triggered === true, `escalated=${concern.data?.escalation_triggered}`);

  // ── Task lifecycle + separation of duties
  const complete = await api("PATCH", `/api/operations/tasks?id=${task.data.id}`, { cookie: nurseCookie, json: { status: "completed" } });
  check("Worker completes their task", complete.status === 200 && complete.data?.status === "completed", `status ${complete.status}`);
  const selfVerify = await api("PATCH", `/api/operations/tasks?id=${task.data.id}`, { cookie: nurseCookie, json: { status: "verified" } });
  check("Worker cannot verify their own task", selfVerify.status === 403 || selfVerify.status === 400, `status ${selfVerify.status}`);
  const supVerify = await api("PATCH", `/api/operations/tasks?id=${task.data.id}`, { cookie, json: { status: "verified" } });
  check("Coordinator verifies the task", supVerify.status === 200, `status ${supVerify.status}`);

  // ── Frontline can raise; access control
  const esc = await api("POST", "/api/operations/escalations", { cookie: nurseCookie, json: { level: 2, summary: "Family concern", patient_id: pid } });
  check("Frontline worker can raise an escalation", esc.status === 201, `status ${esc.status}`);
  const safety = await api("POST", "/api/operations/safety-alerts", { cookie: nurseCookie, json: { category: "fall_risk", patient_id: pid } });
  check("Frontline worker can raise a safety alert", safety.status === 201, `status ${safety.status}`);

  const notMine = await api("POST", "/api/operations/observations", { cookie: otherCookie, json: { mode: "record", patient_id: pid, observation_type: "vital_signs", ews_score: 3 } });
  check("Non-assigned worker cannot record obs for the patient", notMine.status === 403, `status ${notMine.status}`);
  const otherAssign = await api("POST", "/api/operations/tasks", { cookie: otherCookie, json: { assigned_to: nurse.id, description: "sneaky" } });
  check("Worker cannot assign a task to someone else", otherAssign.status === 403, `status ${otherAssign.status}`);
  const xTenantTask = await api("POST", "/api/operations/tasks", { cookie, json: { assigned_to: adminB.id, description: "cross-tenant inject" } });
  check("Coordinator cannot assign a task to a cross-tenant user", xTenantTask.status === 403 || xTenantTask.status === 404, `status ${xTenantTask.status}`);
  const otherMy = await api("GET", "/api/operations/my-shift", { cookie: otherCookie });
  check("Unassigned worker's My Shift is empty", (otherMy.data?.patients ?? []).length === 0, `${(otherMy.data?.patients ?? []).length} patient(s)`);

  // ── Tenant isolation
  const bObs = await api("POST", "/api/operations/observations", { cookie: cookieB, json: { mode: "schedule", patient_id: pid, observation_type: "vital_signs" } });
  check("Tenant-B cannot schedule obs for tenant-A patient", bObs.status === 403 || bObs.status === 404, `status ${bObs.status}`);
  const bTasks = await api("GET", "/api/operations/tasks", { cookie: cookieB });
  check("Tenant-B does not see tenant-A tasks", !(bTasks.data?.tasks ?? []).some(t => t.id === task.data.id), (bTasks.data?.tasks ?? []).length + " tenant-B tasks");

  // ── Audit
  const { data: al } = await admin.from("audit_log").select("action").in("actor_id", created.users);
  const actions = new Set((al ?? []).map(a => a.action));
  check("Tasks + observations audited", actions.has("create_task") && actions.has("record_observation"), [...actions].filter(a => a.includes("task") || a.includes("observation")).join(","));
}

(async () => {
  let ok = true;
  try { await run(); } catch (e) { console.error("\nHARNESS ERROR:", e.message); ok = false; } finally { await cleanup(); }
  const pass = results.filter(r => r.pass).length, fail = results.length - pass;
  console.log(`\n================ MY SHIFT + TASKS/OBSERVATIONS TEST ================`);
  console.log(`${results.length} checks · ${pass} passed · ${fail} failed`);
  if (fail) for (const r of results.filter(x => !x.pass)) console.log(`  * ${r.n}`);
  process.exit(ok && fail === 0 ? 0 : 1);
})();
