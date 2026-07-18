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

// 3a-iii. Escalation to senior assessor (migration 031)
{
  const educator = await makeUser("testeducator@competen.test", "Test Educator", "educator");
  const eduLogin = await login(educator.email, educator.password);
  record("workflow:escalation", "educator login", eduLogin.status === 200, `status ${eduLogin.status}`);

  // Nurse logs an entry; the (non-senior) assessor escalates it
  r = await send("POST", "/api/logbook", nurse.cookies, { skill_name: "TEST — escalation demo", supervision_level: "assisted" });
  const escEntry = (await r.json().catch(() => ({}))).id;
  r = await send("PATCH", "/api/logbook", assessor.cookies, { id: escEntry, status: "escalated", comment: "Needs senior review" });
  const { data: escRow } = await admin.from("skill_log_entries").select("status, escalated_by").eq("id", escEntry).single();
  record("workflow:escalation", "assessor escalates an entry", r.status === 200 && escRow?.status === "escalated" && escRow?.escalated_by === created.assessor.id, `status=${escRow?.status}`);

  // Non-senior assessor cannot decide an escalated entry
  r = await send("PATCH", "/api/logbook", assessor.cookies, { id: escEntry, status: "verified" });
  record("workflow:escalation", "non-senior blocked from deciding escalated entry", r.status === 403, `status ${r.status}`);

  // Nurse cannot manage senior assessors; educator can
  r = await send("PATCH", "/api/senior-assessors", nurse.cookies, { user_id: created.assessor.id, senior: true });
  record("workflow:escalation", "nurse blocked from senior assignment", r.status === 403, `status ${r.status}`);
  r = await send("PATCH", "/api/senior-assessors", eduLogin.cookies, { user_id: created.assessor.id, senior: true });
  const { data: seniorRow } = await admin.from("profiles").select("is_senior_assessor").eq("id", created.assessor.id).single();
  record("workflow:escalation", "educator grants senior status", r.status === 200 && seniorRow?.is_senior_assessor === true, `senior=${seniorRow?.is_senior_assessor}`);
  const { data: grantNotif } = await admin.from("notifications").select("type").eq("user_id", created.assessor.id).eq("type", "senior_assessor_granted");
  record("workflow:escalation", "assessor notified of senior grant", (grantNotif ?? []).length === 1, `${grantNotif?.length ?? 0} notifications`);

  // Now-senior assessor decides the escalated entry
  r = await send("PATCH", "/api/logbook", assessor.cookies, { id: escEntry, status: "verified", comment: "Senior review complete" });
  const { data: escDone } = await admin.from("skill_log_entries").select("status").eq("id", escEntry).single();
  record("workflow:escalation", "senior assessor decides escalated entry", r.status === 200 && escDone?.status === "verified", `status=${escDone?.status}`);

  // Escalation notifications route to seniors: educator escalates a fresh entry
  r = await send("POST", "/api/logbook", nurse.cookies, { skill_name: "TEST — escalation notify demo", supervision_level: "observed" });
  const escEntry2 = (await r.json().catch(() => ({}))).id;
  await send("PATCH", "/api/logbook", eduLogin.cookies, { id: escEntry2, status: "escalated", comment: "TEST — routing check" });
  const { data: escNotif } = await admin.from("notifications").select("type").eq("user_id", created.assessor.id).eq("type", "logbook_escalated");
  record("workflow:escalation", "seniors notified of new escalation", (escNotif ?? []).length === 1, `${escNotif?.length ?? 0} notifications`);

  await admin.from("profiles").delete().eq("id", educator.id);
  await admin.auth.admin.deleteUser(educator.id);
}

// 3b. CPD: log an activity, confirm it lands and is user-scoped; invalid input rejected
r = await send("POST", "/api/cpd", nurse.cookies, { activity_type: "course", title: "TEST — Functional test CPD", hours: 2.5 });
record("workflow:cpd", "nurse logs CPD activity", r.status === 200, `status ${r.status}`);
const { data: cpdRow } = await admin.from("cpd_logs").select("hours, user_id").eq("user_id", created.nurse.id);
record("workflow:cpd", "CPD row stored with hours", cpdRow?.length === 1 && Number(cpdRow[0].hours) === 2.5, JSON.stringify(cpdRow?.[0] ?? null));
r = await send("POST", "/api/cpd", nurse.cookies, { activity_type: "course", title: "TEST — bad hours", hours: "abc" });
record("workflow:cpd", "non-numeric hours rejected", r.status === 400, `status ${r.status}`);
r = await send("POST", "/api/cpd", nurse.cookies, { activity_type: "course", title: "TEST — negative hours", hours: -5 });
record("workflow:cpd", "negative hours rejected", r.status === 400, `status ${r.status}`);
r = await send("POST", "/api/cpd", nurse.cookies, { activity_type: "course", title: "TEST — Functional test CPD", hours: 2.5 });
record("workflow:cpd", "duplicate activity same date rejected (§G)", r.status === 409, `status ${r.status}`);

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

