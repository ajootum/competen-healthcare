// COMPETEN — Workforce Assignment Engine functional test
// Proves the full provisioning pipeline end-to-end against the LIVE app:
// build a position library entry → template → publish → position → assign an
// employee, then assert every provisioned resource, idempotency, termination and
// permission enforcement. Requires migration 037 applied + code deployed.
//
// Run: node scripts/workforce-test.mjs   (TEST_BASE overrides the target)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.env.TEST_BASE || "https://competenhealthcare.com";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PW = "Wae-" + randomBytes(9).toString("base64url");
const created = { users: [], hospitals: [], orgs: [], frameworks: [], libs: [] };
const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "  PASS" : "* FAIL"} ${name}${detail ? "  — " + detail : ""}`);
}

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  return (r.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).filter(c => c && !c.endsWith("=")).join("; ");
}
async function api(method, path, { cookie, json } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
  let data = null; const t = await r.text();
  try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { status: r.status, data };
}
async function mkUser(tag, role, roles, hospital_id, organisation_id) {
  const email = `wae-${tag}@interaction.test`;
  try { const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); const old = (data?.users ?? []).find(u => u.email === email); if (old) { await admin.from("profiles").delete().eq("id", old.id); await admin.auth.admin.deleteUser(old.id); } } catch {}
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  await admin.from("profiles").upsert({ id: u.user.id, email, full_name: `WAE ${tag}`, role, roles, hospital_id, organisation_id });
  created.users.push(u.user.id);
  return { id: u.user.id, email };
}

async function cleanup() {
  console.log("\nCleaning up ...");
  try { await admin.from("position_library").delete().in("id", created.libs); } catch {}
  try { await admin.from("competency_cycles").delete().in("hospital_id", created.hospitals); } catch {}
  try { await admin.from("frameworks").delete().in("id", created.frameworks); } catch {}
  try { await admin.from("audit_log").delete().in("actor_id", created.users); } catch {}
  try { await admin.from("notifications").delete().in("user_id", created.users); } catch {}
  for (const id of created.users) { try { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); } catch {} }
  try { await admin.from("hospitals").delete().in("id", created.hospitals); } catch {}
  try { await admin.from("organisations").delete().in("id", created.orgs); } catch {}
  console.log("Cleanup done.");
}

async function run() {
  // Pre-flight: are the workforce tables present?
  const probe = await admin.from("position_library").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message)) {
    console.log(`\n⚠  workforce_* tables not found — apply migration 037 first (${probe.error.message}).`);
    return;
  }

  console.log(`\nSeeding on ${BASE} ...`);
  const { data: org } = await admin.from("organisations").insert({ name: "WAE Org", hq_country: "Kenya" }).select("id").single();
  created.orgs.push(org.id);
  const { data: hosp } = await admin.from("hospitals").insert({ name: "WAE Hospital", country: "Kenya", organisation_id: org.id }).select("id").single();
  created.hospitals.push(hosp.id);
  const { data: dept } = await admin.from("departments").insert({ hospital_id: hosp.id, name: "WAE ICU" }).select("id").single();
  const { data: fw } = await admin.from("frameworks").insert({ name: "WAE Framework", library: "core", hospital_id: hosp.id }).select("id").single();
  created.frameworks.push(fw.id);
  const { data: dom } = await admin.from("framework_domains").insert({ framework_id: fw.id, name: "WAE Domain" }).select("id").single();
  await admin.from("framework_competencies").insert({ domain_id: dom.id, name: "WAE Competency" });
  const { data: res } = await admin.from("learning_resources").insert({ title: "WAE Orientation Module", resource_type: "policy", hospital_id: hosp.id }).select("id").single();

  const adminU = await mkUser("admin", "hospital_admin", ["hospital_admin"], hosp.id, org.id);
  const emp = await mkUser("emp", "nurse", ["nurse"], hosp.id, org.id);
  const cookie = await login(adminU.email);
  const empCookie = await login(emp.email);

  // ── Position Library → Template → Publish → Position
  const lib = await api("POST", "/api/workforce/position-library", { cookie, json: { name: "Clinical Educator", category: "education", level: "senior" } });
  check("Create position library entry", lib.status === 201 && lib.data?.id, `status ${lib.status}`);
  if (lib.data?.id) created.libs.push(lib.data.id);

  const tpl = await api("POST", "/api/workforce/position-templates", { cookie, json: {
    position_library_id: lib.data?.id, workspaces: ["educator", "nurse"], framework_ids: [fw.id], resource_ids: [res.id],
    cycle_type: "orientation", assessment_programme: "orientation",
  } });
  check("Create position template (v1)", tpl.status === 201 && tpl.data?.version === 1, `status ${tpl.status} v${tpl.data?.version}`);

  const pub = await api("PATCH", `/api/workforce/position-templates?id=${tpl.data?.id}&action=publish`, { cookie });
  check("Publish template → active", pub.status === 200 && pub.data?.status === "active", `status ${pub.status}`);

  const posr = await api("POST", "/api/workforce/positions", { cookie, json: { title: "ICU Clinical Educator", template_id: tpl.data?.id, department_id: dept.id } });
  check("Create position", posr.status === 201 && posr.data?.id, `status ${posr.status}`);
  const positionId = posr.data?.id;

  // Negative: cannot use an unpublished template
  const tpl2 = await api("POST", "/api/workforce/position-templates", { cookie, json: { position_library_id: lib.data?.id, workspaces: ["nurse"] } });
  const posBad = await api("POST", "/api/workforce/positions", { cookie, json: { title: "Bad", template_id: tpl2.data?.id } });
  check("Position rejects unpublished template", posBad.status === 400, `status ${posBad.status}`);

  // ── The assignment — full provisioning pipeline
  const asg = await api("POST", "/api/workforce/assignments", { cookie, json: { employee_id: emp.id, position_id: positionId, assignment_type: "permanent" } });
  check("Assign employee → provisioning runs", (asg.status === 201) && asg.data?.status === "complete", `status ${asg.status} pipeline=${asg.data?.status}`);
  const allSteps = (asg.data?.steps ?? []).every(s => s.ok);
  check("All pipeline steps succeeded", allSteps, (asg.data?.steps ?? []).map(s => `${s.step}:${s.ok ? "ok" : "FAIL"}`).join(" "));

  // ── Assert provisioned side-effects
  const { data: prof } = await admin.from("profiles").select("roles").eq("id", emp.id).single();
  const roles = prof?.roles ?? [];
  check("Workspaces provisioned into roles", roles.includes("educator") && roles.includes("nurse"), `roles [${roles.join(", ")}]`);

  const { data: reg } = await admin.from("workspace_registry").select("workspace_type, status").eq("employee_id", emp.id);
  check("Workspace registry has 2 active", (reg ?? []).filter(r => r.status === "active").length === 2, `${(reg ?? []).length} rows`);

  const { data: cyc } = await admin.from("competency_cycles").select("id").eq("nurse_id", emp.id).eq("hospital_id", hosp.id);
  check("Competency cycle provisioned", (cyc ?? []).length >= 1, `${(cyc ?? []).length} cycle(s)`);
  if (cyc?.[0]) {
    const { data: cf } = await admin.from("cycle_frameworks").select("framework_id").eq("cycle_id", cyc[0].id);
    check("Cycle framework attached", (cf ?? []).some(x => x.framework_id === fw.id), `${(cf ?? []).length} framework(s)`);
  }

  const { data: pw } = await admin.from("learning_pathways").select("id").eq("nurse_id", emp.id);
  let items = [];
  if (pw?.[0]) { const r = await admin.from("pathway_items").select("resource_id").eq("pathway_id", pw[0].id); items = r.data ?? []; }
  check("Learning pathway + resource provisioned", items.some(i => i.resource_id === res.id), `${items.length} item(s)`);

  const { data: plan } = await admin.from("assessment_plans").select("id, programme_type").eq("nurse_id", emp.id);
  check("Assessment plan provisioned", (plan ?? []).length >= 1, `${(plan ?? []).length} plan(s)`);

  const { data: er } = await admin.from("employment_records").select("id, role_title, status").eq("nurse_id", emp.id).eq("hospital_id", hosp.id);
  check("Employment record (passport) provisioned", (er ?? []).length >= 1 && er[0].role_title === "ICU Clinical Educator", `${(er ?? []).length} record(s)`);

  const { data: notes } = await admin.from("notifications").select("type").eq("user_id", emp.id);
  check("Employee notified of assignment", (notes ?? []).some(n => n.type === "workforce_assigned"), (notes ?? []).map(n => n.type).join(","));

  const { data: al } = await admin.from("audit_log").select("action").in("actor_id", created.users);
  const actions = new Set((al ?? []).map(a => a.action));
  check("Assignment audited", actions.has("assign_position") && actions.has("provision_workspace"), [...actions].filter(a => a.startsWith("provision") || a === "assign_position").join(","));

  // ── Idempotency — re-run must not duplicate
  await api("POST", "/api/workforce/assignments", { cookie, json: { employee_id: emp.id, position_id: positionId } });
  const { count: asgCount } = await admin.from("workforce_assignments").select("id", { count: "exact", head: true }).eq("employee_id", emp.id).eq("position_id", positionId);
  const { count: regCount } = await admin.from("workspace_registry").select("id", { count: "exact", head: true }).eq("employee_id", emp.id);
  check("Re-assign is idempotent (no dup assignment/workspaces)", asgCount === 1 && regCount === 2, `${asgCount} assignment, ${regCount} workspaces`);

  // ── Permission — a non-admin cannot assign
  const forbid = await api("POST", "/api/workforce/assignments", { cookie: empCookie, json: { employee_id: emp.id, position_id: positionId } });
  check("Non-admin cannot assign (permission)", forbid.status === 403, `status ${forbid.status}`);

  // ── Termination — archives workspaces, recomputes roles, closes employment
  const { data: asgRow } = await admin.from("workforce_assignments").select("id").eq("employee_id", emp.id).eq("position_id", positionId).single();
  const term = await api("PATCH", `/api/workforce/assignments?id=${asgRow.id}`, { cookie, json: { action: "terminate", reason: "Test offboard" } });
  check("Terminate assignment", term.status === 200, `status ${term.status}`);
  const { data: prof2 } = await admin.from("profiles").select("roles").eq("id", emp.id).single();
  check("Roles recomputed after termination (workspaces dropped)", !(prof2?.roles ?? []).includes("educator"), `roles [${(prof2?.roles ?? []).join(", ")}]`);
  const { data: er2 } = await admin.from("employment_records").select("end_date").eq("nurse_id", emp.id).eq("hospital_id", hosp.id).limit(1).maybeSingle();
  check("Employment record closed on termination", !!er2?.end_date, er2?.end_date || "still open");
}

(async () => {
  let ok = true;
  try { await run(); } catch (e) { console.error("\nHARNESS ERROR:", e.message); ok = false; }
  finally { await cleanup(); }
  const pass = results.filter(r => r.pass).length, fail = results.length - pass;
  console.log(`\n================ WORKFORCE ENGINE TEST ================`);
  console.log(`${results.length} checks · ${pass} passed · ${fail} failed`);
  if (fail) for (const r of results.filter(x => !x.pass)) console.log(`  * ${r.name} — ${r.detail}`);
  process.exit(ok && fail === 0 ? 0 : 1);
})();
