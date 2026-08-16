import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getEncounter, transitionEncounter } from "@/lib/practice/encounters";
import { saveNoteSegment } from "@/lib/practice/documentation";
import { ENCOUNTER_ACTIONS } from "@/lib/practice/encounter-constants";

// GET   /api/v1/practice/encounters/{id}          -- everything CPR-V2-006 renders.
// PATCH /api/v1/practice/encounters/{id}          -- { action } state machine, or { noteType, body } autosave.
//
// Signing needs encounter.sign; everything else needs encounter.edit. That split is deliberate: an
// assistant may hold encounter.list to run the queue, and a future scribe role could hold edit without
// ever being able to put a practitioner's signature on a clinical record.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  const detail = await getEncounter(auth.caller.admin, auth.ctx.workspaceId, encounterId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await params;
  let body: { action?: string; noteType?: string; body?: string; source?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  // Note-save path. `source` records how the text was produced -- typed or dictated (CPR-130). It is a
  // claim the CLIENT makes, and it is stored as such: only the browser knows whether the words arrived
  // through a keyboard or a microphone, and there is no way to verify it server-side. It is provenance,
  // not evidence, and the record shows it beside the text rather than inferring anything from it.
  if (body.noteType !== undefined) {
    const auth = await requirePracticeContext("encounter.edit");
    if (isDenied(auth)) return auth;
    const result = await saveNoteSegment(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, encounterId, noteType: String(body.noteType),
      body: String(body.body ?? ""), source: body.source ? String(body.source) : undefined,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    // Walkthrough #5: documenting is consulting. A saved segment with content promotes a DRAFT
    // encounter to ACTIVE -- best-effort, never the save's failure. Keystroke drafts (the drafts
    // route) deliberately do not do this.
    if (String(body.body ?? "").trim()) {
      const { ensureConsultationStarted } = await import("@/lib/practice/encounters");
      await ensureConsultationStarted(auth.caller.admin, {
        workspaceId: auth.ctx.workspaceId, encounterId,
        actorId: auth.caller.userId, correlationId: auth.caller.traceId,
      });
    }
    return NextResponse.json({ saved: result.data, correlationId: auth.caller.traceId });
  }

  const to = ENCOUNTER_ACTIONS[body.action ?? ""];
  if (!to) return NextResponse.json({ error: `action must be one of: ${Object.keys(ENCOUNTER_ACTIONS).join(", ")}` }, { status: 400 });

  const auth = await requirePracticeContext(to === "SIGNED" ? "encounter.sign" : "encounter.edit");
  if (isDenied(auth)) return auth;

  const result = await transitionEncounter(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, to,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  // ── CPR-FUP-001 s10 / CPR-FUP-002 s6: CLOSING THE LINKED CONSULTATION CLOSES THE OBLIGATION ──────
  //
  // ⚠ THIS IS AN ACCEPTANCE CRITERION IN BOTH SPECIFICATIONS AND IT WAS NOT HAPPENING. A practitioner
  // booked the review, saw the patient, closed the consultation -- and the follow-up stayed open,
  // waiting to be ticked a second time by hand. The board then claimed somebody was owed a review they
  // had already had, which is worse than saying nothing: it is a false positive in the one list whose
  // whole value is that everything on it is real.
  //
  // WIRED HERE RATHER THAN INSIDE transitionEncounter because this route is the ONLY caller that closes
  // an encounter -- the three inside encounters.ts are the interruption path (PAUSE/ACTIVE) and never
  // reach COMPLETED. Putting it in the engine would also mean the follow-up module and the encounter
  // module importing each other.
  //
  // ⚠ IT NEVER FAILS THE TRANSITION IT FOLLOWS. The consultation has already been closed and committed;
  // refusing the response because a follow-up could not be settled would tell the practitioner their
  // consultation did not close when it did. What did not settle comes back in `settledFollowUps` so a
  // screen can say so, rather than being swallowed.
  let settledFollowUps: { completed: string[]; skipped: string[] } | null = null;
  let settleError: string | null = null;
  if (to === "COMPLETED" || to === "SIGNED") {
    const { settleFollowUpsForEncounter } = await import("@/lib/practice/follow-ups");
    const settled = await settleFollowUpsForEncounter(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, encounterId,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (settled.ok) settledFollowUps = settled.data;
    else settleError = settled.message;
  }

  return NextResponse.json({
    encounter: result.data, settledFollowUps, settleError, correlationId: auth.caller.traceId,
  });
}