// 3c-ii. Evidence engine (§E): upload → list → signed view → access control
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function uploadEvidence(cookies, fields) {
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "test-evidence.png");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return fetch(BASE + "/api/evidence", { method: "POST", headers: { Cookie: cookies }, body: form });
}
if (created.logEntry) {
  r = await uploadEvidence(nurse.cookies, { skill_log_entry_id: created.logEntry });
  body = await r.json().catch(() => ({}));
  const evidenceId = body.evidence?.id;
  record("workflow:evidence", "nurse uploads evidence to own entry", r.status === 201 && !!evidenceId, `status ${r.status}`);

  r = await get(`/api/evidence?entry=${created.logEntry}`, nurse.cookies);
  body = await r.json().catch(() => ({}));
  record("workflow:evidence", "evidence listed on the entry", (body.evidence ?? []).length === 1, `${body.evidence?.length ?? 0} files`);

  r = await get(`/api/evidence?id=${evidenceId}`, assessor.cookies);
  body = await r.json().catch(() => ({}));
  record("workflow:evidence", "verifier gets signed download URL", r.status === 200 && String(body.url ?? "").includes("token="), `status ${r.status}`);

  r = await get(`/api/evidence?id=${evidenceId}`, "");
  record("workflow:evidence", "unauthenticated evidence access rejected", r.status === 401, `status ${r.status}`);

  r = await uploadEvidence(assessor.cookies, { skill_log_entry_id: created.logEntry });
  record("workflow:evidence", "cannot attach to someone else's entry", r.status === 403, `status ${r.status}`);
}

// 3c-iii. Credentials (§A): self-entry lands pending; adding for others is staff-only
r = await send("POST", "/api/credentials", nurse.cookies, {
  title: "TEST — RN Licence", credential_type: "professional_license",
  issuing_body: "Test Council", credential_number: "TC-0001", expiry_date: "2027-01-01",
});
body = await r.json().catch(() => ({}));
record("workflow:credentials", "nurse self-submits a licence", r.status === 201 && !!body.id, `status ${r.status}`);
const { data: credRow } = body.id
  ? await admin.from("professional_credentials").select("status, credential_number").eq("id", body.id).single()
  : { data: null };
record("workflow:credentials", "licence stored pending verification with number",
  credRow?.status === "pending_verification" && credRow?.credential_number === "TC-0001", JSON.stringify(credRow));
r = await send("POST", "/api/credentials", nurse.cookies, { nurse_id: created.assessor.id, title: "TEST — should fail" });
record("workflow:credentials", "nurse cannot add credentials for others", r.status === 403, `status ${r.status}`);

// 3c-iii-b. Account management: profile edit, avatar, password change
r = await send("PATCH", "/api/account/profile", nurse.cookies, { full_name: "Test Nurse Renamed", phone: "+256700000000", role: "super_admin" });
const { data: prof } = await admin.from("profiles").select("full_name, phone, role").eq("id", created.nurse.id).single();
record("workflow:account", "profile self-edit (name, phone)", r.status === 200 && prof?.full_name === "Test Nurse Renamed" && prof?.phone === "+256700000000", JSON.stringify(prof));
record("workflow:account", "role cannot be self-escalated", prof?.role === "nurse", `role=${prof?.role}`);

{
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "avatar.png");
  r = await fetch(BASE + "/api/account/avatar", { method: "POST", headers: { Cookie: nurse.cookies }, body: fd });
  body = await r.json().catch(() => ({}));
  const avatarOk = r.status === 200 && typeof body.avatar_url === "string";
  let publicOk = false;
  if (avatarOk) publicOk = (await fetch(body.avatar_url)).ok;
  record("workflow:account", "avatar upload sets public image URL", avatarOk && publicOk, `status ${r.status}, url fetch ${publicOk}`);
}

r = await send("POST", "/api/account/password", nurse.cookies, { current_password: "wrong-password", new_password: "NewPass-12345" });
record("workflow:account", "password change rejects wrong current password", r.status === 403, `status ${r.status}`);
r = await send("POST", "/api/account/password", nurse.cookies, { current_password: created.nurse.password, new_password: "NewPass-12345" });
record("workflow:account", "password change succeeds with correct current", r.status === 200, `status ${r.status}`);
{
  const oldLogin = await login(created.nurse.email, created.nurse.password);
  const newLogin = await login(created.nurse.email, "NewPass-12345");
  record("workflow:account", "old password no longer works, new one does",
    oldLogin.status === 400 && newLogin.status === 200, `old ${oldLogin.status}, new ${newLogin.status}`);
  if (newLogin.status === 200) { nurse.cookies = newLogin.cookies; created.nurse.password = "NewPass-12345"; }
}

// 3c-iv. Notifications (§8): events landed, unread count works, mark-all-read works
const { data: nurseNotifs } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id);
record("workflow:notifications", "nurse notified of verification verdict",
  (nurseNotifs ?? []).some(n => n.type === "logbook_verified"), (nurseNotifs ?? []).map(n => n.type).join(",") || "none");
