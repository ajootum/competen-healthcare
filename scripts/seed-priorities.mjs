// Seed the Platform Priority & Execution Framework (PPE, migration 107) with a realistic strategic cascade:
// platform strategic themes → platform + AMU-hospital objectives (with key results) → cascading priorities
// (platform/enterprise/hospital/department) → campaigns, generated actions, governance approvals and audit trail.
// Idempotent: clears PPE rows then reseeds. Run:  node scripts/seed-priorities.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ins = async (t, rows) => { const { data, error } = await db.from(t).insert(rows).select(); if (error) { console.error(`${t}:`, error.message); process.exit(1); } return data; };

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const deps = (await db.from("departments").select("id, name").eq("hospital_id", H).limit(4)).data ?? [];
const profs = (await db.from("profiles").select("id").eq("hospital_id", H).limit(4)).data ?? [];
const owner = (i) => profs[i % Math.max(1, profs.length)]?.id ?? null;
const dep = (i) => deps[i % Math.max(1, deps.length)]?.id ?? null;
const today = new Date().toISOString().slice(0, 10);
const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// Reset (order respects FKs).
for (const t of ["ppe_audit", "ppe_approvals", "ppe_actions", "ppe_priority_ack", "ppe_campaigns", "ppe_key_results", "ppe_priorities", "ppe_objectives", "ppe_strategic_themes"]) await db.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");

// ── Strategic themes (platform pillars) ──
const themes = await ins("ppe_strategic_themes", [
  { scope_type: "platform", name: "Patient Safety", description: "Zero avoidable harm across the network.", color: "#ef4444", icon: "🛡️", sort_order: 1 },
  { scope_type: "platform", name: "Quality Excellence", description: "Accreditation-ready care and continuous improvement.", color: "#0ea5e9", icon: "🏅", sort_order: 2 },
  { scope_type: "platform", name: "Workforce Development", description: "Competent, engaged, well-supported teams.", color: "#8b5cf6", icon: "🎓", sort_order: 3 },
  { scope_type: "platform", name: "Operational Efficiency", description: "Flow, capacity and cost-effective operations.", color: "#22c55e", icon: "⚙️", sort_order: 4 },
  { scope_type: "platform", name: "Digital Transformation", description: "Data-driven, connected, paperless workflows.", color: "#f59e0b", icon: "💻", sort_order: 5 },
]);
const T = Object.fromEntries(themes.map((t) => [t.name, t.id]));

// ── Objectives (platform strategy → AMU hospital cascade) ──
const platObjs = await ins("ppe_objectives", [
  { scope_type: "platform", theme_id: T["Patient Safety"], framework: "okr", title: "Reduce avoidable patient harm by 30%", description: "Network-wide reduction in preventable safety incidents.", owner_id: owner(0), timeframe_start: d(-120), timeframe_end: d(240), target_pct: 100, progress_pct: 62, status: "published" },
  { scope_type: "platform", theme_id: T["Quality Excellence"], framework: "okr", title: "Achieve JCI accreditation across all hospitals", description: "Every facility accreditation-ready by year end.", owner_id: owner(1), timeframe_start: d(-90), timeframe_end: d(180), target_pct: 100, progress_pct: 48, status: "published" },
  { scope_type: "platform", theme_id: T["Workforce Development"], framework: "okr", title: "95% mandatory competency compliance", description: "All clinical staff current on mandatory competencies.", owner_id: owner(2), timeframe_start: d(-60), timeframe_end: d(120), target_pct: 95, progress_pct: 88, status: "published" },
  { scope_type: "platform", theme_id: T["Operational Efficiency"], framework: "bsc", title: "Improve bed flow efficiency to 90%", description: "Reduce boarding and discharge delays network-wide.", owner_id: owner(0), timeframe_start: d(-30), timeframe_end: d(150), target_pct: 90, progress_pct: 71, status: "published" },
  { scope_type: "platform", theme_id: T["Digital Transformation"], framework: "okr", title: "Paperless clinical handover by Q4", description: "Electronic SBAR handover adopted in all units.", owner_id: owner(1), timeframe_start: d(-15), timeframe_end: d(210), target_pct: 100, progress_pct: 34, status: "pending" },
]);
const P = Object.fromEntries(platObjs.map((o) => [o.title.slice(0, 12), o.id]));

