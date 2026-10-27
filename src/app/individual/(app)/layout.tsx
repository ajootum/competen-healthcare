import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { individualShell, gatedMetadata } from "../_components/shell-context";
import { experienceOfPath, forQuery, isIndividualNext } from "@/lib/individual/entry";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// ── THE COMPETEN INDIVIDUAL APPLICATION: GATE 3 ── COMPETEN-IND-003 s2, ADR-016 ───────────────────────
//
// Every signed-in Individual route sits in this group, and this layout answers gate 3 once for all of
// them: the release gate first (OFF renders 404 -- src/lib/individual/gate.ts), then, in the Practice
// shell's order, authentication and membership. A non-READY state redirects to
// its own surface and protected content never renders in it.
//
// ⚠ GATE 3 ONLY. This layout never calls admitToEstate and never requires platform_membership -- an
// Individual-only person holds neither, by design (COMP-ARCH-PSA-001 s40). Nor does anything here grant
// one. Each page re-asks the same cached question (shell-context.ts) rather than trusting this layout.
//
// ⚠ NOT INDEXED. /individual (the public gateway) is a marketing page. Everything behind this layout is a
// person's own record. Set here as metadata rather than in robots.ts, which the website branch also edits.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({
    title: { default: "Competen Individual", template: "%s · Competen Individual" },
    robots: { index: false, follow: false },
  });
}

export default async function IndividualAppLayout({ children }: { children: React.ReactNode }) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  // The proxy's x-pathname: safe for a redirect decision during this server render, never rendered.
  const asked = shell.state === "READY" ? "" : (await headers()).get("x-pathname") ?? "";
  if (shell.state === "AUTH_REQUIRED") {
    // Return to where they were going, validated -- only a plain /individual path, never an open redirect.
    const next = isIndividualNext(asked) ? asked : "/individual/home";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  // COMPETEN-IND-ACCESS-001 s3: the guidance names the experience they asked for. It is copy only -- the
  // access page works out the person's state itself and never trusts the URL for it.
  if (shell.state !== "READY") redirect(`/individual/access${forQuery(experienceOfPath(asked))}`);
  // COMPETEN-DESIGN-SYSTEM-01: the Individual theme for every page under the gate; an experience layout re-points it.
  return <div data-cmp-theme="individual">{children}</div>;
}
