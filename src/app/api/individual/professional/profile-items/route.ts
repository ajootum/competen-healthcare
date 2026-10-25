import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { isWithdrawReason, parseItem } from "@/lib/individual/professional/profile-form";
import { addItem, documentOf, withdrawItem } from "@/lib/individual/professional/profile-store";
import { removeDocument, storeDocument } from "@/lib/individual/professional/documents";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/profile-items -- COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, GO s4 and s5.
//
// The profile sections' records (migration 450 individual_professional_profile_item): qualifications,
// registrations and licences, employment periods, specialties, interests and career aspirations.
//
//   POST          a new record, or with supersedesId a NEW VERSION of one. The earlier version is kept as it
//                 was and closed by 450's trigger. Its document is carried over unless a new one replaces it.
//   PATCH ?id=    { withdraw: reason } -- withdraw a current record. Kept in history. Nothing is ever deleted.
//
// ⚠ NEVER VERIFIED. A document makes a record document-supported (450's generated class). It is attached only
// where the verification policy allows it, and nothing here can mark a record checked.
// ⚠ The audit row carries the kind and the class, never a title, a number or a document name.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields, file } = await readBody(req);
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalProfile;
  const parsed = parseItem(fields.kind, fields, policy);
  if (!parsed.ok) return refuse(parsed.error);
  const input = parsed.value;
  if (file && !policy.documentKinds.includes(input.section)) return refuse("A document cannot be attached to this kind of record.");

  let doc: Record<string, unknown> | null = null;
  let stored = false;
  if (file) {
    const s = await storeDocument(ctx.admin, ctx.userId, file);
    if (!s.ok) return refuse(s.error);
    doc = s.doc; stored = true;
  } else if (input.supersedes_id && fields.removeDocument !== "true" && policy.documentKinds.includes(input.section)) {
    doc = await documentOf(ctx.admin, ctx.userId, input.supersedes_id);
  }

  const out = await addItem(ctx.admin, ctx.userId, input, doc);
  if (!out.ok) {
    if (stored) await removeDocument(ctx.admin, doc?.document_path as string | undefined);
    return refuse(out.error, out.status);
  }
  await audit(ctx, input.supersedes_id ? "individual_professional_profile_item_revise" : "individual_professional_profile_item_create",
    "individual_professional_profile_item", out.id, { kind: input.section, evidence_class: out.evidenceClass, supersedes: input.supersedes_id });
  return NextResponse.json({ ok: true, id: out.id, evidenceClass: out.evidenceClass }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a record.");
  const { fields } = await readBody(req);
  if (!isWithdrawReason(fields.withdraw)) return refuse("Say why you are withdrawing it.");
  const out = await withdrawItem(ctx.admin, ctx.userId, id, fields.withdraw);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_profile_item_withdraw", "individual_professional_profile_item", id, { reason: fields.withdraw });
  return NextResponse.json({ ok: true });
}
