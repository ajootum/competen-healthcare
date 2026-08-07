import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  identitySetupView, issueIdentity, claimHandle, resolveDisplayName,
} from "@/lib/practice/identity-service";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// GET  /api/v1/practice/identity  -- what this practitioner's identity and booking address are
// POST /api/v1/practice/identity  -- { action: "issue" } | { action: "claim", handle }
//
// PIS-000 s3, s15. CPR-V5-007 s8.
//
// ⚠ THE CAPABILITY IS practice.settings.manage, PROBED AND NOT INVENTED. The live catalogue holds 47
// distinct codes and this is one of them; it is the same code /api/v1/practice/patient-access uses, on
// the same reasoning -- s14 gives "Publish booking page" to the account owner and to authorised staff by
// explicit permission only, and a booking address is the thing that gets published. Six invented
// capability codes have shipped in this product; the safest number of new ones is none.
//
// ⚠ TWO SEPARATE ACTS, AND THE SPLIT IS THE POINT OF THIS ENDPOINT.
//
//   `issue` creates the identity ROW: a permanent practitioner number, a private profile, discovery
//   hidden. It publishes nothing. Provisioning does this for every new practice; the action exists for
//   the practices that were provisioned before it did.
//
//   `claim` writes the PUBLIC HANDLE, which becomes an address printed on cards and given to patients,
//   and which cannot afterwards be released to anybody else. It is never done on the practitioner's
//   behalf and never as a side effect of anything.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  const admin = caller.admin;
  const view = await identitySetupView(admin, {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    fallbackDisplayName: await resolveDisplayName(admin, ctx.userId, ctx.workspaceId),
  });
  // 200 EVEN WHEN THERE IS NOTHING. `state` carries the answer -- none, unclaimed, claimed or unreadable
  // -- and an unclaimed address is a state of this practice rather than a failure of this request.
  return NextResponse.json({ identity: view, correlationId: caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;
  const admin = caller.admin;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = String(body.action ?? "");

  if (action === "issue") {
    // ⚠ THE SUBJECT IS THE CALLER, NEVER A USER ID FROM THE BODY. An identity is keyed on a person and
    // is permanent; accepting a target from the client would let one practice mint another person's
    // permanent number. This platform has already been bitten once by a write that trusted a subject it
    // was handed.
    const displayName = await resolveDisplayName(admin, ctx.userId, ctx.workspaceId);
    if (!displayName)
      return NextResponse.json({
        error: {
          code: "NO_DISPLAY_NAME",
          message: "your identity needs a name, and there is none on your profile or on this practice. Add your full name to your profile first.",
        },
      }, { status: 409 });

    const result = await issueIdentity(admin, {
      userId: ctx.userId, displayName, workspaceId: ctx.workspaceId, correlationId: caller.traceId,
    });
    if (!result.ok)
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

    return NextResponse.json({
      practitionerNumber: result.data.practitionerNumber,
      created: result.data.created,
      // STATED ON EVERY ISSUE. The one thing somebody might otherwise assume just happened.
      handle: null,
      note: "Your practitioner number is permanent. No public address has been created — you choose that yourself.",
      correlationId: caller.traceId,
    }, { status: result.data.created ? 201 : 200 });
  }

  if (action === "claim") {
    const result = await claimHandle(admin, {
      userId: ctx.userId, handle: String(body.handle ?? ""), correlationId: caller.traceId,
    });
    if (!result.ok)
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ ...result.data, correlationId: caller.traceId }, { status: 201 });
  }

  return NextResponse.json({
    error: { code: "UNKNOWN_ACTION", message: "action must be \"issue\" or \"claim\"" },
  }, { status: 400 });
}