const { data: assessorNotifs } = await admin.from("notifications").select("type").eq("user_id", created.assessor.id);
record("workflow:notifications", "verifier notified of pending entry + credential",
  (assessorNotifs ?? []).some(n => n.type === "logbook_pending") && (assessorNotifs ?? []).some(n => n.type === "credential_submitted"),
  (assessorNotifs ?? []).map(n => n.type).join(",") || "none");
r = await get("/api/notifications", nurse.cookies);
body = await r.json().catch(() => ({}));
record("workflow:notifications", "notification list API with unread count", r.status === 200 && body.unread > 0, `unread ${body.unread}`);
r = await send("PATCH", "/api/notifications", nurse.cookies, { all: true });
const after = await (await get("/api/notifications", nurse.cookies)).json().catch(() => ({}));
record("workflow:notifications", "mark all read", r.status === 200 && after.unread === 0, `unread now ${after.unread}`);

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

// 3f. Assessor workspace: pages render, scheduling works, exports work
const ASSESSOR_PAGES = [
  ["/assessor", "Assessment Operations Centre"],
  ["/assessor/notifications", "Notifications"],
  ["/assessor/queue", "Assessment Inbox"],
  ["/assessor/calendar", "Assessment Calendar"],
  ["/assessor/schedule", "Assessment Schedule"],
  ["/assessor/nurses", "Learners"],
  ["/assessor/frameworks", "Assessment Frameworks"],
  ["/assessor/logbook", "Evidence Validation Centre"],
  ["/assessor/passports", "Competency Passport Centre"],
  ["/assessor/assess", "Conduct Assessment"],
  ["/assessor/osce", "OSCE Management Centre"],
  ["/assessor/simulation", "Simulation &amp; OSCE Centre"],
  ["/assessor/quality", "Quality &amp; Governance"],
  ["/assessor/quality/concurrent", "Concurrent Reviews"],
  ["/assessor/quality/retrospective", "Retrospective Reviews"],
  ["/assessor/quality/clinical", "Clinical Audits"],
  ["/assessor/quality/capa", "Improvement Actions"],
  ["/assessor/quality/indicators", "Quality Indicators"],
  ["/assessor/quality/library", "Audit Library"],
  ["/assessor/reports", "Assessment Dashboard"],
  ["/assessor/reports/learners", "Learner Performance"],
  ["/assessor/reports/competencies", "Competency Analytics"],
  ["/assessor/reports/quality", "Assessment Quality"],
  ["/assessor/reports/evidence", "Evidence Analytics"],
  ["/assessor/reports/productivity", "Productivity &amp; Workload"],
  ["/assessor/reports/departments", "Department Reports"],
  ["/assessor/reports/benchmarking", "Benchmarking"],
  ["/assessor/reports/workforce", "Workforce Intelligence"],
  ["/assessor/reports/builder", "Report Builder"],
  ["/assessor/reports/scheduled", "Scheduled Reports"],
  ["/assessor/ai/copilot", "AI Assessment Copilot"],
  ["/assessor/ai/insights", "Assessment Insights"],
  ["/assessor/ai/competency", "Competency Intelligence"],
  ["/assessor/ai/risk", "Risk Engine"],
  ["/assessor/ai/learner", "Learner Intelligence"],
  ["/assessor/ai/knowledge", "Knowledge Hub"],
  ["/assessor/ai/report-writer", "AI Report Writer"],
  ["/assessor/ai/learning", "AI Learning Recommendations"],
  ["/assessor/ai/automation", "AI Automation Centre"],
  ["/assessor/ai/simulation", "Simulation Intelligence"],
  ["/assessor/ai/history", "AI Assistant History"],
  ["/assessor/analytics", "My Analytics"],
  ["/assessor/remediation", "Remediation"],
  ["/assessor/history", "Assessment History"],
];
for (const [path, marker] of ASSESSOR_PAGES) {
  const res = await get(path, assessor.cookies);
  const html = await res.text();
  record("assessor:pages", path, res.status === 200 && html.includes(marker), `status ${res.status}`);
}

// Scheduling: assessor schedules for the nurse → nurse notified; nurse can't schedule
const tomorrow = new Date(Date.now() + 86400000).toISOString();
r = await send("POST", "/api/schedule", assessor.cookies, { nurse_id: created.nurse.id, method: "direct_observation", scheduled_for: tomorrow, location: "Test Ward" });
body = await r.json().catch(() => ({}));
const schedId = body.id;
record("assessor:schedule", "assessor schedules an assessment", r.status === 201 && !!schedId, `status ${r.status}`);
const { data: schedNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "assessment_scheduled");
record("assessor:schedule", "nurse notified of scheduled session", (schedNotif ?? []).length === 1, `${schedNotif?.length ?? 0} notifications`);
r = await send("POST", "/api/schedule", nurse.cookies, { nurse_id: created.assessor.id, scheduled_for: tomorrow });
record("assessor:schedule", "nurse role cannot schedule", r.status === 403, `status ${r.status}`);
r = await send("PATCH", "/api/schedule", assessor.cookies, { id: schedId, status: "cancelled" });
const { data: schedRow } = schedId ? await admin.from("scheduled_assessments").select("status").eq("id", schedId).single() : { data: null };
record("assessor:schedule", "assessor cancels the session", r.status === 200 && schedRow?.status === "cancelled", `status=${schedRow?.status}`);

