/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { scholarModulesFor } from "@/lib/individual/scholar/module-access";
import { assessmentsReady, type Res } from "./store";

// ── THE GATE EVERY SCHOLAR ASSESSMENT ROUTE PASSES ── Checklist Studio S3 ───────────────────────────────────────────
//
// A route handler calls requireIndividualContext("scholar") ITSELF (the Scholar guard: release gate, membership, live experience, terms),
// then this, in this order and before any other read:
//   1. the learner may see the My Competencies module (private module development access) -> otherwise 404;
//   2. the assessment tables exist on this environment (the readiness probe) -> otherwise 404;
// and both answer the SAME 404 with the same body, so a refused learner cannot tell "not allowed" from "not there".
// The policy list of offered instrument codes is read here once and handed on: empty means nothing is offered.

export const NOT_AVAILABLE = { error: "Not found." } as const;

export async function assessmentApiGate(ctx: { admin: any; userId: string }): Promise<{ ok: true; policyCodes: string[] } | { ok: false; res: NextResponse }> {
  const refuse = () => ({ ok: false as const, res: NextResponse.json(NOT_AVAILABLE, { status: 404, headers: { "Cache-Control": "private, no-store" } }) });
  try {
    if (!(await scholarModulesFor(ctx.admin, ctx.userId)).has("competencies")) return refuse();
    if (!(await assessmentsReady(ctx.admin, ctx.userId))) return refuse();
    const policy = await loadIndividualPolicy(ctx.admin);
    return { ok: true, policyCodes: policy.scholarAssessmentInstruments };
  } catch { return refuse(); }
}

/** A store result as a JSON response: the data on success, the status and message (and the server's own copy on a conflict) otherwise. */
export function respond<T extends Record<string, unknown>>(r: Res<T>, extra?: (d: T) => Record<string, unknown>): NextResponse {
  const headers = { "Cache-Control": "private, no-store" };
  if (r.ok) return NextResponse.json({ ok: true, ...r.data, ...(extra ? extra(r.data) : {}) }, { headers });
  return NextResponse.json({ error: r.error, ...(r.server !== undefined ? { server: r.server } : {}) }, { status: r.status, headers });
}
