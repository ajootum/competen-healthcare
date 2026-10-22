/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { readIndividualAccess, type IndividualMembership } from "./access";
import type { ExperienceKey } from "./experiences";

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
  profile: IndividualProfile;
};

export type IndividualShell =
  | { state: "AUTH_REQUIRED" }
  | { state: "NO_ACCESS" }
  | { state: "UNAVAILABLE" }
  | { state: "READY"; ctx: IndividualContext };

async function readProfile(admin: any, userId: string, authEmail: string | null): Promise<IndividualProfile> {
  // The identity record every authenticated person has (on_auth_user_created). Display only -- nothing
  // here reads profiles.role, which stays null for an Individual-only person (ADR-001).
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "AUTH_REQUIRED" };
  const admin = createAdminClient() as any;
  const access = await readIndividualAccess(admin, user.id);
  if (access.state === "unavailable") return { state: "UNAVAILABLE" };
  if (access.state === "none") return { state: "NO_ACCESS" };
  const profile = await readProfile(admin, user.id, user.email ?? null);
  return { state: "READY", ctx: { userId: user.id, admin, membership: access.membership, live: access.live, profile } };
}

/**
 * For API routes. With `experience`, also requires that experience to be live -- an API reached for an
 * experience the person does not hold refuses, rather than trusting the page that called it.
 */
export async function requireIndividualContext(experience?: ExperienceKey): Promise<IndividualContext | NextResponse> {
  const shell = await resolveIndividualShell();
  if (shell.state === "AUTH_REQUIRED") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (shell.state === "UNAVAILABLE")
    return NextResponse.json({ error: "Your Competen Individual access could not be checked. Try again shortly." }, { status: 503 });
  if (shell.state === "NO_ACCESS") return NextResponse.json({ error: "Competen Individual is not active on this account" }, { status: 403 });
  if (experience && !shell.ctx.live.includes(experience))
    return NextResponse.json({ error: "That experience is not active on this account" }, { status: 403 });
  return shell.ctx;
}

export const isGuardRefusal = (x: IndividualContext | NextResponse): x is NextResponse => x instanceof NextResponse;
