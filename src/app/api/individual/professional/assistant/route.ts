// Allow up to 60s for AI generation -- the same ceiling /api/individual/assistant uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { currentTraceId } from "@/lib/trace";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { recordContext, systemPrompt } from "@/lib/individual/assistant";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { cleanActivity, isAssistTask, professionalContext, taskInstruction } from "@/lib/individual/professional/assistant";
import { CPD_ACTIVITY_LABEL } from "@/lib/individual/professional/vocabulary";
import { todayUtc } from "@/lib/individual/professional/api";

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

  const quota = await checkAiQuota(ctx.admin, ctx.userId);
  if (!quota.ok) return NextResponse.json({ error: `You have reached the limit of ${quota.limit} questions an hour. Try again later.` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "The personal AI is not configured on this environment." }, { status: 503 });

  const today = todayUtc();
  const [passport, record] = await Promise.all([
    loadIndividualPassport(ctx.admin, ctx.userId, today),
    loadProfessionalRecord(ctx.admin, ctx.userId),
  ]);
  const grounding = [
    recordContext({ name: ctx.profile.fullName, experience: "professional", live: ctx.live, passport }),
    professionalContext(record, today),
  ].join("\n");
  const ask = task === "cpd_plan"
    ? "Suggest a CPD plan for me."
    : `Draft a reflection on this activity.\nActivity: ${activity!.title} (${CPD_ACTIVITY_LABEL[activity!.activityType]}).\nMy notes: ${activity!.notes ?? "none given"}`;

  const result = await generate({
    system: `${systemPrompt("professional")}\n\n${taskInstruction(task)}`,
    user: `My Competen record:\n${grounding}\n\n${ask}`,
    tier: "reasoning",
    maxTokens: 900,
    context: { userId: ctx.userId, attribution: { scope: "person" }, operation: `individual_professional_${task}` },
  });
  if (!result.ok) {
    const status = result.error === "not_configured" ? 503 : 502;
    const msg = result.error === "refusal" ? "The assistant declined that request." : "The assistant could not answer just now. Try again shortly.";
    return NextResponse.json({ error: msg }, { status });
  }

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action: "ai_assistant_query", entity_type: "individual_professional_assistant", entity_id: null,
    new_value: { experience: "professional", task, notes_chars: activity?.notes?.length ?? 0, model: result.model },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ answer: result.text });
}
