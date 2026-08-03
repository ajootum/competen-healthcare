import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { hasPracticeMembership } from "@/lib/practice/shell";
import { platformFlag } from "@/lib/practice/provisioning";
import { pageMetadata } from "@/lib/marketing/site";
import SignUpForm from "./SignUpForm";

// /practice/sign-up (CPR-IAM-001 s8, PROV-001 s10/s11) -- self-service individual signup.
//
// FLAG-GATED ON practice_public_signup, which is the controlled-launch rung of IAM-001 s14.1's ladder.
// With it off this page collects nothing and says so; with it on the real two-step form renders. The API
// checks the SAME flag, so the page and the endpoint cannot disagree -- a form that renders while the
// endpoint refuses would be the worst of both.
//
// The provisioning machinery behind it has been live and harness-proven since Phase 0. What arrives here
// is steps 1 to 4 of s8: collect, check for an existing identity, create the pending identity, verify.

export const metadata = pageMetadata({
  title: "Create your Competen Practice",
  description: "Individual practitioner signup for Competen Practice.",
  path: "/practice/sign-up",
});

export const dynamic = "force-dynamic";

export default async function Page() {
  if (await hasPracticeMembership()) redirect("/practice/home");
  const open = await platformFlag(createAdminClient(), "practice_public_signup");

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <span className="w-9 h-9 rounded-full bg-[var(--cp-primary)] flex items-center justify-center text-white font-bold">C</span>
          <span className="text-lg font-bold text-gray-900">competen<span className="text-[var(--cp-primary)]">Practice</span></span>
        </div>

        {open ? <SignUpForm /> : (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <h1 className="text-lg font-bold text-gray-900">Signup is not open yet</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Competen Practice provisioning runs in a controlled pilot first. Public self-service signup
              opens after the pilot completes; until then no account can be created from this page, and we
              would rather tell you that than collect an email for a waiting list that does not exist.
            </p>
            <p className="mt-4 text-[13px] text-gray-500">
              See what you will get at{" "}
              <Link href="/practice" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Competen Practice</Link>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
