// Seed the UMW Administration & Configuration stores (migrations 109 + 110) for the AMU demo hospital: unit profile,
// rooms, services, operational rules, the controlled document library, asset register, forms/registers, config items,
// delegations, change register and AI recommendations/automations. Idempotent. Reuses op_beds/departments/positions
// for structure counts at load time. Run:  node scripts/seed-admin.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ins = async (t, rows) => { if (!rows.length) return []; const { data, error } = await db.from(t).insert(rows).select("id"); if (error) { console.error(`${t}:`, error.message); process.exit(1); } return data; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const dPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const dep = (await db.from("departments").select("id").eq("hospital_id", H).limit(1)).data?.[0]?.id ?? null;
const profs = (await db.from("profiles").select("id").eq("hospital_id", H).limit(8)).data ?? [];
const owner = (i) => profs[i % Math.max(1, profs.length)]?.id ?? null;

for (const t of ["adm_automations", "adm_ai_recommendations", "adm_changes", "adm_delegations", "adm_config_items", "adm_forms", "adm_assets", "adm_documents", "adm_operational_rules", "adm_services", "adm_rooms", "adm_unit_profile"]) await db.from(t).delete().eq("hospital_id", H).then((r) => r, () => {});

// ── Unit profile ──
await ins("adm_unit_profile", [{ hospital_id: H, department_id: dep, unit_name: "Acute Medical Unit", unit_code: "AMU-001", specialty: "Acute Internal Medicine", cost_centre: "CC-2100", location: "Building A, Level 3", operational_hours: "24/7", manager_id: owner(0), established_on: "2022-01-15", config_version: "v2.14.0" }]);

// ── Rooms ──
const rooms = [];
for (let i = 1; i <= 9; i++) rooms.push({ hospital_id: H, name: `Room A3-0${i}`, room_type: "patient", floor: "Level 3", bed_count: pick([2, 4, 4, 4]), status: "active" });
rooms.push({ hospital_id: H, name: "Isolation Room A3-10", room_type: "isolation", floor: "Level 3", bed_count: 1, status: "active" });
rooms.push({ hospital_id: H, name: "Nurse Station", room_type: "nurse_station", floor: "Level 3", bed_count: 0, status: "active" });
rooms.push({ hospital_id: H, name: "Equipment Room", room_type: "store", floor: "Level 3", bed_count: 0, status: "active" });
rooms.push({ hospital_id: H, name: "Medication Room", room_type: "clinical_support", floor: "Level 3", bed_count: 0, status: "active" });
rooms.push({ hospital_id: H, name: "Staff Room", room_type: "staff", floor: "Level 3", bed_count: 0, status: "active" });
await ins("adm_rooms", rooms);

// ── Services ──
await ins("adm_services", [
  ["Inpatient Acute Medicine", "Clinical", 142], ["Ambulatory Care", "Clinical", 38], ["Acute Medical Take", "Clinical", 64],
  ["Diagnostics Liaison", "Support", 21], ["Rapid Assessment", "Clinical", 47], ["Rehabilitation Liaison", "Support", 12],
].map(([name, category, cases]) => ({ hospital_id: H, name, category, cases, status: "active" })));

// ── Operational rules ──
await ins("adm_operational_rules", [
  ["Bed Allocation Policy", "bed_allocation"], ["Admission Criteria", "admission"], ["Deterioration Escalation Pathway", "escalation"],
  ["Safe Staffing Ratios", "staffing"], ["Major Incident Procedure", "emergency"], ["Weekend Coverage Policy", "coverage"],
  ["Patient Flow & Discharge", "patient_flow"], ["Business Continuity Plan", "continuity"],
].map(([name, rule_type]) => ({ hospital_id: H, name, rule_type, status: "active" })));

