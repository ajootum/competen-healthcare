import Link from "next/link";
import { createAdminClientOrNull } from "@/lib/supabase/server";
import { platformFlag } from "@/lib/practice/provisioning";
import SignupForm from "./SignupForm";

// The estate signup, behind a launch flag at last -- the gap the WEB-HOME-001 survey named.
//
// ⚠ WHAT WAS WRONG BEFORE: /signup was a bare client form calling supabase.auth.signUp with NO flag,
// while the owner keeps Supabase signups OFF at the project level. So the page invited a visitor to
// fill four fields and then failed with a raw provider error -- a dishonest page in front of a closed
// door, the exact shape Practice's own signup was built to avoid. This mirrors Practice's ladder:
// the same platformFlag reader, the same server-side gate on page AND endpoint, the same honest closed
// state.
//
// ⚠ FAIL-CLOSED BY CONSTRUCTION, AND THAT IS WHY THERE IS NO MIGRATION. platformFlag treats an absent
// row and an unreadable store as OFF. `estate_public_signup` has never been written, so the gate is
// closed today because the row does not exist -- which is the truth. Opening signup later is the owner
// inserting one row in practice_platform_flags, the same table the Practice ladder already operates.

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const open = await platformFlag(createAdminClientOrNull(), "estate_public_signup");

  if (open) return <SignupForm />;

  return (
    <main className="min-h-screen bg-[var(--cmp-neutral-50)] flex items-center justify-center p-6">
      {/* ⚠ THE CLOSED COPY MUST NOT UNDERSTATE THE PRODUCT — 2026-08-28. Practice self-serve signup is
          OPEN (owner decision, practice_public_signup + the dashboard toggle), while THIS estate-level
          door stays on its own never-written flag. The old sentence — "accounts are currently set up
          with us directly" — became false the day the Practice door opened one path away, which is the
          stale-refusal class CPR-HFE-REF-001 records: a refusal that understates is as dishonest as one
          that overstates. The primary action now points at the door that is actually open. */}
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8">
        <h1 className="text-xl font-bold text-gray-900">Start with Competen Practice</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-gray-700">
          Self-service signup is open for Competen Practice — create your practice in a few minutes.
          Other Competen accounts are still set up with us directly.
        </p>
        <div className="mt-6 space-y-2.5">
          <Link href="/practice/sign-up"
            className="block rounded-xl bg-[#4F46E5] px-4 py-3 text-center text-[14px] font-semibold text-white hover:opacity-90">
            Create your Competen Practice
          </Link>
          <a href={"mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen account request")}
            className="block rounded-xl border border-gray-300 px-4 py-3 text-center text-[14px] font-semibold text-gray-700 hover:bg-gray-50">
            Talk to us about a different account
          </a>
          <Link href="/login"
            className="block rounded-xl border border-gray-300 px-4 py-3 text-center text-[14px] font-semibold text-gray-700 hover:bg-gray-50">
            Already have one? Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
