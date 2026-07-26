// Seed AI Services Platform Phase 3 (migration 113): context sources, knowledge sources, actions, governance
// policies and evaluation runs. The control-plane governance & eval layer. Idempotent. Run: node scripts/seed-ai-services-p3.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ins = async (t, rows) => { const { error } = await db.from(t).insert(rows); if (error) { console.error(`${t}:`, error.message); process.exit(1); } };
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

for (const t of ["ais_evals", "ais_policies", "ais_actions", "ais_knowledge_sources", "ais_context_sources"]) await db.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");

// ── Context sources (AIS-002) ──
await ins("ais_context_sources", [
  ["User Profile & Role", "user", "Identity & Access", "on request"], ["Active Workspace", "workspace", "Workspace Runtime", "on request"],
  ["Tenant Configuration", "tenant", "WCE / Config Registry", "5 min cache"], ["Security & Permissions", "security", "IAM", "on request"],
  ["Knowledge Index", "knowledge", "AIS-003", "on request"], ["Active Workflow / Record", "workflow", "Operational Stores", "on request"],
  ["Conversation Memory", "memory", "Conversation Service", "per session"], ["Business Rules", "business", "Rules Engine (NCP)", "10 min cache"],
].map(([name, domain, source_system, refresh]) => ({ name, domain, source_system, refresh, status: "active" })));

// ── Knowledge sources (AIS-003, RAG) ──
await ins("ais_knowledge_sources", [
  ["Clinical Policies & SOPs", "unstructured", "adm_documents", 214, true], ["Competency Framework", "structured", "competency stores", 486, true],
  ["Operational Metrics", "structured", "op_ops_snapshots", 25, true], ["Learning Content Library", "unstructured", "learning stores", 312, true],
  ["Config Registry", "configuration", "workspace_config_overrides", 148, true], ["Incident & Safety History", "structured", "op_incidents / op_safety_alerts", 89, true],
  ["Regulatory Standards (JCI/MOH)", "unstructured", "regulatory library", 64, false], ["Forms & Registers", "structured", "adm_forms", 15, true],
].map(([name, domain, source_type, doc_count, indexed]) => ({ name, domain, source_type, doc_count, indexed, status: indexed ? "active" : "indexing", last_indexed: indexed ? ago(rint(30, 2880)) : null })));

// ── Actions (AIS-005 orchestrator) ──
await ins("ais_actions", [
  ["Create Task", "task", "recommendation", true, 312, 98], ["Send Notification", "notification", "event", true, 489, 99],
  ["Escalate Incident", "escalation", "recommendation", true, 74, 100], ["Assign Learning", "learning", "recommendation", true, 203, 97],
  ["Schedule Review", "scheduling", "recommendation", true, 98, 96], ["Generate Report", "report", "scheduled", false, 156, 100],
  ["Update Configuration", "config", "manual", true, 41, 95], ["Trigger Workflow", "workflow", "event", true, 267, 98],
].map(([name, action_type, trigger, requires_approval, executions, success_rate]) => ({ name, action_type, trigger, requires_approval, executions, success_rate, status: "active" })));

// ── Governance policies (AIS-008) ──
await ins("ais_policies", [
  ["PHI Redaction", "privacy", "all responses", "enforce"], ["Prompt-Injection Screening", "safety", "all inputs", "enforce"],
  ["High-Impact Action Approval", "access", "write actions", "enforce"], ["Content Safety Filter", "content", "all responses", "enforce"],
  ["Model Allow-List", "model", "provider abstraction", "enforce"], ["Immutable Audit Logging", "audit", "all AI events", "enforce"],
  ["Data Residency", "privacy", "tenant boundary", "enforce"], ["Refusal Logging", "safety", "refused requests", "monitor"],
  ["Bias & Fairness Monitoring", "content", "recommendations", "monitor"], ["Per-Request Cost Ceiling", "model", "generation", "monitor"],
  ["Explainability Requirement", "audit", "high-impact outputs", "enforce"],
].map(([name, category, scope, enforcement]) => ({ name, category, scope, enforcement, status: "active" })));

// ── Evaluation runs (AIS-011 testing & eval) ──
await ins("ais_evals", [
  ["Clinical Accuracy Benchmark", "accuracy", "claude-opus-4-8", 94, true, 48], ["Safety Red-Team Suite", "safety", "copilot", 97, true, 32],
  ["Response Quality (LLM-judge)", "quality", "copilot", 91, true, 120], ["Prompt Regression", "regression", "prompt templates", 96, true, 210],
  ["Copilot Groundedness", "accuracy", "RAG pipeline", 89, true, 86], ["Hallucination Rate", "quality", "claude-sonnet-5", 97, true, 74],
  ["Refusal Appropriateness", "safety", "copilot", 93, true, 41], ["Latency Benchmark", "benchmark", "all models", 88, true, 300],
  ["Citation Accuracy", "accuracy", "RAG pipeline", 92, true, 68], ["Persona Consistency", "regression", "personas", 90, true, 55],
  ["Bias Evaluation", "safety", "recommendations", 86, false, 22],
].map(([name, eval_type, target, score, passed, runs]) => ({ name, eval_type, target, score, passed, runs, last_run: ago(rint(60, 4320)) })));

console.log(`✅ Seeded AI Services Phase 3: 8 context sources, 8 knowledge sources, 8 actions, 11 policies, 11 eval runs.`);
