import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { isWithdrawReason, parseItem } from "@/lib/individual/professional/profile-form";
import { addItem, documentOf, withdrawItem } from "@/lib/individual/professional/profile-store";
import { removeDocument, storeDocument } from "@/lib/individual/professional/documents";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";
import { isHubExperience, kindAllowed } from "@/lib/individual/profile-hub";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/profile-items -- COMPETEN-INDIVIDUAL-PROFILE-HFE: the repeatable records of the SHARED Profile &
// History page, in whichever experience the person is in. The same records, parser and store as the Professional
// profile (migration 450, /api/individual/professional/profile-items); only the origin experience differs.
//
//   POST          { experience, kind, ... } a new record, or with supersedesId a NEW VERSION of one (the earlier
//                 version is kept and closed by 450's trigger).
//   PATCH ?id=    { withdraw: reason, experience? } withdraw a current record of the person's. Kept in history, never deleted.
//
// ⚠ THE EXPERIENCE IS CHECKED BY THE GUARD, NOT TRUSTED: requireIndividualContext(experience) refuses one the
// person does not hold, or whose terms they have not accepted. Each experience adds only its own kinds.
// ⚠ NEVER VERIFIED. Nothing here can mark a record checked. A document (Professional records only, where the
// policy allows) makes a record document-supported. Verification stays the Professional verifier's (451).
// ⚠ The audit row carries the kind, the class and the experience, never a title, a number or a document name.

export async function POST(req: Request) {
  const { fields, file } = await readBody(req);
  if (!isHubExperience(fields.experience)) return refuse("Choose where you are adding this.");
  const experience = fields.experience;
  const ctx = await requireIndividualContext(experience);
  if (isGuardRefusal(ctx)) return ctx;
  if (!kindAllowed(experience, fields.kind)) return refuse("That kind of record is not offered here.");
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalProfile;
  const parsed = parseItem(fields.kind, fields, policy);
  if (!parsed.ok) return refuse(parsed.error);
  const input = parsed.value;
  const documentsOffered = experience === "professional" && policy.documentKinds.includes(input.section);
  if (file && !documentsOffered) return refuse("A document cannot be attached to this kind of record here.");

  let doc: Record<string, unknown> | null = null;
  let stored = false;
  if (file) {
    const s = await storeDocument(ctx.admin, ctx.userId, file);
    if (!s.ok) return refuse(s.error);
    doc = s.doc; stored = true;
  } else if (input.supersedes_id && fields.removeDocument !== "true" && documentsOffered) {
    doc = await documentOf(ctx.admin, ctx.userId, input.supersedes_id);
  }

  const out = await addItem(ctx.admin, ctx.userId, input, doc, experience);
  if (!out.ok) {
    if (stored) await removeDocument(ctx.admin, doc?.document_path as string | undefined);
    return refuse(out.error, out.status);
  }
  await audit(ctx, input.supersedes_id ? "individual_professional_profile_item_revise" : "individual_professional_profile_item_create",
    "individual_professional_profile_item", out.id, { experience, kind: input.section, evidence_class: out.evidenceClass, supersedes: input.supersedes_id });
  return NextResponse.json({ ok: true, id: out.id, evidenceClass: out.evidenceClass }, { status: 201 });
}

export async function PATCH(req: Request) {
  const { fields } = await readBody(req);
  const experience = isHubExperience(fields.experience) ? fields.experience : undefined;
  const ctx = await requireIndividualContext(experience);
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a record.");
  if (!isWithdrawReason(fields.withdraw)) return refuse("Say why you are withdrawing it.");
  const out = await withdrawItem(ctx.admin, ctx.userId, id, fields.withdraw);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_profile_item_withdraw", "individual_professional_profile_item", id, { experience: experience ?? null, reason: fields.withdraw });
  return NextResponse.json({ ok: true });
}
