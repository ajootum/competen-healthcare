import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { publishScope, resetOverride, rollbackVersion, setOverride, wceMissing } from "@/lib/config/workspace-config-write";
import { POLICY_SCOPE, policyDef, policyPath, validateDraft } from "@/lib/individual/policy";
import { checkLcpdDraft, LCPD_PATH } from "@/lib/individual/professional/lcpd-config";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/individual/config -- COMPETEN-CONFIG-002 items 4-7.
//
// The Competen Individual policy, written through the EXISTING Workspace Configuration Engine lifecycle
// (src/lib/config/workspace-config-write.ts, migration 076): draft, publish as a version, roll back to a
// version, each audited in workspace_config_audit. Body: { action: "set", key, value } | { action:
// "reset", key } | { action: "publish", note? } | { action: "rollback", versionId } | { action: "lcpd", settings }.
//
// "lcpd" (COMPETEN-PROFESSIONAL-LCPD-01 s11) is the one other path this door writes: the Professional Learning and CPD
// document (src/lib/individual/professional/lcpd-config.ts) -- activity types, reflection templates, CPD requirements
// with their source and review status, Passport eligibility. Validated whole, drafted, and published with the rest.
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
      // S1: a catalogue allowlist may name only shared, active, published frameworks -- checked against the
      // library now, and again on every read (src/lib/competency/foundation.ts), so a later unpublish offers nothing.
      if (v.def.kind === "catalogues") {
        const ids = (v.settings.ids as string[]) ?? [];
        if (ids.length) {
          const { data, error } = await ctx.admin.from("frameworks").select("id").in("id", ids).is("hospital_id", null).eq("is_active", true).eq("pub_status", "published");
          if (error) return refuse(503, "The catalogues could not be checked just now. Nothing has changed.");
          const ok = new Set((data ?? []).map((r: { id: string }) => String(r.id).toLowerCase()));
          if (ids.some(id => !ok.has(id))) return refuse(422, `${v.def.label}: only shared, active, published catalogues can be chosen.`);
        }
      }
      // JOIN-01: programmes offered at join, and programmes given levels, must be active Scholar programme rows
      // (migration 387) -- checked now, and again on every read (src/lib/individual/scholar/context.ts).
      if (v.def.kind === "programmes" || v.def.kind === "levels") {
        const codes = v.def.kind === "programmes" ? (v.settings.codes as string[]) : Object.keys(v.settings.byProgramme as Record<string, unknown>);
        if (codes.length) {
          const { data, error } = await ctx.admin.from("individual_scholar_programme").select("code").in("code", codes).eq("is_active", true);
          if (error) return refuse(503, "The programmes could not be checked just now. Nothing has changed.");
          const ok = new Set((data ?? []).map((r: { code: string }) => r.code));
          if (codes.some(c => !ok.has(c))) return refuse(422, `${v.def.label}: only active Scholar programmes can be named.`);
        }
      }
      const r = await setOverride(ctx.admin, actor, SCOPE, policyPath(v.def.key), v.settings);
      return r.ok ? NextResponse.json({ ok: true }) : refuse(500, "The draft could not be saved. Nothing has changed.");
    }
    case "lcpd": {
      const v = checkLcpdDraft(body.settings);
      if (!v.ok) return refuse(422, v.error);
      const r = await setOverride(ctx.admin, actor, SCOPE, LCPD_PATH, v.settings);
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