// Conduct Assessment cockpit: full session submit → assessment recorded,
// consensus recomputed, learner notified; attestation + role gates enforced.
const { data: anyComp } = await admin.from("framework_competencies").select("id").limit(1).single();
const { data: testCycle } = await admin.from("competency_cycles").insert({
  nurse_id: created.nurse.id, hospital_id: HOSPITAL, cycle_type: "annual", status: "active",
}).select("id").single();
created.cycle = testCycle?.id ?? null;
r = await get(`/assessor/assess?nurse=${created.nurse.id}&cycle=${testCycle.id}`, assessor.cookies);
{
  const html = await r.text();
  record("assessor:conduct", "cockpit renders for a live session",
    r.status === 200 && html.includes("Assessment Workflow") && html.includes("Automatic Actions on Submit"), `status ${r.status}`);
}
// 1x1 transparent PNG as a stand-in signature drawing
const SIG_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
r = await send("POST", "/api/assess/submit", assessor.cookies, {
  cycle_id: testCycle.id, nurse_id: created.nurse.id, method: "direct_observation", attest: true,
  strengths: "TEST — calm, systematic practice",
  recommendation: "competent", duration_seconds: 300,
  signatures: { assessor: SIG_PNG, learner: SIG_PNG },
  scores: [{ competency_id: anyComp.id, score: 4, notes: "TEST — observed full procedure" }],
});
body = await r.json().catch(() => ({}));
const { data: sessRows } = await admin.from("assessments").select("score, status").eq("cycle_id", testCycle.id).eq("assessor_id", created.assessor.id);
record("assessor:conduct", "session submit records the assessment",
  r.status === 200 && body.ok === true && (sessRows ?? []).length === 1 && sessRows?.[0]?.score === 4 && sessRows?.[0]?.status === "complete",
  `status ${r.status}, rows ${sessRows?.length ?? 0}`);
const { data: consScore } = await admin.from("competency_scores").select("score").eq("cycle_id", testCycle.id).eq("competency_id", anyComp.id).maybeSingle();
record("assessor:conduct", "consensus score recomputed", consScore?.score === 4, `score ${consScore?.score}`);
const { data: sessRec } = await admin.from("assessment_sessions").select("recommendation, duration_seconds, assessor_signature_path, learner_signature_path").eq("cycle_id", testCycle.id).maybeSingle();
record("assessor:conduct", "session record saved with recommendation",
  sessRec?.recommendation === "competent" && sessRec?.duration_seconds === 300, `rec ${sessRec?.recommendation}, dur ${sessRec?.duration_seconds}`);
record("assessor:conduct", "e-signatures stored",
  !!sessRec?.assessor_signature_path && !!sessRec?.learner_signature_path, `assessor ${sessRec?.assessor_signature_path ? "✓" : "✗"}, learner ${sessRec?.learner_signature_path ? "✓" : "✗"}`);
r = await send("POST", "/api/assess/submit", assessor.cookies, {
  cycle_id: testCycle.id, nurse_id: created.nurse.id, method: "direct_observation", attest: true,
  recommendation: "definitely_amazing", scores: [{ competency_id: anyComp.id, score: 3 }],
});
record("assessor:conduct", "invalid recommendation rejected", r.status === 400, `status ${r.status}`);

// Messaging (one-way, notification-backed) + AI in-session assistant
r = await send("POST", "/api/messages", assessor.cookies, { recipient_id: created.nurse.id, text: "TEST — well done today, review the airway checklist before Thursday." });
const { data: msgNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "message");
record("assessor:conduct", "message delivered to learner", r.status === 200 && (msgNotif ?? []).length === 1, `status ${r.status}, ${msgNotif?.length ?? 0} notifications`);
r = await send("POST", "/api/messages", assessor.cookies, { text: "TEST — no recipient" });
record("assessor:conduct", "message without recipient rejected", r.status === 400, `status ${r.status}`);
r = await send("POST", "/api/ai/assess", assessor.cookies, { nurse_id: created.nurse.id, method: "direct_observation" });
body = await r.json().catch(() => ({}));
record("assessor:conduct", "AI in-session assistant answers", (r.status === 200 && (body.answer ?? "").length > 50) || r.status === 503, `status ${r.status}${r.status === 503 ? " (AI not configured)" : `, ${(body.answer ?? "").length} chars`}`);

