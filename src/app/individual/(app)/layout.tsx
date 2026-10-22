import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { individualShell } from "../_components/shell-context";

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

export const metadata: Metadata = {
  title: { default: "Competen Individual", template: "%s · Competen Individual" },
  robots: { index: false, follow: false },
};

export default async function IndividualAppLayout({ children }: { children: React.ReactNode }) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state === "AUTH_REQUIRED") {
    // Return to where they were going, validated -- only a plain /individual path, never an open redirect.
    const asked = (await headers()).get("x-pathname") ?? "";
    const next = /^\/individual\/[A-Za-z0-9\-/]*$/.test(asked) ? asked : "/individual/home";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (shell.state !== "READY") redirect("/individual/access");
  return <>{children}</>;
}
