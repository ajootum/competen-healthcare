import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { offlineClinicalPayload } from "@/lib/practice/offline-clinical-source";
import { offlineCacheGate } from "@/lib/practice/offline-gate";
import { workspaceClock } from "@/lib/practice/practice-time";

// GET /api/v1/practice/offline/clinical -- CP-OFFLINE-SURVEY-001 s9, the clinical carry.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SAME GATE AS THE DAY AND THE GUIDANCE LIBRARY. `offlineCacheGate` answers one question -- may
// anything at all be held on this device -- and it is the practice's own switch plus the platform flag,
// fail-closed. This payload is the most sensitive of the three by a wide margin, so if there was ever a
// case for a SEPARATE switch it is here; it is still not taken, for the reason the guidance route gives:
// a practice that says "hold nothing of mine on that laptop" is not drawing a distinction, and a second
// switch would make the honest answer to "is anything cached?" become "it depends".
//
// ⚠ THE CAPABILITY IS `practice.calendar.view`, the one the patient worklists already use. s8 forbids
// minting a new code, and a practitioner entitled to open a patient's record online is the same
// practitioner reading it offline.
//
// ⚠ WHAT THIS ROUTE DOES NOT DO, AND IT IS THE IMPORTANT PART: IT DOES NOT DECIDE WHETHER THE DEVICE MAY
// KEEP THIS. The PIN requirement lives in the WRITER, because only the browser knows whether a device
// credential is set on it. A route that returned the payload and trusted the client to refuse it would
// be trusting the client with the whole control. So this route answers the question it can answer --
// may this ACCOUNT read this, and may this PRACTICE cache at all -- and the writer answers the one only
// it can: is there a PIN on this device.
//
// NO-STORE, EMPHATICALLY. This is the one response in Practice that carries allergies and current
// medication for a named cohort. The ONLY place it may persist is the encrypted IndexedDB store, which
// can be labelled with its age, expired, purged and sealed behind the PIN. An HTTP cache entry is none
// of those things.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

export async function GET() {
  const auth = await requirePracticeContext("practice.calendar.view");
  if (isDenied(auth)) return auth;

  const gate = await offlineCacheGate(auth.caller.admin, auth.ctx, auth.caller.userId);

  // ⚠ 200 WITH A DECISION, NOT 403 -- the day route's reasoning, unchanged. `purge` is an INSTRUCTION:
  // a practice that switched offline access off needs what is already on the device removed, and a bare
  // 403 gives the browser no reason to delete anything.
  if (!gate.allowed)
    return NextResponse.json({
      gate: { state: gate.state, reason: gate.reason, purge: gate.purge, decidedBy: gate.decidedBy },
      pack: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  // The practice's own clock, from the one helper that owns it. The horizon is a run of PRACTICE
  // calendar days, so a practitioner who has travelled two time zones still gets the same four days of
  // clinic rather than three and a bit.
  const { timezone } = await workspaceClock(auth.caller.admin, auth.ctx.workspaceId);
  const result = await offlineClinicalPayload(auth.caller.admin, auth.ctx, { timezone });

  if (!result.ok)
    return NextResponse.json({
      // ⚠ NOT A PURGE. Records that could not be READ are not a decision to stop holding what is already
      // on the device -- and that pack still expires on its own five-day clock. Deleting a usable
      // clinical cache because one read failed would take the allergy list away from a practitioner in
      // the field at the exact moment nothing can replace it.
      gate: { state: "unresolved" as const, reason: result.reason, purge: false, decidedBy: "allowed" as const },
      pack: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  return NextResponse.json({
    gate: { state: gate.state, reason: gate.reason, purge: false, decidedBy: gate.decidedBy },
    pack: result.pack, correlationId: auth.caller.traceId,
  }, { headers: NO_STORE });
}
