import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseCpd } from "@/lib/individual/professional/validate";
import { removeDocument, storeDocument } from "@/lib/individual/professional/documents";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, todayUtc, writeFailed } from "@/lib/individual/professional/api";

// /api/individual/professional/cpd -- COMPETEN-IND-007 s4, the private CPD log.
//
// ⚠ NOT cpd_logs (owner ruling D1). The estate CPD table is read by hospital analytics
// (src/lib/operations/pd-cpd.ts). This writes migration 373's individual_professional_cpd, which no
// institutional reader queries and which has no hospital column to scope by.
//
// ⚠ THE CLASS IS NOT SENT, IT IS COMPUTED. A certificate attached here makes the entry `source_linked`
// through 373's generated column. Nothing in the body can make it anything else, and nothing makes it
// verified.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields, file } = await readBody(req);
  const parsed = parseCpd(fields, todayUtc());
  if (!parsed.ok) return refuse(parsed.error);
  if (parsed.value.goal_id) {
    const { data: goal } = await ctx.admin.from("individual_professional_goal").select("id").eq("id", parsed.value.goal_id).eq("user_id", ctx.userId).maybeSingle();
    if (!goal) return refuse("That goal is not on your record.");
  }

  let doc = {};
  if (file) {
    const stored = await storeDocument(ctx.admin, ctx.userId, file);
    if (!stored.ok) return refuse(stored.error);
    doc = stored.doc;
  }
  const { data, error } = await ctx.admin.from("individual_professional_cpd")
    .insert({ ...parsed.value, ...doc, user_id: ctx.userId, experience_code: ORIGIN }).select("id, evidence_class").single();
  if (error || !data) {
    await removeDocument(ctx.admin, (doc as { document_path?: string }).document_path);
    return writeFailed("CPD entry");
  }
  await audit(ctx, "individual_professional_cpd_create", "individual_professional_cpd", data.id, { evidence_class: data.evidence_class });
  return NextResponse.json({ ok: true, id: data.id, evidenceClass: data.evidence_class }, { status: 201 });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a CPD entry.");
  const { data, error } = await ctx.admin.from("individual_professional_cpd")
    .delete().eq("id", id).eq("user_id", ctx.userId).select("id, document_path").maybeSingle();
  if (error) return writeFailed("CPD entry");
  if (!data) return refuse("That CPD entry is not on your record.", 404);
  await removeDocument(ctx.admin, data.document_path);
  await audit(ctx, "individual_professional_cpd_delete", "individual_professional_cpd", id);
  return NextResponse.json({ ok: true });
}
