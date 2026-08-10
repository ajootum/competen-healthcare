import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";

import { currentTraceId } from "@/lib/trace";
// Clinical case studies — publish / retire / adjust difficulty.
//
// ⚠ NARROWED FROM A ROLE LIST TO THE CAPABILITY ITS CONSOLE REQUIRES (CP-HQ-NAV-001 follow-up).
//
// It used to admit super_admin, hospital_admin and educator, and `clinical_cases` carries no hospital_id --
// so any of them could PATCH any case in the product by id, with no scope or ownership check. The only
// caller is /super-admin/studio/cases, which now requires hq.learning.studio.view, so the role list was
// vestigial: nothing in the estate calls this and no screen loses anything by the narrowing.
const CAPABILITIES = ["hq.learning.studio.view"];

export async function PATCH(req: Request) {
  const ctx = await hqApiGate(CAPABILITIES);
  if (isHqRefusal(ctx)) return ctx;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json();

  const update: Record<string, unknown> = {};
  if (body.status && ["draft", "active", "retired"].includes(body.status)) update.status = body.status;
  if (body.difficulty && ["foundation", "intermediate", "advanced"].includes(body.difficulty)) update.difficulty = body.difficulty;
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await ctx.admin.from("clinical_cases").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (update.status) {
    await ctx.admin.from("audit_log").insert({ trace_id: await currentTraceId(),
      actor_id: ctx.userId, actor_name: ctx.fullName,
      action: `case_${update.status}`, entity_type: "clinical_case", entity_id: id,
      new_value: { status: update.status },
    });
  }
  return NextResponse.json({ ok: true });
}
