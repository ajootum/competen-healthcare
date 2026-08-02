import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { hasPracticeMembership } from "@/lib/practice/shell";
import { platformFlag } from "@/lib/practice/provisioning";
import { pageMetadata } from "@/lib/marketing/site";
import SignInForm from "./SignInForm";

// /practice/sign-in (CPR-IAM-001 s6/s7) -- the Practice-branded entry point to CENTRAL identity.
// It is an entry point and destination router, not a separate authentication system (IAM s1).
//
// FLAG-GATED, WHICH IS WHAT KEEPS TWO PROMISES AT ONCE. The practice_sign_in flag is OFF in the
// development posture (migration 191 seeds, IAM s14.1), so this page renders the same transparent
// "not open yet" statement as the journey pages -- no credential field exists anywhere on the public
// site, and the disclosure harness's no-password assertion stays TRUE rather than needing retirement.
// When the flag flips for the private pilot, the real form renders here and that assertion is revisited
// deliberately, because its purpose was preventing a FAKE form, not a real one.
//
// An already-signed-in member never sees the form either way: membership routes them straight in.

export const metadata = pageMetadata({
  title: "Sign in to Competen Practice",
  description: "Sign in to your Competen Practice workspace.",
  path: "/practice/sign-in",
});

export const dynamic = "force-dynamic";

export default async function Page() {
  if (await hasPracticeMembership()) redirect("/practice/home");

  const enabled = await platformFlag(createAdminClient(), "practice_sign_in");

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <span className="w-9 h-9 rounded-full bg-[#2563EB] flex items-center justify-center text-white font-bold">C</span>
          <span className="text-lg font-bold text-gray-900">competen<span className="text-[#2563EB]">Practice</span></span>
        </div>

        {enabled ? (
          <SignInForm />
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <h1 className="text-lg font-bold text-gray-900">Sign-in is not open yet</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Competen Practice is in development and accounts cannot sign in yet. This page becomes the
              sign-in for the private pilot when it opens; nothing you could type today would work, so
              there is nothing to type.
            </p>
            <p className="mt-4 text-[13px] text-gray-500">
              Read about the product at{" "}
              <Link href="/practice" className="font-semibold text-[#1D4ED8] hover:underline">Competen Practice</Link>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
