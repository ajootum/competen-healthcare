import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";

import { currentTraceId } from "@/lib/trace";
// Clinical Knowledge Objects — create, publish and retire governed knowledge.
//
// ⚠ THE ONE OF THE NINE THAT WAS A REAL HOLE, AND WHAT MADE IT ONE.
//
//   PATCH did  .update(update).eq("id", id)  with NO scope check and NO ownership check,
//   `knowledge_objects` carries NO hospital_id -- it is a GLOBAL platform table (19 rows when measured),
//   the role list admitted educator and hospital_admin -- 8 live accounts,
//   and it uses the SERVICE-ROLE client, so RLS is bypassed and this route is the only control.
//
// Any of those 8 could retitle, rewrite the content of, or retire any governed clinical knowledge object in
// the product, including ones the platform authored, from any tenant. For content every tenant reads, that
// is a platform-integrity hole rather than a data leak, which is why nothing had noticed it.
//
// ⚠ THE FIX IS THE GATE, NOT AN OWNERSHIP CHECK, and that is deliberate. The table is global and has no
// tenant to scope to; "who may edit platform-wide clinical knowledge" is exactly the question a capability
// answers. Adding `created_by === userId` instead would have been worse -- it would stop the Learning
// Product Director editing knowledge they are appointed to govern.
//
// ⚠ TWO CAPABILITIES, BECAUSE TWO CONSOLES CALL IT: /super-admin/ckp/* and /super-admin/studio/*. No seeded
// position currently holds one without the other, but a position is DATA and today's grant table is not a
// rule. See hqApiGate for the any-of argument.
const CAPABILITIES = ["hq.learning.knowledge.view", "hq.learning.studio.view"];

const TYPES = ["anatomy", "physiology", "pathophysiology", "pharmacology", "classification",
  "assessment_tool", "clinical_reasoning", "procedure", "evidence", "other"];

export async function POST(req: Request) {
  const ctx = await hqApiGate(CAPABILITIES);
  if (isHqRefusal(ctx)) return ctx;

  const { title, knowledge_type, cpu_id, summary, content, source_ref } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: "A title is required" }, { status: 400 });
  const type = TYPES.includes(knowledge_type) ? knowledge_type : "other";

  const { data, error } = await ctx.admin.from("knowledge_objects").insert({
    title: title.trim(),
    knowledge_type: type,
    cpu_id: cpu_id || null,
    summary: summary?.trim() || null,
    content: content?.trim() || null,
    source_ref: source_ref?.trim() || null,
    status: "draft",
    created_by: ctx.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (cpu_id) {
    await ctx.admin.from("knowledge_links").insert({
      knowledge_object_id: data.id, target_type: "cpu", target_id: cpu_id,
    });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await hqApiGate(CAPABILITIES);
  if (isHqRefusal(ctx)) return ctx;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json();

  const update: Record<string, unknown> = {};
  if (body.status && ["draft", "active", "retired"].includes(body.status)) update.status = body.status;
  if (body.title?.trim()) update.title = body.title.trim();
  if (body.summary !== undefined) update.summary = body.summary?.trim() || null;
  if (body.content !== undefined) update.content = body.content?.trim() || null;
  if (body.knowledge_type && TYPES.includes(body.knowledge_type)) update.knowledge_type = body.knowledge_type;
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await ctx.admin.from("knowledge_objects").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (update.status) {
    await ctx.admin.from("audit_log").insert({ trace_id: await currentTraceId(),
      actor_id: ctx.userId, actor_name: ctx.fullName,
      action: `knowledge_${update.status}`, entity_type: "knowledge_object", entity_id: id,
      new_value: { status: update.status },
    });
  }
  return NextResponse.json({ ok: true });
}
