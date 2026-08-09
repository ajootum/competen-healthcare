import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  identitySetupView, issueIdentity, claimHandle, resolveDisplayName,
  publishIdentity, updateIdentity, DISCOVERY_MODES,
} from "@/lib/practice/identity-service";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// GET  /api/v1/practice/identity  -- what this practitioner's identity and booking address are
// POST /api/v1/practice/identity  -- { action: "issue" } | { action: "claim", handle }
//                                    | { action: "publish", discovery } | { action: "discovery", discovery }
//                                    | { action: "profile", ...fields }
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
//
//   `publish` is the third act, and it is the one that makes the address open. It confirms the caller's
//   sign-in email against the auth directory, walks s10's lifecycle to `active`, and only then writes the
//   discovery mode. `discovery` changes that mode afterwards -- including back to hidden. `profile`
//   edits the s6 fields the public page renders.
//
// ⚠ THE LIFECYCLE IS NOT SETTABLE FROM HERE, AND `licence_verified` HAS NO DOOR AT ALL.
//
// transitionIdentity writes licence_verified_by = actorId, and the only actor this endpoint ever has is
// the practitioner themselves -- so exposing that state would let a clinician record that somebody
// checked their licence, on their own say-so, into a column the rest of the product reads as provenance.
// publishIdentity steps around it deliberately, no action accepts a target state, and a body that names
// one is refused outright rather than ignored: an ignored field is one refactor away from being honoured.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** ⚠ Any of these in a body is a request to set the lifecycle, and every one of them is refused. */
const STATUS_KEYS = ["status", "to", "state", "transition", "identityStatus", "licenceReference", "licence_reference"];

/**
 * Read a body field as a string, or undefined when it was not sent at all.
 *
 * ⚠ THREE CASES, AND null IS THE ONE WORTH SPELLING OUT. Absent means "leave this alone"; null means
 * "clear it", which updateIdentity turns into a null column; anything else is coerced. Without the null
 * arm, `String(null)` writes the literal text "null" into a practitioner's biography.
 */
const str = (v: unknown): string | undefined =>
  v === undefined ? undefined : v === null ? "" : typeof v === "string" ? v : String(v);

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

  // ⚠ REFUSED, NOT IGNORED, AND BEFORE ANY ACTION RUNS. Dropping an unrecognised field is the polite
  // thing and the dangerous one: it leaves a caller believing they set a lifecycle state, and it leaves
  // the next person to add a field one spread operator away from actually honouring it. The lifecycle
  // moves only through publishIdentity's fixed sequence, and licence_verified is not in that sequence.
  const named = STATUS_KEYS.filter(k => body[k] !== undefined);
  if (named.length > 0)
    return NextResponse.json({
      error: {
        code: "STATUS_NOT_ACCEPTED",
        message: `this endpoint does not set your lifecycle state, so ${named.join(", ")} was refused rather than ignored. Publishing moves it for you; licence verification is recorded by whoever checked the licence, and never from here.`,
      },
    }, { status: 400 });

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

  if (action === "publish") {
    // ⚠ THE SUBJECT IS THE CALLER HERE TOO. Same reasoning as `issue` above, and a worse outcome if it
    // were not: a body-supplied user id would let one practice publish another person's name,
    // qualifications and place of work into a public search index.
    const result = await publishIdentity(admin, {
      userId: ctx.userId, discovery: String(body.discovery ?? ""), correlationId: caller.traceId,
    });
    if (!result.ok)
      return NextResponse.json({
        error: { code: result.code, message: result.message },
        // ⚠ HOW FAR IT GOT, ON THE FAILURE. A refusal at step three has already moved the lifecycle at
        // step two, and a practitioner who cannot see that cannot tell a retry from a fresh attempt.
        completed: result.completed, alreadyTrue: result.alreadyTrue,
        correlationId: caller.traceId,
      }, { status: result.status });

    return NextResponse.json({ ...result.data, correlationId: caller.traceId });
  }

  if (action === "discovery") {
    const discovery = String(body.discovery ?? "");
    if (!DISCOVERY_MODES.some(m => m.key === discovery))
      return NextResponse.json({
        error: {
          code: "VALIDATION_ERROR",
          message: `discovery must be one of: ${DISCOVERY_MODES.map(m => m.key).join(", ")}`,
        },
      }, { status: 400 });

    // ⚠ GOING PRIVATE IS THE SAME ONE CALL AS GOING PUBLIC, WITH NO EXTRA CONDITION.
    //
    // It would be easy to gate this the way `publish` is gated -- confirm the email, check the lifecycle
    // -- and it would be wrong. A practitioner turning discovery off is somebody who has decided their
    // name should stop being reachable, sometimes urgently, and every precondition between them and that
    // is a reason it fails at the moment it matters. `hidden` needs no handle, no confirmed email and no
    // particular state, so nothing here asks for one.
    const result = await updateIdentity(admin, {
      userId: ctx.userId, discovery, correlationId: caller.traceId,
    });
    if (!result.ok)
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

    const view = await identitySetupView(admin, { userId: ctx.userId, workspaceId: ctx.workspaceId });
    return NextResponse.json({
      discovery: result.data.discovery,
      // WHETHER THE ADDRESS ACTUALLY OPENS NOW, asked of the resolver rather than inferred from the write.
      address: view.address,
      correlationId: caller.traceId,
    });
  }

  if (action === "profile") {
    // s6's public fields, and only those. `discovery` is not read here even if it is sent: changing what
    // is written and who can read it are different decisions and they get different buttons.
    const result = await updateIdentity(admin, {
      userId: ctx.userId,
      displayName: str(body.displayName),
      qualifications: str(body.qualifications),
      specialties: str(body.specialties),
      subSpecialty: str(body.subSpecialty),
      biography: str(body.biography),
      languages: str(body.languages),
      consultationTypes: str(body.consultationTypes),
      correlationId: caller.traceId,
    });
    if (!result.ok)
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

    const view = await identitySetupView(admin, { userId: ctx.userId, workspaceId: ctx.workspaceId });
    return NextResponse.json({
      publicProfile: view.publicProfile,
      displayName: view.displayName,
      // SAID ON EVERY SAVE, because it is the thing somebody might reasonably assume changed.
      note: view.address.state === "resolves"
        ? "Saved. Your page is open, so this is visible to anybody who reaches it."
        : "Saved. Your page does not open yet, so nobody can read this.",
      correlationId: caller.traceId,
    });
  }

  return NextResponse.json({
    error: {
      code: "UNKNOWN_ACTION",
      message: "action must be \"issue\", \"claim\", \"publish\", \"discovery\" or \"profile\"",
    },
  }, { status: 400 });
}
