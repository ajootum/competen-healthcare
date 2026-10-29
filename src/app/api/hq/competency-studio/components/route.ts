import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { checkComponentDef, upsertComponent } from "@/lib/competency/studio-components";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/competency-studio/components -- CFCA-STUDIO-P1 CCHU assessment component registry (660).
//
// Body: { code, label, description?, sortOrder?, active? } -- create or change one component. A component is
// retired with active: false, never deleted: programme frameworks that require it keep their record.
//
// ⚠ GATED BY hqApiGate(["hq.quality.competency.author"]), the Competency Author (465). Which components a
// programme requires of a competency is set on the programme framework (programmes route), not here.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.quality.competency.author"]);
  if (isHqRefusal(ctx)) return ctx;
  const checked = checkComponentDef(await req.json().catch(() => ({})));
  if (!checked.ok) return refuse(422, checked.error);
  const result = await upsertComponent(ctx.admin, checked.def);
  if (!result.ok) return refuse(409, result.error);
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: "competency_assessment_component_set", entity_type: "competency_assessment_component", entity_id: null,
    entity_name: checked.def.code, old_value: null, new_value: checked.def,
  }).then((r: unknown) => r, () => {});
  return NextResponse.json({ ok: true });
}
