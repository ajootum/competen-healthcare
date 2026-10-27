import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { govStatusForDbError } from "@/lib/hq/governance-model";
import {
  applyStudioOp, asDefinition, isOwnerOnly, loadStudio, parseStudioAction, saveDraftRpc, studioRpcFor, validateDefinition,
} from "@/lib/hq/governance-studio";

/**
 * /api/hq/governance/studio — the Organisation & Governance Studio (Addendum V1.2, migration 620).
 *
 * GET   ?structure=&version=   the structure, its versions, the version on screen and the published one
 * POST  one action: create_structure | create_draft | edit | save_details | transition | publish | add_relation_type
 *
 * ⚠ THE GATE. hq.platform.governance.manage (granted to no position) or ownership opens the studio and lets a
 * person edit a draft. Approve, publish and create_structure are owner-only, here AND in the database.
 *
 * ⚠ AN EDIT IS ONE OPERATION ON THE DRAFT THE DATABASE HOLDS. The route reads the draft, applies the operation with
 * applyStudioOp (which never removes anything), checks the result, and saves it with the revision the editor read, so
 * a concurrent edit is refused rather than overwritten. Nothing here grants access or appoints anyone.
 */
const GATE = ["hq.platform.governance.manage"];
const dbRefusal = (message: string, code?: string | null) => {
  const { status, error } = govStatusForDbError(message, code);
  return NextResponse.json({ error: status === 503 ? "The studio is not available yet: migration 620 is not applied to this database. Nothing was changed." : error }, { status });
};

export async function GET(req: Request) {
  const ctx = await hqApiGate(GATE);
  if (isHqRefusal(ctx)) return ctx;
  const url = new URL(req.url);
  const load = await loadStudio(ctx.admin, { structure: url.searchParams.get("structure"), version: url.searchParams.get("version") });
  return NextResponse.json({ load, isOwner: ctx.isOwner });
}

export async function POST(req: Request) {
  const ctx = await hqApiGate(GATE);
  if (isHqRefusal(ctx)) return ctx;
  const parsed = parseStudioAction(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const a = parsed.value;
  if (isOwnerOnly(a) && !ctx.isOwner)
    return NextResponse.json({ error: "Approving, publishing and creating structures is reserved to a platform owner." }, { status: 403 });
  const actor = { id: ctx.userId, name: ctx.fullName, trace: await currentTraceId() };

  if (a.action === "edit" || a.action === "save_details") {
    const { data: v, error } = await ctx.admin.from("hq_gov_structure_version")
      .select("id, structure_code, status, revision, definition, based_on_version_id").eq("id", a.version).maybeSingle();
    if (error) return dbRefusal(error.message, error.code);
    if (!v) return NextResponse.json({ error: "No such version." }, { status: 404 });
    if (v.status !== "draft") return NextResponse.json({ error: `Only a draft is edited. This version is ${v.status}.` }, { status: 409 });
    if (v.revision !== a.revision) return NextResponse.json({ error: "The draft changed since you opened it. Reload and apply your change again." }, { status: 409 });
    let def = asDefinition(v.definition);
    if (a.action === "edit") {
      const applied = applyStudioOp(def, a.op);
      if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 400 });
      def = applied.def;
    }
    const { fn, args } = saveDraftRpc(actor, a.version, a.revision, def, a.reason,
      a.action === "save_details" ? a.title : null, a.action === "save_details" ? a.changeSummary : null);
    const { data, error: rpcErr } = await ctx.admin.rpc(fn, args);
    if (rpcErr) return dbRefusal(rpcErr.message, rpcErr.code);
    // Problems that would stop publication are returned as advice, never hidden. Saving a draft with them is allowed.
    const { data: base } = v.based_on_version_id
      ? await ctx.admin.from("hq_gov_structure_version").select("definition").eq("id", v.based_on_version_id).maybeSingle()
      : { data: null };
    const problems = validateDefinition(def, { base: base ? asDefinition(base.definition) : null });
    return NextResponse.json({ ok: true, action: a.action, result: data, problems });
  }

  const { fn, args } = studioRpcFor(a, actor);
  const { data, error } = await ctx.admin.rpc(fn, args);
  if (error) return dbRefusal(error.message, error.code);
  return NextResponse.json({ ok: true, action: a.action, result: data });
}
