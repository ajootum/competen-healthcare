import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseNeed, parseNeedStatus } from "@/lib/individual/professional/validate";
import { checkSharedReference } from "@/lib/individual/professional/frameworks";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, writeFailed } from "@/lib/individual/professional/api";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { checkStageChange, parseNeedForm } from "@/lib/individual/professional/needs-form";
import { createNeed, reflectionOf, updateNeed } from "@/lib/individual/professional/needs-store";

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
//
// COMPETEN-PROFESSIONAL-NEEDS-01 (Stage 2, migration 470). A body with `stage2` set uses the Stage 2 form: only the
// title is required, every other field is optional and configured, and it may name the person's own reflection
// (its words are copied into the need only when `includeReflection` is ticked). PATCH also takes `stage` (any
// offered stage, in any order, subject to the reopen rule) and `reviewed`. Without `stage2` everything below
// behaves exactly as the MVP did, so it keeps working where 470 is not applied.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (fields.stage2 === true || fields.stage2 === "true") {
    const form = parseNeedForm(fields, (await loadIndividualPolicy(ctx.admin)).professionalNeeds);
    if (!form.ok) return refuse(form.error);
    const reflectionId = isUuid(fields.reflectionId) ? fields.reflectionId : null;
    if (reflectionId && (fields.includeReflection === "true" || fields.includeReflection === true)) {
      const r = await reflectionOf(ctx.admin, ctx.userId, reflectionId);
      if (!r) return refuse("That reflection is not yours.", 404);
      form.value.detail = [form.value.detail, r.body].filter(Boolean).join("\n\n").slice(0, 2000);
    }
    const made = await createNeed(ctx.admin, ctx.userId, form.value, { reflectionId });
    if (!made.ok) return refuse(made.error, made.status);
    await audit(ctx, "individual_professional_need_create", "individual_professional_need", made.id, { origin: reflectionId ? "reflection" : form.value.origin, stage2: true });
    return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
  }
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
  if (fields.stage !== undefined || fields.reviewed !== undefined) {
    if (!isUuid(fields.id)) return refuse("Choose a need.");
    const { data: before } = await ctx.admin.from("individual_professional_need").select("id, stage_code").eq("id", fields.id).eq("user_id", ctx.userId).maybeSingle();
    if (!before) return refuse("That need is not on your record.", 404);
    let stage: Parameters<typeof updateNeed>[3]["stage_code"];
    if (fields.stage !== undefined) {
      const ch = checkStageChange(before.stage_code, fields.stage, (await loadIndividualPolicy(ctx.admin)).professionalNeeds);
      if (!ch.ok) return refuse(ch.error);
      stage = ch.value;
    }
    const out = await updateNeed(ctx.admin, ctx.userId, before.id, { ...(stage ? { stage_code: stage } : {}), reviewed: fields.reviewed === true || fields.reviewed === "true" || !!stage });
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, stage ? "individual_professional_need_stage" : "individual_professional_need_reviewed", "individual_professional_need", before.id, stage ? { from: before.stage_code, to: stage } : {});
    return NextResponse.json({ ok: true });
  }
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

/**
 * PUT ?id= -- edit a need's title and detail. Where it came from and what it links to stay as recorded: the same
 * parser checks the whole need, but only the words are written.
 */
export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a need.");
  const { fields } = await readBody(req);
  const { data: before } = await ctx.admin.from("individual_professional_need").select("id, origin, framework_id, framework_competency_id").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!before) return refuse("That need is not on your record.", 404);
  if (fields.stage2 === true || fields.stage2 === "true") {
    // Stage 2: only the fields the form sent are revised. The 470 trigger keeps the earlier wording as history.
    const form = parseNeedForm(fields, (await loadIndividualPolicy(ctx.admin)).professionalNeeds, true);
    if (!form.ok) return refuse(form.error);
    if (fields.source === undefined) delete form.value.origin;
    else if (["reflection", "aspiration", "passport_gap"].includes(before.origin)) delete form.value.origin;
    const out = await updateNeed(ctx.admin, ctx.userId, id, { ...form.value, reviewed: true });
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_need_update", "individual_professional_need", id, { stage2: true });
    return NextResponse.json({ ok: true });
  }
  const parsed = parseNeed({ ...fields, origin: before.origin, frameworkId: before.framework_id ?? "", frameworkCompetencyId: before.framework_competency_id ?? "" });
  if (!parsed.ok) return refuse(parsed.error);
  const { data, error } = await ctx.admin.from("individual_professional_need")
    .update({ title: parsed.value.title, detail: parsed.value.detail, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId).select("id").maybeSingle();
  if (error) return writeFailed("development need");
  if (!data) return refuse("That need is not on your record.", 404);
  await audit(ctx, "individual_professional_need_update", "individual_professional_need", id);
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
