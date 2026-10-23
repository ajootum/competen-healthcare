import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { currentTraceId } from "@/lib/trace";
import type { IndividualContext } from "../guard";
import { readConsent } from "./store";

// ── WHAT EVERY SCHOLAR AI ROUTE CHECKS, IN ORDER ── after requireIndividualContext("scholar") ────────────
//
//   1. CONSENT. The person's own, revocable consent to AI processing of their uploads
//      (individual_scholar_consent). None, revoked, or unreadable: no AI call. Unreadable is not
//      permission (ADR-015).
//   2. QUOTA. The estate's hourly AI limit (src/lib/ai/quota.ts), which counts audit_log rows by action.
//   3. CONFIGURATION. An environment with no AI provider says so rather than failing later.
//
// The audit row afterwards uses action `ai_assistant_query` -- the action the quota counts -- so a Scholar
// AI call is one the hourly limit can see. entity_type names which Scholar operation it was.

export async function aiPreflight(ctx: IndividualContext): Promise<NextResponse | null> {
  const consent = await readConsent(ctx.admin, ctx.userId);
  if (!consent.ok) return NextResponse.json({ error: "Your AI consent could not be checked just now, so nothing was sent. Try again shortly." }, { status: 503 });
  if (!consent.data.granted)
    return NextResponse.json({ error: "Turn on AI processing of your material in My Learning before asking for explanations or questions." }, { status: 403 });
  const quota = await checkAiQuota(ctx.admin, ctx.userId);
  if (!quota.ok) return NextResponse.json({ error: `You have reached the limit of ${quota.limit} AI requests an hour. Try again later.` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured on this environment." }, { status: 503 });
  return null;
}

export const AI_ERROR: Record<"not_configured" | "refusal" | "failed", { status: number; error: string }> = {
  not_configured: { status: 503, error: "AI is not configured on this environment." },
  refusal: { status: 502, error: "The AI declined that request." },
  failed: { status: 502, error: "The AI could not answer just now. Try again shortly." },
};

/** One audit row. Counts and ids only -- never the person's question text or their material. */
export async function audit(ctx: IndividualContext, action: string, entityType: string, entityId: string | null, value: Record<string, unknown>) {
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action, entity_type: entityType, entity_id: entityId, new_value: value,
  }).then((r: unknown) => r, () => {});
}

export const SCHOLAR_AI_AUDIT_ACTION = "ai_assistant_query";
