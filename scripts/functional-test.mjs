// Functional test battery for the Nurse Workspace ("Functionality Testing of
// the Nurse Work Space" guide). Creates two throwaway .test accounts (nurse +
// assessor) in the demo hospital, signs in through the app's own /api/auth/login,
// then exercises pages, APIs, workflows, permissions, RLS isolation and data
// integrity. Cleans up everything it created at the end (pass --keep to skip).
//
//   node scripts/functional-test.mjs            # run (needs dev server on :3000)
//   node scripts/functional-test.mjs --keep     # keep test accounts/data for inspection
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = "http://localhost:3000";
const KEEP = process.argv.includes("--keep");

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const HOSPITAL = "0b16a1aa-c6dd-4e91-bf9f-df68958c5efa"; // F-Care Mbale
const ORG = "29c2eb7e-a342-423c-8bd0-adb017e438c2"; // F-Care Group Test

const results = [];
let created = { nurse: null, assessor: null, logEntry: null };
function record(section, name, pass, note = "") {
  results.push({ section, name, pass, note });
  console.log(`${pass ? "  PASS" : "* FAIL"}  [${section}] ${name}${note ? " — " + note : ""}`);
}

async function makeUser(email, fullName, role) {
  const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const old = (page?.users ?? []).find(u => u.email === email);
  if (old) { await admin.from("profiles").delete().eq("id", old.id); await admin.auth.admin.deleteUser(old.id); }
  const password = "Test-" + randomBytes(9).toString("base64url");
  const { data: u, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error) throw new Error("createUser " + email + ": " + error.message);
  const { error: perr } = await admin.from("profiles").upsert({
    id: u.user.id, email, full_name: fullName, role, roles: [role],
    hospital_id: HOSPITAL, organisation_id: ORG,
  });
  if (perr) throw new Error("profile " + email + ": " + perr.message);
  return { id: u.user.id, email, password };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookies = (res.headers.getSetCookie?.() ?? [])
    .map(c => c.split(";")[0]).filter(c => !c.endsWith("=")).join("; ");
  return { status: res.status, cookies, body: await res.json().catch(() => ({})) };
}

