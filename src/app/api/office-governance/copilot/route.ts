export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadOgsCommandCentre } from "@/lib/ogs/ogs-data";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

// OGS-009 Office Governance copilot — wired to the real AI Runtime Gateway (generate()), grounded in the
// live governance command-centre data. Advisory only (AI never appoints, votes or certifies). Calls log to
// plat_ai_requests (operation "office_governance") → AIS-011 Observability / AIS-008 Governance.

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
  if (!roles.some(r => ["super_admin", "hospital_admin"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the governance copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a governance briefing: office health, coverage gaps, expiring delegations and the top 3 governance actions.";

  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const d = await loadOgsCommandCentre(admin, hid, isSuper);
  const ctx: string[] = [];
  if (!d.provisioned) ctx.push("No governance offices provisioned.");
  else {
    const k = d.kpis;
    ctx.push(`OFFICES: ${k.totalOffices} total, ${k.activeOffices} active. Compliance score ${k.complianceScore != null ? k.complianceScore + "%" : "n/a"} (active + chaired + at-quorum).`);
    ctx.push(`MEMBERSHIP: ${k.members} distinct members across ${k.appointments} appointments. DELEGATIONS: ${k.delegations} active. DECISIONS: ${k.decisionsMade} made.`);
    ctx.push(`PORTFOLIO by level: ${d.portfolio.map((p: any) => `${p.label} ${p.value}`).join("; ")}.`);
    ctx.push(`OFFICE HEALTH (top): ${d.officeCards.slice(0, 6).map((o: any) => `${o.name} ${o.health}%${o.chair ? "" : " (no chair)"}${o.atQuorum ? "" : " (below quorum)"}`).join("; ")}.`);
    ctx.push(`ALERTS: ${d.alerts.map((a: any) => `${a.title} — ${a.detail}`).join("; ")}.`);
  }

  const system = [
    "You are the Competen Office Governance copilot for the platform's Office Governance System (OGS).",
    "Answer ONLY from the governed office data provided. Do NOT invent offices, appointments, delegations or decisions.",
    "You are ADVISORY ONLY: you may recommend office composition, flag coverage gaps, expiring delegations and overdue reviews, and summarise governance — but you NEVER appoint, vote, certify, publish or dissolve; those require the accountable governance authority.",
    "Be concise and structured; order recommendations by governance impact and reference the underlying numbers. If the data doesn't support an answer, say so.",
  ].join("\n");

  const result = await generate({ system, user: `Office governance data (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: hid, operation: "office_governance" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "ogs_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
