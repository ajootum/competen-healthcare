import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { wceMissing } from "@/lib/config/workspace-config-write";
import { CHECK_KINDS, publishResearch, recordCheck, rollbackResearch, runConnectivity, savePolicy, saveProvider, saveWorkflow, transition, type CheckKind } from "@/lib/holdings/research/admin";
import type { Lifecycle } from "@/lib/holdings/research/registry";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/research-sources -- COMPETEN-RESEARCH-01 ADDENDUM V2, the Research Sources & Evidence Studio.
//
// Body: { action: "provider_save", id, patch } | { action: "provider_check", id } (connectivity, server-run) |
//       { action: "provider_attest", id, kind, note } | { action: "provider_transition", id, to } |
//       { action: "policy", settings } | { action: "workflow", id, patch } | { action: "publish", note? } | { action: "rollback", versionId }
//
// ⚠ GATED BY hqApiGate(["hq.platform.research.manage"]) (migration 630, granted to NO position): until the owner grants
// it, only platform owners pass. Approval, activation, retirement, spend approval, publish and rollback check isOwner
// in admin.ts as well. Everything is a CONFIG-002 draft until an owner publishes it. No credential is read or returned.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.platform.research.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
  const body = await req.json().catch(() => ({}));
  const actor = { userId: ctx.userId, name: ctx.fullName ?? null, isOwner: ctx.isOwner };
  const id = typeof body?.id === "string" ? body.id : "";
  const r = await (async () => {
    switch (body?.action) {
      case "provider_save": return saveProvider(ctx.admin, actor, id, body.patch && typeof body.patch === "object" ? body.patch : {});
      case "provider_check": return runConnectivity(ctx.admin, actor, id);
      case "provider_attest": return (CHECK_KINDS as readonly string[]).includes(body.kind) ? recordCheck(ctx.admin, actor, id, body.kind as CheckKind, String(body.note ?? "")) : { ok: false as const, status: 400, error: "Choose a check." };
      case "provider_transition": return transition(ctx.admin, actor, id, body.to as Lifecycle);
      case "policy": return savePolicy(ctx.admin, actor, body.settings ?? {});
      case "workflow": return saveWorkflow(ctx.admin, actor, id, body.patch ?? {});
      case "publish": return publishResearch(ctx.admin, actor, typeof body.note === "string" ? body.note.slice(0, 500) : null);
      case "rollback": return rollbackResearch(ctx.admin, actor, String(body.versionId ?? ""));
      default: return { ok: false as const, status: 400, error: "Unknown action." };
    }
  })();
  return r.ok ? NextResponse.json({ ok: true, detail: r.detail ?? null }) : refuse(r.status, r.error);
}