const hospObjs = await ins("ppe_objectives", [
  { scope_type: "hospital", scope_ref: H, theme_id: T["Patient Safety"], parent_id: platObjs[0].id, framework: "okr", title: "AMU: cut medication errors by 40%", description: "Local delivery of the network patient-safety objective.", owner_id: owner(0), timeframe_start: d(-90), timeframe_end: d(180), target_pct: 100, progress_pct: 55, status: "published" },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Quality Excellence"], parent_id: platObjs[1].id, framework: "okr", title: "AMU: close all JCI accreditation gaps", description: "Remediate open accreditation findings before survey.", owner_id: owner(1), timeframe_start: d(-60), timeframe_end: d(120), target_pct: 100, progress_pct: 41, status: "published" },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Operational Efficiency"], parent_id: platObjs[3].id, framework: "bsc", title: "AMU: reduce ED boarding to under 4h", description: "Improve emergency-to-ward flow.", owner_id: owner(2), timeframe_start: d(-20), timeframe_end: d(140), target_pct: 100, progress_pct: 66, status: "published" },
  { scope_type: "department", scope_ref: dep(0), theme_id: T["Workforce Development"], parent_id: platObjs[2].id, framework: "okr", title: `${deps[0]?.name ?? "Ward"}: 100% appraisal completion`, description: "All team members appraised this cycle.", owner_id: owner(3), timeframe_start: d(-45), timeframe_end: d(90), target_pct: 100, progress_pct: 78, status: "published" },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Patient Safety"], parent_id: platObjs[0].id, framework: "okr", title: "AMU: falls-prevention bundle compliance", description: "Embed falls bundle on every ward.", owner_id: owner(2), timeframe_start: d(-10), timeframe_end: d(160), target_pct: 90, progress_pct: 22, status: "draft" },
]);

// ── Key results ──
await ins("ppe_key_results", [
  { objective_id: platObjs[0].id, title: "Preventable incident rate", metric: "per 1,000 bed-days", unit: "rate", baseline: 4.2, target: 2.9, current: 3.4, status: "on_track" },
  { objective_id: platObjs[0].id, title: "Safety huddle adherence", metric: "% shifts", unit: "%", baseline: 60, target: 95, current: 84, status: "on_track" },
  { objective_id: platObjs[1].id, title: "Accreditation gaps closed", metric: "% of findings", unit: "%", baseline: 0, target: 100, current: 48, status: "at_risk" },
  { objective_id: platObjs[2].id, title: "Mandatory competency compliance", metric: "% staff current", unit: "%", baseline: 72, target: 95, current: 88, status: "on_track" },
  { objective_id: hospObjs[0].id, title: "Medication error rate", metric: "per 1,000 doses", unit: "rate", baseline: 5.1, target: 3.1, current: 3.9, status: "on_track" },
  { objective_id: hospObjs[1].id, title: "Open JCI findings", metric: "count", unit: "count", baseline: 34, target: 0, current: 20, status: "at_risk" },
  { objective_id: hospObjs[2].id, title: "Median ED boarding time", metric: "hours", unit: "h", baseline: 6.2, target: 4.0, current: 4.6, status: "on_track" },
]);

