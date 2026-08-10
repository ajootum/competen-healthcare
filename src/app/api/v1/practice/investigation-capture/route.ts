import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  addInvestigations, reviewInvestigations, cancelInvestigation,
  createCustomInvestigation, setInvestigationActivation, setInvestigationFavourite,
  saveInvestigationSet, retireInvestigationSet, setCaptureSetting,
} from "@/lib/practice/investigations";
import { CAPTURE_SETTING_KEYS, type CaptureSettingKey } from "@/lib/practice/investigation-constants";

// POST /api/v1/practice/investigation-capture -- CPR-INV-001 + CINV-CAP-001.
//
// ONE ROUTE, AN `action` DISCRIMINATOR, the shape /api/v1/practice/medications already uses. Nine verbs
// over one domain would otherwise be nine directories, and the capability each one needs is decided by
// the ENGINE rather than by the folder it happens to sit in.
//
// ⚠ THIS ROUTE SENDS NOTHING TO A LABORATORY. CPR-INV-001 s14. It writes what the practitioner recorded
// they asked for, and what they recorded they have looked at. There is no result field in any body
// below, in any response below, or in the table underneath.
//
// ⚠ THE BATCH ACTIONS RETURN PER-ITEM RESULTS. s15's "without silently dropping": a duplicate refusal
// comes back as a refused item beside the ones that were written, never as a 422 that throws away the
// practitioner's whole selection.
//
// ⚠ THE CAPABILITY GATE HERE IS `null` AND THAT IS DELIBERATE. Each engine call checks the capability
// the ACTION needs -- encounter.edit to record, investigation.configure to change the catalogue -- so a
// single route-level capability would either be too weak for the configuration verbs or too strong for
// the recording ones. requirePracticeContext still enforces authentication, membership, status and
// entitlement before any of them.

/* eslint-disable @typescript-eslint/no-explicit-any */

const bad = (message: string) => NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 400 });

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return bad("invalid JSON"); }

  const action = String(body.action ?? "");
  const actor = { actorId: caller.userId, correlationId: caller.traceId };

  switch (action) {
    case "add": {
      const encounterId = String(body.encounterId ?? "");
      if (!encounterId) return bad("encounterId is required");
      if (!Array.isArray(body.items)) return bad("items must be an array");
      const result = await addInvestigations(caller.admin, ctx, {
        encounterId,
        items: body.items.map((i: any) => ({
          investigationId: i?.investigationId ?? null,
          label: i?.label ?? null,
          reasonOverride: i?.reasonOverride ?? null,
        })),
        reasonShared: body.reasonShared ?? null,
        allowDuplicate: Array.isArray(body.allowDuplicate)
          ? body.allowDuplicate.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n))
          : [],
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }

    case "review": {
      const encounterId = String(body.encounterId ?? "");
      if (!encounterId) return bad("encounterId is required");
      if (!Array.isArray(body.investigationIds)) return bad("investigationIds must be an array");
      const result = await reviewInvestigations(caller.admin, ctx, {
        encounterId,
        investigationIds: body.investigationIds.map((s: any) => String(s)),
        summary: body.summary ?? null,
        ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "cancel": {
      const result = await cancelInvestigation(caller.admin, ctx, {
        encounterId: String(body.encounterId ?? ""),
        investigationId: String(body.investigationId ?? ""),
        reason: String(body.reason ?? ""),
        ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "createCustom": {
      const result = await createCustomInvestigation(caller.admin, ctx, {
        canonicalName: String(body.canonicalName ?? ""),
        shortName: body.shortName ?? null,
        category: String(body.category ?? ""),
        subcategory: body.subcategory ?? null,
        aliases: Array.isArray(body.aliases) ? body.aliases.map((s: any) => String(s)) : [],
        favourite: !!body.favourite,
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }

    case "setActivation": {
      const result = await setInvestigationActivation(caller.admin, ctx, {
        investigationId: String(body.investigationId ?? ""),
        enabled: body.enabled === undefined ? undefined : !!body.enabled,
        localDisplayName: body.localDisplayName === undefined ? undefined : body.localDisplayName,
        ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "setFavourite": {
      const result = await setInvestigationFavourite(caller.admin, ctx, {
        investigationId: String(body.investigationId ?? ""),
        favourite: !!body.favourite,
        // ⚠ THE PRACTITIONER IS THE CALLER, NEVER THE BODY. A pin written on somebody else's behalf is
        // the subject-versus-caller bug class this codebase has already closed twice.
        practitionerId: caller.userId,
        ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "saveSet": {
      const ownerType = body.ownerType === "practice" ? "practice" : "practitioner";
      const result = await saveInvestigationSet(caller.admin, ctx, {
        setId: body.setId ?? null,
        name: String(body.name ?? ""),
        ownerType,
        practitionerId: caller.userId,
        investigationIds: Array.isArray(body.investigationIds) ? body.investigationIds.map((s: any) => String(s)) : [],
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }

    case "retireSet": {
      const result = await retireInvestigationSet(caller.admin, ctx, {
        setId: String(body.setId ?? ""), practitionerId: caller.userId, ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "setSetting": {
      const key = String(body.key ?? "");
      if (!(CAPTURE_SETTING_KEYS as readonly string[]).includes(key))
        return bad(`key must be one of: ${CAPTURE_SETTING_KEYS.join(", ")}`);
      const result = await setCaptureSetting(caller.admin, ctx, {
        key: key as CaptureSettingKey, value: String(body.value ?? ""), ...actor,
      });
      return respond(result, caller.traceId);
    }

    default:
      return bad(`unknown action "${action}"`);
  }
}

function respond(result: any, correlationId: string, okStatus = 200) {
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId }, { status: okStatus });
}