// Media evidence: video upload accepted (widened mime set)
{
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], "test-clip.webm", { type: "video/webm" }));
  fd.append("note", "TEST — video evidence");
  const res = await fetch(BASE + "/api/evidence", { method: "POST", headers: { Cookie: nurse.cookies }, body: fd });
  record("assessor:conduct", "video evidence accepted", res.status === 201, `status ${res.status}`);
}
const { data: subNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "assessment_submitted");
record("assessor:conduct", "learner notified of the session", (subNotif ?? []).length === 1, `${subNotif?.length ?? 0} notifications`);
r = await send("POST", "/api/assess/submit", assessor.cookies, {
  cycle_id: testCycle.id, nurse_id: created.nurse.id, method: "direct_observation", attest: false,
  scores: [{ competency_id: anyComp.id, score: 3 }],
});
record("assessor:conduct", "submit without attestation rejected", r.status === 400, `status ${r.status}`);
r = await send("POST", "/api/assess/submit", nurse.cookies, {
  cycle_id: testCycle.id, nurse_id: created.assessor.id, method: "direct_observation", attest: true,
  scores: [{ competency_id: anyComp.id, score: 3 }],
});
record("assessor:conduct", "nurse role cannot submit assessments", r.status === 403, `status ${r.status}`);

// OSCE Centre: exam lifecycle → results feed the assessment engine
r = await send("POST", "/api/osce/exams", assessor.cookies, {
  title: "TEST — Airway OSCE", programme: "Test Programme", exam_date: new Date().toISOString().slice(0, 10),
  stations: [{ name: "Airway assessment station", competency_id: anyComp.id, duration_minutes: 10 }],
  candidate_ids: [created.nurse.id],
});
body = await r.json().catch(() => ({}));
const osceId = body.id;
const osceStationId = body.stations?.[0]?.id;
record("assessor:osce", "assessor creates an OSCE with station + candidate", r.status === 201 && !!osceId && !!osceStationId, `status ${r.status}`);
r = await send("POST", "/api/osce/exams", nurse.cookies, { title: "TEST — rogue OSCE" });
record("assessor:osce", "nurse role cannot create OSCEs", r.status === 403, `status ${r.status}`);
r = await send("PATCH", "/api/osce/exams", assessor.cookies, { id: osceId, status: "published" });
r = await send("PATCH", "/api/osce/exams", assessor.cookies, { id: osceId, status: "running" });
record("assessor:osce", "publish → start lifecycle", r.status === 200, `status ${r.status}`);
r = await send("POST", "/api/osce/results", assessor.cookies, { station_id: osceStationId, nurse_id: created.nurse.id, score: 5, notes: "TEST — clear airway assessment" });
record("assessor:osce", "examiner records a station score", r.status === 200, `status ${r.status}`);
const preOsce = await admin.from("assessments").select("id").eq("cycle_id", created.cycle).eq("method", "osce");
r = await send("PATCH", "/api/osce/exams", assessor.cookies, { id: osceId, status: "completed" });
body = await r.json().catch(() => ({}));
const postOsce = await admin.from("assessments").select("id, score").eq("cycle_id", created.cycle).eq("method", "osce");
record("assessor:osce", "completion feeds the assessment engine",
  r.status === 200 && (postOsce.data ?? []).length === (preOsce.data ?? []).length + 1,
  `engine rows ${(preOsce.data ?? []).length} → ${(postOsce.data ?? []).length}`);
