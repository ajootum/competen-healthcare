import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { publishScope, resetOverride, rollbackVersion, setOverride, wceMissing } from "@/lib/config/workspace-config-write";
import { POLICY_SCOPE, policyDef, policyPath, validateDraft } from "@/lib/individual/policy";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/individual/config -- COMPETEN-CONFIG-002 items 4-7.
//
// The Competen Individual policy, written through the EXISTING Workspace Configuration Engine lifecycle
// (src/lib/config/workspace-config-write.ts, migration 076): draft, publish as a version, roll back to a
// version, each audited in workspace_config_audit. Body: { action: "set", key, value } | { action:
// "reset", key } | { action: "publish", note? } | { action: "rollback", versionId }.
//
// ⚠ GATED BY hqApiGate(["hq.individual.config.manage"]) (migration 376) -- the right the Individual Product
// Administrator appointment holds. Not super-admin, not landlord authority: this door can write only the
// paths in the policy catalogue, only at scope platform/individual, only within each fixed hard limit.
//
// ⚠ IT CANNOT REACH the Individual release gate (owner-only activation, CONFIG-002 item 3), a
// workspace setting, or another scope. Rollback names its scope, so a version from any other scope is
// "not found" here.

const SCOPE = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };
const refuse = (status: number, message: string) => NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.config.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");

  const body = await req.json().catch(() => ({}));
  const actor = { userId: ctx.userId, name: ctx.fullName ?? null };

  switch (body?.action) {
    case "set": {
      const v = validateDraft(body.key, body.value);
      if (!v.ok) return refuse(422, v.error);
      const r = await setOverride(ctx.admin, actor, SCOPE, policyPath(v.def.key), v.settings);
      return r.ok ? NextResponse.json({ ok: true }) : refuse(500, "The draft could not be saved. Nothing has changed.");
    }
    case "reset": {
      const def = typeof body.key === "string" ? policyDef(body.key) : undefined;
      if (!def) return refuse(422, "That is not a Competen Individual policy.");
      await resetOverride(ctx.admin, actor, SCOPE, policyPath(def.key));
      return NextResponse.json({ ok: true });
    }
    case "publish": {
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
      const r = await publishScope(ctx.admin, actor, SCOPE, { label: "Competen Individual policy", note });
      return r.ok ? NextResponse.json({ ok: true, versionId: r.version_id, policies: r.modules }) : refuse(500, "It could not be published. Nothing has changed.");
    }
    case "rollback": {
      if (typeof body.versionId !== "string" || !body.versionId) return refuse(422, "Choose a version.");
      // prune: the partition reads exactly as it did at that version, so a policy set later goes back to its default.
      const r = await rollbackVersion(ctx.admin, actor, body.versionId, { scope: SCOPE, prune: true });
      return r.ok ? NextResponse.json({ ok: true, restored: r.restored, reset: r.pruned }) : refuse(404, "That version was not found.");
    }
    default:
      return refuse(400, "Unknown action.");
  }
}
