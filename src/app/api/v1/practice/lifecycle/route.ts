import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { readActiveWorkspaceId } from "@/lib/practice/access";
import {
  practiceLifecycle, applyTransition, exportPractice, resolveLifecycleActor,
} from "@/lib/practice/lifecycle";
import {
  LIFECYCLE_ACTIONS, LIFECYCLE_REFUSALS, LIFECYCLE_CAPABILITIES, REASON_MIN, REASON_MAX,
} from "@/lib/practice/lifecycle-constants";

// CPR-LIFE-001 -- the one API for the Practice Lifecycle page.
//
//   GET                       the state, the history, the figures and s4's closure report
//   GET  ?view=export         s5's whole-practice export, as JSON, audited        data.export
//   POST {action:"archive"|"suspend"|"restore", reason}                practice.archive/suspend/restore
//
// ⚠ THERE IS NO DELETE ON THIS ROUTE AND THERE IS NO PENDING_DELETION. Migration 247 names the three
// questions CPR-LIFE-001 does not answer, and a route that offered the verb before they were answered
// would be a working irreversible destructor with some of its safeties missing. LIFECYCLE_REFUSALS
// travels with the payload so the screen says so rather than merely lacking a button.
//
// ⚠ THE CAPABILITY IS AN INLINE DOUBLE-QUOTED LITERAL AT EVERY requirePracticeContext CALL, deliberately
// rather than tidily: practice-audit-harness.ts's capabilityCodesInSource() matches only that shape, and
// an invented capability code compiles, reviews clean and returns 403 for every user including the
// owner. Both codes here were verified live in practice_role_capabilities, and LIFECYCLE_CAPABILITIES is
// asserted against the catalogue by the lifecycle harness.
//
// ⚠ POST DOES NOT GO THROUGH requirePracticeContext, AND THAT IS THE WHOLE POINT OF THE RESTORE PATH.
// requirePracticeContext refuses any workspace whose status is not ACTIVE, ONBOARDING or PROVISIONING --
// so the moment a practice is archived, the only route that could un-archive it would refuse. It uses
// resolveLifecycleActor instead, which resolves the SAME membership and the SAME time-bounded grants
// without the status gate, and applyTransition then enforces the capability exactly as it would
// anywhere else. Nothing is granted here; one gate that would make archive a one-way door is stepped
// around, and only for the three lifecycle verbs.

export const dynamic = "force-dynamic";

const fail = (r: { code: string; message: string; status: number }) =>
  NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

/** The vocabulary the console needs, sent with every GET. */
const VOCABULARY = {
  actions: LIFECYCLE_ACTIONS.map(a => ({
    action: a.action, label: a.label, from: a.from, to: a.to,
    capability: a.capability, effect: a.effect, reversibleBy: a.reversibleBy,
  })),
  reason: { min: REASON_MIN, max: REASON_MAX },
  capabilities: LIFECYCLE_CAPABILITIES,
  // ⚠ THE REFUSALS TRAVEL WITH THE PAYLOAD. A screen that simply lacks a delete button looks like one
  // that has not finished loading; one that carries the reason is telling the truth.
  refusals: LIFECYCLE_REFUSALS,
};

export async function GET(req: NextRequest) {
  const view = new URL(req.url).searchParams.get("view") ?? "state";

  if (view === "export") {
    const auth = await requirePracticeContext("data.export");
    if (isDenied(auth)) return auth;
    const result = await exportPractice(auth.caller.admin, auth.ctx, { correlationId: auth.caller.traceId });
    if (!result.ok) return fail(result);
    const name = `competen-practice-${auth.ctx.workspaceId}-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(result.data, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      },
    });
  }

  const auth = await requirePracticeContext("practice.lifecycle.view");
  if (isDenied(auth)) return auth;
  const state = await practiceLifecycle(auth.caller.admin, auth.ctx);
  return NextResponse.json({ lifecycle: state, vocabulary: VOCABULARY, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const caller = await getCaller();
  if (isResponse(caller)) return caller;

  // The workspace: the body's own id when it names one (the access-status screen knows which practice it
  // was refused for), else the cookie preference. Either way it is re-validated against live membership
  // by resolveLifecycleActor -- the cookie is a preference, never an authority.
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId
    ? body.workspaceId
    : await readActiveWorkspaceId();
  if (!workspaceId)
    return NextResponse.json({ error: { code: "WORKSPACE_REQUIRED", message: "no practice was named and none is selected" } }, { status: 400 });

  const actor = await resolveLifecycleActor(caller.admin, caller.userId, workspaceId);
  // A caller with no active membership is told the practice is not found rather than that it exists and
  // they may not touch it -- the same answer requirePracticeContext gives, for the same reason.
  if (!actor) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  const result = await applyTransition(caller.admin, actor, {
    action: String(body.action ?? ""),
    reason: String(body.reason ?? ""),
    correlationId: caller.traceId,
  });
  return result.ok ? NextResponse.json(result.data) : fail(result);
}
