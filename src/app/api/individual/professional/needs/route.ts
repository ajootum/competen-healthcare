import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseNeed, parseNeedStatus } from "@/lib/individual/professional/validate";
import { checkSharedReference } from "@/lib/individual/professional/frameworks";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, writeFailed } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/needs -- COMPETEN-IND-007 s2, development needs.
//
// POST records a need, optionally against a SHARED framework competency (frameworks.hospital_id null,
// checked before the write -- src/lib/individual/professional/frameworks.ts). PATCH changes its status.
// DELETE removes it, and migration 373 clears the link on any goal or evidence that pointed at it
// rather than deleting them.
//
// Every write is the caller's own row: the owner is ctx.userId, and every update and delete matches on
// it as well as the id, so another person's id updates nothing.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const parsed = parseNeed(fields);
  if (!parsed.ok) return refuse(parsed.error);
  const refErr = await checkSharedReference(ctx.admin, parsed.value.framework_id, parsed.value.framework_competency_id);
  if (refErr) return refuse(refErr);

  const { data, error } = await ctx.admin.from("individual_professional_need")
    .insert({ ...parsed.value, user_id: ctx.userId, experience_code: ORIGIN }).select("id").single();
  if (error || !data) return writeFailed("development need");
  await audit(ctx, "individual_professional_need_create", "individual_professional_need", data.id, { origin: parsed.value.origin });
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const status = parseNeedStatus(fields.status);
  if (!isUuid(fields.id) || !status) return refuse("Choose a need and a status.");
  const { data, error } = await ctx.admin.from("individual_professional_need")
    .update({ status, closed_at: status === "open" ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", fields.id).eq("user_id", ctx.userId).select("id").maybeSingle();
  if (error) return writeFailed("development need");
  if (!data) return refuse("That need is not on your record.", 404);
  await audit(ctx, "individual_professional_need_status", "individual_professional_need", data.id, { status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a need.");
  const { data, error } = await ctx.admin.from("individual_professional_need")
    .delete().eq("id", id).eq("user_id", ctx.userId).select("id").maybeSingle();
  if (error) return writeFailed("development need");
  if (!data) return refuse("That need is not on your record.", 404);
  await audit(ctx, "individual_professional_need_delete", "individual_professional_need", id);
  return NextResponse.json({ ok: true });
}
