import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  resolveCapabilities, activateCapability, deactivateCapability, applyPracticeMode,
  planDeactivation, SETTINGS_CAPABILITY,
} from "@/lib/practice/capabilities";
import { isCapabilityId, capabilityDef } from "@/lib/practice/capability-registry";

// /api/v1/practice/capabilities -- CPR-CAP-001 s4, s5, s6, s8.
//
// ⚠ WHAT THIS ROUTE CHANGES IS COMMERCIAL, NOT SECURITY.
//
// It writes practice_capability_activation: what THIS PRACTICE has switched on. It does NOT write
// practice_role_assignment: what A USER may do. Deactivating CP.ENCOUNTERS here takes nobody's
// encounter.edit away, and there is no verb on this route that grants a permission to anybody.
//
// ⚠ THE GATE IS AN EXISTING PERMISSION AND NO NEW ONE WAS INVENTED. practice.settings.manage, seeded on
// practice_owner by migration 191, is the same permission that governs the timezone, the booking rules
// and the registration form. Changing which products a practice runs is practice administration and it
// belongs to the code that already means that. Inventing a CP.* code for the gate would have put the two
// axes in one namespace, which is the exact confusion this whole framework is written to avoid.
//
// ⚠ THE READ IS GATED THE SAME WAY. What a practice has bought is commercial information about the
// business, not a clinical fact every member needs. When navigation starts consuming the resolver it
// will do so server-side inside the shell, which already has the context -- not by calling this route.
//
// ⚠ EVERY REFUSAL NAMES ITSELF. DEPENDENTS_ACTIVE carries the list of dependents, because s6 asks for a
// warning and "this cannot be switched off" is not one.

/* eslint-disable @typescript-eslint/no-explicit-any */

const bad = (message: string) =>
  NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 400 });

export async function GET() {
  const auth = await requirePracticeContext(SETTINGS_CAPABILITY);
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;

  const resolution = await resolveCapabilities(caller.admin, ctx.workspaceId);

  // ⚠ 200 EVEN WHEN THE STORE COULD NOT BE READ, AND THE BODY SAYS SO. The request succeeded; the store
  // did not answer. Returning 500 would make a caller retry, and returning an empty active list with a
  // 200 would make it believe the practice has nothing. readable:false plus active:null is the only
  // shape a caller cannot misread as "off".
  return NextResponse.json({ ...resolution, correlationId: caller.traceId }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(SETTINGS_CAPABILITY);
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return bad("invalid JSON"); }

  const action = String(body.action ?? "");
  const actor = {
    actorId: caller.userId,
    correlationId: caller.traceId,
    reason: typeof body.reason === "string" ? body.reason : null,
  };

  switch (action) {
    case "activate": {
      const capability = String(body.capability ?? "");
      if (!capability) return bad("capability is required");
      const result = await activateCapability(caller.admin, ctx, { capability, ...actor });
      return respond(result, caller.traceId);
    }

    case "deactivate": {
      const capability = String(body.capability ?? "");
      if (!capability) return bad("capability is required");
      const result = await deactivateCapability(caller.admin, ctx, {
        capability, acknowledgeDependents: body.acknowledgeDependents === true, ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "applyMode": {
      const mode = String(body.mode ?? "");
      if (!mode) return bad("mode is required");
      const result = await applyPracticeMode(caller.admin, ctx, { mode, ...actor });
      return respond(result, caller.traceId);
    }

    // The warning of s6 bullet four, askable WITHOUT changing anything -- so a console can show what a
    // deactivation would affect before the practitioner commits to it, and show the SAME list the write
    // would compute, because both come from planDeactivation over one resolution.
    case "planDeactivation": {
      const capability = String(body.capability ?? "");
      if (!isCapabilityId(capability)) return bad(`${capability || "(missing)"} is not a capability in the registry`);
      const resolution = await resolveCapabilities(caller.admin, ctx.workspaceId);
      const plan = planDeactivation(resolution, capability);
      return NextResponse.json({
        capability,
        displayName: capabilityDef(capability)?.displayName ?? capability,
        readable: plan.readable,
        // ⚠ NULL, NOT [], WHEN UNREADABLE. "No dependents would be affected" is a promise this cannot
        // make over a store it could not see.
        dependents: plan.dependents,
        dependentNames: plan.dependents?.map(d => capabilityDef(d)?.displayName ?? d) ?? null,
        correlationId: caller.traceId,
      }, { status: 200 });
    }

    default:
      return bad(`unknown action "${action}"`);
  }
}

function respond(result: any, correlationId: string, okStatus = 200) {
  if (!result.ok) {
    return NextResponse.json({
      error: {
        code: result.code,
        message: result.message,
        ...(result.dependents ? { dependents: result.dependents } : {}),
      },
    }, { status: result.status });
  }
  return NextResponse.json({ ...result.data, correlationId }, { status: okStatus });
}
