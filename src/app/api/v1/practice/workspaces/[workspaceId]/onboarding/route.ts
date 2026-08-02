import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { resolveWorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";

// GET/PATCH /api/v1/practice/workspaces/{workspaceId}/onboarding (PROV-001 s12, IAM-001 s9).
//
// The step catalog drives everything: order, requiredness and titles come from
// practice_onboarding_step_catalog (seeded by migration 191), so adding an onboarding step is a seed row,
// not a code change. Completing the final step is the ONE place a workspace transitions
// ONBOARDING -> ACTIVE (PROV-001 s6), and it is audited as practice.workspace_activated's precursor.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function load(admin: any, workspaceId: string, userId: string) {
  const { data: steps } = await admin.from("practice_onboarding_step_catalog")
    .select("step_code, position, required, title").order("position");
  const { data: ob } = await admin.from("practice_onboarding")
    .select("id, state, current_step, completed_steps, step_data, started_at, completed_at")
    .eq("workspace_id", workspaceId).eq("user_id", userId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return { steps: (steps ?? []) as any[], ob: ob as any | null };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { workspaceId } = await params;

  const res = await resolveWorkspaceContext(c.admin, c.userId, workspaceId);
  if (!res.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { steps, ob } = await load(c.admin, workspaceId, c.userId);

  // WHAT PROVISIONING ALREADY KNOWS. Timezone, profession and practice type were all collected at
  // signup and stored on the workspace; asking for them again, blank, asks the same person the same
  // question twice and invites a different answer the second time. Returned as defaults so the wizard
  // can pre-select them.
  //
  // stepData comes back too, so resuming an interrupted setup shows what was already entered. IAM-001
  // s9.1 requires resume; resuming to empty fields is technically resuming and practically starting over.
  const { data: ws } = await c.admin.from("practice_workspace")
    .select("timezone, profession_code, default_practice_type, country").eq("id", workspaceId).maybeSingle();

  return NextResponse.json({
    state: ob?.state ?? "none", currentStep: ob?.current_step ?? null,
    completedSteps: ob?.completed_steps ?? [], steps,
    stepData: ob?.step_data ?? {},
    defaults: {
      timezone: ws?.timezone ?? null,
      profession: ws?.profession_code ?? null,
      practiceType: ws?.default_practice_type ?? null,
      country: ws?.country ?? null,
    },
    correlationId: c.traceId,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { workspaceId } = await params;

  const res = await resolveWorkspaceContext(c.admin, c.userId, workspaceId);
  if (!res.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { stepCode?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.stepCode) return NextResponse.json({ error: "stepCode is required" }, { status: 400 });

  const { steps, ob } = await load(c.admin, workspaceId, c.userId);
  if (!ob || ob.state !== "in_progress") return NextResponse.json({ error: "no onboarding in progress" }, { status: 409 });

  const catalog = steps.map(s => s.step_code as string);
  if (!catalog.includes(body.stepCode)) return NextResponse.json({ error: "unknown stepCode" }, { status: 400 });

  const completed: string[] = Array.isArray(ob.completed_steps) ? [...ob.completed_steps] : [];
  if (!completed.includes(body.stepCode)) completed.push(body.stepCode);
  const nextStep = catalog.find(s => !completed.includes(s)) ?? null;
  const done = nextStep === null;

  // practice_context is where the real location arrives (PROV-001 s7 deferred-location decision).
  if (body.stepCode === "practice_context" && body.data?.locationName) {
    const { data: loc } = await c.admin.from("practice_location").select("id").eq("workspace_id", workspaceId).limit(1).maybeSingle();
    if (!loc) {
      await c.admin.from("practice_location").insert({
        workspace_id: workspaceId, name: String(body.data.locationName).slice(0, 160),
        type: ["hospital", "clinic", "outreach", "teleconsultation", "independent"].includes(String(body.data.locationType)) ? body.data.locationType : "clinic",
        country: null,
      });
    }
  }

  // regional_settings must reach the WORKSPACE, not only the onboarding record. Every appointment time
  // and clinical timestamp is rendered against practice_workspace.timezone; a zone chosen here that only
  // landed in step_data would be a picker that changes nothing, and the practitioner would have no way to
  // tell. Validated against the runtime's own IANA database rather than a list in this repo.
  if (body.stepCode === "regional_settings" && body.data?.timezone) {
    const tz = String(body.data.timezone);
    let valid = false;
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); valid = true; } catch { valid = false; }
    if (!valid) return NextResponse.json({ error: `unknown timezone: ${tz}` }, { status: 400 });
    await c.admin.from("practice_workspace")
      .update({ timezone: tz, updated_at: new Date().toISOString() }).eq("id", workspaceId);
  }

  await c.admin.from("practice_onboarding").update({
    completed_steps: completed,
    step_data: { ...(ob.step_data ?? {}), [body.stepCode]: body.data ?? {} },
    current_step: nextStep ?? "review_activate",
    state: done ? "completed" : "in_progress",
    completed_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", ob.id);

  await audit(c.admin, { workspaceId, actorId: c.userId, eventType: "practice.onboarding_stage_completed", payload: { stepCode: body.stepCode }, correlationId: c.traceId });

  if (done) {
    await c.admin.from("practice_workspace").update({ status: "ACTIVE", updated_at: new Date().toISOString() })
      .eq("id", workspaceId).eq("status", "ONBOARDING");
    await audit(c.admin, { workspaceId, actorId: c.userId, eventType: "practice.workspace_activated", payload: { via: "onboarding_completed" }, correlationId: c.traceId });
  }

  return NextResponse.json({
    state: done ? "completed" : "in_progress", currentStep: done ? null : nextStep,
    completedSteps: completed, workspaceStatus: done ? "ACTIVE" : "ONBOARDING", correlationId: c.traceId,
  });
}