// ── Priorities (the cascade) ──
const prios = await ins("ppe_priorities", [
  { scope_type: "platform", theme_id: T["Workforce Development"], objective_id: platObjs[2].id, title: "Complete mandatory learning", description: "All staff current on mandatory modules.", category: "learning", mandatory: true, base_weight: 90, urgency: "high", inheritance_mode: "cascade", valid_from: d(-60), valid_to: d(120), status: "published", source_scope_type: "platform" },
  { scope_type: "platform", theme_id: T["Patient Safety"], objective_id: platObjs[0].id, title: "Patient safety first", description: "Prioritise safety alerts and deteriorating patients.", category: "safety", mandatory: true, base_weight: 95, urgency: "critical", inheritance_mode: "cascade", valid_from: d(-90), status: "published", source_scope_type: "platform" },
  { scope_type: "platform", theme_id: T["Digital Transformation"], title: "Adopt electronic handover", description: "Use the electronic SBAR at every handover.", category: "operations", mandatory: false, base_weight: 60, urgency: "medium", inheritance_mode: "cascade", valid_from: d(-15), status: "published", source_scope_type: "platform" },
  { scope_type: "enterprise", theme_id: T["Quality Excellence"], objective_id: platObjs[1].id, title: "Quality First", description: "Enterprise-wide quality and accreditation focus.", category: "quality", mandatory: true, base_weight: 85, urgency: "high", inheritance_mode: "cascade", valid_from: d(-90), status: "published", source_scope_type: "enterprise" },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Quality Excellence"], objective_id: hospObjs[1].id, title: "JCI accreditation readiness", description: "Close accreditation gaps ahead of survey.", category: "quality", mandatory: true, base_weight: 88, urgency: "critical", inheritance_mode: "cascade", valid_from: d(-60), valid_to: d(120), status: "published", source_scope_type: "hospital", source_scope_ref: H },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Patient Safety"], objective_id: hospObjs[0].id, title: "Medication safety drive", description: "Double-check high-risk medications.", category: "safety", mandatory: true, base_weight: 82, urgency: "high", inheritance_mode: "cascade", valid_from: d(-45), status: "published", source_scope_type: "hospital", source_scope_ref: H },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Operational Efficiency"], objective_id: hospObjs[2].id, title: "Expedite ED flow", description: "Reduce boarding via early discharge.", category: "operations", mandatory: false, base_weight: 70, urgency: "high", inheritance_mode: "local", valid_from: d(-20), status: "published", source_scope_type: "hospital", source_scope_ref: H },
  { scope_type: "department", scope_ref: dep(0), theme_id: T["Workforce Development"], title: "Complete team appraisals", description: "Finish this cycle's appraisals.", category: "workforce", mandatory: false, base_weight: 55, urgency: "medium", inheritance_mode: "cascade", valid_from: d(-30), status: "published", source_scope_type: "department", source_scope_ref: dep(0) },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Digital Transformation"], title: "Local handover pilot (draft)", description: "Pilot handover changes — pending approval.", category: "operations", mandatory: false, base_weight: 50, urgency: "low", inheritance_mode: "cascade", status: "draft", source_scope_type: "hospital", source_scope_ref: H },
]);

// ── Campaigns / initiatives ──
const camps = await ins("ppe_campaigns", [
  { scope_type: "hospital", scope_ref: H, theme_id: T["Quality Excellence"], objective_id: hospObjs[1].id, name: "JCI Accreditation 2026", description: "Cross-functional accreditation readiness programme.", status: "active", start_date: d(-60), end_date: d(120), progress_pct: 48, budget: 250000, sponsor_id: owner(1) },
  { scope_type: "hospital", scope_ref: H, theme_id: T["Patient Safety"], objective_id: hospObjs[0].id, name: "Medication Safety Drive", description: "Reduce medication errors through double-check and education.", status: "active", start_date: d(-45), end_date: d(90), progress_pct: 55, budget: 80000, sponsor_id: owner(0) },
  { scope_type: "platform", theme_id: T["Digital Transformation"], objective_id: platObjs[4].id, name: "Digital Handover Rollout", description: "Electronic SBAR across all units.", status: "planned", start_date: d(10), end_date: d(210), progress_pct: 12, budget: 140000, sponsor_id: owner(1) },
  { scope_type: "platform", theme_id: T["Workforce Development"], objective_id: platObjs[2].id, name: "Competency Compliance Push", description: "Close mandatory-competency gaps network-wide.", status: "active", start_date: d(-30), end_date: d(60), progress_pct: 74, budget: 60000, sponsor_id: owner(2) },
]);

