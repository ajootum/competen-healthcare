// COMPETEN — Cross-Workspace Interaction Test harness
// Executes the "COMPETEN EDUCATOR WORKSPACE Interaction Testing" spec against the
// LIVE deployed app. Seeds two isolated tenants + the required role accounts,
// drives the real API routes as each role (cookie sessions), and asserts the
// cross-workspace behaviour: same record surfaces across role-scoped views,
// controlled status transitions, notifications, tenant isolation, permission
// denials, separation of duties, no-duplication, and audit.
//
// Everything is created under @interaction.test in FRESH hospitals/orgs so it
// cannot collide with the @competen.test functional battery, and is cleaned up.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.env.TEST_BASE || "https://competenhealthcare.com";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PW = "Ixn-" + randomBytes(9).toString("base64url");
const created = { users: [], hospitals: [], orgs: [], frameworks: [], courses: [] };
const results = [];
let currentGroup = "";
function group(g) { currentGroup = g; }
function check(specId, desc, pass, detail = "") {
  results.push({ group: currentGroup, specId, desc, pass: !!pass, detail });
  const tag = pass ? "  PASS" : "* FAIL";
  console.log(`${tag} [${specId}] ${desc}${detail ? "  — " + detail : ""}`);
  return !!pass;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const cookie = (r.headers.getSetCookie?.() ?? [])
    .map(c => c.split(";")[0]).filter(c => c && !c.endsWith("=")).join("; ");
  return cookie;
}
async function api(method, path, { cookie, json, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let body;
  if (form) { body = form; }
  else if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  const r = await fetch(BASE + path, { method, headers, body });
  let data = null;
  const txt = await r.text();
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { status: r.status, data };
}

// ── Seed ─────────────────────────────────────────────────────────────────────
async function mkUser(tag, role, roles, hospital_id, organisation_id, extra = {}) {
  const email = `ixn-${tag}@interaction.test`;
  // purge any prior
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const old = (data?.users ?? []).find(u => u.email === email);
    if (old) { await admin.from("profiles").delete().eq("id", old.id); await admin.auth.admin.deleteUser(old.id); }
  } catch {}
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const id = u.user.id;
  const { error: pe } = await admin.from("profiles").upsert({
    id, email, full_name: `IXN ${tag}`, role, roles, hospital_id, organisation_id, ...extra,
  });
  if (pe) throw new Error(`profile ${email}: ${pe.message}`);
  created.users.push(id);
  return { id, email, cookie: null, role, roles, hospital_id };
}

