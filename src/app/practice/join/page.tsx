import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JoinForm from "./JoinForm";

// /practice/join -- redeem an invitation code (CPR-310).
//
// DELIBERATELY OUTSIDE THE (shell) GROUP. The shell's guards require a workspace membership, and the
// entire point of this page is that the visitor does not have one yet -- routing it through those
// guards would bounce them to the chooser or to /practice with no way back.
//
// It does need a SESSION, though: a membership belongs to an authenticated identity, and there is
// nobody to add without one. Signed-out visitors are sent to sign-in with a return path, so the code in
// their hand survives the round trip.

export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/practice/sign-in?return_to=/practice/join");

  return (
    <div className="cp-surface min-h-screen bg-[var(--cp-canvas)] px-4 py-16">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">Join a practice</h1>
        <p className="mt-1 text-[13px] text-gray-600">
          Enter the code you were given. It works once, and only for the practice it was made for.
        </p>

        <JoinForm />

        <p className="mt-6 text-[11px] text-gray-500">
          Codes are handed over in person or however your practice already communicates &mdash; Competen
          Practice does not email or text them, and never will silently. If a code has expired or was
          already used, whoever invited you can issue another.
        </p>
      </div>
    </div>
  );
}
