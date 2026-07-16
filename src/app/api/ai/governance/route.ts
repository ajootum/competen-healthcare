// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { frameworkImpact } from "@/lib/engines/impact";

// POST — AI Governance Assistant: plain-language impact summary of a proposed
// framework change, for governance committees (Book IV Ch.17). Body: { frameworkId }.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const quota = await checkAiQuota(admin, user.id);
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

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: profile?.full_name ?? null,
    action: "ai_governance_brief", entity_type: "framework", entity_id: frameworkId,
    entity_name: report.entity.name, new_value: { total_affected: total, model: result.model },
  });

  return NextResponse.json({ answer: result.text, total, model: result.model });
}
