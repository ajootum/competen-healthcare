import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolveIndividualShell, contextTermsGate, type IndividualContext } from "@/lib/individual/guard";
import { EXPERIENCES, isExperienceKey, type ExperienceKey } from "@/lib/individual/experiences";
import { forQuery, signInHref } from "@/lib/individual/entry";

// One gate-3 resolution per request, shared by the group layout, the experience layout and the page.
// React's cache() scopes it to the render, so three callers cost one read -- and, more importantly, they
// cannot get three different answers.
export const individualShell = cache(resolveIndividualShell);

/**
 * Metadata for a gated Individual route: the route's own title while the release gate is on, and NOTHING
 * while it is off -- so a disabled Individual 404 carries the root default title, byte-for-byte what an
 * absent route's 404 carries. Static `export const metadata` would put "Competen Scholar · Competen
 * Individual" into the 404 and tell a visitor the route exists (found 2026-10-23, merge-condition check).
 */
export async function gatedMetadata(meta: Metadata): Promise<Metadata> {
  return (await individualShell()).state === "DISABLED" ? {} : meta;
}

/**
 * ⚠ EVERY PAGE CALLS THIS ITSELF, NOT ONLY THE LAYOUT. Layouts and pages render in parallel, so a page
 * cannot assume its layout has already refused -- a page that read data on the strength of a check
 * somewhere above it would compute that data for a person the layout was about to turn away. Here the
 * page asks the same (cached) question and gets null when the experience is not live for the person,
 * and the experience layout renders the not-active state in its place.
 */
export async function experiencePage(param: string): Promise<{ ctx: IndividualContext; experience: ExperienceKey } | null> {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  const asked = isExperienceKey(param) ? param : null;
  if (shell.state === "AUTH_REQUIRED") redirect(signInHref(asked));
  if (shell.state !== "READY") redirect(`/individual/access${forQuery(asked)}`);
  if (!isExperienceKey(param) || !shell.ctx.live.includes(param)) return null;
  // Owner ruling D2: live is not usable until the terms are accepted. The layout renders the acceptance.
  if (!contextTermsGate(shell.ctx, param).usable) return null;
  return { ctx: shell.ctx, experience: param };
}

/**
 * For an EXPERIENCE-OWNED module page (EXPERIENCES[x].modules -- IND-004 Scholar, IND-007 Professional):
 * everything experiencePage() checks (release gate, gate 3, live experience, D2 terms), and then that this
 * experience actually lists the module. /individual/scholar/<a professional segment> is 404, not a page
 * that happens to render because both experiences share the [experience] route.
 */
export async function experienceModulePage(param: string, segment: string): Promise<{ ctx: IndividualContext; experience: ExperienceKey } | null> {
  const page = await experiencePage(param);
  if (!page) return null;
  if (!EXPERIENCES[page.experience].modules.some(m => m.segment === segment)) notFound();
  return page;
}
