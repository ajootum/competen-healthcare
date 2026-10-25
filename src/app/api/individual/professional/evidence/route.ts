import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseEvidence } from "@/lib/individual/professional/validate";
import { checkSharedReference } from "@/lib/individual/professional/frameworks";
import { removeDocument, storeDocument } from "@/lib/individual/professional/documents";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, todayUtc, writeFailed } from "@/lib/individual/professional/api";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { parseEvidenceType } from "@/lib/individual/professional/competency-form";
import { isNotProvisioned } from "@/lib/individual/access";
import type { IndividualContext } from "@/lib/individual/guard";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/evidence -- COMPETEN-IND-007 s4, credentials and competency evidence.
//
// ⚠ NOT professional_credentials, NOT evidence (owner ruling D1). Both are read by hospital staff in
// scope. This writes migration 373's individual_professional_evidence and its private bucket.
//
// ⚠ SELF-DECLARED OR SOURCE-LINKED, AND NOTHING ELSE. The class is 373's generated column. A credential
// added here is never "verified" -- there is no regulator lookup and no verifier, so the page says so.
//
// COMPETEN-PROFESSIONAL-COMPETENCY-01 C3 (migration 520): an evidence item may say what KIND of evidence it is (an
// observation, mentor feedback, teaching, research, quality improvement, an assessment...) and who it is from. That is
// written to the SAME record, after it, and only where 520 is applied: without 520 the item is saved exactly as before.

/** 520's type fields, written after the 373 row. A database without 520 ignores them: nothing else changes. */
async function writeType(ctx: Pick<IndividualContext, "admin" | "userId">, id: string, fields: Record<string, unknown>): Promise<string | null> {
  if (fields.evidenceType === undefined && fields.author === undefined) return null;
  const t = parseEvidenceType(fields, (await loadIndividualPolicy(ctx.admin)).professionalCompetency);
  if (!t.ok) return t.error;
  const { error } = await ctx.admin.from("individual_professional_evidence").update(t.value).eq("id", id).eq("user_id", ctx.userId);
  return error && !isNotProvisioned(error) ? "The kind of evidence could not be saved just now." : null;
}

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
  const typeErr = await writeType(ctx, data.id, fields);
  await audit(ctx, "individual_professional_evidence_create", "individual_professional_evidence", data.id, { kind: parsed.value.kind, evidence_class: data.evidence_class });
  if (typeErr) return NextResponse.json({ ok: true, id: data.id, evidenceClass: data.evidence_class, warning: `Saved, but: ${typeErr}` }, { status: 201 });
  return NextResponse.json({ ok: true, id: data.id, evidenceClass: data.evidence_class }, { status: 201 });
}

/** PUT ?id= -- edit an item: the same checks as adding one. A new document replaces the old; none attached keeps it. */
export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose an evidence item.");
  const { fields, file } = await readBody(req);
  const parsed = parseEvidence(fields, todayUtc());
  if (!parsed.ok) return refuse(parsed.error);
  const { data: before } = await ctx.admin.from("individual_professional_evidence").select("id, document_path").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!before) return refuse("That evidence is not on your record.", 404);
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
    .update({ ...parsed.value, ...doc, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId).select("id, evidence_class").maybeSingle();
  if (error || !data) {
    await removeDocument(ctx.admin, (doc as { document_path?: string }).document_path);
    return writeFailed("evidence");
  }
  if (file) await removeDocument(ctx.admin, before.document_path);
  const typeErr = await writeType(ctx, id, fields);
  if (typeErr) return refuse(`Saved, but: ${typeErr}`);
  await audit(ctx, "individual_professional_evidence_update", "individual_professional_evidence", id, { kind: parsed.value.kind, evidence_class: data.evidence_class, document_replaced: !!file });
  return NextResponse.json({ ok: true, id, evidenceClass: data.evidence_class });
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
