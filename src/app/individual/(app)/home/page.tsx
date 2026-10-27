import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { decideLanding } from "@/lib/individual/access";
import { individualShell, gatedMetadata } from "../../_components/shell-context";
import type { Metadata } from "next";
import { StatePanel, IndividualMark, primaryBtn, secondaryBtn } from "../../_components/chrome";
import { learningEnabled } from "@/lib/learning/policy";
import { SignOutButton } from "../../_components/ShellNav";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /individual/home -- THE LANDING. The neutral sign-in chooser sends Individual members here, and this
// page sends them on: to the welcome if they have not finished it, otherwise to their primary experience
// if it is still live, otherwise to the one that is (src/lib/individual/access.ts decideLanding).
//
// The one state it renders is a member with no live experience -- membership without entitlement. That
// is a real state (a period ended, an experience was suspended), and it is stated, not hidden behind a
// redirect loop.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Home" }); }

export default async function IndividualHome() {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state !== "READY") redirect("/individual/access");
  const landing = decideLanding(shell.ctx.membership, shell.ctx.live);
  if (landing.kind === "welcome") redirect("/individual/welcome");
  if (landing.kind === "experience") redirect(`/individual/${landing.experience}`);
  // COMPETEN-LEARNING-01 (ADR-017, owner D2): a course-only member holds no experience and is served by Competen
  // Learning, which needs none. Offered only while learning_app is on. No experience is granted or implied.
  const learning = await learningEnabled(shell.ctx.admin);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-6"><IndividualMark /></div>
        {learning && (
          <div className="mb-4">
            <StatePanel title="Competen Learning"
              actions={<Link href="/individual/learning" className={`${primaryBtn} bg-[var(--cmp-theme-accent)]`}>Open Competen Learning</Link>}>
              <p>Your courses, your learning record and any certificates are in Competen Learning. You do not need Competen Scholar or Competen Professional to use it.</p>
            </StatePanel>
          </div>
        )}
        <StatePanel title="No experience is active on your account right now"
          actions={<><Link href="/individual" className={secondaryBtn}>About Competen Individual</Link><SignOutButton /></>}>
          <p>Your Competen Individual membership is in place, but neither Competen Scholar nor Competen Professional is currently active. An access period may have ended or been paused.</p>
          <p>Your Passport, profile and history are kept. Nothing has been deleted, and they will be here when an experience is active again.</p>
          <p>Competen Individual is in pilot, so access is arranged by Competen. Contact the person who invited you.</p>
        </StatePanel>
      </div>
    </main>
  );
}
