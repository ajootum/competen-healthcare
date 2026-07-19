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

async function makeUser(email, fullName, role, hospitalId = HOSPITAL) {
  const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const old = (page?.users ?? []).find(u => u.email === email);
  if (old) { await admin.from("profiles").delete().eq("id", old.id); await admin.auth.admin.deleteUser(old.id); }
  const password = "Test-" + randomBytes(9).toString("base64url");
  // A prior crashed run can leave an un-deletable auth account (GoTrue 500 when
  // it still owns orphaned storage objects). Fall back to a fresh unique email
  // on collision so one poisoned leftover can't crash the whole suite.
  let attempt = email, u = null, error = null;
  for (let i = 0; i < 3; i++) {
    ({ data: u, error } = await admin.auth.admin.createUser({
      email: attempt, password, email_confirm: true, user_metadata: { full_name: fullName },
    }));
    if (!error) break;
    if (!/already.*registered/i.test(error.message ?? "")) break;
    attempt = email.replace("@", `-${randomBytes(3).toString("hex")}@`);
  }
  if (error) throw new Error("createUser " + email + ": " + error.message);
  const { error: perr } = await admin.from("profiles").upsert({
    id: u.user.id, email: attempt, full_name: fullName, role, roles: [role],
    hospital_id: hospitalId, organisation_id: ORG,
  });
  if (perr) throw new Error("profile " + email + ": " + perr.message);
  return { id: u.user.id, email: attempt, password };
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
  ["/assessor/studio", "Assessment Studio"],
  ["/assessor/studio/checklists", "Checklist Builder"],
  ["/assessor/studio/assessments", "Question Builder"],
  ["/assessor/studio/rubrics", "Rubrics &amp; Scoring"],
  ["/assessor/studio/versions", "Version Control"],
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

// ── UAT §1/§5: end-to-end lifecycle to passport + business rules ─────────────
// Critical-failure rule: score 0 on a second competency via the cockpit.
const { data: comp2 } = await admin.from("framework_competencies").select("id").neq("id", anyComp.id).limit(1).maybeSingle();
if (comp2) {
  r = await send("POST", "/api/assess/submit", assessor.cookies, {
    cycle_id: created.cycle, nurse_id: created.nurse.id, method: "direct_observation", attest: true,
    scores: [{ competency_id: comp2.id, score: 0, notes: "TEST — critical failure observed" }],
  });
  record("uat:e2e", "critical-failure score recorded via cockpit", r.status === 200, `status ${r.status}`);
}
// Educator runs the formal decision process → decisions, passport, notification.
const uatEducator = await makeUser("testeducator2@competen.test", "Test Educator II", "educator");
const eduLogin2 = await login(uatEducator.email, uatEducator.password);
r = await send("POST", `/api/cycles/${created.cycle}/decisions`, eduLogin2.cookies, {});
body = await r.json().catch(() => ({}));
record("uat:e2e", "educator decision run issues decisions", r.status === 200 && (body.created ?? 0) >= 1, `status ${r.status}, created ${body.created}`);
const { data: cycleDecisions } = await admin.from("competency_decisions")
  .select("competency_id, outcome, critical_failure, expiry_date").eq("cycle_id", created.cycle);
const passDec = (cycleDecisions ?? []).find(d => d.competency_id === anyComp.id);
record("uat:e2e", "passing score → provisional outcome with expiry",
  passDec?.outcome === "provisionally_competent" && !!passDec?.expiry_date,
  `outcome ${passDec?.outcome}, expiry ${passDec?.expiry_date ?? "—"}`);
if (comp2) {
  const critDec = (cycleDecisions ?? []).find(d => d.competency_id === comp2.id);
  record("uat:e2e", "score 0 → critical failure, not competent, no expiry",
    critDec?.outcome === "not_yet_competent" && critDec?.critical_failure === true && !critDec?.expiry_date,
    `outcome ${critDec?.outcome}, critical ${critDec?.critical_failure}`);
}
const { data: decNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "decisions_issued");
record("uat:e2e", "learner notified of issued decisions", (decNotif ?? []).length >= 1, `${decNotif?.length ?? 0} notifications`);
r = await get("/api/reports/passports", assessor.cookies);
{
  const csv = await r.text();
  const line = csv.split("\n").find(l => l.includes("Test Nurse"));
  record("uat:e2e", "passport CSV reconciles (Test Nurse has decided competencies)", !!line && !/,0\s*$/.test(line ?? ""), line ? line.trim().slice(0, 90) : "row missing");
}
r = await get("/api/reports/history", assessor.cookies);
{
  const csv = await r.text();
  record("uat:e2e", "history CSV reconciles with submitted assessments", csv.includes("Test Nurse"), "");
}
// Educator Validation Centre: the 7 new modules render + core flows
const EDUCATOR_PAGES = [
  ["/educator/teach", "Teach &amp; Assess"],
  ["/educator/assessments", "Assessments"],
  ["/educator/questions", "Question Bank"],
  ["/educator/library", "Learning Resources"],
  ["/educator/courses", "CPD &amp; Courses"],
  ["/educator/simulation", "Simulation Scenarios"],
  ["/educator/support", "Learner Success Dashboard"],
  ["/educator/students", "Learner Directory"],
  ["/educator/profiles", "Learner Profiles"],
  ["/educator/progress", "Progress Monitoring"],
  ["/educator/at-risk", "At-Risk Learners"],
  ["/educator/plans", "Learning Plans"],
  ["/educator/feedback", "Feedback &amp; Comments"],
  ["/educator/gaps", "Competency Gaps"],
  ["/educator/evidence-support", "Evidence Support"],
  ["/educator/ai-insights", "AI Learning Insights"],
  ["/educator/communication", "Communication Centre"],
  ["/educator/support-analytics", "Support Analytics"],
  ["/educator/coaching", "Coaching Sessions"],
  ["/educator/interventions", "Interventions"],
  ["/educator/meetings", "Meetings &amp; Follow-ups"],
  ["/educator/referrals", "Referrals"],
  ["/educator/studio", "Education Studio"],
  ["/educator/studio/curriculum", "Curriculum &amp; Framework Design"],
  ["/educator/studio/assessment", "Assessment Design Studio"],
  ["/educator/studio/content", "Learning Content Studio"],
  ["/educator/studio/mapping", "Blueprint &amp; Mapping Centre"],
  ["/educator/studio/cko", "CKO &amp; CPU Studio"],
  ["/educator/studio/ai", "AI Studio"],
  ["/educator/studio/publishing", "Publishing &amp; Governance"],
  ["/educator/studio/frameworks", "Framework Builder"],
  ["/educator/studio/cpus", "CPU Builder"],
  ["/educator/studio/knowledge", "Clinical Library"],
  ["/educator/studio/checklists", "Clinical Skills Checklist Builder"],
  ["/educator/studio/rubrics", "Assessment Templates"],
  ["/educator/studio/gaps", "Gap Analysis"],
  ["/educator/studio/versions", "Version Control"],
  ["/educator/studio/analytics", "Object Analytics"],
  ["/educator/reviews", "My Reviews"],
  ["/educator/evidence", "Evidence Review"],
  ["/educator/moderation", "Moderation Queue"],
  ["/educator/escalations", "Escalations"],
  ["/educator/approvals", "Passport Approvals"],
  ["/educator/quality-flags", "Quality Flags"],
  ["/educator/validation-analytics", "Validation Analytics"],
];
for (const [path, marker] of EDUCATOR_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:centre", path, res.status === 200 && html.includes(marker), `status ${res.status}`);
}

// ── Analytics & Quality workspace: overview dashboard + 8 section pages ──────
const ANALYTICS_PAGES = [
  ["/educator/analytics", "Learning Progress Trend"],
  ["/educator/analytics/learning", "Learning Analytics"],
  ["/educator/analytics/competency", "Competency Analytics"],
  ["/educator/analytics/curriculum", "Curriculum Analytics"],
  ["/educator/analytics/assessment", "Assessment Analytics"],
  ["/educator/analytics/outcomes", "Learner Outcomes"],
  ["/educator/analytics/quality", "Program Quality"],
  ["/educator/analytics/accreditation", "Accreditation &amp; Standards"],
  ["/educator/analytics/improvement", "Improvement Centre"],
];
for (const [path, marker] of ANALYTICS_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Learning Analytics workspace: landing + 6 modules (Learner/Cohort/Course/Faculty/Trend/Custom)
const LEARNING_PAGES = [
  ["/educator/analytics/learning", "Open module"],
  ["/educator/analytics/learning/learners", "Individual Learner Overview"],
  ["/educator/analytics/learning/cohorts", "Cohort Analytics"],
  ["/educator/analytics/learning/courses", "Course Completion Funnel"],
  ["/educator/analytics/learning/faculty", "Faculty Ranking"],
  ["/educator/analytics/learning/trends", "Performance Trend"],
  ["/educator/analytics/learning/custom", "AI Analytics Assistant"],
];
for (const [path, marker] of LEARNING_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Competency Analytics workspace: landing + 7 modules
const COMPETENCY_PAGES = [
  ["/educator/analytics/competency", "Competency Analytics"],
  ["/educator/analytics/competency/coverage", "Coverage Matrix"],
  ["/educator/analytics/competency/achievement", "Achievement by Learner"],
  ["/educator/analytics/competency/heatmaps", "Learners × Domains"],
  ["/educator/analytics/competency/gaps", "Gap Register"],
  ["/educator/analytics/competency/domains", "Domain Scorecards"],
  ["/educator/analytics/competency/skills", "Skill Mastery Overview"],
  ["/educator/analytics/competency/trends", "Competency Trend"],
];
for (const [path, marker] of COMPETENCY_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Curriculum Analytics workspace: landing + 6 modules
const CURRICULUM_PAGES = [
  ["/educator/analytics/curriculum", "Curriculum Analytics"],
  ["/educator/analytics/curriculum/effectiveness", "Curriculum Performance Overview"],
  ["/educator/analytics/curriculum/blueprint", "Blueprint Coverage Matrix"],
  ["/educator/analytics/curriculum/outcomes", "Learning Outcomes Performance"],
  ["/educator/analytics/curriculum/cpus", "CPU Performance Overview"],
  ["/educator/analytics/curriculum/content", "Content by Type"],
  ["/educator/analytics/curriculum/gaps", "Curriculum Gaps Register"],
];
for (const [path, marker] of CURRICULUM_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Assessment Analytics workspace: landing + 5 modules
const ASSESSMENT_PAGES = [
  ["/educator/analytics/assessment", "Assessment Analytics"],
  ["/educator/analytics/assessment/performance", "Performance by Assessment Type"],
  ["/educator/analytics/assessment/questions", "Question Bank"],
  ["/educator/analytics/assessment/reliability", "Reliability Indicators"],
  ["/educator/analytics/assessment/blueprint", "Blueprint Coverage Matrix"],
  ["/educator/analytics/assessment/difficulty", "Difficulty by Category"],
];
for (const [path, marker] of ASSESSMENT_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Learner Outcomes workspace: landing + 5 modules
const OUTCOMES_PAGES = [
  ["/educator/analytics/outcomes", "Learner Outcomes"],
  ["/educator/analytics/outcomes/success", "Success Distribution"],
  ["/educator/analytics/outcomes/competency", "Achievement by Domain"],
  ["/educator/analytics/outcomes/clinical", "Clinical Readiness by Domain"],
  ["/educator/analytics/outcomes/certification", "Certification Checklist"],
  ["/educator/analytics/outcomes/cpd", "Recommended CPD"],
];
for (const [path, marker] of OUTCOMES_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Program Quality workspace: landing + 8 modules
const QUALITY_PAGES = [
  ["/educator/analytics/quality", "Program Quality"],
  ["/educator/analytics/quality/program", "Quality Score by Domain"],
  ["/educator/analytics/quality/faculty", "Faculty Assessment Activity"],
  ["/educator/analytics/quality/curriculum", "Curriculum Quality Scorecard"],
  ["/educator/analytics/quality/assessment", "Top Assessment Types"],
  ["/educator/analytics/quality/compliance", "Compliance Matrix"],
  ["/educator/analytics/quality/benchmarking", "Benchmarking"],
  ["/educator/analytics/quality/reviews", "Improvement Actions"],
  ["/educator/analytics/quality/reports", "Report Templates"],
];
for (const [path, marker] of QUALITY_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Accreditation & Standards workspace: landing + 7 modules
const ACCREDITATION_PAGES = [
  ["/educator/analytics/accreditation", "Accreditation &amp; Standards"],
  ["/educator/analytics/accreditation/standards", "Compliance by Area"],
  ["/educator/analytics/accreditation/reports", "What this module needs"],
  ["/educator/analytics/accreditation/evidence", "Evidence by Type"],
  ["/educator/analytics/accreditation/mapping", "What this module needs"],
  ["/educator/analytics/accreditation/audit", "Readiness by Domain"],
  ["/educator/analytics/accreditation/documents", "What this module needs"],
  ["/educator/analytics/accreditation/improvement", "Actions by Source"],
];
for (const [path, marker] of ACCREDITATION_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// Improvement & Action Center workspace: landing + 3 modules
const IMPROVEMENT_PAGES = [
  ["/educator/analytics/improvement", "CAPA by Status"],
  ["/educator/analytics/improvement/plans", "What this module needs"],
  ["/educator/analytics/improvement/capa", "Recent CAPAs"],
  ["/educator/analytics/improvement/risks", "Risks by Category"],
];
for (const [path, marker] of IMPROVEMENT_PAGES) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}

// AI & Intelligence Hub + Copilot workspace
for (const [path, marker] of [["/educator/ai", "Institution Intelligence Map"], ["/educator/ai/copilot", "Recommended Next Actions"]]) {
  const res = await get(path, eduLogin2.cookies);
  const html = await res.text();
  record("educator:analytics", path, res.status === 200 && html.includes(marker), `status ${res.status}${res.status === 200 && !html.includes(marker) ? ", marker missing" : ""}`);
}
// Approvals flow: educator validates the conducted score, cycle appears fully approvable
const { data: pendingScore } = await admin.from("competency_scores").select("id").eq("cycle_id", created.cycle).eq("competency_id", anyComp.id).single();
r = await send("POST", "/api/educator/validate", eduLogin2.cookies, { competency_score_id: pendingScore.id, action: "validate", notes: "TEST — validated in approvals flow" });
const { data: validatedScore } = await admin.from("competency_scores").select("educator_validated").eq("id", pendingScore.id).single();
record("educator:centre", "educator validates a competency score", r.status === 200 && validatedScore?.educator_validated === true, `status ${r.status}, validated ${validatedScore?.educator_validated}`);
r = await get("/api/reports/validations", eduLogin2.cookies);
record("educator:centre", "validations CSV export", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv"), `status ${r.status}`);
r = await get("/api/reports/validations", nurse.cookies);
record("educator:centre", "nurse blocked from validations export", r.status === 403, `status ${r.status}`);

// ── Learner Support stores: coaching sessions, interventions, referrals ──────
// Coaching: schedule → learner notified → complete with notes
r = await send("POST", "/api/support/sessions", eduLogin2.cookies, {
  nurse_id: created.nurse.id, session_type: "coaching",
  scheduled_for: new Date(Date.now() + 2 * 86400000).toISOString(),
  focus: "TEST — IV therapy skills", goals: "TEST — practise cannulation on 3 supervised attempts",
});
body = await r.json().catch(() => ({}));
const coachId = body.id;
const { data: coachNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "coaching_scheduled");
record("educator:support", "coaching session scheduled + learner notified", r.status === 201 && !!coachId && (coachNotif ?? []).length === 1, `status ${r.status}, ${coachNotif?.length ?? 0} notifications`);
r = await send("POST", "/api/support/sessions", nurse.cookies, { nurse_id: created.assessor.id, scheduled_for: new Date().toISOString() });
record("educator:support", "nurse cannot schedule sessions", r.status === 403, `status ${r.status}`);
r = await send("PATCH", "/api/support/sessions", eduLogin2.cookies, { id: coachId, status: "completed", notes: "TEST — good progress, review in a week" });
const { data: coachDone } = await admin.from("support_sessions").select("status, notes").eq("id", coachId).single();
record("educator:support", "coaching session completed with notes", r.status === 200 && coachDone?.status === "completed" && !!coachDone?.notes, `status ${r.status}, ${coachDone?.status}`);

// Interventions: create → learner notified → advance → complete requires outcome
r = await send("POST", "/api/support/interventions", eduLogin2.cookies, {
  nurse_id: created.nurse.id, reason: "TEST — repeated medication-safety failures", competency_name: "TEST — Medication Safety",
  objectives: "TEST — pass reassessment", review_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
});
body = await r.json().catch(() => ({}));
const ivId = body.id;
const { data: ivNotif } = await admin.from("notifications").select("type").eq("user_id", created.nurse.id).eq("type", "intervention_created");
record("educator:support", "intervention created + learner notified", r.status === 201 && !!ivId && (ivNotif ?? []).length === 1, `status ${r.status}, ${ivNotif?.length ?? 0} notifications`);
r = await send("PATCH", "/api/support/interventions", eduLogin2.cookies, { id: ivId, status: "completed", outcome: "" });
record("educator:support", "completing intervention requires an outcome", r.status === 400, `status ${r.status}`);
r = await send("PATCH", "/api/support/interventions", eduLogin2.cookies, { id: ivId, status: "in_progress" });
r = await send("PATCH", "/api/support/interventions", eduLogin2.cookies, { id: ivId, status: "completed", outcome: "successful", outcome_note: "TEST — passed reassessment" });
const { data: ivDone } = await admin.from("interventions").select("status, outcome").eq("id", ivId).single();
record("educator:support", "intervention completes with outcome", r.status === 200 && ivDone?.status === "completed" && ivDone?.outcome === "successful", `status ${r.status}, outcome ${ivDone?.outcome}`);

// Referrals: create to internal referee (the assessor) → referee notified → resolve → referrer notified. Learner must NOT see it.
r = await send("POST", "/api/support/referrals", eduLogin2.cookies, {
  nurse_id: created.nurse.id, referred_to_id: created.assessor.id, reason: "TEST — attendance and engagement concern", urgency: "high",
});
body = await r.json().catch(() => ({}));
const refId = body.id;
const { data: refNotif } = await admin.from("notifications").select("type").eq("user_id", created.assessor.id).eq("type", "referral_created");
record("educator:support", "referral created + referee notified", r.status === 201 && !!refId && (refNotif ?? []).length === 1, `status ${r.status}, ${refNotif?.length ?? 0} notifications`);
{
  const nurseAuthed = anon();
  await nurseAuthed.auth.signInWithPassword({ email: created.nurse.email, password: created.nurse.password });
  const { data: seen } = await nurseAuthed.from("referrals").select("id").eq("id", refId);
  record("educator:support", "learner cannot read referrals (RLS)", (seen ?? []).length === 0, `${seen?.length ?? 0} rows`);
}
r = await send("PATCH", "/api/support/referrals", eduLogin2.cookies, { id: refId, status: "resolved", resolution_note: "TEST — met with learner, plan agreed" });
record("educator:support", "referral resolves", r.status === 200, `status ${r.status}`);

// Education Studio: educator can author a checklist via /api/studio, and the AI generator answers
r = await send("POST", "/api/studio", eduLogin2.cookies, { kind: "skill", name: "TEST — studio skill" });
body = await r.json().catch(() => ({}));
const studioEduSkill = body.id;
r = await send("POST", "/api/studio", eduLogin2.cookies, { kind: "attach_skill", skill_id: studioEduSkill, competency_id: anyComp.id });
body = await r.json().catch(() => ({}));
const studioEduCompSkill = body.id;
r = await send("POST", "/api/studio", eduLogin2.cookies, { kind: "checklist", skill_id: studioEduCompSkill, name: "TEST — studio checklist" });
record("educator:studio", "educator authors a checklist via studio", r.status === 201, `status ${r.status}`);
r = await send("POST", "/api/ai/osce", eduLogin2.cookies, { station_name: "TEST — studio station", competency_id: anyComp.id });
body = await r.json().catch(() => ({}));
record("educator:studio", "AI assessment generator answers", (r.status === 200 && (body.answer ?? "").length > 100) || r.status === 503, `status ${r.status}${r.status === 503 ? " (AI off)" : ""}`);
r = await send("POST", "/api/studio", nurse.cookies, { kind: "skill", name: "TEST — rogue" });
record("educator:studio", "nurse blocked from studio authoring", r.status === 403, `status ${r.status}`);

// ── Educator framework authoring: create hospital framework → domains → competencies → reorder → publish ──
// Educators author their OWN hospital's frameworks (scope=local, audit-logged); the shared master library stays read-only.
const authoring = (payload) => send("POST", "/api/studio/authoring", eduLogin2.cookies, payload);
let authFwId, authDom1, authDom2, authComp;
r = await authoring({ action: "create_framework", name: "TEST — Educator Framework", library: "specialty" });
body = await r.json().catch(() => ({})); authFwId = body.id;
const { data: authFwRow } = authFwId ? await admin.from("frameworks").select("scope, hospital_id, owner_type").eq("id", authFwId).single() : { data: null };
record("educator:authoring", "educator creates a hospital framework", r.status === 201 && !!authFwId && authFwRow?.scope === "local" && authFwRow?.hospital_id === HOSPITAL, `status ${r.status}, scope ${authFwRow?.scope}`);

r = await authoring({ action: "create_domain", framework_id: authFwId, name: "TEST — Domain A" });
body = await r.json().catch(() => ({})); authDom1 = body.id;
record("educator:authoring", "educator creates a domain", r.status === 201 && !!authDom1, `status ${r.status}`);
r = await authoring({ action: "create_domain", framework_id: authFwId, name: "TEST — Domain B" });
body = await r.json().catch(() => ({})); authDom2 = body.id;

r = await authoring({ action: "create_competency", domain_id: authDom1, name: "TEST — Competency 1" });
body = await r.json().catch(() => ({})); authComp = body.id;
record("educator:authoring", "educator creates a competency", r.status === 201 && !!authComp, `status ${r.status}`);

r = await authoring({ action: "reorder_domains", framework_id: authFwId, order: [authDom2, authDom1] });
const { data: reordered } = await admin.from("framework_domains").select("id, sort_order").eq("framework_id", authFwId).order("sort_order");
record("educator:authoring", "educator reorders domains (sort persisted)", r.status === 200 && reordered?.[0]?.id === authDom2, `status ${r.status}`);

r = await authoring({ action: "update_competency", competency_id: authComp, name: "TEST — Competency 1 renamed" });
const { data: renamedComp } = authComp ? await admin.from("framework_competencies").select("name").eq("id", authComp).single() : { data: null };
record("educator:authoring", "educator autosave-renames a competency", r.status === 200 && renamedComp?.name === "TEST — Competency 1 renamed", `status ${r.status}`);

r = await authoring({ action: "lifecycle", framework_id: authFwId, step: "publish" });
const { data: publishedFw } = authFwId ? await admin.from("frameworks").select("pub_status, version_num").eq("id", authFwId).single() : { data: null };
const { data: authVersion } = authFwId ? await admin.from("framework_versions").select("id").eq("framework_id", authFwId) : { data: [] };
record("educator:authoring", "educator publishes framework (version snapshotted)", r.status === 200 && publishedFw?.pub_status === "published" && (authVersion ?? []).length >= 1, `status ${r.status}, ${publishedFw?.pub_status}`);

r = await send("POST", "/api/studio/authoring", nurse.cookies, { action: "create_framework", name: "TEST — rogue framework" });
record("educator:authoring", "nurse blocked from framework authoring", r.status === 403, `status ${r.status}`);

const { data: masterFw } = await admin.from("frameworks").select("id").eq("scope", "master").limit(1).single();
r = masterFw ? await authoring({ action: "create_domain", framework_id: masterFw.id, name: "TEST — should fail" }) : { status: 0 };
record("educator:authoring", "educator blocked from editing master library", r.status === 403, `status ${r.status}`);

// Cleanup authoring artefacts (children first, then audit rows for the throwaway educator)
if (authFwId) {
  await admin.from("framework_competencies").delete().in("domain_id", [authDom1, authDom2].filter(Boolean));
  await admin.from("framework_domains").delete().eq("framework_id", authFwId);
  await admin.from("framework_versions").delete().eq("framework_id", authFwId);
  await admin.from("content_approvals").delete().eq("framework_id", authFwId);
  await admin.from("frameworks").delete().eq("id", authFwId);
}
await admin.from("audit_log").delete().eq("actor_id", uatEducator.id);

if (studioEduCompSkill) {
  const { data: sc } = await admin.from("skill_checklists").select("id").eq("skill_id", studioEduCompSkill);
  for (const x of sc ?? []) await admin.from("skill_checklists").delete().eq("id", x.id);
  await admin.from("competency_skills").delete().eq("id", studioEduCompSkill);
}
if (studioEduSkill) await admin.from("skill_library").delete().eq("id", studioEduSkill);

await admin.from("support_sessions").delete().eq("nurse_id", created.nurse.id);
await admin.from("interventions").delete().eq("nurse_id", created.nurse.id);
await admin.from("referrals").delete().eq("nurse_id", created.nurse.id);

await admin.from("profiles").delete().eq("id", uatEducator.id);
await admin.auth.admin.deleteUser(uatEducator.id);

// ── UAT §4: tenant isolation (assessor in a different hospital) ──────────────
const { data: isoHosp } = await admin.from("hospitals")
  .insert({ name: "TEST — Isolation Hospital", organisation_id: ORG, country: "Uganda" }).select("id").single();
if (isoHosp) {
  created.outsider = await makeUser("testoutsider@competen.test", "Test Outsider", "assessor", isoHosp.id);
  const outsiderLogin = await login(created.outsider.email, created.outsider.password);
  r = await send("POST", "/api/passports/request-evidence", outsiderLogin.cookies, { nurse_id: created.nurse.id });
  record("uat:isolation", "cross-tenant evidence request blocked", r.status === 403, `status ${r.status}`);
  r = await send("POST", "/api/messages", outsiderLogin.cookies, { recipient_id: created.nurse.id, text: "TEST — cross-tenant message" });
  record("uat:isolation", "cross-tenant message blocked", r.status === 403, `status ${r.status}`);
  r = await send("PATCH", "/api/quality/capa", outsiderLogin.cookies, { id: capaId, status: "completed" });
  record("uat:isolation", "cross-tenant CAPA update blocked", r.status === 403, `status ${r.status}`);
} else {
  record("uat:isolation", "isolation hospital created", false, "hospitals insert failed");
}

// ── UAT §7: secure uploads ───────────────────────────────────────────────────
{
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([0x4d, 0x5a, 1, 2, 3, 4])], "malware.exe", { type: "application/x-msdownload" }));
  const res = await fetch(BASE + "/api/evidence", { method: "POST", headers: { Cookie: nurse.cookies }, body: fd });
  record("uat:security", "executable upload rejected by mime allow-list", res.status === 400, `status ${res.status}`);
}

// ── UAT §8: performance & reliability (dev server, warm) ─────────────────────
{
  const t0 = Date.now();
  const res = await get("/assessor", assessor.cookies);
  const ms = Date.now() - t0;
  record("uat:performance", "dashboard responds under 4s (warm dev)", res.status === 200 && ms < 4000, `${ms}ms`);
  const five = await Promise.all(Array.from({ length: 5 }, () => get("/assessor/reports", assessor.cookies)));
  record("uat:performance", "5 concurrent analytics loads all succeed", five.every(x => x.status === 200), five.map(x => x.status).join(","));
}

// ── Cross-workspace integration (Nurse ↔ Assessor spec) ─────────────────────
// §1 Assignment visible on both sides
r = await send("POST", "/api/schedule", assessor.cookies, {
  nurse_id: created.nurse.id, method: "direct_observation",
  scheduled_for: new Date(Date.now() + 3 * 86400000).toISOString(),
  location: "Test Ward B", note: "TEST — cross-workspace assignment",
});
body = await r.json().catch(() => ({}));
const xSchedId = body.id;
record("xworkspace", "§1 assessor assigns a session", r.status === 201 && !!xSchedId, `status ${r.status}`);
{
  const res = await get("/dashboard/notifications", nurse.cookies);
  const html = await res.text();
  record("xworkspace", "§1 nurse sees the assignment notification", res.status === 200 && html.includes("Assessment scheduled"), `status ${res.status}`);
  const res2 = await get("/assessor/schedule", assessor.cookies);
  const html2 = await res2.text();
  record("xworkspace", "§1 session visible in assessor schedule", res2.status === 200 && html2.includes("Test Nurse"), `status ${res2.status}`);
}
{
  const nurseAuthed = anon();
  await nurseAuthed.auth.signInWithPassword({ email: created.nurse.email, password: created.nurse.password });
  const { data: mySessions } = await nurseAuthed.from("scheduled_assessments").select("id").eq("nurse_id", created.nurse.id);
  record("xworkspace", "§1 nurse reads own session via RLS", (mySessions ?? []).length >= 1, `${mySessions?.length ?? 0} rows`);
  // No signOut(): default scope revokes ALL of the user's sessions globally,
  // which would kill the nurse's app cookie session mid-battery.
}
// §3 Evidence linkage visible to the assessor immediately
r = await send("POST", "/api/logbook", nurse.cookies, { skill_name: "TEST — cross-workspace evidence", supervision_level: "supervised", location: "Test Ward" });
record("xworkspace", "§3 nurse logs an evidence entry", [200, 201].includes(r.status), `status ${r.status}`);
{
  const res = await get("/assessor/logbook", assessor.cookies);
  const html = await res.text();
  record("xworkspace", "§3 entry appears in assessor Evidence Centre", res.status === 200 && html.includes("cross-workspace evidence"), `status ${res.status}`);
}
// §6/§9 Decision → nurse passport parity
const { data: xCompName } = await admin.from("framework_competencies").select("name").eq("id", anyComp.id).single();
{
  const res = await get("/dashboard/passport", nurse.cookies);
  const html = await res.text();
  record("xworkspace", "§6/§9 nurse passport shows the decided competency", res.status === 200 && html.includes((xCompName?.name ?? "").slice(0, 24)), `status ${res.status}`);
}
// §8 Feedback parity: assessor's cockpit note visible in nurse feedback
{
  const res = await get("/dashboard/feedback", nurse.cookies);
  const html = await res.text();
  record("xworkspace", "§8 assessor note visible in nurse feedback", res.status === 200 && html.includes("observed full procedure"), `status ${res.status}`);
}
// §11 Learning pathway regenerated from decision gaps
const { data: pathItems } = await admin.from("pathway_items")
  .select("id, learning_pathways!inner(nurse_id)").eq("learning_pathways.nurse_id", created.nurse.id);
record("xworkspace", "§11 failed decision generated pathway items", (pathItems ?? []).length >= 1, `${pathItems?.length ?? 0} items`);
// §12 Cancellation syncs both calendars and notifies
r = await send("PATCH", "/api/schedule", assessor.cookies, { id: xSchedId, status: "cancelled" });
const { data: xCancelNotif } = await admin.from("notifications").select("id").eq("user_id", created.nurse.id).eq("type", "assessment_cancelled");
record("xworkspace", "§12 cancellation syncs and notifies the nurse", r.status === 200 && (xCancelNotif ?? []).length >= 1, `status ${r.status}, ${xCancelNotif?.length ?? 0} notifications`);
// §16 Dual-role switching without logout, with audit trail
created.dual = await makeUser("testdual@competen.test", "Test Dual Role", "nurse");
await admin.from("profiles").update({ roles: ["nurse", "assessor"] }).eq("id", created.dual.id);
const dualLogin = await login(created.dual.email, created.dual.password);
r = await send("POST", "/api/auth/switch-role", dualLogin.cookies, { role: "assessor" });
body = await r.json().catch(() => ({}));
record("xworkspace", "§16 dual-role user switches to assessor", r.status === 200 && body.redirect === "/assessor", `status ${r.status} → ${body.redirect}`);
{
  const res = await get("/assessor", dualLogin.cookies);
  record("xworkspace", "§16 assessor workspace accessible after switch", res.status === 200, `status ${res.status}`);
}
r = await send("POST", "/api/auth/switch-role", dualLogin.cookies, { role: "nurse" });
record("xworkspace", "§16 switch back to nurse allowed", r.status === 200, `status ${r.status}`);
const { data: switchAudit } = await admin.from("audit_log").select("id").eq("actor_id", created.dual.id).eq("action", "switch_role");
record("xworkspace", "§16 role switches recorded in audit log", (switchAudit ?? []).length >= 2, `${switchAudit?.length ?? 0} audit rows`);
{
  // Regression: /dashboard must render the clinician home even when
  // active_role points elsewhere — it must never bounce back to a portal
  // (the "jumping between workspaces" loop for multi-role users).
  const res = await get("/dashboard", `${dualLogin.cookies}; active_role=assessor`);
  const html = await res.text();
  record("xworkspace", "§16 nurse home reachable with non-nurse active_role (no bounce)", res.status === 200 && html.includes("👋"), `status ${res.status}`);
}
{
  // Regression: logout must redirect with 303 (See Other). The default 307
  // preserves POST, making the browser re-POST /login → 405 in production.
  // Runs LAST for the dual user — signOut revokes their sessions globally.
  const res = await fetch(BASE + "/api/auth/logout", { method: "POST", headers: { Cookie: dualLogin.cookies }, redirect: "manual" });
  const loc = res.headers.get("location") ?? "";
  record("xworkspace", "logout 303-redirects to login (no 405 re-POST)", res.status === 303 && loc.includes("/login"), `status ${res.status} → ${loc}`);
}

// Assessment Studio: full authoring chain (skill → attach → checklist →
// critical item → question bank → question) as an ASSESSOR via /api/studio.
r = await send("POST", "/api/studio", assessor.cookies, { kind: "skill", name: "TEST — Aseptic non-touch technique" });
body = await r.json().catch(() => ({}));
const studioSkillId = body.id;
record("assessor:studio", "assessor creates a library skill", r.status === 201 && !!studioSkillId, `status ${r.status}`);
r = await send("POST", "/api/studio", assessor.cookies, { kind: "attach_skill", skill_id: studioSkillId, competency_id: anyComp.id });
body = await r.json().catch(() => ({}));
const studioCompSkillId = body.id;
record("assessor:studio", "skill attached to a competency", r.status === 201 && !!studioCompSkillId, `status ${r.status}`);
r = await send("POST", "/api/studio", assessor.cookies, { kind: "checklist", skill_id: studioCompSkillId, name: "TEST — ANTT checklist" });
body = await r.json().catch(() => ({}));
const studioChecklistId = body.id;
record("assessor:studio", "checklist created on the skill", r.status === 201 && !!studioChecklistId, `status ${r.status}`);
r = await send("POST", "/api/studio", assessor.cookies, { kind: "checklist_item", checklist_id: studioChecklistId, item: "TEST — performs hand hygiene before contact", is_critical: true });
record("assessor:studio", "critical checklist item added", r.status === 201, `status ${r.status}`);
r = await send("POST", "/api/studio", assessor.cookies, { kind: "question_bank", name: "TEST — Medication safety bank", pass_mark: 80 });
body = await r.json().catch(() => ({}));
const studioBankId = body.id;
record("assessor:studio", "question bank created", r.status === 201 && !!studioBankId, `status ${r.status}`);
r = await send("POST", "/api/studio", assessor.cookies, { kind: "bank_question", bank_id: studioBankId, content: "TEST — Which right is checked first?", options: ["Right patient", "Right route"], correct_index: 0 });
record("assessor:studio", "question added to bank", r.status === 201, `status ${r.status}`);
r = await send("POST", "/api/studio", nurse.cookies, { kind: "skill", name: "TEST — rogue skill" });
record("assessor:studio", "nurse role cannot author", r.status === 403, `status ${r.status}`);
r = await send("POST", "/api/studio", assessor.cookies, { kind: "clone_cpu", cpu_id: anyComp.id });
record("assessor:studio", "assessor blocked from CPU governance", r.status === 403, `status ${r.status}`);
// Studio cleanup (reverse order; checklist_items cascade via checklist delete is not defined — remove explicitly)
if (studioChecklistId) {
  const { data: sItems } = await admin.from("checklist_items").select("id").eq("checklist_id", studioChecklistId);
  for (const it of sItems ?? []) await admin.from("checklist_items").delete().eq("id", it.id);
  await admin.from("skill_checklists").delete().eq("id", studioChecklistId);
}
if (studioCompSkillId) await admin.from("competency_skills").delete().eq("id", studioCompSkillId);
if (studioSkillId) await admin.from("skill_library").delete().eq("id", studioSkillId);
if (studioBankId) {
  await admin.from("questions").delete().eq("bank_id", studioBankId);
  await admin.from("question_banks").delete().eq("id", studioBankId);
}

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
  record("permissions", "footer workspace control visible (single-role: access statement)", html.includes("Workspace access"), "");
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
  for (const uid of [created.nurse.id, created.assessor.id, ...(created.outsider ? [created.outsider.id] : []), ...(created.dual ? [created.dual.id] : [])]) {
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
  await admin.from("hospitals").delete().ilike("name", "TEST — %");
  console.log("Removed test accounts and their data.");
} else {
  console.log(`\n--keep: test accounts left in place (${created.nurse.email} / ${created.assessor.email})`);
}

// Summary
const fails = results.filter(x => !x.pass);
console.log(`\n${"─".repeat(60)}\n${results.length} checks · ${results.length - fails.length} passed · ${fails.length} failed`);
if (fails.length) { console.log("\nFailures:"); for (const f of fails) console.log(`  ✗ [${f.section}] ${f.name} — ${f.note}`); }
process.exit(fails.length ? 1 : 0);
