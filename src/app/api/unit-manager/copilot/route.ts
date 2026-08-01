export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadUnitIntelligence } from "@/lib/operations/ai-intelligence";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

// UMG-AI — Unit Intelligence copilot. Wired to the real AI Runtime Gateway (generate()), grounded in the unit's
// consolidated cross-domain intelligence (workforce, competency, delivery, safety, capacity, quality). Calls log
// to plat_ai_requests (operation "unit_intelligence") → AIS-011 observability / AIS-008 governance.

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
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the unit intelligence copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a unit intelligence briefing: the top risks across workforce, competency, safety and capacity, and my 3 highest-priority actions right now.";

  const isSuper = roles.includes("super_admin");
  const intel: any = await loadUnitIntelligence(admin, profile?.hospital_id ?? null, isSuper);
  const ctx: string[] = [];
  if (!intel.provisioned) ctx.push("Unit intelligence not provisioned — no competency or operational data yet.");
  else {
    ctx.push(`AI HEALTH: composite ${intel.aiHealth ?? "—"} / confidence ${intel.confidence ?? "—"}%. ${intel.criticalCount} critical + ${intel.warnCount} warning signal(s).`);
    ctx.push(`DOMAIN SIGNALS: ${intel.domains.map((d: any) => `${d.key} — ${d.headline}${d.signals ? ` (${d.signals} signal${d.signals === 1 ? "" : "s"})` : ""}`).join("; ")}.`);
    if (intel.recommendations.length) ctx.push(`PRIORITISED RECOMMENDATIONS:\n${intel.recommendations.slice(0, 12).map((rr: any, i: number) => `${i + 1}. [${rr.domain} · ${rr.tone}] ${rr.title} — ${rr.detail}`).join("\n")}`);
    else ctx.push("No open recommendations — the unit's cross-domain signals are stable.");
  }

  const system = [
    "You are the Competen Unit Intelligence copilot for a healthcare unit manager.",
    "Answer ONLY from the consolidated unit intelligence provided. Do NOT invent metrics, patients, staff, incidents or numbers.",
    "You synthesise cross-domain signals (workforce, competency, delivery, safety, capacity, quality) into clear, prioritised guidance. Order actions by clinical/safety impact and reference the underlying signals. Recommendations are decision-support for a human to accept, not commands.",
    "Be concise and structured. If the data doesn't support an answer, say so plainly.",
  ].join("\n");

  const result = await generate({ system, user: `Unit intelligence (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "unit_intelligence" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "unit_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