// ── Documents (controlled library) ──
const DOC_TYPES = [["policy", "Policy"], ["sop", "SOP"], ["guideline", "Guideline"], ["protocol", "Protocol"], ["form", "Form"], ["work_instruction", "Work Instruction"]];
const DOC_NAMES = ["Medication Administration", "Hand Hygiene", "Falls Prevention", "Pressure Injury Prevention", "Infection Control", "Patient Handover (SBAR)", "Sepsis Recognition", "Blood Transfusion", "Deteriorating Patient", "Discharge Planning", "Central Line Insertion", "Pain Management", "Fluid Balance", "VTE Prophylaxis", "Isolation Precautions", "Nutrition & Hydration", "End of Life Care", "Consent", "Restraint & De-escalation", "Sharps Disposal", "Fire Safety", "Major Haemorrhage", "Airway Management", "Wound Care", "Catheter Care", "Oxygen Therapy", "Medicines Reconciliation", "Visitor Management", "Death Verification", "Clinical Photography"];
const DOC_CATS = ["Clinical Care", "Infection Control", "Patient Safety", "Medication Safety", "Administration", "Quality"];
const DOC_STATUS = ["published", "published", "published", "published", "in_review", "pending_approval", "draft", "archived"];
const REG = ["JCI", "SafeCare", "Ministry of Health", "Internal", "JCI"];
const docs = DOC_NAMES.map((n, i) => { const [dt] = pick(DOC_TYPES); return { hospital_id: H, title: `${n} ${pick(DOC_TYPES.filter((t) => t[0] === dt))[1]}`, doc_type: dt, category: pick(DOC_CATS), status: pick(DOC_STATUS), version: `${rint(1, 3)}.${rint(0, 4)}`, owner_id: owner(i), review_date: dPlus(rint(-20, 180)), acknowledgement_pct: rint(70, 100), regulatory: pick(REG) }; });
await ins("adm_documents", docs);

// ── Assets (register) ──
const ASSET_CATS = ["clinical", "clinical", "clinical", "it", "furniture", "infrastructure", "emergency", "other"];
const ASSET_NAMES = { clinical: ["Ventilator", "Infusion Pump", "Patient Monitor", "Syringe Pump", "Defibrillator", "Suction Unit", "ECG Machine", "Pulse Oximeter", "Feeding Pump", "Bladder Scanner"], it: ["Workstation", "Barcode Scanner", "Label Printer", "Tablet"], furniture: ["Hospital Bed", "Bedside Cabinet", "Overbed Table", "Patient Chair"], infrastructure: ["Nurse Call System", "Pneumatic Tube", "Medical Gas Panel"], emergency: ["Crash Cart", "Emergency Trolley", "AED"], other: ["Wheelchair", "Commode", "Hoist"] };
const ASSET_STATUS = ["in_service", "in_service", "in_service", "in_service", "under_maintenance", "out_of_service", "in_storage", "pending"];
const assets = [];
for (let i = 0; i < 36; i++) { const cat = pick(ASSET_CATS); assets.push({ hospital_id: H, name: `${pick(ASSET_NAMES[cat])} ${String(rint(100, 999))}`, asset_tag: `ASSET-${String(1000 + i)}`, category: cat, status: pick(ASSET_STATUS), location: pick(["ICU - Bed 5", "Ward A3", "Nurse Station", "Equipment Room", "Bay 2", "Store"]), custodian_id: owner(i), maintenance_due: dPlus(rint(-10, 60)), calibration_due: dPlus(rint(-5, 90)), warranty_expiry: dPlus(rint(-30, 400)), vendor: pick(["MedTech Solutions", "Philips Healthcare", "GE Healthcare", "Dräger", "Local Biomedical"]), utilisation_pct: rint(20, 95) }); }
await ins("adm_assets", assets);

// ── Forms / registers / checklists ──
const FORMS = [["Neuro Assessment Register", "register", 174], ["Medication Administration Form", "form", 198], ["Central Line Checklist", "checklist", 131], ["Incident Reporting Form", "form", 89], ["Equipment Maintenance Register", "register", 62], ["Daily Safety Checklist", "checklist", 245], ["Falls Risk Assessment", "form", 156], ["Visitor Register", "register", 78], ["Fluid Balance Chart", "form", 210], ["Handover Checklist", "checklist", 189], ["Competency Register", "register", 44], ["Pressure Area Chart", "form", 167], ["Controlled Drugs Register", "register", 98], ["Resuscitation Trolley Log", "log", 121], ["Fridge Temperature Log", "log", 203]];
await ins("adm_forms", FORMS.map(([name, form_type, submissions], i) => ({ hospital_id: H, name, form_type, category: pick(DOC_CATS), status: pick(["active", "active", "active", "published", "draft"]), submissions, compliance_pct: rint(80, 99), review_date: dPlus(rint(-10, 150)) })));

// ── Configuration items ──
const CFG = [["Landing Page Layout", "workspace"], ["Unit Safety Dashboard", "dashboard"], ["Patient Handover Workflow", "workflow"], ["Medication Administration Workflow", "workflow"], ["Incident Reporting Workflow", "workflow"], ["Unit → Ward Terminology", "terminology"], ["Healthcare Worker → Nurse", "terminology"], ["Critical Task Overdue Alert", "notification"], ["Escalation Notification Rule", "notification"], ["BambooHR Integration", "integration"], ["QuickBooks Integration", "integration"], ["Azure AD Integration", "integration"], ["Unit Branding Theme", "branding"], ["Sepsis Alert Workflow", "workflow"], ["Discharge Planning Workflow", "workflow"], ["Equipment Maintenance Workflow", "workflow"], ["Digest Notification Rule", "notification"], ["EMR (Bahmni) Integration", "integration"], ["Custom Dashboard Widgets", "dashboard"], ["Saved Views Config", "workspace"]];
await ins("adm_config_items", CFG.map(([name, config_type], i) => ({ hospital_id: H, name, config_type, status: pick(["active", "active", "active", "published", "in_review", "draft"]), source: i % 3 === 0 ? "inherited" : "local", runs: config_type === "workflow" ? rint(120, 250) : rint(0, 40) })));

