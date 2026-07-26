// Seed the Competency Office expansion (migrations 114+115) for AMU: certifications, privileges, assignments,
// forecasts, plans, publications, accreditation mappings, config and AI recommendations. Reuses existing competency_*
// stores for gaps/review/readiness/standards (no seed needed there). Idempotent. Run: node scripts/seed-cmo-expansion.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ins = async (t, rows) => { const { error } = await db.from(t).insert(rows); if (error) { console.error(`${t}:`, error.message); process.exit(1); } };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const dPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const staff = (await db.from("profiles").select("id").eq("hospital_id", H).limit(24)).data ?? [];
const sid = (i) => staff[i % Math.max(1, staff.length)]?.id ?? null;

for (const t of ["cmo_ai_recommendations", "cmo_config", "cmo_accreditations", "cmo_publications", "cmo_plans", "cmo_forecasts", "cmo_assignments", "cmo_privileges", "cmo_certifications"]) await db.from(t).delete().eq("hospital_id", H).then((r) => r, () => {});

const COMPS = ["Medication Administration", "Basic Life Support", "Advanced Life Support", "Venepuncture", "IV Cannulation", "Wound Care", "Urinary Catheterisation", "Blood Transfusion", "Sepsis Management", "Falls Prevention", "Pressure Injury Prevention", "Infection Control", "Manual Handling", "Safeguarding", "Deteriorating Patient (NEWS2)"];

// ── Certifications ──
const CERTS = [["Nursing Registration", "registration", "Nursing Council"], ["BLS Certification", "certification", "Resus Council"], ["ALS Certification", "certification", "Resus Council"], ["Medication Management License", "license", "Pharmacy Board"], ["Infection Control Certificate", "certification", "IPC Academy"], ["Manual Handling Certificate", "mandatory", "H&S Office"], ["Safeguarding Level 2", "mandatory", "Safeguarding Board"], ["Fire Safety Training", "mandatory", "H&S Office"]];
const certRows = [];
for (let i = 0; i < 42; i++) { const [name, cert_type, issuer] = pick(CERTS); const exp = rint(-40, 400); certRows.push({ hospital_id: H, staff_id: sid(i), cert_type, name, issuer, cert_number: `CERT-${rint(10000, 99999)}`, issued_date: dPlus(-rint(200, 1000)), expiry_date: dPlus(exp), status: exp < 0 ? "expired" : exp < 60 ? "expiring" : "active", verified: Math.random() > 0.15 }); }
await ins("cmo_certifications", certRows);

// ── Privileges ──
const PRIVS = [["Central Line Insertion", "procedural"], ["Endotracheal Intubation", "special"], ["Chest Drain Insertion", "procedural"], ["Lumbar Puncture", "procedural"], ["Non-Medical Prescribing", "special"], ["IV Cannulation", "core"], ["Male Catheterisation", "core"], ["IV Chemotherapy Administration", "special"], ["Emergency Airway Management", "emergency"], ["Telemedicine Consultation", "telemedicine"]];
const privRows = [];
for (let i = 0; i < 30; i++) { const [privilege_name, category] = pick(PRIVS); const exp = rint(-20, 500); privRows.push({ hospital_id: H, staff_id: sid(i + 3), privilege_name, category, status: exp < 0 ? "expired" : Math.random() > 0.85 ? "under_review" : "active", granted_date: dPlus(-rint(100, 900)), expiry_date: dPlus(exp), prerequisites_met: Math.random() > 0.1 }); }
await ins("cmo_privileges", privRows);

// ── Assignments ──
const assignRows = [];
const TARGETS = [["Registered Nurses", "role"], ["Ward A3", "department"], ["Night Team", "team"], ["All Clinical Staff", "enterprise"], ["Individual", "individual"]];
for (let i = 0; i < 30; i++) { const [target_label, target_type] = pick(TARGETS); const due = rint(-15, 90); assignRows.push({ hospital_id: H, competency: pick(COMPS), target_type, target_label, method: pick(["role_based", "role_based", "campaign", "rule", "manual"]), campaign: Math.random() > 0.6 ? pick(["Q3 Mandatory Refresh", "Sepsis Drive 2026", "Onboarding Cohort"]) : null, due_date: dPlus(due), status: due < 0 ? pick(["overdue", "completed"]) : pick(["assigned", "in_progress", "completed"]) }); }
await ins("cmo_assignments", assignRows);

// ── Forecasts ──
await ins("cmo_forecasts", COMPS.slice(0, 12).map((competency) => { const supply = rint(8, 40), demand = rint(10, 48), gap = Math.max(0, demand - supply); return { hospital_id: H, competency, current_supply: supply, demand, gap, horizon: pick(["3 months", "6 months", "12 months"]), risk: gap > 12 ? "high" : gap > 5 ? "medium" : "low" }; }));

