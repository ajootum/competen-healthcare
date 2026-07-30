export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadGovernanceRegistry } from "@/lib/cgr/registry";
/* eslint-disable @typescript-eslint/no-explicit-any */

// CGR-007 — Governance Intelligence & Predictive Risk copilot. Wired to the real AI Runtime Gateway (generate()),
// grounded ONLY in the live Competency Governance Registry (CGR-001): governance completeness, ownership,
// regulatory alignment, review currency, evidence and risk. It recommends, detects and explains governance risk —
// but per the CGR mandate (CGR-000 §9) it MUST NOT approve competencies, change standards or override decisions.
// Super-admin. Calls log to plat_ai_requests (operation "governance_intelligence_cgr") + audit_log.

export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured, provider: s.provider });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, full_name, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the governance copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a governance briefing: which competencies are at risk, where are the ownership / regulatory / review gaps, and the top 3 governance priorities.";

  const d: any = await loadGovernanceRegistry(admin).catch(() => ({ provisioned: false }));
  const ctx: string[] = [];
  if (d?.provisioned) {
    const k = d.kpis;
    ctx.push(`REGISTRY: ${d.total} competency definitions${d.capped ? ` (analysing top ${d.loaded} by risk)` : ""}. Avg governance completeness ${k.avgScore}/100. Ownership ${k.ownerPct}% (${k.withOwner} owned), regulatory-mapped ${k.standardsPct}%, evidence-backed ${k.evidencePct}%. Overdue reviews ${k.overdue}. High/critical-risk ${k.highRisk}.`);
    ctx.push(`GOVERNANCE STATE: governed ${d.states.governed}, monitor ${d.states.monitor}, at-risk ${d.states.at_risk}, ungoverned ${d.states.ungoverned}.`);
    const flagged = d.records.filter((r: any) => r.state === "at_risk" || r.state === "ungoverned").slice(0, 12).map((r: any) => {
      const gaps: string[] = [];
      if (!r.owner) gaps.push("no owner");
      if (r.standards === 0) gaps.push("no regulatory mapping");
      if (r.reviewOverdue) gaps.push("review overdue");
      else if (!r.reviewDue) gaps.push("no review date");
      if (r.decisions === 0) gaps.push("no evidence");
      return `${r.name} [${r.risk} risk, score ${r.score}] — ${gaps.join(", ") || "multiple gaps"}`;
    });
    if (flagged.length) ctx.push(`TOP FLAGGED (highest-risk first):\n- ${flagged.join("\n- ")}`);
  } else ctx.push("Governance registry: not provisioned / no competency definitions.");

  const system = [
    "You are the Competen Governance Intelligence copilot for a healthcare enterprise's super-admin (the CGR platform).",
    "Answer ONLY from the governance registry data provided. Do NOT invent competencies, owners, scores, standards or numbers.",
    "You reason over competency GOVERNANCE — ownership, regulatory alignment, review currency, evidence and risk — and surface where governance is incomplete and what to prioritise. Order recommendations by clinical risk and regulatory exposure; reference the underlying numbers.",
    "GOVERNANCE BOUNDARY: you may recommend reviews, flag gaps, detect duplicates and highlight risk, but you MUST NOT approve competencies, change standards, or override governance decisions — always route the action to the responsible human owner or governance authority.",
    "Be concise and structured. If the data doesn't support an answer, say so plainly.",
  ].join("\n");

  const result = await generate({ system, user: `Competency governance registry (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "governance_intelligence_cgr" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ actor_id: user.id, actor_name: profile?.full_name ?? null, action: "cgr_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
