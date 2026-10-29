import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { checkStage, createDraft, discardDraft, publishMapping, setBand, upsertStage } from "@/lib/competency/stage-mapping";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/competency-studio/stages -- CFCA-STUDIO-P1 competency stages and scale-to-stage mappings (660).
//
// Body: { action: "stage", code, label, description?, sortOrder?, active? }      author
//     | { action: "draft", scaleId, note? }                                     author
//     | { action: "band", mappingId, levelId, stageCode }                       author
//     | { action: "discard", mappingId }                                        author
//     | { action: "publish", mappingId }                                        publisher
//
// ⚠ TWO AUTHORITIES. Drafting is hq.quality.competency.author. Publishing is hq.quality.competency.publish, the
// independent publisher, and the 660 trigger refuses a publisher who drafted the version -- the same separation
// as framework publication (580, 640). A published or retired mapping can never be edited: a change is a new
// draft version.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const AUTHOR = "hq.quality.competency.author", PUBLISH = "hq.quality.competency.publish";

export async function POST(req: Request) {
  const ctx = await hqApiGate([AUTHOR, PUBLISH]);
  if (isHqRefusal(ctx)) return ctx;
  const holds = (c: string) => ctx.isOwner || ctx.capabilities.includes(c);
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action === "publish" ? !holds(PUBLISH) : !holds(AUTHOR))
    return refuse(403, action === "publish" ? "Publishing a stage mapping needs publication authority." : "Changing stages and drafts needs competency authoring authority.");

  let result: { ok: true; id?: string } | { ok: false; error: string };
  switch (action) {
    case "stage": {
      const s = checkStage(body);
      if (!s.ok) return refuse(422, s.error);
      result = await upsertStage(ctx.admin, s.stage);
      break;
    }
    case "draft":
      if (!isId(body.scaleId)) return refuse(400, "Choose a scale.");
      result = await createDraft(ctx.admin, body.scaleId, ctx.userId, typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null);
      break;
    case "band":
      if (!isId(body.mappingId) || !isId(body.levelId) || typeof body.stageCode !== "string") return refuse(400, "Choose a level and a stage.");
      result = await setBand(ctx.admin, body.mappingId, body.levelId, body.stageCode);
      break;
    case "discard":
      if (!isId(body.mappingId)) return refuse(400, "Choose a draft.");
      result = await discardDraft(ctx.admin, body.mappingId);
      break;
    case "publish":
      if (!isId(body.mappingId)) return refuse(400, "Choose a draft.");
      result = await publishMapping(ctx.admin, body.mappingId, ctx.userId);
      break;
    default:
      return refuse(400, "Unknown action.");
  }
  if (!result.ok) return refuse(409, result.error);

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: `competency_stage_${action}`, entity_type: action === "stage" ? "competency_stage" : "competency_stage_mapping",
    entity_id: null, entity_name: String(body.mappingId ?? body.scaleId ?? body.code ?? ""), old_value: null,
    new_value: { ...body, ...(result.id ? { id: result.id } : {}) },
  }).then((r: unknown) => r, () => {});
  return NextResponse.json({ ok: true, ...(result.id ? { id: result.id } : {}) });
}