const { data: osceNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "osce_completed");
record("assessor:osce", "candidate notified of OSCE results", (osceNotif ?? []).length === 1, `${osceNotif?.length ?? 0} notifications`);
r = await get(`/api/reports/osce?exam=${osceId}`, assessor.cookies);
record("assessor:osce", "OSCE results CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);
r = await send("POST", "/api/ai/osce", assessor.cookies, { station_name: "IV cannulation station", competency_id: anyComp.id });
body = await r.json().catch(() => ({}));
record("assessor:osce", "AI station designer drafts material", (r.status === 200 && (body.answer ?? "").length > 100) || r.status === 503, `status ${r.status}${r.status === 503 ? " (AI not configured)" : `, ${(body.answer ?? "").length} chars`}`);

// Simulation Centre: schedule a simulation session + AI scenario designer
r = await send("POST", "/api/schedule", assessor.cookies, { nurse_id: created.nurse.id, method: "simulation", scheduled_for: new Date(Date.now() + 172800000).toISOString(), location: "Sim Lab", note: "TEST — Sepsis Recognition & Bundle Initiation" });
body = await r.json().catch(() => ({}));
const simSchedId = body.id;
record("assessor:simulation", "simulation session scheduled", r.status === 201 && !!simSchedId, `status ${r.status}`);
{
  const res = await get("/assessor/simulation", assessor.cookies);
  const html = await res.text();
  record("assessor:simulation", "scheduled session appears in the centre", res.status === 200 && html.includes("Sepsis Recognition &amp; Bundle Initiation"), `status ${res.status}`);
}
r = await send("PATCH", "/api/schedule", assessor.cookies, { id: simSchedId, status: "cancelled" });
record("assessor:simulation", "session cancelled", r.status === 200, `status ${r.status}`);
r = await send("POST", "/api/ai/simulation", assessor.cookies, { scenario_name: "Post-partum haemorrhage", competency_id: anyComp.id });
body = await r.json().catch(() => ({}));
record("assessor:simulation", "AI scenario designer drafts material", (r.status === 200 && (body.answer ?? "").length > 100) || r.status === 503, `status ${r.status}${r.status === 503 ? " (AI not configured)" : `, ${(body.answer ?? "").length} chars`}`);

// Quality & Governance: audit from a governed checklist → auto-CAPA on failed
// critical criteria; manual CAPA lifecycle; CSV export.
let { data: auditItems } = await admin.from("checklist_items")
  .select("id, is_critical, skill_checklists(competency_skills(competency_id))").eq("is_critical", true).limit(1);
let auditItem = auditItems?.[0];
let auditCompId = auditItem?.skill_checklists?.competency_skills?.competency_id;
let seededChecklist = null;
if (!auditItem || !auditCompId) {
  // No governed checklist exists in the DB — seed a temporary one (removed below).
  const { data: sk } = await admin.from("competency_skills").insert({ competency_id: anyComp.id, name: "TEST — audit skill", sort_order: 999 }).select("id").single();
  const { data: cl } = await admin.from("skill_checklists").insert({ skill_id: sk.id, name: "TEST — audit checklist" }).select("id").single();
  const { data: it } = await admin.from("checklist_items").insert({ checklist_id: cl.id, item: "TEST — verifies patient identity with two identifiers", is_critical: true, sort_order: 1 }).select("id, is_critical").single();
  seededChecklist = { skillId: sk.id, clId: cl.id, itemId: it.id };
  auditItem = it;
  auditCompId = anyComp.id;
}
r = await send("POST", "/api/quality/audits", assessor.cookies, {
  audit_type: "clinical", competency_id: auditCompId, area: "TEST — ICU",
  responses: [{ checklist_item_id: auditItem.id, result: "not_met", note: "TEST — not performed" }],
});
body = await r.json().catch(() => ({}));
const expCapa = auditItem.is_critical ? 1 : 0;
record("assessor:quality", "clinical audit recorded from governed checklist",
  r.status === 201 && body.compliance === 0 && body.capa_created === expCapa,
  `status ${r.status}, compliance ${body.compliance}, auto-CAPA ${body.capa_created} (expected ${expCapa})${seededChecklist ? " — seeded temp checklist" : ""}`);
if (seededChecklist) {
  await admin.from("checklist_items").delete().eq("id", seededChecklist.itemId);
  await admin.from("skill_checklists").delete().eq("id", seededChecklist.clId);
  await admin.from("competency_skills").delete().eq("id", seededChecklist.skillId);
}
r = await send("POST", "/api/quality/audits", nurse.cookies, {
  audit_type: "clinical", competency_id: anyComp.id, responses: [{ checklist_item_id: anyComp.id, result: "met" }],
});
record("assessor:quality", "nurse role cannot conduct audits", r.status === 403, `status ${r.status}`);
r = await send("POST", "/api/quality/capa", assessor.cookies, {
  title: "TEST — Update hand hygiene signage", priority: "high",
  due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
});
body = await r.json().catch(() => ({}));
const capaId = body.id;
record("assessor:quality", "manual CAPA action created", r.status === 201 && !!capaId, `status ${r.status}`);
r = await send("PATCH", "/api/quality/capa", assessor.cookies, { id: capaId, status: "in_progress" });
record("assessor:quality", "CAPA status advances", r.status === 200, `status ${r.status}`);
r = await send("PATCH", "/api/quality/capa", assessor.cookies, { id: capaId, status: "open" });
record("assessor:quality", "CAPA cannot move backwards", r.status === 400, `status ${r.status}`);
r = await get("/api/reports/quality", assessor.cookies);
record("assessor:quality", "quality audits CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);

// AI & Intelligence: grounded insight narrative + report writer
r = await send("POST", "/api/ai/insights", assessor.cookies, { scope: "overview" });
body = await r.json().catch(() => ({}));
record("assessor:ai", "insight narrative generated", (r.status === 200 && (body.answer ?? "").length > 100) || r.status === 503, `status ${r.status}${r.status === 503 ? " (AI not configured)" : `, ${(body.answer ?? "").length} chars`}`);
r = await send("POST", "/api/ai/insights", nurse.cookies, { scope: "overview" });
record("assessor:ai", "nurse blocked from insights", r.status === 403, `status ${r.status}`);
r = await send("POST", "/api/ai/report", assessor.cookies, { report_type: "executive" });
body = await r.json().catch(() => ({}));
record("assessor:ai", "AI report writer generates a report", (r.status === 200 && (body.answer ?? "").length > 200) || r.status === 503, `status ${r.status}${r.status === 503 ? " (AI not configured)" : `, ${(body.answer ?? "").length} chars`}`);
r = await send("POST", "/api/ai/report", assessor.cookies, { report_type: "not_a_type" });
record("assessor:ai", "invalid report type rejected", r.status === 400, `status ${r.status}`);

// Report Builder: custom reports, saved definitions, schedules + cron, appeals
r = await get("/api/reports/custom?dataset=assessments&format=csv", assessor.cookies);
record("assessor:builder", "custom report CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);
r = await get("/api/reports/custom?dataset=learners", assessor.cookies);
body = await r.json().catch(() => ({}));
record("assessor:builder", "custom report JSON preview", r.status === 200 && Array.isArray(body.rows), `status ${r.status}, ${body.rows?.length ?? "no"} rows`);
r = await get("/api/reports/custom?dataset=assessments", nurse.cookies);
record("assessor:builder", "nurse blocked from custom reports", r.status === 403, `status ${r.status}`);
r = await send("POST", "/api/reports/definitions", assessor.cookies, {
  name: "TEST — Monthly assessments", dataset: "assessments", config: { columns: ["date", "learner", "score"] },
});
body = await r.json().catch(() => ({}));
const reportDefId = body.id;
record("assessor:builder", "report definition saved", r.status === 201 && !!reportDefId, `status ${r.status}`);
r = await send("POST", "/api/reports/schedules", assessor.cookies, {
  name: "TEST — Daily assessment report", definition_id: reportDefId, frequency: "daily",
  recipient_ids: [created.assessor.id],
});
body = await r.json().catch(() => ({}));
const schedRepId = body.id;
record("assessor:builder", "report schedule created", r.status === 201 && !!schedRepId && !!body.next_run_at, `status ${r.status}`);
await admin.from("report_schedules").update({ next_run_at: new Date(Date.now() - 3600e3).toISOString() }).eq("id", schedRepId);
r = await fetch(BASE + "/api/cron/reports", { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
body = await r.json().catch(() => ({}));
const { data: repNotif } = await admin.from("notifications").select("type").eq("user_id", created.assessor.id).eq("type", "report_ready");
record("assessor:builder", "cron executes due schedule + notifies recipient",
  r.status === 200 && (body.processed ?? 0) >= 1 && (repNotif ?? []).length >= 1,
  `status ${r.status}, processed ${body.processed}, notifications ${repNotif?.length ?? 0}`);
r = await fetch(BASE + "/api/cron/reports");
record("assessor:builder", "cron rejects missing secret", r.status === 401 || r.status === 503, `status ${r.status}`);

// Appeals: nurse appeals an outcome → staff resolve → nurse notified
const { data: appealTarget } = await admin.from("assessments").select("id").eq("cycle_id", created.cycle).limit(1).single();
r = await send("POST", "/api/appeals", nurse.cookies, { assessment_id: appealTarget.id, reason: "TEST — I completed all critical steps; the observing charge nurse can confirm." });
body = await r.json().catch(() => ({}));
const appealId = body.id;
record("assessor:appeals", "learner raises an appeal", r.status === 201 && !!appealId, `status ${r.status}`);
r = await send("POST", "/api/appeals", nurse.cookies, { assessment_id: appealTarget.id, reason: "TEST — duplicate" });
record("assessor:appeals", "duplicate appeal rejected", r.status === 409, `status ${r.status}`);
r = await send("PATCH", "/api/appeals", assessor.cookies, { id: appealId, status: "overturned", resolution_note: "TEST — reassessment arranged with a second assessor" });
const { data: appealNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "appeal_resolved");
record("assessor:appeals", "staff resolve appeal + learner notified", r.status === 200 && (appealNotif ?? []).length === 1, `status ${r.status}, ${appealNotif?.length ?? 0} notifications`);

// CSV exports: assessor gets CSV, nurse is blocked
r = await get("/api/reports/history", assessor.cookies);
record("assessor:reports", "history CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);
r = await get("/api/reports/analytics", assessor.cookies);
record("assessor:reports", "analytics CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);
r = await get("/api/reports/evidence", assessor.cookies);
record("assessor:reports", "evidence queue CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);
r = await get("/api/reports/passports", assessor.cookies);
record("assessor:reports", "passport centre CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);

// Passport Centre: request-evidence action notifies the clinician
r = await send("POST", "/api/passports/request-evidence", assessor.cookies, { nurse_id: created.nurse.id, note: "TEST — please evidence recent IV practice" });
const { data: evReqNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "evidence_requested");
record("assessor:passports", "request-evidence notifies the clinician", r.status === 200 && (evReqNotif ?? []).length === 1, `status ${r.status}, notifications ${evReqNotif?.length ?? 0}`);
r = await send("POST", "/api/passports/request-evidence", nurse.cookies, { nurse_id: created.assessor.id });
record("assessor:passports", "nurse blocked from requesting evidence", r.status === 403, `status ${r.status}`);
r = await get("/api/reports/history", nurse.cookies);
record("assessor:reports", "nurse blocked from assessor exports", r.status === 403, `status ${r.status}`);

// 3g. Admin portal: dashboard reads real decisions, CSV export gated
{
  const hospAdmin = await makeUser("testhospadmin@competen.test", "Test Hosp Admin", "hospital_admin");
  const adminLogin = await login(hospAdmin.email, hospAdmin.password);
  record("admin", "hospital admin login", adminLogin.status === 200, `status ${adminLogin.status}`);
  const res = await get("/admin/dashboard", adminLogin.cookies);
  const html = await res.text();
  record("admin", "/admin/dashboard renders with CPD compliance", res.status === 200 && html.includes("CPD Compliance"), `status ${res.status}`);
  record("admin", "no invented 30h target when unset", !html.includes("Target: 30h/year"), html.includes("Target: 30h/year") ? "hardcoded target present" : "ok");
  r = await get("/api/reports/admin-cpd", adminLogin.cookies);
  record("admin", "admin CPD CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);
  r = await get("/api/reports/admin-cpd", nurse.cookies);
  record("admin", "nurse blocked from admin export", r.status === 403, `status ${r.status}`);
  await admin.from("profiles").delete().eq("id", hospAdmin.id);
  await admin.auth.admin.deleteUser(hospAdmin.id);
}

// PHASE 4 — Permissions & tenant isolation
r = await get("/api/super-admin/users/list", nurse.cookies);
record("permissions", "nurse blocked from super-admin API", [401, 403].includes(r.status), `status ${r.status}`);
r = await send("POST", "/api/content/frameworks", nurse.cookies, { name: "TEST should fail" });
record("permissions", "nurse blocked from content authoring", [401, 403].includes(r.status), `status ${r.status}`);
r = await send("POST", "/api/logbook", "", { skill_name: "x", supervision_level: "observed" });
record("permissions", "unauthenticated API rejected", r.status === 401, `status ${r.status}`);

// Workspace switcher: server-side permission enforcement
r = await send("POST", "/api/auth/switch-role", assessor.cookies, { role: "nurse" });
record("permissions", "switch to unheld workspace rejected", r.status === 403, `status ${r.status}`);
r = await send("POST", "/api/auth/switch-role", assessor.cookies, { role: "assessor" });
body = await r.json().catch(() => ({}));
record("permissions", "switch to held workspace allowed", r.status === 200 && body.redirect === "/assessor", `status ${r.status} → ${body.redirect}`);
r = await send("POST", "/api/auth/switch-role", assessor.cookies, { role: "bogus" });
record("permissions", "invalid workspace role rejected", r.status === 400, `status ${r.status}`);
{
  const res = await get("/assessor", assessor.cookies);
  const html = await res.text();
  record("permissions", "no cross-shell Nurse Dashboard link in sidebar", res.status === 200 && !html.includes("Nurse Dashboard"), `status ${res.status}`);
}

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
record("rls", "nurse can read their own logbook", (own ?? []).length >= 1, `${own?.length ?? 0} rows`);

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
  // Session e-signature files live in the evidence bucket outside per-user folders
  const { data: sigSessions } = await admin.from("assessment_sessions")
    .select("assessor_signature_path, learner_signature_path, witness_signature_path")
    .eq("nurse_id", created.nurse.id);
  const sigPaths = (sigSessions ?? [])
    .flatMap(s => [s.assessor_signature_path, s.learner_signature_path, s.witness_signature_path])
    .filter(Boolean);
  if (sigPaths.length) await admin.storage.from("evidence").remove(sigPaths);
  await admin.from("osce_exams").delete().ilike("title", "TEST — %");
  for (const uid of [created.nurse.id, created.assessor.id]) {
    const { data: evRows } = await admin.from("evidence").select("file_path").eq("owner_id", uid);
    if (evRows?.length) await admin.storage.from("evidence").remove(evRows.map(e => e.file_path));
    const { data: avatarFiles } = await admin.storage.from("avatars").list(uid);
    if (avatarFiles?.length) await admin.storage.from("avatars").remove(avatarFiles.map(f => `${uid}/${f.name}`));
    await admin.from("evidence").delete().eq("owner_id", uid);
    await admin.from("notifications").delete().eq("user_id", uid);
    await admin.from("professional_credentials").delete().eq("nurse_id", uid);
    await admin.from("skill_log_entries").delete().eq("nurse_id", uid);
    await admin.from("cpd_logs").delete().eq("user_id", uid);
    await admin.from("competency_cycles").delete().eq("nurse_id", uid);
    await admin.from("capa_actions").delete().eq("created_by", uid);
    await admin.from("audits").delete().eq("conducted_by", uid);
    await admin.from("appeals").delete().eq("nurse_id", uid);
    await admin.from("report_schedules").delete().eq("created_by", uid);
    await admin.from("report_definitions").delete().eq("created_by", uid);
    await admin.from("quiz_attempts").delete().eq("user_id", uid);
    await admin.from("audit_log").delete().eq("actor_id", uid);
    await admin.from("profiles").delete().eq("id", uid);
    await admin.auth.admin.deleteUser(uid);
  }
  // Notifications the test actions generated FOR real users (e.g. hospital
  // verifiers) — the "TEST — " marker is unique to this battery.
  await admin.from("notifications").delete().ilike("body", "%TEST — %");
  console.log("Removed test accounts and their data.");
} else {
  console.log(`\n--keep: test accounts left in place (${created.nurse.email} / ${created.assessor.email})`);
}

// Summary
const fails = results.filter(x => !x.pass);
console.log(`\n${"─".repeat(60)}\n${results.length} checks · ${results.length - fails.length} passed · ${fails.length} failed`);
if (fails.length) { console.log("\nFailures:"); for (const f of fails) console.log(`  ✗ [${f.section}] ${f.name} — ${f.note}`); }
process.exit(fails.length ? 1 : 0);
