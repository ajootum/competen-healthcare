import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseEvidence } from "@/lib/individual/professional/validate";
import { checkSharedReference } from "@/lib/individual/professional/frameworks";
import { removeDocument, storeDocument } from "@/lib/individual/professional/documents";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, todayUtc, writeFailed } from "@/lib/individual/professional/api";

// /api/individual/professional/evidence -- COMPETEN-IND-007 s4, credentials and competency evidence.
//
// ⚠ NOT professional_credentials, NOT evidence (owner ruling D1). Both are read by hospital staff in
// scope. This writes migration 373's individual_professional_evidence and its private bucket.
//
// ⚠ SELF-DECLARED OR SOURCE-LINKED, AND NOTHING ELSE. The class is 373's generated column. A credential
// added here is never "verified" -- there is no regulator lookup and no verifier, so the page says so.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields, file } = await readBody(req);
  const parsed = parseEvidence(fields, todayUtc());
  if (!parsed.ok) return refuse(parsed.error);
  const refErr = await checkSharedReference(ctx.admin, parsed.value.framework_id, parsed.value.framework_competency_id);
  if (refErr) return refuse(refErr);
  if (parsed.value.need_id) {
    const { data: need } = await ctx.admin.from("individual_professional_need").select("id").eq("id", parsed.value.need_id).eq("user_id", ctx.userId).maybeSingle();
    if (!need) return refuse("That need is not on your record.");
  }

  let doc = {};
  if (file) {
    const stored = await storeDocument(ctx.admin, ctx.userId, file);
    if (!stored.ok) return refuse(stored.error);
    doc = stored.doc;
  }
  const { data, error } = await ctx.admin.from("individual_professional_evidence")
    .insert({ ...parsed.value, ...doc, user_id: ctx.userId, experience_code: ORIGIN }).select("id, evidence_class").single();
  if (error || !data) {
    await removeDocument(ctx.admin, (doc as { document_path?: string }).document_path);
    return writeFailed("evidence");
  }
  await audit(ctx, "individual_professional_evidence_create", "individual_professional_evidence", data.id, { kind: parsed.value.kind, evidence_class: data.evidence_class });
  return NextResponse.json({ ok: true, id: data.id, evidenceClass: data.evidence_class }, { status: 201 });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose an item.");
  const { data, error } = await ctx.admin.from("individual_professional_evidence")
    .delete().eq("id", id).eq("user_id", ctx.userId).select("id, document_path").maybeSingle();
  if (error) return writeFailed("evidence");
  if (!data) return refuse("That item is not on your record.", 404);
  await removeDocument(ctx.admin, data.document_path);
  await audit(ctx, "individual_professional_evidence_delete", "individual_professional_evidence", id);
  return NextResponse.json({ ok: true });
}
