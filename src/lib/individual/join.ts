/* eslint-disable @typescript-eslint/no-explicit-any */
import { individualAppEnabled } from "./gate";
import { individualIdentityProfile } from "../platform-membership";
import { selfActivateScholar } from "./grants";
// PRODUCT-EXPERIENCE P5 (prepared, OFF): the self-service Professional addition, gated in professional-add.ts.
export { addProfessionalFromScholar, type AddOutcome } from "./grants";
import { setLearnerContext, type ContextChoice } from "./scholar/context";

// ── JOINING COMPETEN SCHOLAR ── COMPETEN-SCHOLAR-JOIN-01 Stage 1, J1-J3 ──────────────────────────────────────
//
// Get Started -> Create Account -> Verify Email -> Educational Context -> Activate Scholar -> Welcome -> Upload.
//
// ⚠ DARK BY DEFAULT, TWICE. Every step asks selfRegistrationEnabled first: the Individual release gate
// (individual_app) AND practice_platform_flags.flag = 'individual_self_registration'. No migration writes
// that row, so it is OFF, and an absent row, a failed read or a missing client is OFF. Owner ruling: public
// self-registration stays disabled pending legal confirmation and a separate production approval. The
// invitation flow (378) is untouched and does not depend on this flag.
//
// ⚠ ONE IDENTITY. An existing Competen account never gets a second one: registration refuses a signed-in
// caller and an email that already has an account, and offers sign-in instead (the Practice signup
// precedent, CPR-IAM-001 s8). An existing account activates Scholar on the account it already has (J1).
//
// ⚠ AGE (owner ruling): 18+, by the person's own explicit DECLARATION, recorded with its time, the words shown
// and the eligibility-policy version (migration 403). It is self-declaration, not verified age. No identity
// document is asked for and no external age-verification service is called. This replaces the HQ
// confirmation of D8 for self-activated periods only, and it is an owner decision recorded in the build record.
//
// ⚠ NO ESTATE ROLE. A new identity's profiles row gets the trigger's default 'nurse' set back to null through
// the boundary helper -- the rule Practice signup and Individual invitations already keep.

export const INDIVIDUAL_SELF_REGISTRATION_FLAG = "individual_self_registration";

/** The eligibility policy a declaration is made under. A new version is a new statement, reviewed in code. */
export const SCHOLAR_ELIGIBILITY = {
  policyVersion: "scholar-eligibility-18plus-2026-10",
  statement: "I confirm that I am 18 years of age or older.",
} as const;

/** True only when BOTH flags are on. Every other outcome is false, and it never throws. */
export async function selfRegistrationEnabled(admin: any | null): Promise<boolean> {
  if (!admin || !(await individualAppEnabled(admin))) return false;
  try {
    const { data, error } = await admin.from("practice_platform_flags")
      .select("enabled").eq("flag", INDIVIDUAL_SELF_REGISTRATION_FLAG).maybeSingle();
    if (error) return false;
    return data?.enabled === true;
  } catch {
    return false;
  }
}

type Refusal = { ok: false; status: number; code: string; message: string; nextUrl?: string };

/** Where a verified, signed-in person continues the join. A fixed path, never echoed from input. */
export const JOIN_START = "/individual/join/start";
export const JOIN_SIGN_IN = `/login?next=${encodeURIComponent(JOIN_START)}`;

/** Pure: the registration form, or why it is refused. Minimal fields: name, email, password. */
export function validateRegistration(body: any): { email: string; password: string; fullName: string } | Refusal {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const fullName = String(body?.fullName ?? "").trim().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "Use a password of at least 8 characters." };
  if (!fullName) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "Enter your name." };
  return { email, password, fullName };
}

export const isJoinRefusal = (x: any): x is Refusal => x?.ok === false;

/**
 * Create the identity: Supabase auth sign-up, with email confirmation, on the CALLER's cookie-bound client.
 * The caller has already checked the flag and that nobody is signed in. Returns once the confirmation email is
 * on its way -- nothing Individual is created until the person comes back verified and activates.
 */