const get = (path, cookies) => fetch(BASE + path, { headers: cookies ? { Cookie: cookies } : {}, redirect: "manual" });
const send = (method, path, cookies, body) => fetch(BASE + path, {
  method, headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
  body: JSON.stringify(body), redirect: "manual",
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("Setting up test accounts…");
created.nurse = await makeUser("testnurse@competen.test", "Test Nurse", "nurse");
created.assessor = await makeUser("testassessor@competen.test", "Test Assessor", "assessor");

// PHASE 1 — Authentication
const bad = await login(created.nurse.email, "wrong-password");
record("auth", "wrong password rejected", bad.status === 400, `status ${bad.status}`);
const nurse = await login(created.nurse.email, created.nurse.password);
record("auth", "nurse login sets session cookies", nurse.status === 200 && nurse.cookies.includes("auth-token"), `status ${nurse.status}`);
const assessor = await login(created.assessor.email, created.assessor.password);
record("auth", "assessor login", assessor.status === 200 && assessor.cookies.includes("auth-token"), `status ${assessor.status}`);
const unauthPage = await get("/dashboard");
record("auth", "unauthenticated /dashboard redirects", [302, 303, 307, 308].includes(unauthPage.status),
  `status ${unauthPage.status} → ${unauthPage.headers.get("location") ?? "?"}`);

// PHASE 2 — Every nurse-workspace page renders
const [{ data: ko }, { data: cc }, { data: cpu }, { data: course }, { data: bank }] = await Promise.all([
  admin.from("knowledge_objects").select("id").neq("status", "retired").limit(1).single(),
  admin.from("clinical_cases").select("id").neq("status", "retired").limit(1).single(),
  admin.from("clinical_practice_units").select("id").limit(1).single(),
  admin.from("courses").select("id").limit(1).single(),
  admin.from("question_banks").select("id").limit(1).single(),
]);
const PAGES = [
  ["/dashboard", "👋"], // h1 is a personal greeting — "Good …, <name> 👋"
  ["/dashboard/passport", "Competency Passport"],
  ["/dashboard/learning", "Learning Pathway"],
  ["/dashboard/cpu", "My CPUs"],
  ["/dashboard/logbook", "Clinical Skills Logbook"],
  ["/dashboard/library", "Clinical Library"],
  ["/dashboard/assessments", "Assessment Centre"],
  ["/dashboard/osce", "OSCE"],
  ["/dashboard/questions", "Knowledge Assessment Centre"],
  ["/dashboard/knowledge", "Knowledge Hub"],
  ["/dashboard/copilot", "AI Clinical Coach"],
  ["/dashboard/simulation", "Simulation Lab"],
  ["/dashboard/career", "Career Growth"],
  ["/dashboard/courses", "CPD Academy"],
  ["/dashboard/cpd", "CPD Log"],
  ["/dashboard/feedback", "My Feedback"],
  ["/dashboard/certificates", "Certificates"],
  ["/dashboard/audit", "Clinical Competency Assessment"],
  ["/dashboard/audit/concurrent", "Concurrent Audit"],
  ["/dashboard/audit/chart", "Retrospective Chart Audit"],
  ["/dashboard/billing", "Subscription"],
  ["/dashboard/passport/print", "Passport"],
  ...(ko ? [[`/dashboard/knowledge/${ko.id}`, ""]] : []),
  ...(cc ? [[`/dashboard/knowledge/case/${cc.id}`, ""]] : []),
  ...(cpu ? [[`/dashboard/cpu/${cpu.id}`, ""]] : []),
  ...(course ? [[`/dashboard/courses/${course.id}`, ""]] : []),
  ...(bank ? [[`/dashboard/tests/${bank.id}`, ""]] : []),
];
for (const [path, marker] of PAGES) {
  try {
    const res = await get(path, nurse.cookies);
    const html = await res.text();
    const ok = res.status === 200 && (!marker || html.includes(marker)) && !html.includes("Application error");
    record("pages", path, ok, `status ${res.status}${marker && !html.includes(marker) ? ", marker missing" : ""}`);
  } catch (e) { record("pages", path, false, String(e).slice(0, 80)); }
}

// PHASE 3 — Workflows
// 3a. Logbook: nurse logs a skill → self-verify blocked → assessor verifies
let r = await send("POST", "/api/logbook", nurse.cookies, {
  skill_name: "TEST — IV cannulation (functional test)", supervision_level: "supervised", location: "Test Ward",
});
let body = await r.json().catch(() => ({}));
created.logEntry = body.id ?? null;
record("workflow:logbook", "nurse logs a skill (POST)", r.status === 201 && !!body.id, `status ${r.status}`);

const { data: entry } = created.logEntry
  ? await admin.from("skill_log_entries").select("status, nurse_id").eq("id", created.logEntry).single()
  : { data: null };
record("workflow:logbook", "entry stored as pending", entry?.status === "pending", `status=${entry?.status}`);

r = await send("PATCH", "/api/logbook", nurse.cookies, { id: created.logEntry, status: "verified" });
record("workflow:logbook", "nurse cannot verify (role gate)", r.status === 403, `status ${r.status}`);
r = await send("PATCH", "/api/logbook", assessor.cookies, { id: created.logEntry, status: "verified", comment: "Functional test verification" });
record("workflow:logbook", "assessor verifies entry", r.status === 200, `status ${r.status}`);
const { data: entry2 } = created.logEntry
  ? await admin.from("skill_log_entries").select("status, verified_by").eq("id", created.logEntry).single()
  : { data: null };
record("workflow:logbook", "entry now verified with verifier stamped",
  entry2?.status === "verified" && entry2?.verified_by === created.assessor.id, `status=${entry2?.status}`);
const { data: auditRows } = await admin.from("audit_log").select("action").eq("actor_id", created.nurse.id).eq("action", "log_skill");
record("workflow:logbook", "audit event recorded", (auditRows ?? []).length > 0, `${auditRows?.length ?? 0} audit rows`);

// 3a-ii. Conflict of interest: assessor cannot verify their OWN entry
r = await send("POST", "/api/logbook", assessor.cookies, { skill_name: "TEST — assessor own skill", supervision_level: "independent" });
body = await r.json().catch(() => ({}));
r = await send("PATCH", "/api/logbook", assessor.cookies, { id: body.id, status: "verified" });
record("workflow:logbook", "assessor cannot verify own entry (conflict of interest)", r.status === 400, `status ${r.status}`);

// 3b. CPD: log an activity, confirm it lands and is user-scoped; invalid input rejected
r = await send("POST", "/api/cpd", nurse.cookies, { activity_type: "course", title: "TEST — Functional test CPD", hours: 2.5 });
record("workflow:cpd", "nurse logs CPD activity", r.status === 200, `status ${r.status}`);
const { data: cpdRow } = await admin.from("cpd_logs").select("hours, user_id").eq("user_id", created.nurse.id);
record("workflow:cpd", "CPD row stored with hours", cpdRow?.length === 1 && Number(cpdRow[0].hours) === 2.5, JSON.stringify(cpdRow?.[0] ?? null));
r = await send("POST", "/api/cpd", nurse.cookies, { activity_type: "course", title: "TEST — bad hours", hours: "abc" });
record("workflow:cpd", "non-numeric hours rejected", r.status === 400, `status ${r.status}`);
r = await send("POST", "/api/cpd", nurse.cookies, { activity_type: "course", title: "TEST — negative hours", hours: -5 });
record("workflow:cpd", "negative hours rejected", r.status === 400, `status ${r.status}`);

// 3c. Quiz attempt — correctness must be computed server-side
const { data: q } = await admin.from("questions").select("id, correct_answer").is("bank_id", null).limit(1).single();
if (q) {
  r = await send("POST", "/api/quiz/attempt", nurse.cookies, { question_id: q.id, selected_answer: q.correct_answer, is_correct: true });
  const { data: qa } = await admin.from("quiz_attempts").select("is_correct").eq("user_id", created.nurse.id);
  record("workflow:quiz", "practice attempt recorded", r.status === 200 && (qa ?? []).length === 1, `status ${r.status}, rows ${qa?.length}`);
  // Wrong answer, client falsely claims correct — server must store false
  const wrong = "definitely-not-the-answer-" + Date.now();
  r = await send("POST", "/api/quiz/attempt", nurse.cookies, { question_id: q.id, selected_answer: wrong, is_correct: true });
  const { data: qa2 } = await admin.from("quiz_attempts").select("is_correct, selected_answer").eq("user_id", created.nurse.id).eq("selected_answer", wrong).single();
  record("workflow:quiz", "client cannot fake correctness (server-side scoring)",
    r.status === 200 && qa2?.is_correct === false, `stored is_correct=${qa2?.is_correct}`);
} else record("workflow:quiz", "practice attempt recorded", false, "no practice questions found");

// 3d. Library governed search
r = await get("/api/library?q=hygiene", nurse.cookies);
body = await r.json().catch(() => ({}));
record("workflow:library", "governed search returns hits", r.status === 200 && Array.isArray(body.hits) && body.hits.length > 0, `${body.hits?.length ?? 0} hits`);

// 3e. AI Copilot streams (minimal prompt, abort after first chunk)
try {
  const ctl = new AbortController();
  const res = await fetch(BASE + "/api/copilot", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: nurse.cookies },
    body: JSON.stringify({ messages: [{ role: "user", content: "Reply with the single word: ready" }] }),
    signal: ctl.signal,
  });
  let first = "";
  if (res.ok && res.body) {
    const reader = res.body.getReader();
    const { value } = await reader.read();
    first = new TextDecoder().decode(value ?? new Uint8Array());
    ctl.abort();
  }
  record("workflow:ai", "copilot streams a response", res.status === 200 && first.includes("data:"), `status ${res.status}`);
} catch (e) { record("workflow:ai", "copilot streams a response", false, String(e).slice(0, 80)); }