async function seed() {
  console.log(`\nSeeding two tenants on ${BASE} ...`);
  // Purge any leftover @interaction.test users from a prior run
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of (data?.users ?? []).filter(x => x.email?.endsWith("@interaction.test"))) {
      await admin.from("profiles").delete().eq("id", u.id); await admin.auth.admin.deleteUser(u.id);
    }
  } catch {}

  const { data: orgA } = await admin.from("organisations").insert({ name: "IXN Org A", hq_country: "Kenya" }).select("id").single();
  const { data: orgB } = await admin.from("organisations").insert({ name: "IXN Org B", hq_country: "Kenya" }).select("id").single();
  created.orgs.push(orgA.id, orgB.id);
  const { data: hA } = await admin.from("hospitals").insert({ name: "IXN Hospital A", country: "Kenya", organisation_id: orgA.id }).select("id").single();
  const { data: hB } = await admin.from("hospitals").insert({ name: "IXN Hospital B", country: "Kenya", organisation_id: orgB.id }).select("id").single();
  created.hospitals.push(hA.id, hB.id);

  const U = {};
  U.eduA   = await mkUser("eduA",   "educator",       ["educator"],            hA.id, orgA.id);
  U.assrA  = await mkUser("assrA",  "assessor",       ["assessor"],            hA.id, orgA.id, { is_senior_assessor: true });
  U.nurseA1= await mkUser("nurseA1","nurse",          ["nurse"],               hA.id, orgA.id);
  U.nurseA2= await mkUser("nurseA2","nurse",          ["nurse"],               hA.id, orgA.id);
  U.adminA = await mkUser("adminA", "hospital_admin", ["hospital_admin"],      hA.id, orgA.id);
  U.dualAE = await mkUser("dualAE", "educator",       ["educator","assessor"], hA.id, orgA.id);
  U.eduB   = await mkUser("eduB",   "educator",       ["educator"],            hB.id, orgB.id);
  U.assrB  = await mkUser("assrB",  "assessor",       ["assessor"],            hB.id, orgB.id);
  U.nurseB1= await mkUser("nurseB1","nurse",          ["nurse"],               hB.id, orgB.id);

  // Content in tenant A: framework -> domain -> 2 competencies
  const { data: fA } = await admin.from("frameworks").insert({ name: "IXN Framework A", library: "core", hospital_id: hA.id }).select("id").single();
  created.frameworks.push(fA.id);
  const { data: dA } = await admin.from("framework_domains").insert({ framework_id: fA.id, name: "IXN Domain A" }).select("id").single();
  const { data: cA } = await admin.from("framework_competencies").insert({ domain_id: dA.id, name: "IXN Competency A1" }).select("id").single();
  const { data: cA2 } = await admin.from("framework_competencies").insert({ domain_id: dA.id, name: "IXN Competency A2" }).select("id").single();
  // Content in tenant B
  const { data: fB } = await admin.from("frameworks").insert({ name: "IXN Framework B", library: "core", hospital_id: hB.id }).select("id").single();
  created.frameworks.push(fB.id);
  const { data: dB } = await admin.from("framework_domains").insert({ framework_id: fB.id, name: "IXN Domain B" }).select("id").single();
  const { data: cB } = await admin.from("framework_competencies").insert({ domain_id: dB.id, name: "IXN Competency B1" }).select("id").single();

  // Cycles
  const { data: cycA } = await admin.from("competency_cycles").insert({ nurse_id: U.nurseA1.id, hospital_id: hA.id, cycle_type: "annual", created_by: U.eduA.id }).select("id").single();
  const { data: cycB } = await admin.from("competency_cycles").insert({ nurse_id: U.nurseB1.id, hospital_id: hB.id, cycle_type: "annual", created_by: U.eduB.id }).select("id").single();

  // A course for the enroll-dedupe test
  const { data: course } = await admin.from("courses").insert({ title: "IXN Course", category: "General", is_published: true }).select("id").single();
  created.courses.push(course.id);

  // Log in everyone
  for (const k of Object.keys(U)) U[k].cookie = await login(U[k].email);

  return { U, hA, hB, orgA, orgB, comp: { cA: cA.id, cA2: cA2.id, cB: cB.id }, cyc: { A: cycA.id, B: cycB.id }, course: course.id };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log("\nCleaning up ...");
  try { await admin.from("competency_cycles").delete().in("hospital_id", created.hospitals); } catch {}
  try { await admin.from("frameworks").delete().in("id", created.frameworks); } catch {}
  try { await admin.from("audit_log").delete().in("actor_id", created.users); } catch {}
  try { await admin.from("notifications").delete().in("user_id", created.users); } catch {}
  try { await admin.from("courses").delete().in("id", created.courses); } catch {}
  for (const id of created.users) { try { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); } catch {} }
  try { await admin.from("hospitals").delete().in("id", created.hospitals); } catch {}
  try { await admin.from("organisations").delete().in("id", created.orgs); } catch {}
  console.log("Cleanup done.");
}

