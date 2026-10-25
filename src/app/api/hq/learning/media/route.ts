import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { LEARNING_OFF, learningEnabled } from "@/lib/learning/policy";
import { uploadMedia } from "@/lib/learning/studio";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/learning/media -- COMPETEN-LEARNING-01 S1, migration 460 (bucket learning-content).
//
// multipart/form-data: versionId, file. Behind hq.learning.course.author. A file is written once under a new path of
// the DRAFT it belongs to, and never overwritten, so an approved version never changes underneath its approval.

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.learning.course.author"]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await learningEnabled(ctx.admin))) return NextResponse.json({ error: LEARNING_OFF }, { status: 409 });
  const form = await req.formData().catch(() => null);
  const versionId = typeof form?.get("versionId") === "string" ? String(form?.get("versionId")) : "";
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  const r = await uploadMedia(ctx.admin, ctx.userId, versionId, file);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null, action: "learning_media_upload",
    entity_type: "learning_offering_version", entity_id: versionId, new_value: { path: r.mediaPath, mime: file.type, bytes: file.size },
  }).then((x: unknown) => x, () => {});
  return NextResponse.json(r);
}