// PHASE 4 — Permissions & tenant isolation
r = await get("/api/super-admin/users/list", nurse.cookies);
record("permissions", "nurse blocked from super-admin API", [401, 403].includes(r.status), `status ${r.status}`);
r = await send("POST", "/api/content/frameworks", nurse.cookies, { name: "TEST should fail" });
record("permissions", "nurse blocked from content authoring", [401, 403].includes(r.status), `status ${r.status}`);
r = await send("POST", "/api/logbook", "", { skill_name: "x", supervision_level: "observed" });
record("permissions", "unauthenticated API rejected", r.status === 401, `status ${r.status}`);

// RLS: anonymous client sees nothing
const a = anon();
const { data: anonProfiles } = await a.from("profiles").select("id").limit(5);
record("rls", "anonymous cannot read profiles", (anonProfiles ?? []).length === 0, `${anonProfiles?.length ?? 0} rows`);
const { data: anonDecisions } = await a.from("competency_decisions").select("id").limit(5);
record("rls", "anonymous cannot read decisions", (anonDecisions ?? []).length === 0, `${anonDecisions?.length ?? 0} rows`);

// RLS: a signed-in nurse cannot read another nurse's records
const nurseClient = anon();
await nurseClient.auth.signInWithPassword({ email: created.nurse.email, password: created.nurse.password });
const { data: grace } = await admin.from("profiles").select("id").eq("full_name", "Grace Wanjiru").single();
if (grace) {
  const { data: cross } = await nurseClient.from("competency_decisions").select("id").eq("nurse_id", grace.id).limit(5);
  record("rls", "nurse cannot read another nurse's decisions", (cross ?? []).length === 0, `${cross?.length ?? 0} rows`);
  const { data: crossLog } = await nurseClient.from("skill_log_entries").select("id").eq("nurse_id", grace.id).limit(5);
  record("rls", "nurse cannot read another nurse's logbook", (crossLog ?? []).length === 0, `${crossLog?.length ?? 0} rows`);
}
const { data: own } = await nurseClient.from("skill_log_entries").select("id").eq("nurse_id", created.nurse.id);
record("rls", "nurse can read their own logbook", (own ?? []).length === 1, `${own?.length ?? 0} rows`);

