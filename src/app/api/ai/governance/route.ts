// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { frameworkImpact } from "@/lib/engines/impact";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";

import { currentTraceId } from "@/lib/trace";
// POST — AI Governance Assistant: plain-language impact summary of a proposed
// framework change, for governance committees (Book IV Ch.17). Body: { frameworkId }.
//
// ⚠ NARROWED FROM A ROLE LIST TO THE CAPABILITY ITS CONSOLE REQUIRES (CP-HQ-NAV-001 follow-up). It admitted
// every hospital_admin, and it runs a paid model over a framework named by id with no tenant scoping -- so
// an admin of one tenant could brief themselves on another's framework AND spend the platform's AI quota
// doing it. Its only caller is /super-admin/content/[frameworkId], which requires hq.learning.content.view.
const CAPABILITIES = ["hq.learning.content.view"];

export async function POST(req: Request) {
  const ctx = await hqApiGate(CAPABILITIES);
  if (isHqRefusal(ctx)) return ctx;
  const { admin, userId, fullName } = ctx;

  const quota = await checkAiQuota(admin, userId);
  if (!quota.ok) {
    return NextResponse.json({ error: "AI rate limit reached (" + quota.limit + " requests/hour). Try again later." }, { status: 429 });
  }

  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });

  const { frameworkId } = await req.json();
  if (!frameworkId) return NextResponse.json({ error: "frameworkId required" }, { status: 400 });

  const report = await frameworkImpact(admin, frameworkId);
  const total = report.affected.reduce((s, a) => s + a.count, 0);

  const system = [
    "You are the Competen Governance Assistant. You brief a clinical governance committee on the downstream impact of a proposed change to a competency framework (Book IV Ch.17).",
    "Ground your summary ONLY in the impact data provided. Do not invent objects or counts. Do not approve or reject the change — that is the committee's decision.",
    "Write a concise governance briefing: what would be affected and the scale, which categories carry the most clinical risk (CPUs, competencies, active cycles, and existing decisions matter most), and 2–3 specific things the committee should verify before approving. Note that existing competency decisions remain linked to the version active at assessment time.",
  ].join("\n");

  const userMsg = [
    `Framework: ${report.entity.name}`,
    `Total downstream objects affected: ${total}`,
    `Breakdown:\n${report.affected.map(a => `- ${a.label}: ${a.count}${a.items.length ? ` (e.g. ${a.items.slice(0, 8).join(", ")})` : ""}`).join("\n")}`,
    report.edges.length ? `Explicit graph links: ${report.edges.length}` : "",
    "Write the governance impact briefing.",
  ].filter(Boolean).join("\n\n");

  const result = await generate({ system, user: userMsg, tier: "reasoning", maxTokens: 1200 });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "refusal" ? "The assistant declined this request." : `Assistant error: ${result.detail ?? "failed"}` }, { status: 500 });
  }

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: userId, actor_name: fullName,
    action: "ai_governance_brief", entity_type: "framework", entity_id: frameworkId,
    entity_name: report.entity.name, new_value: { total_affected: total, model: result.model },
  });

  return NextResponse.json({ answer: result.text, total, model: result.model });
}