// ── Plans ──
await ins("cmo_plans", [
  ["Neuro Competency Roadmap 2026", "roadmap", "12 months", 62, 180000], ["Critical Care Upskilling Investment", "investment", "6 months", 41, 240000],
  ["Charge Nurse Succession Plan", "succession", "18 months", 55, 90000], ["Specialist Nurse Recruitment", "recruitment", "9 months", 38, 320000],
  ["Preceptorship Education Programme", "education", "12 months", 74, 60000], ["Sepsis Competency Roadmap", "roadmap", "6 months", 68, 45000],
].map(([name, plan_type, horizon, progress_pct, budget]) => ({ hospital_id: H, name, plan_type, horizon, progress_pct, budget, status: "active" })));

// ── Publications ──
await ins("cmo_publications", [
  ["Adult Nursing Competency Framework v3", "framework", "3.0", "enterprise", "published"], ["Sepsis Assessment Blueprint", "blueprint", "2.1", "role", "published"],
  ["Critical Care Pathway", "pathway", "1.4", "profession", "approved"], ["Medication Safety Standard", "standard", "2.0", "enterprise", "published"],
  ["Preceptorship Package", "package", "1.0", "workspace", "in_review"], ["JCI Competency Mapping", "mapping", "1.2", "enterprise", "scheduled"],
  ["Falls Prevention Framework", "framework", "1.1", "tenant", "draft"], ["ALS Blueprint", "blueprint", "3.0", "role", "published"],
  ["Wound Care Pathway", "pathway", "2.2", "profession", "published"], ["Infection Control Standard", "standard", "1.5", "enterprise", "published"],
].map(([name, artifact_type, version, target, status]) => ({ hospital_id: H, name, artifact_type, version, target, status, published_at: status === "published" ? new Date(Date.now() - rint(1, 90) * 86400000).toISOString() : null })));

// ── Accreditation mappings ──
const STDS = ["JCI", "SafeCare", "Ministry of Health", "ANCC"];
const accrRows = [];
for (let i = 0; i < 18; i++) { const cov = rint(55, 100); accrRows.push({ hospital_id: H, standard: pick(STDS), requirement: `${pick(["Staff competency", "Assessment", "Credentialing", "Privileging", "Mandatory training", "Documentation"])} — ${pick(["IPSG", "COP", "SQE", "PCI", "GLD"])}.${rint(1, 9)}`, mapped_competency: pick(COMPS), coverage_pct: cov, compliance_status: cov >= 90 ? "compliant" : cov >= 70 ? "partial" : "gap", evidence_count: rint(2, 24) }); }
await ins("cmo_accreditations", accrRows);

// ── Config ──
await ins("cmo_config", [
  ["scoring.pass_threshold", "Pass Threshold", "scoring", "80%", "inherited"], ["scoring.proficiency_levels", "Proficiency Levels", "scoring", "5-level", "inherited"],
  ["workflow.assessment_approval", "Assessment Approval Chain", "workflow", "assessor → educator", "local"], ["approval.privilege_committee", "Privilege Approval Committee", "approval", "required", "inherited"],
  ["notification.expiry_lead_days", "Expiry Reminder Lead", "notification", "60 days", "local"], ["notification.escalation", "Non-Compliance Escalation", "notification", "enabled", "local"],
  ["ai.gap_intelligence", "AI Gap Intelligence", "ai", "enabled", "inherited"], ["ai.confidence_threshold", "AI Confidence Threshold", "ai", "75%", "local"],
  ["rules.mandatory_inheritance", "Mandatory Inheritance", "rules", "role-based", "inherited"], ["rules.reassessment_interval", "Reassessment Interval", "rules", "12 months", "local"],
  ["approval.review_board_quorum", "Review Board Quorum", "approval", "3 members", "inherited"], ["general.terminology", "Terminology", "general", "Competency Office", "local"],
].map(([config_key, name, category, value, source]) => ({ hospital_id: H, config_key, name, category, value, source, status: "active" })));

// ── AI recommendations ──
await ins("cmo_ai_recommendations", [
  ["12 staff have expiring BLS certifications", "Schedule refresher before expiry to maintain compliance.", "certification", 91, "high"],
  ["Sepsis competency gap widening on Night Team", "Prioritise 6 staff for reassessment.", "gap", 87, "high"],
  ["Central Line privilege prerequisites lapsed for 2 staff", "Suspend and re-validate before next shift.", "privileging", 94, "high"],
  ["Predicted RN competency shortfall in 6 months", "Advance the recruitment plan by one cycle.", "planning", 82, "medium"],
  ["Readiness at risk in Critical Care", "Uplift ALS coverage from 68% to target 90%.", "readiness", 85, "medium"],
  ["3 competencies not mapped to JCI", "Complete accreditation crosswalk before survey.", "risk", 79, "medium"],
  ["Falls prevention reassessments overdue", "18 staff past their 12-month interval.", "gap", 76, "low"],
  ["Manual handling certificates expiring in bulk", "Stagger renewals to avoid capacity dip.", "certification", 73, "low"],
].map(([title, detail, category, confidence, impact]) => ({ hospital_id: H, title, detail, category, confidence, impact, status: "open" })));

console.log(`✅ Seeded CMO expansion for AMU (${H}): ${certRows.length} certs, ${privRows.length} privileges, ${assignRows.length} assignments, 12 forecasts, 6 plans, 10 publications, ${accrRows.length} accreditations, 12 config, 8 AI recs.`);