// PHASE 5 — Entity register (doc §3) and data integrity
const ENTITIES = [
  "profiles", "hospitals", "organisations", "employment_records",
  "frameworks", "framework_domains", "clinical_practices", "clinical_practice_units",
  "framework_competencies", "competency_skills", "benner_scale",
  "competency_cycles", "assessments", "competency_decisions", "competency_scores", "skill_scores",
  "question_banks", "questions", "quiz_attempts", "knowledge_attempts",
  "knowledge_objects", "clinical_cases", "policies", "quality_objects",
  "cpd_logs", "courses", "course_enrollments", "pathway_items",
  "professional_credentials", "professional_recognitions", "clinical_authorizations",
  "skill_log_entries", "audit_log",
];
const missing = [];
for (const t of ENTITIES) {
  const { error } = await admin.from(t).select("*", { count: "exact", head: true });
  if (error) missing.push(t);
}
record("entities", `${ENTITIES.length} core entities exist`, missing.length === 0, missing.length ? "missing: " + missing.join(", ") : "all present");

// Integrity: orphaned references
const [{ data: decs }, { data: comps }, { data: cycles2 }, { data: assess2 }] = await Promise.all([
  admin.from("competency_decisions").select("id, competency_id, nurse_id"),
  admin.from("framework_competencies").select("id"),
  admin.from("competency_cycles").select("id, nurse_id"),
  admin.from("assessments").select("id, cycle_id, competency_id"),
]);
const compIds = new Set((comps ?? []).map(c => c.id));
const cycleIds = new Set((cycles2 ?? []).map(c => c.id));
const orphanDecs = (decs ?? []).filter(d => d.competency_id && !compIds.has(d.competency_id));
record("integrity", "decisions reference real competencies", orphanDecs.length === 0, `${orphanDecs.length} orphans of ${decs?.length ?? 0}`);
const orphanAssess = (assess2 ?? []).filter(x => x.cycle_id && !cycleIds.has(x.cycle_id));
record("integrity", "assessments reference real cycles", orphanAssess.length === 0, `${orphanAssess.length} orphans of ${assess2?.length ?? 0}`);
const { data: kos } = await admin.from("knowledge_objects").select("id, title, content").neq("status", "retired");
const emptyKos = (kos ?? []).filter(k => !k.content?.trim());
record("integrity", "published knowledge objects have content", emptyKos.length === 0,
  emptyKos.length ? `${emptyKos.length} empty: ${emptyKos.slice(0, 3).map(k => k.title).join("; ")}` : `${kos?.length ?? 0} checked`);

// Duplicate sibling sort_orders (builder reorder bug class)
async function dupCheck(table, parentCol) {
  const { data } = await admin.from(table).select(`id, ${parentCol}, sort_order`);
  const seen = new Map(); let dups = 0;
  for (const row of data ?? []) {
    const k = row[parentCol] + ":" + row.sort_order;
    if (seen.has(k)) dups++; else seen.set(k, true);
  }
  return { dups, total: (data ?? []).length };
}
for (const [t, p] of [["framework_domains", "framework_id"], ["clinical_practices", "domain_id"], ["clinical_practice_units", "practice_id"]]) {
  const { dups, total } = await dupCheck(t, p);
  record("integrity", `${t} sibling sort_orders unique`, dups === 0, `${dups} duplicates of ${total}`);
}

// PHASE 6 — Cleanup
if (!KEEP) {
  console.log("\nCleaning up test data…");
  for (const uid of [created.nurse.id, created.assessor.id]) {
    await admin.from("skill_log_entries").delete().eq("nurse_id", uid);
    await admin.from("cpd_logs").delete().eq("user_id", uid);
    await admin.from("quiz_attempts").delete().eq("user_id", uid);
    await admin.from("audit_log").delete().eq("actor_id", uid);
    await admin.from("profiles").delete().eq("id", uid);
    await admin.auth.admin.deleteUser(uid);
  }
  console.log("Removed test accounts and their data.");
} else {
  console.log(`\n--keep: test accounts left in place (${created.nurse.email} / ${created.assessor.email})`);
}

// Summary
const fails = results.filter(x => !x.pass);
console.log(`\n${"─".repeat(60)}\n${results.length} checks · ${results.length - fails.length} passed · ${fails.length} failed`);
if (fails.length) { console.log("\nFailures:"); for (const f of fails) console.log(`  ✗ [${f.section}] ${f.name} — ${f.note}`); }
process.exit(fails.length ? 1 : 0);
