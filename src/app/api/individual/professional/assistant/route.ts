// Allow up to 60s for AI generation -- the same ceiling /api/individual/assistant uses.
import { professionalLegacyQuotaApplies } from "@/lib/individual/professional/ai-quota";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { meteredRefusalBody, requestIdFor } from "@/lib/ai/allowance";
import { runIndividualAssistant } from "@/lib/individual/personal-ai";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { individualAiQuota, individualQuotaRefusal, loadIndividualPolicy } from "@/lib/individual/policy";
import { individualPlanAiLimit } from "@/lib/individual/commerce";
import { pilotQuotaRefusal } from "@/lib/individual/pilot-ai";
import { currentTraceId } from "@/lib/trace";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { cleanActivity, isAssistTask } from "@/lib/individual/professional/assistant";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/assistant -- COMPETEN-IND-007 s7. CPD planning and reflection drafting.
//
// The foundation assistant's controls, in its order (src/app/api/individual/assistant/route.ts): gate 3
// with Professional live and its terms accepted, the hourly quota, configuration, generate() with
// `person` attribution (AI-LOG-001), and an audit row with the action the quota counts. The persona and
// shared rules are the foundation's systemPrompt("professional"). Grounding is the person's own record.
//
// ⚠ ADVISORY, STORES NOTHING (owner ruling D10). The answer is returned to the page and nowhere else. The
// reflection draft becomes part of the record only if the person edits it into the CPD form and saves.
// The audit row records the task and sizes, never the notes or the answer.

export async function POST(req: Request) {
  // The guard first, before any input is read: with the release gate off this route does not exist (404).
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;

  const body = await req.json().catch(() => ({}));
  const task = body?.task;
  if (!isAssistTask(task)) return NextResponse.json({ error: "Unknown task" }, { status: 400 });

  const activity = task === "reflection" ? cleanActivity(body ?? {}) : null;
  if (task === "reflection" && !activity) return NextResponse.json({ error: "Name the activity (3 to 200 characters) and keep your notes under 2,000 characters." }, { status: 400 });

  // ONE limit at a time (owner, 25 October 2026): with metering ON the metered allowance governs, inside
  // runIndividualAssistant. With metering OFF, the estate limit and the Individual policy limit, whichever is tighter.
  if (await professionalLegacyQuotaApplies(ctx.admin)) {
    const quota = individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId));
    // Fails CLOSED: an unreadable count is a 503 refusal, never a free pass (individualAiQuota).
    const refusal = await pilotQuotaRefusal(ctx.admin, "professional", ctx.userId, quota, individualQuotaRefusal(quota, "questions"), "questions");
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  }
  if (!aiStatus().configured) return NextResponse.json({ error: "The personal AI is not configured on this environment." }, { status: 503 });

  // The Holdings Personal AI (owner D3): the same engine as the shared assistant, in Professional's CPD modes.
  const out = await runIndividualAssistant(ctx.admin, {
    userId: ctx.userId, fullName: ctx.profile.fullName, live: ctx.live, experience: "professional", mode: task, activity,
    requestId: requestIdFor(ctx.userId, req.headers.get("x-request-id")),
  });
  if (!out.ok && out.kind === "invalid") return NextResponse.json({ error: out.error }, { status: out.status });
  if (!out.ok && out.kind === "metered") { const m = meteredRefusalBody(out.refusal); return NextResponse.json(m.body, { status: m.status }); }
  if (!out.ok) {
    const status = out.result.error === "not_configured" ? 503 : 502;
    const msg = out.result.error === "refusal" ? "The assistant declined that request." : "The assistant could not answer just now. Try again shortly.";
    return NextResponse.json({ error: msg }, { status });
  }

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action: "ai_assistant_query", entity_type: "individual_professional_assistant", entity_id: null,
    new_value: { experience: "professional", task, notes_chars: activity?.notes?.length ?? 0, model: out.model, scopes_read: out.scopesRead },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ answer: out.answer });
}
