import { NextResponse } from "next/server";
import { currentTraceId } from "@/lib/trace";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { validatePrimaryChoice } from "@/lib/individual/access";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/preferences -- COMPETEN-IND-003 s2(3) and s2(7). Sets the primary experience and,
// from the welcome, records that onboarding is complete.
//
// ⚠ IT WRITES TWO COLUMNS OF THE CALLER'S OWN MEMBERSHIP ROW AND NOTHING ELSE. It cannot grant, extend
// or end an entitlement, and it cannot touch anybody else's row: the update is keyed on the user id the
// guard resolved from the session, never on an id in the body.
//
// ⚠ ONLY A LIVE EXPERIENCE MAY BE PRIMARY. A preference for an experience the person does not hold would
// be stored and then silently ignored by the landing, which is a setting that lies about itself.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;

  const body = await req.json().catch(() => ({}));
  const primary = validatePrimaryChoice(body?.primaryExperience, ctx.live);
  if (!primary) return NextResponse.json({ error: "Choose an experience that is active on your account." }, { status: 400 });

  const completeOnboarding = body?.completeOnboarding === true && !ctx.membership.onboardedAt;
  const patch: Record<string, unknown> = { primary_experience: primary, updated_at: new Date().toISOString() };
  if (completeOnboarding) patch.onboarded_at = new Date().toISOString();

  const { error } = await ctx.admin.from("individual_membership").update(patch).eq("user_id", ctx.userId).eq("status", "active");
  if (error) return NextResponse.json({ error: "Your preference could not be saved. Try again shortly." }, { status: 503 });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action: completeOnboarding ? "individual_onboarding_completed" : "individual_primary_experience_set",
    entity_type: "individual_membership", entity_id: ctx.membership.id,
    old_value: { primary_experience: ctx.membership.primaryExperience },
    new_value: { primary_experience: primary },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ primaryExperience: primary, next: `/individual/${primary}` });
}