// ── Delegations ──
await ins("adm_delegations", [
  ["Unit Manager", 1, 0, "active"], ["Shift Supervisor (Night)", 2, 1, "active"], ["Policy Approval Authority", 3, 0, "active"],
  ["Equipment Approval", 4, 0, "active"], ["Leave Approval (Level 1)", 3, 1, "scheduled"], ["Acting Charge Nurse", 5, 0, "active"],
].map(([position, di, bi, status]) => ({ hospital_id: H, position, delegate_id: owner(di), delegated_by: owner(bi), valid_from: dPlus(-rint(1, 20)), valid_to: dPlus(rint(5, 30)), status })));

// ── Change register ──
const CHG_TYPES = ["config", "workflow", "dashboard", "policy", "permission", "form", "asset", "rule", "ai"];
const CHG_STATUS = ["published", "published", "published", "approved", "in_review", "pending_approval", "draft", "rolled_back", "cancelled"];
const CHG_TITLES = ["Update Patient Flow Dashboard", "New Workflow: Infection Control", "Revise Medication Administration Policy", "Add Field: Allergies (Patient Card)", "Update Staffing KPI Calculations", "New Role: Research Nurse", "Update Admission Workflow", "Equipment Purchase Policy", "KPI: Quality Dashboard Changes", "Change: Leave Approval Workflow", "Escalation Pathway Update", "Bed Allocation Rule v3", "Terminology: Ward Naming", "AI Threshold Adjustment", "Notification Rule: Critical Task"];
const changes = [];
for (let i = 0; i < 30; i++) changes.push({ hospital_id: H, change_code: `CHG-2026-${String(100 + i).padStart(4, "0")}`, title: pick(CHG_TITLES), change_type: pick(CHG_TYPES), author_id: owner(i), approver: pick(["Unit Manager", "Quality Lead", "Finance Head", "Clinical Director"]), status: pick(CHG_STATUS), risk: pick(["low", "low", "low", "medium", "medium", "high"]), version: `${rint(1, 3)}.${rint(0, 9)}.${rint(0, 9)}`, affected_users: rint(5, 300) });
await ins("adm_changes", changes);

// ── AI recommendations ──
await ins("adm_ai_recommendations", [
  ["Review 3 policies overdue for update", "Last reviewed over 12 months ago.", "document", 92, "high"],
  ["Optimize staff allocation on Night Shift", "Potential 12% efficiency improvement.", "optimization", 87, "medium"],
  ["4 assets due for preventive maintenance", "Reduce risk of unexpected downtime.", "asset", 88, "medium"],
  ["2 users have conflicting role assignments", "Segregation-of-duties concern detected.", "governance", 91, "high"],
  ["3 terminology items need alignment", "Inconsistent terminology across dashboards.", "configuration", 78, "low"],
  ["Visitor Management Policy not aligned to latest guideline", "Regulatory update available.", "compliance", 86, "medium"],
  ["Consider reducing approval bottleneck in staffing workflow", "Approval step averages 3 days.", "optimization", 82, "medium"],
  ["5 documents have readability score below 70%", "Simplify for staff comprehension.", "document", 76, "low"],
].map(([title, detail, category, confidence, impact]) => ({ hospital_id: H, title, detail, category, confidence, impact, status: "open" })));

// ── Automations ──
await ins("adm_automations", [
  ["Policy Review Reminder Workflow", "reminder", 42], ["Equipment Maintenance Alerts", "alert", 88], ["Staff Credential Expiry Notifications", "notification", 31],
  ["Overdue Task Escalation", "escalation", 64], ["Scheduled Governance Report", "report", 12], ["Document Acknowledgement Reminder", "reminder", 57],
].map(([name, automation_type, runs]) => ({ hospital_id: H, name, automation_type, status: "active", runs })));

console.log(`✅ Seeded Admin & Configuration for AMU (${H}): profile + ${rooms.length} rooms + 6 services + 8 rules + ${docs.length} docs + ${assets.length} assets + ${FORMS.length} forms + ${CFG.length} config + 6 delegations + ${changes.length} changes + 8 AI recs + 6 automations.`);
