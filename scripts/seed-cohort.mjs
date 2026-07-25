// ============================================================================
// COHORT SEED — a realistic Acute Medical Unit (AMU) ward, end to end.
// ----------------------------------------------------------------------------
// WHY: Competen's manager / exec / CMO / quality surfaces are *consolidation
// lenses* over shared stores written by frontline workers (cpd_logs,
// learning_enrolments, professional_credentials, competency_decisions, op_*).
// Those lenses only look authentic once a real staff cohort has PRODUCED data.
// This script seeds that cohort so every downstream workspace lights up with
// coherent, cross-referential numbers instead of an empty state.
//
// WHAT IT CREATES (idempotent — safe no-op if already seeded):
//   • 1 ward manager (Ruth Nabwire, hospital_admin) + 24 nurses on an "Acute
//     Medical Unit (AMU)" department, every profile.hospital_id + department_id
//     set (the CPD/competency loops scope THROUGH profile.hospital_id).
//   • Per worker: CPD logs, mandatory-learning enrolments, professional
//     credentials, and (if a competency framework exists) a completed
//     competency cycle with decisions — all with a realistic compliance spread.
//   • Ward operations: patients, shifts + staffing, patient assignments,
//     observations, tasks, escalations, safety alerts, incidents, and CAPA/
//     quality actions.
//
// AUTH USERS: staff need auth.users rows (profiles.id → auth.users.id). This
// script creates them via the service-role admin API. Emails are namespaced
// "<first>.<last>@amu.competen.demo" so the cohort is easy to identify / purge.
// All share the password below (demo accounts — change or disable as needed).
//
// BOUNDARY: this WRITES to the database + Auth in .env.local. Re-run with
// --confirm to proceed. To re-seed from scratch, delete the AMU cohort first
// (the "@amu.competen.demo" auth users cascade-delete their produced rows).
//
// Run:  node scripts/seed-cohort.mjs --confirm
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--confirm")) {
  console.error("This script WRITES to the database + Auth in .env.local. Re-run with --confirm to proceed.");
  process.exit(1);
}

