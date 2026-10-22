// Allow up to 60s for AI generation -- the same ceiling /api/me/copilot uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { currentTraceId } from "@/lib/trace";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isExperienceKey } from "@/lib/individual/experiences";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { cleanQuestion, recordContext, systemPrompt, QUESTION_MAX } from "@/lib/individual/assistant";

// POST /api/individual/assistant -- COMPETEN-IND-003 s2(6), the personal AI entry point.
//
// Gate 3 first (requireIndividualContext, never getCaller -- see src/lib/individual/guard.ts), and the
// experience named in the body must be LIVE for this person. Then the estate's existing AI controls, in
// the order /api/me/copilot applies them: quota, configuration, generate() through the gateway (which
// writes plat_ai_requests), and an audit row.
//
// ⚠ THE AUDIT ACTION IS `ai_assistant_query` SO THE QUOTA COUNTS IT. checkAiQuota counts audit_log rows
// by action. A new action name would be an AI route the hourly limit cannot see. entity_type says which
// assistant it was.
//
// ⚠ tenantId IS NULL. plat_ai_requests.tenant_id references tenants(id), and a person in Competen
// Individual has no tenant. Passing some other id there (a hospital, a workspace) is the foreign-key
// mismatch COMPETEN-IND-002 s2.7 found in two existing routes -- the insert fails and the usage row is
// silently lost.

export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const experience = body?.experience;
  if (!isExperienceKey(experience)) return NextResponse.json({ error: "Unknown experience" }, { status: 400 });

  const ctx = await requireIndividualContext(experience);
  if (isGuardRefusal(ctx)) return ctx;

  const question = cleanQuestion(body?.question);
  if (!question) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });

  const quota = await checkAiQuota(ctx.admin, ctx.userId);
  if (!quota.ok) return NextResponse.json({ error: `You have reached the limit of ${quota.limit} questions an hour. Try again later.` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "The personal AI is not configured on this environment." }, { status: 503 });

  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10));
  const record = recordContext({ name: ctx.profile.fullName, experience, live: ctx.live, passport });

  const result = await generate({
    system: systemPrompt(experience),
    user: `My Competen record:\n${record}\n\nMy question: ${question}`,
    tier: "reasoning",
    maxTokens: 900,
    context: { userId: ctx.userId, tenantId: null, operation: `individual_assistant_${experience}` },
  });
  if (!result.ok) {
    const status = result.error === "not_configured" ? 503 : 502;
    const msg = result.error === "refusal" ? "The assistant declined to answer that question." : "The assistant could not answer just now. Try again shortly.";
    return NextResponse.json({ error: msg }, { status });
  }

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action: "ai_assistant_query", entity_type: "individual_assistant", entity_id: null,
    new_value: { experience, question_chars: question.length, model: result.model },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ answer: result.text });
}
