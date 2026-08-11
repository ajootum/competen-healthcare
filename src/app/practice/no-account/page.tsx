import Link from "next/link";
import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";

// Where a signed-in person with NO Practice workspace lands -- the owner's request, 2026-08-11.
//
// ⚠ THE BOUNCE THIS REPLACES WAS A SILENT LIE. Four places redirected WORKSPACE_REQUIRED to /practice --
// the MARKETING page. The person signed in successfully, was told nothing, and found themselves back on
// a brochure that invited them to sign in again. The owner hit it personally: signing in without a
// Practice account just circled back to the product homepage. An account that holds no workspace is a
// fact worth a sentence, not a loop.
//
// ⚠ IT SAYS WHAT IS TRUE AND OFFERS EVERY REAL WAY FORWARD: their other Competen workspaces exist and
// are one click away, and joining Practice is a conversation while signup is closed. It does NOT offer
// a signup button -- that door is shut by the owner's decision, and this page is honest about the path.

export const dynamic = "force-dynamic";

export default async function PracticeNoAccountPage() {
  const shell = await resolvePracticeShell();

  // Not signed in: this page's sentence is about an ACCOUNT, so there must be one to talk about.
  if (shell.state === "AUTH_REQUIRED") redirect("/practice/sign-in");
  // Holds a workspace after all (state READY or anything else that can proceed): nothing to explain.
  if (shell.state !== "WORKSPACE_REQUIRED") redirect("/practice/home");

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">You&apos;re signed in — but not to a practice</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
        Your Competen account is real and working, but it doesn&apos;t hold a Competen Practice workspace.
        That&apos;s all that happened — nothing is broken, and nothing was lost.
      </p>

      <div className="mt-6 space-y-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[13.5px] font-semibold text-gray-900">Looking for your other Competen workspaces?</p>
          <p className="mt-1 text-[12.5px] text-gray-600">
            Everything your account does hold is one place away.
          </p>
          <Link href="/dashboard" className="mt-2 inline-block rounded-lg bg-[#4F46E5] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90">
            Go to My Competen →
          </Link>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[13.5px] font-semibold text-gray-900">Want to run your practice on Competen?</p>
          <p className="mt-1 text-[12.5px] text-gray-600">
            Practice workspaces are set up with us directly at the moment — talk to us and we&apos;ll get
            you started.
          </p>
          <a href={"mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen Practice - new practice")}
            className="mt-2 inline-block rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
            Talk to us
          </a>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[13.5px] font-semibold text-gray-900">Expecting to be part of an existing practice?</p>
          <p className="mt-1 text-[12.5px] text-gray-600">
            Ask the practice owner to invite this account — membership is theirs to grant, and it takes
            them a minute.
          </p>
        </div>
      </div>
    </div>
  );
}
