import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { nextStep, parseContext, parseSummary, registrationSteps } from "@/lib/individual/professional/profile-form";
import { saveContext } from "@/lib/individual/professional/profile-store";
import { FIELD_LABEL, OPTIONAL_FIELDS, REGISTRATION_STEPS, REQUIRED_FIELDS, type RegistrationField, type RegistrationStep } from "@/lib/individual/professional/profile-vocabulary";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// PUT /api/individual/professional/context -- COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, GO s3 and s4.
//
// The registration form's save-and-continue, and later edits of the same facts from the profile overview.
// Body: { step, ...fields } where step is a registration step or "overview".
//   profession   the three required facts (blank is allowed while saving: completion is what requires them)
//   practice     the optional questions configuration asks, in its order. `skip: true` saves nothing.
//   review       `complete: true` finishes registration -- refused, with what is missing, unless every
//                required fact is present (450's CHECK refuses it too)
//   overview     every field plus the summary, after registration
//
// ⚠ ONE IDENTITY. This writes the person's own 373/450 profile row and nothing else: no profiles row, no
// second account, no entitlement. The Professional entitlement was already checked by the guard.
// ⚠ The audit row names the step and which fields were sent, never their values.

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const step = fields.step;
  if (step !== "overview" && !(REGISTRATION_STEPS as readonly unknown[]).includes(step)) return refuse("Choose a step.");

  const policy = (await loadIndividualPolicy(ctx.admin)).professionalProfile;
  const steps = registrationSteps(policy);
  const asked: RegistrationField[] = step === "profession" ? [...REQUIRED_FIELDS]
    : step === "practice" ? (fields.skip === true || fields.skip === "true" ? [] : [...policy.registrationFields])
    : step === "overview" ? [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]
    : [];
  const parsed = parseContext(fields, asked, policy);
  if (!parsed.ok) return refuse(parsed.error);
  const summary = step === "overview" ? parseSummary(fields.summary) : null;
  if (summary && !summary.ok) return refuse(summary.error);

  const complete = step === "review" && (fields.complete === true || fields.complete === "true");
  const out = await saveContext(ctx.admin, ctx.userId, policy, {
    columns: parsed.value,
    summary: summary?.ok ? summary.value : undefined,
    step: step === "overview" ? undefined : nextStep(step as RegistrationStep, steps),
    complete,
  });
  if (!out.ok) {
    const missing = (out as { missing?: RegistrationField[] }).missing;
    return NextResponse.json({ error: missing?.length ? `Still needed: ${missing.map(f => FIELD_LABEL[f]).join(", ")}.` : out.error, missing }, { status: out.status });
  }
  await audit(ctx, complete ? "individual_professional_registration_complete" : "individual_professional_context_save", "individual_professional_profile", out.id,
    { step, fields: asked, created: out.created });
  return NextResponse.json({ ok: true, next: step === "overview" ? null : complete ? null : nextStep(step as RegistrationStep, steps), complete });
}
