import { NextResponse, type NextRequest } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { openOrResumeSession, applyCloseAction, completeSession } from "@/lib/practice/day-close";
import { markSeen, toCompleteQueue } from "@/lib/practice/capture-later";
import { reflectClinicalActOnQueue } from "@/lib/practice/scheduling";

// CPR-ADOPT-001 sections 2 and 3 - the write path for Capture Later and Close My Day.
//
// ⚠ EVERY VERB IS CAPABILITY-GATED AT THE BOUNDARY, not by the screen that calls it. requirePracticeContext
// resolves the workspace from the session and the capability from the tenant plane, so a caller who reaches
// this route without encounter.edit cannot close anybody's encounter by posting to it directly.
//
// ⚠ AND THERE IS NO CLOSE-ALL VERB. Section 7 forbids "destructive bulk completion of unresolved clinical
// exceptions", so `action` closes exactly one encounter on one explicit practitioner decision. `complete`
// ends the SESSION and deliberately leaves open encounters open -- adding a convenience that closed them
// would be the one thing the specification names as forbidden.
/* eslint-disable @typescript-eslint/no-explicit-any */

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(req: NextRequest) {
  // encounter.edit, not encounter.list: everything below WRITES to a clinical record.
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return bad("invalid JSON"); }

  const op = String(body.op ?? "");
  const workspaceId = (ctx as any).workspaceId as string;

  switch (op) {
    // One tap: the patient was seen. Creates a shell that asserts nothing clinical (section 7).
    case "seen": {
      const patientId = String(body.patientId ?? "");
      if (!patientId) return bad("patientId is required");
      const r = await markSeen(caller.admin, {
        workspaceId,
        patientId,
        actorId: caller.userId,
        appointmentId: body.appointmentId ?? null,
        locationId: body.locationId ?? null,
      });
      // #4c: Seen closes the corridor row too. This lives HERE and not in markSeen because
      // capture-later.ts is reached by scheduling.ts (via activation-hooks) -- importing scheduling
      // back into it would be a cycle. Best-effort by design; the shell is already written.
      if (r.ok) {
        await reflectClinicalActOnQueue(caller.admin, {
          workspaceId, patientId, act: "seen",
          actorId: caller.userId, correlationId: caller.traceId,
        });
      }
      return r.ok
        ? NextResponse.json({ ok: true, ...r.data }, { status: r.data.created ? 201 : 200 })
        : bad(r.message, r.status);
    }

    case "open": {
      const closeDate = String(body.closeDate ?? "");
      if (!closeDate) return bad("closeDate is required");
      const r = await openOrResumeSession(caller.admin, {
        workspaceId, practitionerId: caller.userId, closeDate, actorId: caller.userId,
      });
      return r.ok ? NextResponse.json({ ok: true, ...r.data }) : bad(r.message, r.status);
    }

    case "action": {
      const encounterId = String(body.encounterId ?? "");
      if (!encounterId) return bad("encounterId is required");
      const r = await applyCloseAction(caller.admin, {
        workspaceId,
        encounterId,
        action: String(body.action ?? ""),
        actorId: caller.userId,
        sessionId: body.sessionId ?? null,
        // Section 3: deferral takes a reason, and the engine refuses one without it.
        deferReason: body.deferReason ?? null,
      });
      return r.ok ? NextResponse.json({ ok: true, ...r.data }) : bad(r.message, r.status);
    }

    case "complete": {
      const sessionId = String(body.sessionId ?? "");
      if (!sessionId) return bad("sessionId is required");
      const r = await completeSession(caller.admin, {
        workspaceId, sessionId, practitionerId: caller.userId, actorId: caller.userId,
      });
      return r.ok ? NextResponse.json({ ok: true, ...r.data }) : bad(r.message, r.status);
    }

    default:
      return bad(`unknown op ${op || "(none)"}`);
  }
}

/** The To Complete queue. Read-only, so encounter.list is the right gate. */
export async function GET() {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;

  const q = await toCompleteQueue(caller.admin, { workspaceId: (ctx as any).workspaceId });
  // ⚠ A FAILED READ IS A 503, NOT AN EMPTY QUEUE. An empty list here reads as "your day is finished".
  return q.ok
    ? NextResponse.json({ ok: true, items: q.items, truncated: q.truncated })
    : NextResponse.json({ error: "The queue could not be read.", detail: q.message }, { status: 503 });
}