export async function registerForScholar(supabase: any, admin: any, input: { email: string; password: string; fullName: string }, siteUrl: string | null)
  : Promise<{ ok: true; userId: string; verified: boolean } | Refusal> {
  const { data: existing, error: exErr } = await admin.from("profiles").select("id").eq("email", input.email).maybeSingle();
  if (exErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "We could not check that email address just now. Try again shortly." };
  if (existing)
    return { ok: false, status: 409, code: "IDENTITY_EXISTS", message: "An account already exists for that email. Sign in, and you can add Competen Scholar to it.", nextUrl: JOIN_SIGN_IN };

  const redirect = siteUrl ? `${siteUrl.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(JOIN_START)}` : undefined;
  const { data, error } = await supabase.auth.signUp({
    email: input.email, password: input.password,
    options: { data: { full_name: input.fullName, competen_join: "scholar" }, ...(redirect ? { emailRedirectTo: redirect } : {}) },
  });
  if (error) return { ok: false, status: 400, code: "SIGNUP_FAILED", message: error.message };
  const userId = data?.user?.id;
  // GoTrue answers an already-registered address with a user that has no identities, and sends nothing.
  if (!userId || (Array.isArray(data.user.identities) && data.user.identities.length === 0))
    return { ok: false, status: 409, code: "IDENTITY_EXISTS", message: "An account already exists for that email. Sign in, and you can add Competen Scholar to it.", nextUrl: JOIN_SIGN_IN };

  const clear = await admin.from("profiles").update(individualIdentityProfile()).eq("id", userId);
  if (clear.error) return { ok: false, status: 502, code: "SIGNUP_FAILED", message: "Your account was created but could not be completed. Sign in to continue." , nextUrl: JOIN_SIGN_IN };
  return { ok: true, userId, verified: !!data.session };
}

/** Pure: the activation form -- the explicit declaration, under the current policy version. */
export function validateDeclaration(body: any): true | Refusal {
  if (body?.adultDeclaration !== true)
    return { ok: false, status: 422, code: "AGE_DECLARATION_REQUIRED", message: "Competen Scholar is for people aged 18 or over. Confirm that you are to continue." };
  // The version the page showed. A stale page is refused rather than recorded against words it did not show.
  if (body?.policyVersion !== SCHOLAR_ELIGIBILITY.policyVersion)
    return { ok: false, status: 409, code: "POLICY_CHANGED", message: "The eligibility statement has changed since this page loaded. Reload and read it again." };
  return true;
}

export type ActivationOutcome =
  | { ok: true; membership: "created" | "existing"; alreadyLive: boolean; next: string }
  | Refusal;

/**
 * Activate Scholar for a verified, signed-in person: their educational context, their declaration, then the
 * entitlement. The caller has checked the flag, the session, a confirmed email and the declaration.
 *
 * Order matters. The context is written first, because it stands on its own and a failure there leaves
 * nothing half-made. The declaration is recorded next, and is kept even if the entitlement then fails: it
 * is a true record of what the person declared, and append-only by design.
 */
export async function activateScholar(admin: any, args: {
  userId: string; choice: ContextChoice; viaRegistration: boolean; onboarded: boolean;
}): Promise<ActivationOutcome> {
  if ((await setLearnerContext(admin, args.userId, args.choice)) !== "ok")
    return { ok: false, status: 503, code: "WRITE_FAILED", message: "Your programme could not be saved just now. Try again shortly." };

  const { data: decl, error: dErr } = await admin.from("individual_age_declaration").insert({
    user_id: args.userId, policy_version: SCHOLAR_ELIGIBILITY.policyVersion, statement: SCHOLAR_ELIGIBILITY.statement,
    source: args.viaRegistration ? "self_registration" : "self_activation",
  }).select("id, declared_at").single();
  if (dErr || !decl) return { ok: false, status: 503, code: "WRITE_FAILED", message: "Your confirmation could not be recorded just now. Try again shortly." };

  const out = await selfActivateScholar(admin, args.userId, { declarationId: decl.id, declaredAt: decl.declared_at, note: "Self-activated through the Scholar join" });
  if (!out.ok) return out;

  await admin.from("audit_log").insert({
    actor_id: args.userId, action: "individual_scholar_self_activated", entity_type: "individual_entitlement", entity_id: null,
    new_value: {
      membership: out.membership, already_live: out.alreadyLive, declaration_id: decl.id, policy_version: SCHOLAR_ELIGIBILITY.policyVersion,
      programme: args.choice.programmeCode, level: args.choice.level?.code ?? null, institution: args.choice.institution?.code ?? null,
    },
  }).then((r: unknown) => r, () => {});

  // A new member meets the welcome first (Upload my notes is its primary action). A member who has already
  // been welcomed goes straight to Scholar's study page, where the terms gate (D2) asks first if it must.
  const next = !args.onboarded ? "/individual/welcome?for=scholar" : "/individual/scholar/study";
  return { ok: true, membership: out.membership, alreadyLive: out.alreadyLive, next };
}
