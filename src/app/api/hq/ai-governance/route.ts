import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { wceMissing } from "@/lib/config/workspace-config-write";
import { changeRate, publishPolicies, RATE_KINDS, savePolicyDraft, type RateKind } from "@/lib/ai/fair-use-admin";
import { AI_PRODUCTS, type AiProduct } from "@/lib/ai/fair-use-policy";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/ai-governance -- COMPETEN-AI-FAIR-USE-01 s12.
//
// Body: { action: "rate", kind: "price" | "fx" | "basis" | "eligibility", ...fields } | { action: "policy", product, settings } |
//       { action: "publish", note? }
//
// ⚠ GATED BY hqApiGate(["hq.platform.ai.manage"]) (migration 410, the Platform Director). Rates are append-only
// history (the 410 guard). Policies go through the CONFIG-002 engine, clamped by the same resolvePolicy the engine
// reads with. This route cannot touch a person's balance, read a provider credential, or switch metering on.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.platform.ai.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const actor = { userId: ctx.userId, name: ctx.fullName ?? null };
  const audit = async (action: string, detail: Record<string, unknown>) => ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null, action, entity_type: "ai_fair_use", entity_id: null, new_value: detail,
  }).then((x: unknown) => x, () => {});

  switch (body?.action) {
    case "rate": {
      if (!(RATE_KINDS as readonly string[]).includes(body.kind)) return refuse(400, "Choose a rate kind.");
      const r = await changeRate(ctx.admin, body.kind as RateKind, body, ctx.userId);
      if (!r.ok) return refuse(422, r.error);
      await audit(body.kind === "eligibility" ? "ai_model_eligibility_decided" : "ai_rate_changed", { kind: body.kind, id: r.id });
      return NextResponse.json({ ok: true });
    }
    case "policy": {
      if (!(AI_PRODUCTS as readonly string[]).includes(body.product)) return refuse(400, "Choose a product.");
      if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
      const r = await savePolicyDraft(ctx.admin, actor, body.product as AiProduct, body.settings ?? {});
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    case "publish": {
      if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
      const r = await publishPolicies(ctx.admin, actor, typeof body.note === "string" ? body.note.slice(0, 500) : null);
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    default:
      return refuse(400, "Unknown action");
  }
}
