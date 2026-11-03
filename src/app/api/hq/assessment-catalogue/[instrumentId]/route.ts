import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { isUuid } from "@/lib/assessment/catalogue/filters";
import { loadInstrumentDetail } from "@/lib/assessment/catalogue/detail";
import { classifyInstrument } from "@/lib/assessment/catalogue/classify";
import { setAvailability } from "@/lib/assessment/catalogue/availability";
import { setRelation, addReference, removeReference } from "@/lib/assessment/catalogue/relations";
import { setCollectionMember } from "@/lib/assessment/catalogue/collections";
import { plainError } from "@/lib/assessment/catalogue/db";
import { AVAILABILITY_MODES, type AvailabilityMode } from "@/lib/assessment/catalogue/shape";

export const dynamic = "force-dynamic";

// /api/hq/assessment-catalogue/[instrumentId]
//   GET   hq.assessment.catalogue.view    the instrument: classification, references, relations, availability per product line,
//                                         versions (read from asmt_instrument_version), collections and the catalogue trail.
//   POST  hq.assessment.catalogue.manage  { action, ... }
//           identity          { name, description, responsibleAuthority, governanceNote }
//           classify          { terms: [{ termId, isPrimary }] }  replaces the classification
//           availability      { productLine, mode: available | optional | unavailable | null, note? }  null clears the row
//           relation          { relatedId, relation, note?, remove? }
//           reference_add     { kind, refTable?, refId?, refCode?, refLabel, refVersion? }
//           reference_remove  { referenceId }
//           collection        { collectionId, add }
//
// Each action is ONE database function that writes the change and its audit event in a single transaction. The actor is
// always the session's person. Checklist CONTENT is not editable here: that is Checklist Studio.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Params = { params: Promise<{ instrumentId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { instrumentId } = await params;
  if (!isUuid(instrumentId)) return refuse(404, "No such instrument.");
  const ctx = await withOwnAppointments(await hqApiGate(["hq.assessment.catalogue.view"]));
  if (isHqRefusal(ctx)) return ctx;
  try {
    const detail = await loadInstrumentDetail(ctx.admin, instrumentId, { actorId: ctx.userId, caps: ctx.capabilities });
    return detail ? NextResponse.json({ detail }) : refuse(404, "No such instrument.");
  } catch (e) {
    return refuse(500, plainError(e));
  }
}

export async function POST(req: Request, { params }: Params) {
  const { instrumentId } = await params;
  if (!isUuid(instrumentId)) return refuse(404, "No such instrument.");
  const ctx = await hqApiGate(["hq.assessment.catalogue.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const me = ctx.userId;
  try {
    switch (body?.action) {
      case "identity": {
        const name = text(body.name, 200);
        if (name.length < 3) return refuse(400, "Give the instrument a title of at least three characters.");
        const { error } = await ctx.admin.rpc("asmt_catalogue_update_identity", {
          p_instrument: instrumentId, p_name: name, p_description: text(body.description, 2000) || null,
          p_responsible_authority: text(body.responsibleAuthority, 200) || null, p_governance_note: text(body.governanceNote, 1000) || null, p_actor: me,
        });
        if (error) throw new Error(error.message);
        break;
      }
      case "classify": {
        const terms = Array.isArray(body.terms) ? body.terms : null;
        if (!terms) return refuse(400, "Send the list of terms.");
        const clean = terms.filter((t: unknown) => !!t && typeof t === "object" && isUuid((t as { termId?: unknown }).termId))
          .map((t: { termId: string; isPrimary?: boolean }) => ({ termId: t.termId, isPrimary: !!t.isPrimary }));
        await classifyInstrument(ctx.admin, me, instrumentId, clean);
        break;
      }
      case "availability": {
        const line = text(body.productLine, 40);
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(line)) return refuse(400, "Choose a product line.");
        const mode = body.mode === null || body.mode === "" ? null : text(body.mode, 20);
        if (mode !== null && !(AVAILABILITY_MODES as readonly string[]).includes(mode)) return refuse(400, "Choose available, optional or not available.");
        await setAvailability(ctx.admin, me, instrumentId, line, mode as AvailabilityMode | null, text(body.note, 300) || null);
        break;
      }
      case "relation": {
        if (!isUuid(body.relatedId)) return refuse(400, "Choose the related instrument.");
        await setRelation(ctx.admin, me, instrumentId, body.relatedId, text(body.relation, 20), text(body.note, 300) || null, !!body.remove);
        break;
      }
      case "reference_add": {
        const label = text(body.refLabel, 300);
        if (!label) return refuse(400, "A reference needs a name.");
        const refId = isUuid(body.refId) ? body.refId : null;
        await addReference(ctx.admin, me, instrumentId, {
          kind: text(body.kind, 41), refTable: refId ? text(body.refTable, 61) || null : null, refId, refCode: text(body.refCode, 100) || null,
          refLabel: label, refVersion: text(body.refVersion, 60) || null,
        });
        break;
      }
      case "reference_remove": {
        if (!isUuid(body.referenceId)) return refuse(400, "Choose the reference.");
        await removeReference(ctx.admin, me, body.referenceId);
        break;
      }
      case "collection": {
        if (!isUuid(body.collectionId)) return refuse(400, "Choose the collection.");
        await setCollectionMember(ctx.admin, me, body.collectionId, instrumentId, body.add !== false);
        break;
      }
      default:
        return refuse(400, "Unknown action.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return refuse(400, plainError(e));
  }
}