// Credentials: prefer shell env vars; otherwise read .env.local at the project root.
// The path is resolved relative to THIS file (import.meta.url), so it works no
// matter which directory you launch the script from.
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  const envUrl = new URL("../.env.local", import.meta.url);
  let raw;
  try {
    raw = readFileSync(envUrl, "utf8");
  } catch (e) {
    console.error(
      `Could not read .env.local at:\n  ${fileURLToPath(envUrl)}\n` +
      `→ Ensure .env.local exists at the competen-healthcare root, or set\n` +
      `  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell first.\n  (${e.message})`,
    );
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (checked shell env + .env.local).");
  process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── helpers ─────────────────────────────────────────────────────────────────
const die = (msg) => { console.error("ABORT:", msg); process.exit(1); };
const iso = (d) => d.toISOString().slice(0, 10);
const dateFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const ts = (daysOffset, hour = 9) => { const d = new Date(); d.setDate(d.getDate() + daysOffset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const at = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];   // deterministic spread
const DEMO_PASSWORD = "Competen#Demo-2026";
const COHORT_DOMAIN = "amu.competen.demo";
const emailFor = (first, last) => `${first}.${last}@${COHORT_DOMAIN}`.toLowerCase();

async function insert(table, row) {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (error) die(`${table}: ${error.message}`);
  return data.id;
}
async function insertMany(table, rows) {
  if (!rows.length) return [];
  const { data, error } = await db.from(table).insert(rows).select("id");
  if (error) die(`${table}: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

// Create (or look up) an auth user; the on_auth_user_created trigger materialises
// the profile row. Returns the profile id. Idempotent per-email.
async function ensureUser(first, last) {
  const email = emailFor(first, last);
  const full_name = `${first} ${last}`;
  const { data: created, error } = await db.auth.admin.createUser({
    email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name },
  });
  if (!error && created?.user) return { id: created.user.id, email, full_name };
  // Already registered → resolve the existing profile by email.
  const { data: prof } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (prof) return { id: prof.id, email, full_name };
  die(`could not create or find auth user ${email}: ${error?.message ?? "unknown"}`);
}

// ── cast ────────────────────────────────────────────────────────────────────
const MANAGER = ["Ruth", "Nabwire"];
const NURSES = [
  ["Sarah", "Namutebi"], ["David", "Okello"], ["Miriam", "Auma"], ["Joseph", "Kato"],
  ["Esther", "Nabirye"], ["Samuel", "Wanyama"], ["Rebecca", "Achieng"], ["Daniel", "Mugisha"],
  ["Florence", "Nakimuli"], ["Peter", "Ssali"], ["Agnes", "Nafula"], ["Emmanuel", "Tumusiime"],
  ["Joan", "Akello"], ["Isaac", "Byaruhanga"], ["Winnie", "Nabukenya"], ["Robert", "Ochieng"],
  ["Catherine", "Nassali"], ["Brian", "Kirya"], ["Lydia", "Amoding"], ["Moses", "Wamala"],
  ["Christine", "Nakintu"], ["Henry", "Opio"], ["Betty", "Namusoke"], ["Andrew", "Mwesigwa"],
];

// ── idempotency guard ────────────────────────────────────────────────────────
const managerEmail = emailFor(...MANAGER);
{
  const { data: existing } = await db.from("profiles").select("id").eq("email", managerEmail).maybeSingle();
  if (existing) {
    console.log(`AMU cohort already seeded (${managerEmail} exists) — nothing to do.\n` +
      `To re-seed, delete the "@${COHORT_DOMAIN}" auth users first (they cascade their produced rows).`);
    process.exit(0);
  }
}

console.log("Seeding AMU ward cohort…");

// ── resolve hospital + assessor ──────────────────────────────────────────────
async function resolveHospital() {
  const { data: p } = await db.from("profiles").select("hospital_id").not("hospital_id", "is", null).limit(1);
  if (p?.[0]?.hospital_id) return p[0].hospital_id;
  const { data: h } = await db.from("hospitals").select("id").limit(1);
  if (h?.[0]?.id) return h[0].id;
  console.log("  No hospital found — creating 'Competen Demo Hospital'.");
  return insert("hospitals", { name: "Competen Demo Hospital", country: "Uganda", city: "Kampala", tier: "enterprise" });
}
const hospitalId = await resolveHospital();

// An existing assessor/admin validates competencies + credentials if one exists;
// otherwise the ward manager (created below) stands in.
const { data: assessors } = await db.from("profiles")
  .select("id, full_name, role").in("role", ["super_admin", "assessor", "hospital_admin"]).limit(5);
let assessor = (assessors ?? []).find((a) => /elisha|super/i.test(a.full_name ?? "")) ?? (assessors ?? [])[0] ?? null;

// ── ward department ──────────────────────────────────────────────────────────
async function ensureDept(name, specialty) {
  const { data: d } = await db.from("departments").select("id").eq("hospital_id", hospitalId).eq("name", name).maybeSingle();
  if (d) return d.id;
  return insert("departments", { hospital_id: hospitalId, name, specialty, is_active: true });
}
const amuId = await ensureDept("Acute Medical Unit (AMU)", "Acute Internal Medicine");

// ── create cohort (manager + 24 nurses) ──────────────────────────────────────
const manager = await ensureUser(...MANAGER);
await db.from("profiles").update({
  role: "hospital_admin", hospital_id: hospitalId, department_id: amuId,
  specialization: "Unit Manager — AMU", country: "Uganda",
}).eq("id", manager.id);
if (!assessor) assessor = { id: manager.id, full_name: manager.full_name };
const managerId = manager.id;
const assessorId = assessor.id;
const assessorName = assessor.full_name ?? manager.full_name;

const SPECIALIZATIONS = ["Charge Nurse", "Registered Nurse", "Critical Care Nurse", "Registered Nurse", "Enrolled Nurse", "Registered Nurse"];
const staff = [];
for (let i = 0; i < NURSES.length; i++) {
  const u = await ensureUser(...NURSES[i]);
  const spec = i < 2 ? "Charge Nurse" : i >= 19 ? "Enrolled Nurse" : at(SPECIALIZATIONS, i + 1);
  await db.from("profiles").update({
    role: "nurse", hospital_id: hospitalId, department_id: amuId, specialization: spec, country: "Uganda",
  }).eq("id", u.id);
  staff.push({ ...u, band: i < 2 ? "charge" : i >= 19 ? "junior" : "senior" });
}
console.log(`  ✓ ${staff.length} nurses + 1 ward manager on AMU (hospital ${hospitalId.slice(0, 8)}…)`);

// ── CPD logs (feeds worker passport + UMW/CMO PD lens) ───────────────────────
// profile.hospital_id (set above) is how the CPD lens scopes these — cpd_logs has none.
const CPD_TYPES = ["course", "workshop", "conference", "self_study", "simulation"];
const CPD_TITLES = [
  "Sepsis recognition & Sepsis Six", "Deteriorating patient (NEWS2) study day", "Safe insulin administration",
  "Venous thromboembolism prevention", "Advanced wound care workshop", "Blood transfusion safety update",
  "End-of-life care conversations", "Falls prevention in the older adult", "Antimicrobial stewardship webinar",
  "Fluid balance & AKI recognition",
];
const cpdRows = [];
const cpdCounts = [3, 4, 2, 5, 1, 3, 0, 2, 4, 3, 2, 5, 3, 1, 2, 4, 3, 0, 2, 3, 1, 4, 2, 3];
staff.forEach((s, i) => {
  const n = at(cpdCounts, i);
  for (let k = 0; k < n; k++) {
    const hours = at([1, 1.5, 2, 3, 4, 6], i + k);
    cpdRows.push({
      user_id: s.id,
      activity_type: at(CPD_TYPES, i + k),
      title: at(CPD_TITLES, i * 3 + k),
      hours,
      cpd_points: Math.max(1, Math.round(hours)),
      activity_date: dateFromNow(-at([12, 40, 75, 110, 150, 25, 60, 95], i + k)),
      verified: (i + k) % 4 !== 0,
    });
  }
});
await insertMany("cpd_logs", cpdRows);
console.log(`  ✓ ${cpdRows.length} CPD logs`);

// ── mandatory learning (feeds Loop 2: worker "My Training" + UMW compliance) ──
const COURSES = [
  { code: "BLS-01", title: "Basic Life Support (BLS)", course_type: "classroom", validity_months: 12 },
  { code: "IPC-01", title: "Infection Prevention & Control", course_type: "elearning", validity_months: 12 },
  { code: "FIRE-01", title: "Fire Safety", course_type: "elearning", validity_months: 12 },
  { code: "MH-01", title: "Moving & Handling", course_type: "classroom", validity_months: 24 },
  { code: "SG-01", title: "Safeguarding Adults", course_type: "elearning", validity_months: 36 },
  { code: "MEDS-01", title: "Medication Safety", course_type: "elearning", validity_months: 12 },
];
const courseIds = [];
for (const c of COURSES) {
  courseIds.push(await insert("learning_courses", {
    hospital_id: hospitalId, code: c.code, title: c.title, course_type: c.course_type,
    mandatory: true, validity_months: c.validity_months, status: "active", active: true, created_by: managerId,
  }));
}
const assignmentId = await insert("learning_assignments", {
  hospital_id: hospitalId, name: "AMU Mandatory Training", assignment_type: "mandatory",
  audience: { org: "hospital", role: ["nurse"], unit: "AMU" }, mandatory: true,
  start_date: dateFromNow(-180), due_date: dateFromNow(30), priority: "high", active: true, created_by: managerId,
});
// Status matrix: mostly completed, a realistic tail of in_progress / overdue / not_started.
const enrolRows = [];
staff.forEach((s, i) => {
  COURSES.forEach((c, ci) => {
    const k = (i + ci) % 7;
    let status = "completed", progress = 100, due = dateFromNow(at([120, 200, 300], i + ci)), completedAt = ts(-at([10, 30, 60, 90], i + ci), 14);
    if (k === 0) { status = "overdue"; progress = at([20, 40, 60], i); due = dateFromNow(-at([5, 15, 30], i)); completedAt = null; }
    else if (k === 1) { status = "in_progress"; progress = at([25, 50, 75], i); due = dateFromNow(at([10, 25, 45], i)); completedAt = null; }
    else if (k === 2 && i % 5 === 0) { status = "not_started"; progress = 0; due = dateFromNow(at([20, 40], i)); completedAt = null; }
    enrolRows.push({
      hospital_id: hospitalId, user_id: s.id, course_id: courseIds[ci], assignment_id: assignmentId,
      status, progress_pct: progress, mandatory: true, due_date: due,
      score: status === "completed" ? at([78, 84, 90, 96, 100], i + ci) : null,
      completed_at: completedAt,
    });
  });
});
await insertMany("learning_enrolments", enrolRows);
console.log(`  ✓ ${COURSES.length} mandatory courses + ${enrolRows.length} enrolments`);

// ── professional credentials (feeds worker passport + CMO expiry watch) ──────
const credRows = [];
const RN_EXPIRY = [420, 380, 45, 500, -15, 300, 60, 410, 90, 350, 250, 30];   // days; a few expiring soon, one expired
staff.forEach((s, i) => {
  const exp = at(RN_EXPIRY, i);
  credRows.push({
    nurse_id: s.id, hospital_id: hospitalId, credential_type: "professional_license",
    title: "Registered Nurse", issuing_body: "Uganda Nurses and Midwives Council",
    issue_date: dateFromNow(-at([730, 900, 1100, 640], i)), expiry_date: dateFromNow(exp),
    status: exp < 0 ? "expired" : "active", verified: i % 4 !== 0,
    verified_by: i % 4 !== 0 ? assessorId : null, verified_at: i % 4 !== 0 ? ts(-at([20, 60, 120], i), 11) : null,
  });
  // ~1 in 3 also hold a BLS provider certificate (specialty_certification).
  if (i % 3 === 0) {
    const bexp = at([200, 40, -10, 320], i);
    credRows.push({
      nurse_id: s.id, hospital_id: hospitalId, credential_type: "specialty_certification",
      title: "BLS Provider", issuing_body: "Uganda Heart Institute",
      issue_date: dateFromNow(-at([300, 500, 700], i)), expiry_date: dateFromNow(bexp),
      status: bexp < 0 ? "expired" : "active", verified: i % 2 === 0,
      verified_by: i % 2 === 0 ? assessorId : null, verified_at: i % 2 === 0 ? ts(-30, 11) : null,
    });
  }
});
await insertMany("professional_credentials", credRows);
console.log(`  ✓ ${credRows.length} professional credentials`);

// ── competency decisions (feeds CMO/UMW readiness + reassessment forecast) ───
// competency_decisions has no hospital_id — it scopes through nurse_id → profile.hospital_id.
let framework = null, comps = [];
{
  const { data: fws } = await db.from("frameworks").select("id, name");
  for (const f of fws ?? []) {
    const { data: fc } = await db.from("framework_competencies")
      .select("id, code, name, cpu_id, framework_id").eq("framework_id", f.id).limit(3);
    if ((fc?.length ?? 0) >= 2) { framework = f; comps = fc; break; }
  }
}
if (framework) {
  // outcome / maturity / expiry(days) plans — mostly competent, a tail of gaps + expiring.
  const PLANS = [
    { outcome: "competent", maturity: "proficient", exp: 365, validated: true },
    { outcome: "competent", maturity: "competent", exp: 365, validated: true },
    { outcome: "competent", maturity: "competent", exp: 45, validated: true },   // due-soon → forecast
    { outcome: "requires_remediation", maturity: "advanced_beginner", exp: null, validated: false }, // gap → pathway/risk
    { outcome: "competent", maturity: "expert", exp: -20, validated: true },      // expired → risk
    { outcome: "provisionally_competent", maturity: "advanced_beginner", exp: 180, validated: true },
  ];
  let cycleCount = 0, decCount = 0;
  const decRows = [];
  for (let i = 0; i < staff.length; i++) {
    const s = staff[i];
    const cycleId = await insert("competency_cycles", {
      nurse_id: s.id, hospital_id: hospitalId, cycle_type: "annual", status: "completed",
      start_date: dateFromNow(-at([40, 90, 200, 320], i)), end_date: dateFromNow(-at([10, 30, 60], i)),
      notes: "AMU-COHORT", created_by: assessorId, min_assessors: 1, consensus_rule: "any",
    });
    cycleCount++;
    comps.forEach((c, ci) => {
      const p = at(PLANS, i + ci * 2);
      decRows.push({
        cycle_id: cycleId, nurse_id: s.id, cpu_id: c.cpu_id ?? null, competency_id: c.id, framework_id: framework.id,
        outcome: p.outcome, maturity: p.maturity, decided_by: assessorId, decided_by_name: assessorName,
        effective_date: dateFromNow(-at([10, 30, 60], i)),
        expiry_date: p.exp == null ? null : dateFromNow(p.exp),
        critical_failure: false,
        validated_by: p.validated ? assessorId : null,
        validated_at: p.validated ? ts(-at([12, 40], i), 15) : null,
        validation_outcome: p.validated ? "validated" : null,
      });
      decCount++;
    });
  }
  await insertMany("competency_decisions", decRows);
  console.log(`  ✓ ${cycleCount} competency cycles + ${decCount} decisions (framework: ${framework.name})`);
} else {
  console.log("  ⚠ No framework with ≥2 competencies found — skipped competency decisions.");
  console.log("    (Run scripts/seed-demo.mjs first to seed the demo framework, then re-run to add competency data.)");
}

// ── ward operations ──────────────────────────────────────────────────────────
// Patients (operational objects — labels only, never PHI).
const ACUITY = ["stable", "moderate", "high", "critical"];
const DEP = ["level_0", "level_1", "level_2", "level_3"];
const ISO = ["none", "none", "none", "contact", "droplet"];
const RISK = ["low", "low", "medium", "high"];
const OPSTAT = ["admitted", "admitted", "admitted", "discharge_pending"];
const patientRows = [];
const PT_ALIAS = ["J.M.", "A.O.", "F.N.", "S.K.", "R.A.", "D.W.", "P.S.", "M.B.", "C.N.", "E.T.", "L.A.", "H.O."];
for (let i = 0; i < 12; i++) {
  patientRows.push({
    hospital_id: hospitalId, department_id: amuId,
    label: `Bed ${i + 1} — ${at(PT_ALIAS, i)}`,
    acuity_level: at(ACUITY, i), dependency_level: at(DEP, i), isolation_status: at(ISO, i),
    risk_level: at(RISK, i), operational_status: at(OPSTAT, i), created_by: managerId,
  });
}
const patientIds = await insertMany("op_patients", patientRows);

// Shifts: yesterday (completed), today day (active), today night (planned).
const shiftYesterday = await insert("op_shifts", {
  hospital_id: hospitalId, department_id: amuId, shift_type: "day", shift_date: dateFromNow(-1),
  starts_at: ts(-1, 8), ends_at: ts(-1, 20), supervisor_id: managerId, status: "completed", created_by: managerId,
});
const shiftDay = await insert("op_shifts", {
  hospital_id: hospitalId, department_id: amuId, shift_type: "day", shift_date: dateFromNow(0),
  starts_at: ts(0, 8), ends_at: ts(0, 20), supervisor_id: managerId, status: "active", created_by: managerId,
});
const shiftNight = await insert("op_shifts", {
  hospital_id: hospitalId, department_id: amuId, shift_type: "night", shift_date: dateFromNow(0),
  starts_at: ts(0, 20), ends_at: ts(1, 8), supervisor_id: managerId, status: "planned", created_by: managerId,
});

// Staff the active day shift (first ~10 nurses; 1 charge, a couple support).
const onShift = staff.slice(0, 10);
await insertMany("op_shift_staff", onShift.map((s, i) => ({
  shift_id: shiftDay, staff_id: s.id,
  role: i === 0 ? "charge" : i >= 8 ? "support" : "nurse",
  status: "on_duty",
})));

// Assign patients to on-shift nurses (competency-validated mix).
await insertMany("op_patient_assignments", patientIds.map((pid, i) => ({
  hospital_id: hospitalId, patient_id: pid, staff_id: onShift[(i % (onShift.length - 1)) + 1].id, shift_id: shiftDay,
  assignment_type: "primary", competency_validated: i % 4 !== 0, status: "active", created_by: managerId,
})));

// Observations — 2 per patient; a few trigger concern / escalation.
const obsRows = [];
patientIds.forEach((pid, i) => {
  const highAcuity = at(ACUITY, i) === "critical" || at(ACUITY, i) === "high";
  for (let k = 0; k < 2; k++) {
    const concern = highAcuity && k === 1;
    obsRows.push({
      hospital_id: hospitalId, patient_id: pid, department_id: amuId, shift_id: shiftDay,
      observation_type: k === 0 ? "vital_signs" : "pews", status: "recorded",
      scheduled_for: ts(0, 10 + k * 4), recorded_at: ts(0, 10 + k * 4),
      observer_id: onShift[(i % (onShift.length - 1)) + 1].id,
      findings: k === 0
        ? { rr: at([16, 18, 20, 22], i), spo2: at([98, 97, 95, 93], i), hr: at([72, 84, 96, 110], i), bp: at(["124/78", "132/84", "108/66", "146/92"], i), temp: at([36.8, 37.1, 37.6, 38.2], i) }
        : { pews: concern ? at([5, 6, 7], i) : at([0, 1, 2], i) },
      ews_score: k === 1 ? (concern ? at([5, 6, 7], i) : at([0, 1, 2], i)) : null,
      concern, escalation_triggered: concern,
      validation_status: i % 3 === 0 ? "validated" : "pending",
      created_by: onShift[(i % (onShift.length - 1)) + 1].id,
    });
  }
});
await insertMany("op_observations", obsRows);

// Tasks — meds / mobilise / review across patients.
const TASK_TYPES = ["medication", "mobilisation", "review", "observation", "hygiene"];
const TASK_DESC = ["Administer 10:00 medications", "Assist with mobilisation", "Medical review requested", "Repeat NEWS2 observations", "Pressure-area care round"];
const TASK_STATUS = ["completed", "in_progress", "assigned", "created", "completed"];
const taskRows = [];
patientIds.forEach((pid, i) => {
  const count = i % 3 === 0 ? 2 : 1;
  for (let k = 0; k < count; k++) {
    const st = at(TASK_STATUS, i + k);
    taskRows.push({
      hospital_id: hospitalId, patient_id: pid, shift_id: shiftDay,
      task_type: at(TASK_TYPES, i + k), description: at(TASK_DESC, i + k),
      assigned_to: onShift[(i % (onShift.length - 1)) + 1].id, assigned_by: managerId,
      priority: at(["normal", "normal", "high", "urgent"], i + k),
      due_at: ts(0, 12 + k * 3), status: st,
      completed_at: st === "completed" ? ts(0, 11 + k) : null,
    });
  }
});
await insertMany("op_tasks", taskRows);

// Escalations — on the highest-acuity patients (mix of open / resolved).
const escRows = [];
[2, 6, 11].forEach((pi, k) => {
  const open = k === 2;
  escRows.push({
    hospital_id: hospitalId, patient_id: patientIds[pi], shift_id: shiftDay,
    escalation_type: "clinical", level: at([2, 3, 4], k), severity: at(["urgent", "high", "emergency"], k),
    summary: at(["NEWS2 rising — SpO2 falling on room air", "New confusion + tachycardia, ?sepsis", "Chest pain with ECG changes — medical team paged"], k),
    raised_by: onShift[k + 1].id, assigned_responder: managerId,
    response_deadline: ts(0, 13 + k), status: open ? "open" : "resolved",
    resolution: open ? null : "Reviewed by medical team; plan escalated and documented.",
    resolved_at: open ? null : ts(0, 14 + k),
  });
});
await insertMany("op_escalations", escRows);

// Safety alerts (active).
await insertMany("op_safety_alerts", [
  { hospital_id: hospitalId, patient_id: patientIds[0], category: "fall_risk", severity: "high", note: "Confused, unsteady gait — bed rails + hourly rounding.", active: true, owner_id: onShift[1].id, created_by: managerId },
  { hospital_id: hospitalId, patient_id: patientIds[4], category: "pressure_injury", severity: "medium", note: "Category 2 sacral pressure injury — 2-hourly repositioning.", active: true, owner_id: onShift[2].id, created_by: managerId },
  { hospital_id: hospitalId, patient_id: patientIds[3], category: "infection", severity: "high", note: "Contact precautions — suspected C. difficile, side room.", active: true, owner_id: onShift[3].id, created_by: managerId },
  { hospital_id: hospitalId, patient_id: patientIds[6], category: "deterioration", severity: "high", note: "Escalating NEWS2 — critical-care outreach aware.", active: true, owner_id: managerId, created_by: managerId },
]);

// Incidents — the Loop 6 downstream (SSW + UMG-QS incident lenses). Reported by
// frontline staff over the last three weeks; a realistic type/severity/status mix.
const INC = [
  { t: "medication", sev: "medium", nm: false, st: "investigating", d: "Insulin given 30 min late due to delayed meal tray; no harm — reviewing timing." },
  { t: "falls", sev: "high", nm: false, st: "closed", d: "Unwitnessed fall while mobilising to bathroom; minor skin tear dressed.", ca: "Falls bundle re-applied; bed alarm in place." },
  { t: "pressure_injury", sev: "medium", nm: false, st: "awaiting_action", d: "Category 2 pressure injury identified on sacrum during hygiene round." },
  { t: "medication", sev: "low", nm: true, st: "closed", d: "Near-miss: wrong-strength ampoule selected, caught at second check.", ca: "Look-alike stock separated in the medication room." },
  { t: "equipment", sev: "medium", nm: false, st: "reported", d: "Infusion pump alarming intermittently; removed from use and swapped." },
  { t: "documentation", sev: "low", nm: true, st: "closed", d: "Near-miss: allergy band missing on admission, added before first dose.", ca: "Admission checklist reinforced at safety huddle." },
  { t: "behaviour", sev: "medium", nm: false, st: "investigating", d: "Verbal aggression from a visitor toward staff; de-escalated, security informed." },
  { t: "infection", sev: "high", nm: false, st: "awaiting_action", d: "Possible cross-infection — two contacts on the bay; IPC team notified." },
];
const incRows = INC.map((x, i) => {
  const reporter = staff[(i * 3) % staff.length];
  return {
    hospital_id: hospitalId, shift_id: i % 2 === 0 ? shiftDay : shiftYesterday,
    incident_type: x.t, severity: x.sev, near_miss: x.nm, patient_id: patientIds[(i * 2) % patientIds.length],
    description: x.d, status: x.st, corrective_action: x.ca ?? null,
    reported_by: reporter.id, reported_by_name: reporter.full_name,
    closed_at: x.st === "closed" ? ts(-at([2, 5, 9], i), 16) : null,
    created_at: ts(-at([1, 4, 8, 12, 16, 20], i), 10),
  };
});
await insertMany("op_incidents", incRows);

// Quality / CAPA actions (feeds UMG-QS CAPA + quality command centre).
await insertMany("op_quality_actions", [
  { hospital_id: hospitalId, action_type: "capa", title: "Reduce late medication rounds on AMU", description: "PDSA on medication-round timing after clustered late-dose incidents.", priority: "high", status: "in_progress", owner_id: managerId, owner_name: manager.full_name, due_at: ts(21, 12), created_by: managerId, created_by_name: manager.full_name },
  { hospital_id: hospitalId, action_type: "audit_action", title: "Falls bundle compliance re-audit", description: "Re-audit falls-risk bundle compliance following a Category-2 fall.", priority: "medium", status: "open", owner_id: onShift[1].id, owner_name: onShift[1].full_name, due_at: ts(30, 12), created_by: managerId, created_by_name: manager.full_name },
  { hospital_id: hospitalId, action_type: "pdsa", title: "Pressure-injury prevention refresh", description: "Repositioning-round PDSA cycle across the ward.", priority: "medium", status: "in_progress", owner_id: onShift[2].id, owner_name: onShift[2].full_name, due_at: ts(14, 12), created_by: managerId, created_by_name: manager.full_name },
  { hospital_id: hospitalId, action_type: "rca", title: "RCA — unwitnessed fall (bay 3)", description: "Root-cause analysis for the unwitnessed fall; actions to falls group.", priority: "high", status: "completed", owner_id: managerId, owner_name: manager.full_name, due_at: ts(-3, 12), completed_at: ts(-2, 15), created_by: managerId, created_by_name: manager.full_name },
  { hospital_id: hospitalId, action_type: "policy_review", title: "Isolation / IPC signage review", description: "Review side-room isolation signage after a cross-infection alert.", priority: "low", status: "overdue", owner_id: onShift[3].id, owner_name: onShift[3].full_name, due_at: ts(-6, 12), created_by: managerId, created_by_name: manager.full_name },
]);

console.log(`  ✓ ${patientRows.length} patients · 3 shifts · ${onShift.length} staffed · ${obsRows.length} observations · ${taskRows.length} tasks · ${escRows.length} escalations · 4 safety alerts · ${incRows.length} incidents · 5 quality actions`);

console.log(`\nAMU cohort seeded. Downstream lenses (Supervisor / Unit Manager / CMO / Exec / Quality) now read authentic ward data.`);
console.log(`Demo logins: <first>.<last>@${COHORT_DOMAIN}  ·  password: ${DEMO_PASSWORD}  ·  manager: ${managerEmail}`);
