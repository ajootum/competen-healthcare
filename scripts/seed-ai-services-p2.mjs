// Seed AI Services Platform Phase 2 (migration 112): prompt templates, personas, skills, agents and AI config.
// The control-plane registries the copilot resolves over. Idempotent. Run:  node scripts/seed-ai-services-p2.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ins = async (t, rows) => { const { error } = await db.from(t).insert(rows); if (error) { console.error(`${t}:`, error.message); process.exit(1); } };
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

for (const t of ["ais_config", "ais_agents", "ais_skills", "ais_personas", "ais_prompt_templates"]) await db.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");

// ── Prompt templates ──
await ins("ais_prompt_templates", [
  ["Clinical Coaching", "worker", "coaching", "reasoning", 412], ["Assessment Feedback", "assessor", "assessment", "reasoning", 356],
  ["Executive Summary", "unit-manager", "reporting", "heavy", 128], ["Incident Triage", "supervisor", "safety", "reasoning", 174],
  ["SBAR Handover", "supervisor", "handover", "reasoning", 231], ["Learning Recommendation", "worker", "learning", "cheap", 289],
  ["Governance Report", "super-admin", "governance", "heavy", 63], ["KPI Explanation", "unit-manager", "analytics", "reasoning", 197],
  ["Policy Drafting", "super-admin", "documents", "reasoning", 84], ["Care Plan Draft", "worker", "clinical", "reasoning", 142],
].map(([name, workspace, category, model_hint, usage]) => ({ name, workspace, category, model_hint, template: `[system policy] + [persona] + [context] + [knowledge] + ${name} instructions`, usage, status: "active" })));

// ── Personas ──
await ins("ais_personas", [
  ["Clinical Copilot", "Grounded clinical decision support for healthcare workers.", "supportive, precise", "worker"],
  ["Unit Manager Copilot", "Operational & performance intelligence for unit managers.", "executive, concise", "unit-manager"],
  ["Assessor Copilot", "Competency assessment and feedback assistance.", "constructive, objective", "assessor"],
  ["Executive Copilot", "Strategic summaries and board-ready insight.", "strategic, brief", "super-admin"],
  ["Learning Advisor", "Personalised learning and CPD guidance.", "encouraging, clear", "worker"],
  ["Governance Copilot", "Compliance, audit and governance support.", "formal, thorough", "super-admin"],
].map(([name, description, tone, workspace]) => ({ name, description, tone, workspace, status: "active" })));

// ── Skills ──
await ins("ais_skills", [
  ["Get Patient Context", "get_patient_context", "data", "read", false, 892], ["Search Knowledge", "search_knowledge", "knowledge", "read", false, 1204],
  ["Query Metrics", "query_metrics", "data", "read", false, 634], ["Lookup Competency", "lookup_competency", "data", "read", false, 421],
  ["Query Audit Log", "query_audit", "data", "read", false, 218], ["Create Task", "create_task", "action", "write", true, 312],
  ["Send Notification", "send_notification", "action", "write", true, 489], ["Generate Report", "generate_report", "action", "write", true, 156],
  ["Schedule Review", "schedule_review", "action", "write", true, 98], ["Escalate", "escalate", "action", "write", true, 74],
  ["Assign Learning", "assign_learning", "action", "write", true, 203], ["Email Send", "email_send", "external", "write", true, 61],
  ["Calendar Create", "calendar_create", "external", "write", true, 47], ["Summarise Document", "summarise_document", "internal", "read", false, 528],
].map(([name, code, category, scope, requires_approval, invocations]) => ({ name, code, category, scope, requires_approval, invocations, description: `${name} — governed skill; each invocation re-authorised and policy-checked.`, status: "active" })));

// ── Agents ──
await ins("ais_agents", [
  ["Clinical Intelligence Agent", "Grounded clinical Q&A and decision support.", "clinical", "claude-opus-4-8", ["get_patient_context", "search_knowledge", "lookup_competency"], "assist", "worker", 1842],
  ["Workforce Optimizer", "Staffing and deployment recommendations.", "workforce", "claude-sonnet-5", ["query_metrics", "create_task"], "suggest", "unit-manager", 421],
  ["Quality Sentinel", "Continuous safety & quality monitoring with escalation.", "quality", "claude-opus-4-8", ["query_metrics", "escalate", "send_notification"], "suggest", "supervisor", 987],
  ["Documentation Assistant", "Drafts policies, SOPs and reports from context.", "documents", "claude-sonnet-5", ["search_knowledge", "summarise_document", "generate_report"], "assist", "super-admin", 356],
  ["Governance Auditor", "Detects governance gaps and compliance risks.", "governance", "claude-opus-4-8", ["query_audit", "query_metrics"], "suggest", "super-admin", 174],
  ["Learning Advisor", "Personalised CPD and pathway recommendations.", "learning", "claude-haiku-4-5", ["lookup_competency", "assign_learning"], "assist", "worker", 612],
  ["Ops Forecaster", "Predicts demand, capacity and escalation risk.", "operations", "claude-sonnet-5", ["query_metrics"], "suggest", "unit-manager", 289],
  ["Copilot Orchestrator", "Routes requests to specialist agents and skills.", "orchestrator", "claude-opus-4-8", ["search_knowledge"], "act", "super-admin", 2103],
].map(([name, description, agent_type, model_id, skills, autonomy, workspace, runs]) => ({ name, description, agent_type, model_id, skills, autonomy, workspace, runs, status: "active" })));

// ── AI config items ──
await ins("ais_config", [
  ["copilot.enabled", "Copilot Enabled", "copilot", "true", "inherited"], ["copilot.default_persona", "Default Persona", "copilot", "workspace-matched", "local"],
  ["model.default", "Default Model", "model", "claude-opus-4-8", "inherited"], ["model.fallback", "Fallback Model", "model", "claude-sonnet-5", "local"],
  ["model.cheap_tier", "Cheap-Tier Model", "model", "claude-haiku-4-5", "inherited"], ["routing.by_risk", "Risk-Based Routing", "routing", "enabled", "local"],
  ["routing.cost_ceiling", "Per-Request Cost Ceiling", "routing", "$0.50", "local"], ["safety.prompt_injection_screen", "Prompt-Injection Screening", "safety", "enabled", "inherited"],
  ["safety.phi_redaction", "PHI Redaction", "safety", "enabled", "inherited"], ["safety.high_impact_approval", "High-Impact Action Approval", "safety", "required", "inherited"],
  ["safety.refusal_logging", "Refusal Logging", "safety", "enabled", "inherited"], ["feature.proactive_insights", "Proactive Insights", "feature", "enabled", "local"],
  ["feature.voice_ui", "Voice UI", "feature", "disabled", "local"], ["knowledge.rag_enabled", "RAG Retrieval", "knowledge", "enabled", "inherited"],
  ["knowledge.citation_required", "Citations Required", "knowledge", "true", "inherited"],
].map(([config_key, name, category, value, source]) => ({ config_key, name, category, value, source, status: "active" })));

console.log(`✅ Seeded AI Services Phase 2: 10 prompt templates, 6 personas, 14 skills, 8 agents, 15 config items.`);