// ── Generated actions (goal-to-action) ──
await ins("ppe_actions", [
  { priority_id: prios[0].id, objective_id: platObjs[2].id, campaign_id: camps[3].id, action_type: "learning", title: "Assign mandatory learning modules to non-compliant staff", target_scope_type: "hospital", target_scope_ref: H, status: "in_progress" },
  { priority_id: prios[4].id, objective_id: hospObjs[1].id, campaign_id: camps[0].id, action_type: "audit", title: "Schedule JCI mock survey for high-risk units", target_scope_type: "hospital", target_scope_ref: H, status: "assigned" },
  { priority_id: prios[5].id, objective_id: hospObjs[0].id, campaign_id: camps[1].id, action_type: "task", title: "Roll out high-risk medication double-check checklist", target_scope_type: "hospital", target_scope_ref: H, status: "in_progress" },
  { priority_id: prios[1].id, objective_id: platObjs[0].id, action_type: "notification", title: "Broadcast patient-safety priority to all clinical workspaces", target_scope_type: "platform", status: "completed" },
  { priority_id: prios[6].id, objective_id: hospObjs[2].id, action_type: "dashboard", title: "Promote ED-flow widgets on unit-manager dashboards", target_scope_type: "hospital", target_scope_ref: H, status: "generated" },
]);

// ── Governance approvals ──
await ins("ppe_approvals", [
  { entity_type: "objective", entity_id: platObjs[4].id, entity_title: "Paperless clinical handover by Q4", scope_type: "platform", workflow: "strategy", step: 2, total_steps: 3, state: "pending", requested_by: owner(1) },
  { entity_type: "priority", entity_id: prios[8].id, entity_title: "Local handover pilot (draft)", scope_type: "hospital", scope_ref: H, workflow: "priority", step: 1, total_steps: 2, state: "pending", requested_by: owner(0) },
  { entity_type: "objective", entity_id: hospObjs[4].id, entity_title: "AMU: falls-prevention bundle compliance", scope_type: "hospital", scope_ref: H, workflow: "strategy", step: 1, total_steps: 2, state: "changes_requested", requested_by: owner(2), decided_by: owner(1), decision_reason: "Add measurable key results before publishing." },
  { entity_type: "campaign", entity_id: camps[0].id, entity_title: "JCI Accreditation 2026", scope_type: "hospital", scope_ref: H, workflow: "campaign", step: 2, total_steps: 2, state: "approved", requested_by: owner(1), decided_by: owner(0), decision_reason: "Approved — budget and sponsor confirmed.", decided_at: new Date(Date.now() - 3 * 86400000).toISOString() },
]);

// ── Audit trail ──
await ins("ppe_audit", [
  { entity_type: "priority", entity_id: prios[1].id, action: "published", actor_id: owner(0), detail: "Published platform priority 'Patient safety first' (critical).", scope_type: "platform" },
  { entity_type: "objective", entity_id: platObjs[1].id, action: "published", actor_id: owner(1), detail: "Published objective 'Achieve JCI accreditation across all hospitals'.", scope_type: "platform" },
  { entity_type: "priority", entity_id: prios[4].id, action: "cascaded", actor_id: owner(1), detail: "Cascaded 'JCI accreditation readiness' to AMU hospital.", scope_type: "hospital", scope_ref: H },
  { entity_type: "campaign", entity_id: camps[0].id, action: "approved", actor_id: owner(0), detail: "Approved campaign 'JCI Accreditation 2026'.", scope_type: "hospital", scope_ref: H },
  { entity_type: "objective", entity_id: hospObjs[0].id, action: "progress_updated", actor_id: owner(0), detail: "Updated progress on 'AMU: cut medication errors by 40%' to 55%.", scope_type: "hospital", scope_ref: H },
  { entity_type: "priority", entity_id: prios[8].id, action: "submitted", actor_id: owner(0), detail: "Submitted 'Local handover pilot' for approval.", scope_type: "hospital", scope_ref: H },
]);

console.log(`✅ Seeded PPE for AMU (${H}): ${themes.length} themes, ${platObjs.length + hospObjs.length} objectives, ${prios.length} priorities, ${camps.length} campaigns.`);
