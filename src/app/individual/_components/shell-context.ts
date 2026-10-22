import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { resolveIndividualShell, contextTermsGate, type IndividualContext } from "@/lib/individual/guard";
import { isExperienceKey, type ExperienceKey } from "@/lib/individual/experiences";

// One gate-3 resolution per request, shared by the group layout, the experience layout and the page.
// React's cache() scopes it to the render, so three callers cost one read -- and, more importantly, they
// cannot get three different answers.
export const individualShell = cache(resolveIndividualShell);

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
  if (shell.state === "AUTH_REQUIRED") redirect("/login?next=/individual/home");
  if (shell.state !== "READY") redirect("/individual/access");
  if (!isExperienceKey(param) || !shell.ctx.live.includes(param)) return null;
  // Owner ruling D2: live is not usable until the terms are accepted. The layout renders the acceptance.
  if (!contextTermsGate(shell.ctx, param).usable) return null;
  return { ctx: shell.ctx, experience: param };
}
