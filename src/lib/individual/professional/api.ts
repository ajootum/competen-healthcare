import { NextResponse } from "next/server";
import { currentTraceId } from "@/lib/trace";
import type { IndividualContext } from "../guard";
import { AI_ERROR, aiErrorBody, type AiErrorKind } from "../ai-error";

// Small helpers shared by the Professional API routes. The GUARD is not here: every handler calls
// requireIndividualContext("professional") itself, so scripts/individual-foundation-harness.ts 5a can see
// it on every handler rather than trusting a wrapper.

/** Today's date in UTC, the way every Individual page computes it. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

export const refuse = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** LEARNING-CLOSE-2026-11 D06 / LE-01: a provider outcome, in the words and with the code every Individual AI route uses (ai-error.ts). */
export const refuseAi = (kind: AiErrorKind) => NextResponse.json(aiErrorBody(kind), { status: AI_ERROR[kind].status });

/** The write failed. A constraint name is not a sentence, so the person gets one. */
export const writeFailed = (what: string) =>
  NextResponse.json({ error: `Your ${what} could not be saved just now. Try again shortly.` }, { status: 500 });

/** A JSON body, or a multipart form as text fields plus its file. */
export async function readBody(req: Request): Promise<{ fields: Record<string, unknown>; file: File | null }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return { fields: {}, file: null };
    const fields: Record<string, unknown> = {};
    let file: File | null = null;
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") fields[k] = v;
      else if (k === "document" && v.size > 0) file = v;
    }
    return { fields, file };
  }
  const json = await req.json().catch(() => ({}));
  return { fields: json && typeof json === "object" ? json : {}, file: null };
}

/**
 * The audit row. Ids and kinds only -- never a title, a reflection or a registration number. audit_log is
 * read by estate consoles, and the person's words are not theirs to read.
 */
export async function audit(ctx: IndividualContext, action: string, entityType: string, entityId: string | null, detail: Record<string, unknown> = {}) {
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: null,
    action, entity_type: entityType, entity_id: entityId, new_value: { experience: "professional", ...detail },
  }).then((r: unknown) => r, () => {});
}
