import { EXPERIENCES, isExperienceKey, type ExperienceKey } from "./experiences";

// ── ENTRY AND DESTINATION ── COMPETEN-IND-ACCESS-001 s2-s3 ───────────────────────────────────────────
//
// Pure helpers for how a person arrives in Competen Individual: which destination a public "Sign in"
// carries to the shared /login, which experience a requested path names, and how the requested
// experience is carried to the welcome and the access guidance.
//
// ⚠ A REQUEST IS NOT AUTHORITY. Everything here only decides WHERE to send somebody. Whether they may
// open it is decided on arrival, by the release gate and gate 3 (src/lib/individual/guard.ts), on the
// server, every time. A requested experience the person does not hold lands on the governed not-active
// state, never on the experience.
//
// ⚠ NO OPEN REDIRECT. Every value returned is one of a fixed set of /individual paths, built here from
// the registry, never echoed from input.

export const INDIVIDUAL_HOME = "/individual/home";

/** `?experience=` (or `?for=`) as sent by a public door: a known experience key, or null. */
export function requestedExperience(param: unknown): ExperienceKey | null {
  const v = Array.isArray(param) ? param[0] : param;
  return isExperienceKey(v) ? v : null;
}

/**
 * Where a public "Sign in" sends the person after authentication. An explicit experience goes straight
 * to it (COMPETEN-IND-ACCESS-001 s3: "open Scholar if entitled"); no experience goes to /individual/home,
 * which opens the configured primary.
 */
export function entryDestination(experience: ExperienceKey | null): string {
  return experience ? `/individual/${experience}` : INDIVIDUAL_HOME;
}

/** The shared Competen sign-in, carrying that destination. */
export function signInHref(experience: ExperienceKey | null): string {
  return `/login?next=${encodeURIComponent(entryDestination(experience))}`;
}

/** The experience a requested /individual path names (`/individual/scholar/learn` -> scholar), or null. */
export function experienceOfPath(path: string | null | undefined): ExperienceKey | null {
  const m = /^\/individual\/([a-z]+)(?:\/|$)/.exec(path ?? "");
  return m && isExperienceKey(m[1]) ? m[1] : null;
}

/**
 * A `next` the shared /login may honour for Individual: a plain /individual/... path only. The login page
 * already refuses anything that is not a single-slash relative path; this is the narrower test the
 * Individual sign-in presentation uses to decide which product to name above the form.
 */
export function isIndividualNext(next: string | null | undefined): boolean {
  return !!next && /^\/individual\/[A-Za-z0-9\-/]*$/.test(next);
}

/** The product name a sign-in for `next` is heading to, for presentation only. */
export function signInProductName(next: string | null | undefined): string | null {
  if (!isIndividualNext(next)) return null;
  const x = experienceOfPath(next);
  return x ? EXPERIENCES[x].name : "Competen Individual";
}

/** Query suffix carrying a requested experience to the welcome or the access guidance. */
export function forQuery(experience: ExperienceKey | null): string {
  return experience ? `?for=${experience}` : "";
}
