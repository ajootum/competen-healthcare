export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadAiCopilot } from "@/lib/operations/ai-copilot";

// AI Operational Copilot assistant (SSW-AI-001 §7). A shift-grounded natural-
// language assistant: answers operational questions from the live derived snapshot
// (health, pressure, patients, staffing, safety, escalations, tasks, forecast).
// Supervisor tier; explainable + audited (every answer logged for governance).
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  return NextResponse.json({ configured: aiStatus().configured });
}

function buildContext(d: any): string {
  if (!d.ready) return "(no active shift data)";
  const c = d.command, w = d.workforceAi, p = d.patientAi, s = d.safetyAi, o = d.operationalAi;
  return [
    `Shift health score: ${c.healthScore ?? "n/a"}%. Operational pressure: ${c.pressureLabel} (${c.pressure}/100).`,
    `Patients: ${p.highRisk} high-risk, ${p.deterioration} showing deterioration (PEWS≥5), ${p.icuTransfer} critical. Ward congestion risk: ${p.wardCongestion}.`,
    `Workforce: safe-staffing score ${w.safeStaffingScore ?? "n/a"}%, staffing gap ${w.staffingGapWte} WTE, ${w.competencyGap} role competency gaps, ${w.redeployment} staff available to redeploy. Fatigue risk: ${w.fatigueRisk}.`,
    `Safety: safety score ${s.safetyScore}%, ${s.openAlerts} open alerts. Risks — observation ${s.obsComplianceRisk}, medication ${s.medicationRisk}, falls ${s.fallsRisk}, pressure-injury ${s.pressureInjuryRisk}.`,
    `Operations: operational score ${o.operationalScore ?? "n/a"}%, ${o.taskDelays} task delays, ${o.escalations} escalations in progress, bed utilisation ${o.bedUtilisation ?? "n/a"}%.`,
    `Predictive (next hours): ${d.predictive.map((f: any) => `${f.label} ${f.value}`).join(", ")}.`,
    `Top priorities: ${c.topPriorities.map((t: any) => t.text).join("; ") || "none"}.`,
  ].join("\n");
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const { question } = await req.json().catch(() => ({}));
  if (!question || typeof question !== "string") return badRequest("question required");

  const quota = await checkAiQuota(c.admin, c.userId);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour). Try again later.` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the copilot." }, { status: 503 });

  const d = await loadAiCopilot(c.admin, c.hospitalId ?? null, isSuper(c));
  const context = buildContext(d);
  const system = [
    "You are the AI Operational Copilot for a hospital Shift Supervisor. You support — you do not replace — operational and clinical judgement.",
    "Answer ONLY from the operational snapshot provided in the user message. Be concise, structured and action-oriented.",
    "Rules:",
    "- Ground every claim in the snapshot numbers; state the figure you used.",
    "- Give explainable recommendations (what to do and why), but frame them as proposals for the supervisor to decide.",
    "- Never give individualised clinical or medical advice or make clinical decisions — you coordinate operations (staffing, tasks, capacity, escalation flow).",
    "- If the snapshot does not contain the answer, say so plainly.",
  ].join("\n");

  const result = await generate({ system, user: `Operational snapshot:\n${context}\n\nQuestion: ${question}`, tier: "reasoning", maxTokens: 900 });
  if (!result.ok) {
    const msg = result.error === "refusal" ? "The copilot declined to answer that." : `Copilot error: ${result.detail ?? "failed"}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "ai_copilot_query", entity_type: "ai_copilot", hospital_id: c.hospitalId ?? null, new_value: { question: question.slice(0, 300), model: result.model } });
  return NextResponse.json({ answer: result.text, model: result.model });
}