// ── Tests ────────────────────────────────────────────────────────────────────
async function run() {
  const S = await seed();
  const { U, comp, cyc } = S;
  const future = new Date(); future.setDate(future.getDate() + 7);
  const notifTypes = async (cookie) => {
    const r = await api("GET", "/api/notifications", { cookie });
    const rows = Array.isArray(r.data?.notifications) ? r.data.notifications : (Array.isArray(r.data) ? r.data : []);
    return rows.map(n => n.type);
  };

  // GROUP 1 — Educator pushes a competency cycle; record exists for the nurse
  group("1. Educator→HW: cycle creation (INT-EHA-001, PERMISSION assign)");
  {
    const r = await api("POST", "/api/cycles", { cookie: U.eduA.cookie, json: { nurse_id: U.nurseA1.id, cycle_type: "annual" } });
    check("INT-EHA-001a", "Educator creates a competency cycle for own-hospital nurse", r.status === 201, `status ${r.status}`);
  }

  // GROUP 2 — Assessor conducts assessment; result reaches educator + HW
  group("2. Assessor conducts (INT-AE-003, §6.5, §20.3)");
  {
    const body = { cycle_id: cyc.A, nurse_id: U.nurseA1.id, method: "direct_observation", attest: true, recommendation: "competent", scores: [{ competency_id: comp.cA, score: 5 }, { competency_id: comp.cA2, score: 5 }] };
    const r = await api("POST", "/api/assess/submit", { cookie: U.assrA.cookie, json: body });
    check("INT-AE-003", "Assessor submits scored assessment", r.status === 200 || r.status === 201, `status ${r.status}`);

    const { data: arows } = await admin.from("assessments").select("id, status, score").eq("cycle_id", cyc.A);
    check("INT-06.1", "One assessment row per competency, status=complete (no duplicate)", (arows?.length ?? 0) === 2 && arows.every(a => a.status === "complete"), `${arows?.length} rows`);

    const nt = await notifTypes(U.nurseA1.cookie);
    check("INT-AHW-002n", "HW is notified of the submitted assessment (assessor→HW)", nt.includes("assessment_submitted"), nt.join(","));

    // Negatives
    const self = await api("POST", "/api/assess/submit", { cookie: U.assrA.cookie, json: { ...body, nurse_id: U.assrA.id } });
    check("INT-6.5a", "Assessor cannot assess self (separation of duties)", self.status === 400, `status ${self.status}`);
    const xhosp = await api("POST", "/api/assess/submit", { cookie: U.assrB.cookie, json: body });
    check("INT-19a", "Cross-tenant assessor cannot conduct on tenant-A cycle", xhosp.status === 403 || xhosp.status === 404, `status ${xhosp.status}`);
    const noAttest = await api("POST", "/api/assess/submit", { cookie: U.assrA.cookie, json: { ...body, attest: false } });
    check("INT-20.3a", "Submission without attestation rejected", noAttest.status === 400, `status ${noAttest.status}`);
    const badScore = await api("POST", "/api/assess/submit", { cookie: U.assrA.cookie, json: { ...body, scores: [{ competency_id: comp.cA, score: 9 }] } });
    check("INT-20.3b", "Score out of 0–6 range rejected", badScore.status === 400, `status ${badScore.status}`);
    const nursePost = await api("POST", "/api/assess/submit", { cookie: U.nurseA1.cookie, json: body });
    check("INT-18a", "HW cannot conduct assessment (permission)", nursePost.status === 403, `status ${nursePost.status}`);
  }

  // GROUP 3 — Educator validates; decision generated; separation of duties
  group("3. Educator validates → decision (INT-EHA-001, §6.5)");
  let scoreId = null;
  {
    const { data: sc } = await admin.from("competency_scores").select("id").eq("cycle_id", cyc.A).eq("competency_id", comp.cA).maybeSingle();
    scoreId = sc?.id ?? null;
    check("INT-EHA-001b", "Assessor scores rolled up into competency_scores", !!scoreId, scoreId ? "score row present" : "MISSING");

    if (scoreId) {
      const asrValidate = await api("POST", "/api/educator/validate", { cookie: U.assrA.cookie, json: { competency_score_id: scoreId, action: "validate" } });
      check("INT-6.5b", "Assessor cannot validate a competency (separation of duties)", asrValidate.status === 403, `status ${asrValidate.status}`);
      const val = await api("POST", "/api/educator/validate", { cookie: U.eduA.cookie, json: { competency_score_id: scoreId, action: "validate" } });
      check("INT-EHA-001c", "Educator validates the competency score", val.status === 200, `status ${val.status}`);
    }

    const dec = await api("POST", `/api/cycles/${cyc.A}/decisions`, { cookie: U.eduA.cookie });
    check("INT-EHA-001d", "Educator finalizes competency decisions", dec.status === 200 && (dec.data?.created ?? 0) >= 1, `created ${dec.data?.created}`);

    const { data: drow } = await admin.from("competency_decisions").select("outcome, expiry_date, validation_outcome, decided_by").eq("cycle_id", cyc.A).eq("competency_id", comp.cA).maybeSingle();
    check("INT-EHA-001e", "Decision record written (passport source)", !!drow, drow ? `outcome=${drow.outcome}` : "MISSING");
    check("INT-14b", "Competent decision carries an expiry date", !!drow?.expiry_date, drow?.expiry_date || "none");
    check("INT-14c", "Decision is traceable to validator/date", !!drow?.decided_by && drow?.validation_outcome === "validated", `validation=${drow?.validation_outcome}`);

    const nt = await notifTypes(U.nurseA1.cookie);
    check("INT-AHW-002o", "HW notified when the decision is issued (decision→HW)", nt.includes("decisions_issued"), nt.join(","));

    const xdec = await api("POST", `/api/cycles/${cyc.A}/decisions`, { cookie: U.eduB.cookie });
    check("INT-19b", "Cross-tenant educator cannot finalize tenant-A decisions", xdec.status === 403 || xdec.status === 404, `status ${xdec.status}`);

    // No-duplicate: re-run decisions, count stays at competency count
    await api("POST", `/api/cycles/${cyc.A}/decisions`, { cookie: U.eduA.cookie });
    const { count } = await admin.from("competency_decisions").select("id", { count: "exact", head: true }).eq("cycle_id", cyc.A);
    check("INT-6.1b", "Re-running decisions does not duplicate records", (count ?? 0) === 2, `${count} decisions for 2 competencies`);
  }

  // GROUP 4 — Data consistency + confidential-notes hiding (§22, §14.2)
  group("4. Data consistency & confidentiality (§22, §14.2)");
  {
    // "Latest decision" as the app computes it: newest competency_decisions row
    // per (nurse, competency). (The latest_decisions VIEW is not exposed to the
    // data API and is read nowhere in app code; the passport is assembled from
    // competency_decisions directly.)
    const { data: allDec } = await admin.from("competency_decisions")
      .select("outcome, created_at").eq("nurse_id", U.nurseA1.id).eq("competency_id", comp.cA)
      .order("created_at", { ascending: false });
    const latestOutcome = allDec?.[0]?.outcome;
    const { data: drow } = await admin.from("competency_decisions").select("outcome").eq("cycle_id", cyc.A).eq("competency_id", comp.cA).maybeSingle();
    check("INT-22a", "Latest decision per nurse+competency is consistent across the record (no conflicting status)", !!latestOutcome && latestOutcome === drow?.outcome, `${latestOutcome} == ${drow?.outcome}`);
    const nurseAssess = await api("GET", "/api/assessments", { cookie: U.nurseA1.cookie });
    check("INT-14.2a", "HW cannot read raw assessment scores/notes via API (confidential)", nurseAssess.status === 403, `status ${nurseAssess.status}`);
  }

  // GROUP 5 — Tenant isolation (§19, release-blocking)
  group("5. Tenant isolation (§19 — release-blocking)");
  {
    const { data: aIds } = await admin.from("assessments").select("id").eq("cycle_id", cyc.A);
    const tenantAIds = new Set((aIds ?? []).map(a => a.id));
    const eduBAssess = await api("GET", "/api/assessments", { cookie: U.eduB.cookie });
    const bSees = Array.isArray(eduBAssess.data) ? eduBAssess.data : (eduBAssess.data?.data ?? []);
    const leak = (Array.isArray(bSees) ? bSees : []).some(a => tenantAIds.has(a.id));
    check("INT-19c", "Tenant-B educator's /api/assessments excludes tenant-A rows", !leak, leak ? "LEAK" : "clean");

    const eduBCycles = await api("GET", "/api/cycles", { cookie: U.eduB.cookie });
    const bCyc = Array.isArray(eduBCycles.data) ? eduBCycles.data : (eduBCycles.data?.data ?? []);
    const cycLeak = (Array.isArray(bCyc) ? bCyc : []).some(c => c.id === cyc.A);
    check("INT-19d", "Tenant-B educator's /api/cycles excludes tenant-A cycle", !cycLeak, cycLeak ? "LEAK" : "clean");

    const eduACycles = await api("GET", "/api/cycles", { cookie: U.eduA.cookie });
    const aCyc = Array.isArray(eduACycles.data) ? eduACycles.data : (eduACycles.data?.data ?? []);
    const seesOwn = (Array.isArray(aCyc) ? aCyc : []).some(c => c.id === cyc.A);
    const seesB = (Array.isArray(aCyc) ? aCyc : []).some(c => c.id === cyc.B);
    check("INT-19e", "Tenant-A educator sees own cycle but not tenant-B cycle", seesOwn && !seesB, `own=${seesOwn} B=${seesB}`);

    const crossCycle = await api("POST", "/api/cycles", { cookie: U.eduB.cookie, json: { nurse_id: U.nurseA1.id, cycle_type: "annual" } });
    check("INT-19f", "Tenant-B educator cannot create a cycle for a tenant-A nurse", crossCycle.status === 403 || crossCycle.status === 404, `status ${crossCycle.status}`);

    const search = await api("GET", `/api/educator/search?q=${encodeURIComponent("IXN nurseA1")}`, { cookie: U.eduB.cookie });
    const learners = search.data?.learners ?? [];
    const learnerLeak = learners.some(l => l.id === U.nurseA1.id);
    check("INT-19g", "Tenant-B educator search does not surface tenant-A learners", !learnerLeak, learnerLeak ? "LEAK" : "clean");

    // Known-gap probe: does search content arm leak cross-tenant competencies?
    const searchComp = await api("GET", `/api/educator/search?q=${encodeURIComponent("IXN Competency A")}`, { cookie: U.eduB.cookie });
    const comps = searchComp.data?.competencies ?? [];
    const compLeak = comps.some(c => c.id === comp.cA || c.id === comp.cA2);
    check("INT-19h", "Search content arm does not surface tenant-A competencies (known-gap probe)", !compLeak, compLeak ? "LEAK (content arm global)" : "clean");
  }

  // GROUP 6 — Permission matrix + role union (§18, §17)
  group("6. Permissions & role model (§18, §17)");
  {
    const c1 = await api("POST", "/api/cycles", { cookie: U.nurseA1.cookie, json: { nurse_id: U.nurseA1.id, cycle_type: "annual" } });
    check("INT-18b", "HW cannot create a cycle (assign learning = No)", c1.status === 403, `status ${c1.status}`);
    const c2 = await api("POST", "/api/content/frameworks", { cookie: U.nurseA1.cookie, json: { name: "x" } });
    check("INT-18c", "HW cannot create framework content", c2.status === 403, `status ${c2.status}`);
    const c3 = await api("POST", "/api/schedule", { cookie: U.nurseA1.cookie, json: { nurse_id: U.nurseA1.id, scheduled_for: future.toISOString() } });
    check("INT-18d", "HW cannot schedule an assessment", c3.status === 403, `status ${c3.status}`);
    // Dual-role user exercises both roles (union authorization; §17)
    const dCyc = await api("POST", "/api/cycles", { cookie: U.dualAE.cookie, json: { nurse_id: U.nurseA1.id, cycle_type: "specialty" } });
    const dAss = await api("POST", "/api/assess/submit", { cookie: U.dualAE.cookie, json: { cycle_id: cyc.A, nurse_id: U.nurseA1.id, method: "direct_observation", attest: true, recommendation: "competent", scores: [{ competency_id: comp.cA, score: 4 }] } });
    check("INT-17a", "Dual educator+assessor user can act in BOTH roles (role union)", dCyc.status === 201 && (dAss.status === 200 || dAss.status === 201), `cycle=${dCyc.status} assess=${dAss.status}`);
  }

  // GROUP 7 — Logbook (HW logs → verifier) (INT-HWE-003, INT-AE-005, §6.5)
  group("7. Skills logbook (HW→assessor, §6.5, INT-AE-005)");
  {
    const log = await api("POST", "/api/logbook", { cookie: U.nurseA1.cookie, json: { skill_name: "IXN cannulation", supervision_level: "supervised" } });
    const entryId = log.data?.id;
    check("INT-HWE-003a", "HW logs a skill (status pending)", (log.status === 200 || log.status === 201) && !!entryId, `status ${log.status}`);

    const vt = await notifTypes(U.assrA.cookie);
    check("INT-HWE-003b", "Verifier is notified of the pending logbook entry (HW→assessor)", vt.includes("logbook_pending"), vt.join(","));

    if (entryId) {
      const selfVerify = await api("PATCH", "/api/logbook", { cookie: U.nurseA1.cookie, json: { id: entryId, status: "verified" } });
      check("INT-6.5c", "HW cannot verify their own logbook entry", selfVerify.status === 400 || selfVerify.status === 403, `status ${selfVerify.status}`);
      const xVerify = await api("PATCH", "/api/logbook", { cookie: U.assrB.cookie, json: { id: entryId, status: "verified" } });
      check("INT-19i", "Cross-tenant assessor cannot verify a tenant-A logbook entry", xVerify.status === 403 || xVerify.status === 404, `status ${xVerify.status}`);
      const verify = await api("PATCH", "/api/logbook", { cookie: U.assrA.cookie, json: { id: entryId, status: "verified" } });
      check("INT-HWA-003a", "Assessor verifies the logbook entry", verify.status === 200, `status ${verify.status}`);
      const nt = await notifTypes(U.nurseA1.cookie);
      check("INT-HWA-004a", "HW is notified of the verification decision (assessor→HW)", nt.includes("logbook_verified"), nt.join(","));
    }
    // Escalation (INT-AE-005 partial)
    const log2 = await api("POST", "/api/logbook", { cookie: U.nurseA1.cookie, json: { skill_name: "IXN escalate", supervision_level: "assisted" } });
    if (log2.data?.id) {
      const esc = await api("PATCH", "/api/logbook", { cookie: U.assrA.cookie, json: { id: log2.data.id, status: "escalated", comment: "needs senior review" } });
      check("INT-AE-005", "Assessor can escalate an entry for senior review", esc.status === 200, `status ${esc.status}`);
    }
  }

  // GROUP 8 — Scheduling (assessor→HW invitation) (INT-EA-004, INT-AHW-001 partial)
  group("8. Scheduling (INT-EA-004, INT-AHW-001)");
  let schedId = null;
  {
    const s = await api("POST", "/api/schedule", { cookie: U.assrA.cookie, json: { nurse_id: U.nurseA1.id, competency_id: comp.cA, method: "direct_observation", scheduled_for: future.toISOString() } });
    schedId = s.data?.id;
    check("INT-AHW-001a", "Assessor schedules an assessment for the HW", (s.status === 200 || s.status === 201), `status ${s.status}`);
    const nt = await notifTypes(U.nurseA1.cookie);
    check("INT-AHW-001b", "HW receives the schedule invitation (assessor→HW)", nt.includes("assessment_scheduled"), nt.join(","));
    const xh = await api("POST", "/api/schedule", { cookie: U.assrA.cookie, json: { nurse_id: U.nurseB1.id, scheduled_for: future.toISOString() } });
    check("INT-19j", "Assessor cannot schedule a cross-tenant nurse", xh.status === 403, `status ${xh.status}`);
    const bad = await api("POST", "/api/schedule", { cookie: U.assrA.cookie, json: { nurse_id: U.nurseA1.id, scheduled_for: "not-a-date" } });
    check("INT-20.2a", "Invalid schedule date rejected", bad.status === 400, `status ${bad.status}`);
    if (schedId) {
      const xEdit = await api("PATCH", "/api/schedule", { cookie: U.assrB.cookie, json: { id: schedId, status: "cancelled" } });
      check("INT-19k", "Only the scheduling assessor can modify the session", xEdit.status === 403 || xEdit.status === 404, `status ${xEdit.status}`);
    }
  }

  // GROUP 9 — Messages + support (educator→HW; HW-support GAP evidence)
  group("9. Messaging & support (INT-EHW-007, INT-HWE-002 gap)");
  {
    const m = await api("POST", "/api/messages", { cookie: U.eduA.cookie, json: { recipient_id: U.nurseA1.id, text: "IXN hello" } });
    check("INT-EHW-007a", "Educator messages a same-hospital HW", (m.status === 200 || m.status === 201), `status ${m.status}`);
    const nt = await notifTypes(U.nurseA1.cookie);
    check("INT-EHW-007b", "HW receives the message notification (correct recipient)", nt.includes("message"), nt.join(","));
    const xm = await api("POST", "/api/messages", { cookie: U.eduA.cookie, json: { recipient_id: U.nurseB1.id, text: "IXN cross" } });
    check("INT-19l", "Educator cannot message a cross-tenant user", xm.status === 403, `status ${xm.status}`);
    const selfm = await api("POST", "/api/messages", { cookie: U.eduA.cookie, json: { recipient_id: U.eduA.id, text: "IXN self" } });
    check("INT-EHW-007c", "Self-message rejected", selfm.status === 400, `status ${selfm.status}`);
    const bigm = await api("POST", "/api/messages", { cookie: U.eduA.cookie, json: { recipient_id: U.nurseA1.id, text: "x".repeat(1001) } });
    check("INT-EHW-007d", "Over-length message rejected", bigm.status === 400, `status ${bigm.status}`);

    const ref = await api("POST", "/api/support/referrals", { cookie: U.eduA.cookie, json: { nurse_id: U.nurseA1.id, referred_to_id: U.assrA.id, reason: "IXN support" } });
    check("INT-8.2a", "Educator creates a learner support referral", (ref.status === 200 || ref.status === 201), `status ${ref.status}`);
    const hwRef = await api("POST", "/api/support/referrals", { cookie: U.nurseA1.cookie, json: { nurse_id: U.nurseA1.id, referred_to_id: U.assrA.id, reason: "IXN" } });
    check("INT-HWE-002a", "HW has NO support-request submit path (referrals are educator-only)", hwRef.status === 403, `status ${hwRef.status} (confirms gap: no HW-initiated support request)`);
    const hwSess = await api("POST", "/api/support/sessions", { cookie: U.nurseA1.cookie, json: { nurse_id: U.nurseA1.id, session_type: "coaching", scheduled_for: future.toISOString() } });
    check("INT-HWE-002b", "HW cannot self-book a support session", hwSess.status === 403, `status ${hwSess.status}`);
  }

  // GROUP 10 — Appeals (HW→reviewer)
  group("10. Appeals (HW→reviewer)");
  {
    const { data: a } = await admin.from("assessments").select("id").eq("cycle_id", cyc.A).limit(1).maybeSingle();
    if (a?.id) {
      const ap = await api("POST", "/api/appeals", { cookie: U.nurseA1.cookie, json: { assessment_id: a.id, reason: "IXN appeal reason" } });
      check("INT-HWA-004b", "HW can appeal their own assessment outcome", (ap.status === 200 || ap.status === 201), `status ${ap.status}`);
      const xap = await api("POST", "/api/appeals", { cookie: U.nurseA2.cookie, json: { assessment_id: a.id, reason: "IXN not mine" } });
      check("INT-19m", "HW cannot appeal another learner's assessment", xap.status === 403 || xap.status === 404, `status ${xap.status}`);
    } else {
      check("INT-HWA-004b", "HW can appeal their own assessment outcome", false, "no assessment to appeal");
    }
  }

  // GROUP 11 — Evidence file gating (§20.2)
  group("11. Evidence upload gating (§20.2)");
  {
    const fd = new FormData();
    fd.append("file", new Blob(["not a real allowed file"], { type: "text/plain" }), "evil.txt");
    const r = await api("POST", "/api/evidence", { cookie: U.nurseA1.cookie, form: fd });
    check("INT-20.2b", "Unsupported evidence file type rejected", r.status === 400, `status ${r.status}`);
  }

  // GROUP 12 — No-duplicate enrollment (§6.1)
  group("12. No-duplicate (§6.1)");
  {
    await api("POST", "/api/courses/enroll", { cookie: U.nurseA1.cookie, json: { course_id: S.course } });
    await api("POST", "/api/courses/enroll", { cookie: U.nurseA1.cookie, json: { course_id: S.course } });
    const { count } = await admin.from("course_enrollments").select("id", { count: "exact", head: true }).eq("user_id", U.nurseA1.id).eq("course_id", S.course);
    check("INT-6.1c", "Double course enrollment produces one record (dedupe)", (count ?? 0) === 1, `${count} enrollment(s)`);
  }

  // GROUP 13 — Verified-absence of unbuilt push routes
  group("13. Verified gaps (unbuilt spec flows)");
  {
    const p = await api("POST", "/api/learning/pathway-items", { cookie: U.eduA.cookie, json: { competency_id: comp.cA, nurse_id: U.nurseA1.id } });
    check("INT-EHW-001g", "No educator 'assign learning pathway' route (POST unsupported)", p.status === 404 || p.status === 405, `status ${p.status} (pathways are auto-generated, not assigned)`);
  }

  // GROUP 14 — Audit trail (§21)
  group("14. Audit trail (§21)");
  {
    const { data: rows } = await admin.from("audit_log").select("action").in("actor_id", created.users);
    const actions = new Set((rows ?? []).map(r => r.action));
    for (const [a, label] of [["conduct_assessment", "assessment conduct"], ["finalize_decisions", "decision finalize"], ["educator_validate", "validation"], ["schedule_assessment", "scheduling"], ["send_message", "message"], ["escalate_skill_entry", "escalation"]]) {
      check("INT-21:" + a, `Audit records ${label}`, actions.has(a), actions.has(a) ? "logged" : "MISSING");
    }
  }

  return S;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  let ok = true;
  try {
    await run();
  } catch (e) {
    console.error("\nHARNESS ERROR:", e.message);
    ok = false;
  } finally {
    await cleanup();
  }
  const pass = results.filter(r => r.pass).length;
  const fail = results.length - pass;
  console.log(`\n================ INTERACTION TEST SUMMARY ================`);
  console.log(`${results.length} checks · ${pass} passed · ${fail} failed`);
  if (fail) {
    console.log(`\nFailed checks:`);
    for (const r of results.filter(x => !x.pass)) console.log(`  * [${r.specId}] ${r.desc} — ${r.detail}`);
  }
  // machine-readable
  const fsmod = await import("node:fs");
  fsmod.writeFileSync(new URL("../.interaction-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exit(ok && fail === 0 ? 0 : 1);
})();
