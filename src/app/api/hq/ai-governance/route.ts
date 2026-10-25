import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { wceMissing } from "@/lib/config/workspace-config-write";
import { attestProvider, changeRate, createBudget, publishPolicies, RATE_KINDS, runProviderChecks, saveBudgetPolicyDraft, saveModelRoutingDraft, savePolicyDraft, saveProviderRegistration, saveRoutingDraft, setBudgetStatus, setProviderStatus, type RateKind } from "@/lib/ai/fair-use-admin";
import { BUDGET_CODE } from "@/lib/ai/consumption";
import { AI_PRODUCTS, type AiProduct } from "@/lib/ai/fair-use-policy";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/ai-governance -- COMPETEN-AI-FAIR-USE-01 s12.
//
// Body: { action: "rate", kind: "price" | "fx" | "basis" | "eligibility", ...fields } | { action: "policy", product, settings } |
//       { action: "publish", note? } | { action: "budget_create", code, ownerType, product, label, institutionRef?, fundingRef? } |
//       { action: "budget_status", budgetId, status } | { action: "budget_policy", code, settings } | { action: "routing", settings } |
//       { action: "model_routing", settings }   (providers, models, primary and alternatives: never a credential) |
//       { action: "provider_save", provider } | { action: "provider_check", id } | { action: "provider_attest", id, kind, ... } |
//       { action: "provider_status", id, status }   (registration: provider-registry.ts. A key is never sent or returned.)
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
    // ── Budgets (AI-CONSUMPTION-01 s6). Identity and status are rows; policy and routing are CONFIG-002 drafts. ──
    case "budget_create": {
      const r = await createBudget(ctx.admin, body, ctx.userId);
      if (!r.ok) return refuse(422, r.error);
      await audit("ai_budget_created", { id: r.id, code: body.code, owner_type: body.ownerType, product: body.product });
      return NextResponse.json({ ok: true });
    }
    case "budget_status": {
      const r = await setBudgetStatus(ctx.admin, String(body.budgetId ?? ""), body.status);
      if (!r.ok) return refuse(422, r.error);
      await audit("ai_budget_status_changed", { id: body.budgetId, status: body.status });
      return NextResponse.json({ ok: true });
    }
    case "budget_policy": {
      if (typeof body.code !== "string" || !BUDGET_CODE.test(body.code)) return refuse(400, "Choose a budget.");
      const { data: b } = await ctx.admin.from("ai_budget").select("id").eq("code", body.code).maybeSingle();
      if (!b) return refuse(404, "No such budget.");
      if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
      const r = await saveBudgetPolicyDraft(ctx.admin, actor, body.code, body.settings ?? {});
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    case "routing": {
      if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
      const r = await saveRoutingDraft(ctx.admin, actor, body.settings ?? {});
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    // ── Model routing (owner MULTI-PROVIDER AI DIRECTION). A CONFIG-002 draft; publishes with the other AI policies. ──
    case "model_routing": {
      if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
      const r = await saveModelRoutingDraft(ctx.admin, actor, body.settings ?? {});
      if (r.ok) await audit("ai_model_routing_draft", { providers: Object.keys(body.settings?.providers ?? {}) });
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    // ── Provider registration (owner NO-CODE AI PROVIDER EXTENSIBILITY). Each act is audited, none carries a key. ──
    case "provider_save": {
      if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
      const r = await saveProviderRegistration(ctx.admin, actor, body.provider ?? {});
      if (r.ok) await audit("ai_provider_registered", { id: body.provider?.id, endpoint: body.provider?.endpoint, protocol: body.provider?.protocol });
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    case "provider_check": {
      const r = await runProviderChecks(ctx.admin, { ...actor, userId: ctx.userId }, String(body.id ?? ""));
      if (r.ok) await audit("ai_provider_checked", { id: body.id, detail: r.detail ?? null });
      return r.ok ? NextResponse.json({ ok: true, detail: r.detail }) : refuse(r.status, r.error);
    }
    case "provider_attest": {
      const kind = body.kind === "security" ? "security" : body.kind === "privacy" ? "privacy" : null;
      if (!kind) return refuse(400, "Say which check: privacy or security.");
      const r = await attestProvider(ctx.admin, { ...actor, userId: ctx.userId }, String(body.id ?? ""), kind, body);
      if (r.ok) await audit("ai_provider_attested", { id: body.id, kind });
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    case "provider_status": {
      const status = body.status === "active" ? "active" : "inactive";
      const r = await setProviderStatus(ctx.admin, actor, String(body.id ?? ""), status);
      if (r.ok) await audit(status === "active" ? "ai_provider_activated" : "ai_provider_deactivated", { id: body.id });
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    default:
      return refuse(400, "Unknown action");
  }
}
