/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, connection } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { readIndividualAccess, type IndividualMembership } from "./access";
import type { ExperienceKey } from "./experiences";
import type { Acceptance } from "./legal";
import { termsGate } from "./terms";
import { individualAppEnabled } from "./gate";

// ── THE INDIVIDUAL GUARDS ── one for pages, one for API routes, one resolution under both ── ADR-016 ───
//
// ⚠ NOT getCaller(). getCaller's DEFAULT plane is the estate (gate 1), and an Individual-only person
// holds no platform_membership -- so every Individual route behind getCaller() would answer 403 to the
// only people it exists for. That is the 115-route Practice regression of 2026-08-10, one product over
// (see the long note in src/lib/api-auth.ts). Individual is gated by ITS membership, here, and nothing
// in this file widens or narrows any other product's gate.
//
// ⚠ AND NOT admitToEstate. The Individual shell must never be admitted by, or require, gate 1.

export type IndividualProfile = { fullName: string | null; email: string | null; avatarUrl: string | null; country: string | null };

export type IndividualContext = {
  userId: string;
  admin: any;
  membership: IndividualMembership;
  live: ExperienceKey[];
  experienceAcceptance: Partial<Record<ExperienceKey, Acceptance[]>>;
  profile: IndividualProfile;
};

export type IndividualShell =
  /** The release gate is off (src/lib/individual/gate.ts). Callers render 404 -- Individual does not exist. */
  | { state: "DISABLED" }
  | { state: "AUTH_REQUIRED" }
  | { state: "NO_ACCESS" }
  | { state: "UNAVAILABLE" }
  | { state: "READY"; ctx: IndividualContext };

async function readProfile(admin: any, userId: string, authEmail: string | null): Promise<IndividualProfile> {
  // The identity record every authenticated person has (on_auth_user_created). Display only -- nothing
  // here reads or writes profiles.role (ADR-001). The new-user trigger (migration 335) sets it; Individual
  // neither relies on that value nor changes it.
  const { data } = await admin.from("profiles").select("full_name, email, avatar_url, country").eq("id", userId).maybeSingle();
  return {
    fullName: data?.full_name ?? null,
    email: data?.email ?? authEmail,
    avatarUrl: data?.avatar_url ?? null,
    country: data?.country ?? null,
  };
}

/** For layouts and pages. Never renders protected content in a non-READY state -- the caller redirects. */
export async function resolveIndividualShell(): Promise<IndividualShell> {
  // ⚠ THE RELEASE GATE FIRST, BEFORE AUTHENTICATION. With the gate off, a signed-out visitor and a signed-
  // in one get the same answer -- 404 -- so a disabled Individual cannot be told apart from an absent one,
  // and nothing below (which reads the migration-370 tables) runs at all.
  // Request time only, before ANY client exists: a prerender stops here instead of building a service-role
  // client at build time (Vercel Preview has no key) or freezing the gate into static HTML.
  await connection();
  const admin = createAdminClient() as any;
  if (!(await individualAppEnabled(admin))) return { state: "DISABLED" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "AUTH_REQUIRED" };
  const access = await readIndividualAccess(admin, user.id);
  if (access.state === "unavailable") return { state: "UNAVAILABLE" };
  if (access.state === "none") return { state: "NO_ACCESS" };
  const profile = await readProfile(admin, user.id, user.email ?? null);
  return { state: "READY", ctx: { userId: user.id, admin, membership: access.membership, live: access.live, experienceAcceptance: access.experienceAcceptance, profile } };
}

/** Owner ruling D2: the terms gate for one live experience of this context. */
export function contextTermsGate(ctx: IndividualContext, experience: ExperienceKey) {
  return termsGate({
    experience,
    foundationAcceptance: ctx.membership.foundationAcceptance,
    experienceAcceptance: ctx.experienceAcceptance[experience],
  });
}

/**
 * For API routes. With `experience`, also requires that experience to be live -- an API reached for an
 * experience the person does not hold refuses, rather than trusting the page that called it -- and, unless
 * the route IS the acceptance (requireTerms: false), that its terms are accepted (owner ruling D2).
 */
export async function requireIndividualContext(
  experience?: ExperienceKey, opts: { requireTerms?: boolean } = {},
): Promise<IndividualContext | NextResponse> {
  const shell = await resolveIndividualShell();
  if (shell.state === "DISABLED") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (shell.state === "AUTH_REQUIRED") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (shell.state === "UNAVAILABLE")
    return NextResponse.json({ error: "Your Competen Individual access could not be checked. Try again shortly." }, { status: 503 });
  if (shell.state === "NO_ACCESS") return NextResponse.json({ error: "Competen Individual is not active on this account" }, { status: 403 });
  if (experience && !shell.ctx.live.includes(experience))
    return NextResponse.json({ error: "That experience is not active on this account" }, { status: 403 });
  if (experience && opts.requireTerms !== false && !contextTermsGate(shell.ctx, experience).usable)
    return NextResponse.json({ error: "Accept the terms for this experience before using it" }, { status: 403 });
  return shell.ctx;
}

export const isGuardRefusal = (x: IndividualContext | NextResponse): x is NextResponse => x instanceof NextResponse;
