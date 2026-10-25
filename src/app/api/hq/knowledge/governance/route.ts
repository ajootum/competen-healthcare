/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { publishScope, setOverride } from "@/lib/config/workspace-config-write";
import { CKRI_OFF, CKRI_POLICY_PATH, CKRI_SCOPE, ckriEnabled, resolveCkriPolicy } from "@/lib/knowledge/governance";
import { activatePurpose, createPurpose, moveProject, proposeProject, recordEthics, retirePurpose, type ProjectMove } from "@/lib/knowledge/research-governance";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/knowledge/governance -- COMPETEN-KNOWLEDGE-RESEARCH-01 s3 (K1) and s10, migration 440.
//
// Body: { action, ...args }. Each action's capability is fixed HERE, server-side:
//   hq.quality.research.propose  (Research Lead)                 propose, submit, return, withdraw
//   hq.quality.research.govern   (Research Governance Officer,   purpose_create, purpose_activate, purpose_retire,
//                                 Quality Council Member)        approve, reject, ethics, recruit, close,
//                                                               policy_draft, policy_publish
// The 440 triggers check the same authority again, and independence (a purpose author cannot activate it, a proposer
// cannot decide their own project), so this route is not the only thing standing between a request and a record.
// ⚠ NOTHING THE BROWSER SENDS PICKS AN ACTOR, A DECIDER, A TIME OR A DATA-ACCESS LEVEL. Every action is audited.

const PROPOSE = ["propose", "submit", "return", "withdraw"] as const;
const GOVERN = ["purpose_create", "purpose_activate", "purpose_retire", "approve", "reject", "ethics", "recruit", "close", "policy_draft", "policy_publish"] as const;
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const capability = (PROPOSE as readonly string[]).includes(action) ? "hq.quality.research.propose" : (GOVERN as readonly string[]).includes(action) ? "hq.quality.research.govern" : null;
  if (!capability) return refuse(400, "Unknown action.");
  const ctx = await hqApiGate([capability]);
  if (isHqRefusal(ctx)) return ctx;
  // The gate: off (unwritten, unreadable, or off) refuses every governance action. Nothing here is a privacy right.
  if (!(await ckriEnabled(ctx.admin))) return refuse(409, CKRI_OFF);
  const me = ctx.userId;
  const trace = await currentTraceId();
  const audit = (entityType: string, entityId: string | null, value: Record<string, unknown>) => ctx.admin.from("audit_log").insert({
    trace_id: trace, actor_id: me, actor_name: ctx.fullName ?? null, action: `ckri_${action}`, entity_type: entityType, entity_id: entityId, new_value: value,
  }).then((x: unknown) => x, () => {});

  let r: any;
  const projectId = str(body.projectId, 40);
  switch (action) {
    case "purpose_create": r = await createPurpose(ctx.admin, me, { code: str(body.code, 61), permission: str(body.permission, 40), label: str(body.label), description: str(body.description, 2000), requiresEthics: body.requiresEthics !== false });
      if (r.ok) await audit("ckri_purpose", r.id, { code: str(body.code, 61), permission: str(body.permission, 40) }); break;
    case "purpose_activate": r = await activatePurpose(ctx.admin, me, str(body.code, 61)); if (r.ok) await audit("ckri_purpose", null, { code: str(body.code, 61) }); break;
    case "purpose_retire": r = await retirePurpose(ctx.admin, str(body.code, 61)); if (r.ok) await audit("ckri_purpose", null, { code: str(body.code, 61) }); break;
    case "propose": r = await proposeProject(ctx.admin, me, { code: str(body.code, 61), title: str(body.title, 300), purposeCode: str(body.purposeCode, 61), sponsor: str(body.sponsor, 20),
        institutionRef: str(body.institutionRef, 40) || null, agreementRef: str(body.agreementRef, 200) || null, minCohort: Number.isInteger(body.minCohort) ? body.minCohort : 10 });
      if (r.ok) await audit("ckri_research_project", r.id, { code: str(body.code, 61), sponsor: str(body.sponsor, 20) }); break;
    case "submit": case "return": case "withdraw": case "approve": case "reject": case "recruit": case "close":
      r = await moveProject(ctx.admin, me, projectId, action as ProjectMove, { note: str(body.note, 2000) || null, retainUntil: str(body.retainUntil, 10) || null });
      if (r.ok) await audit("ckri_research_project", projectId, { move: action }); break;
    case "ethics": r = await recordEthics(ctx.admin, me, projectId, { body: str(body.ethicsBody), ref: str(body.ethicsRef, 120), decidedOn: str(body.decidedOn, 10) });
      if (r.ok) await audit("ckri_research_project", projectId, { ethics_ref: str(body.ethicsRef, 120) }); break;
    case "policy_draft": {
      const w = await setOverride(ctx.admin, { userId: me, name: ctx.fullName ?? null }, CKRI_SCOPE, CKRI_POLICY_PATH, resolveCkriPolicy(body.policy));
      r = w.ok ? { ok: true } : { ok: false, error: "The CKRI policy draft could not be saved." }; break;
    }
    case "policy_publish": {
      const w = await publishScope(ctx.admin, { userId: me, name: ctx.fullName ?? null }, CKRI_SCOPE, { label: "CKRI policy", note: str(body.note, 300) || null });
      r = w.ok ? { ok: true } : { ok: false, error: "The CKRI policy could not be published." }; break;
    }
  }
  if (!r?.ok) return refuse(409, r?.error ?? "That could not be done.");
  return NextResponse.json(r);
}
