"use client";

import { createClient } from "@/lib/supabase/client";

// The way out of an idle lock-out.
//
// ⚠ THE SCREEN SAYS "SIGN OUT AND SIGN IN AGAIN", AND THIS IS THE CONTROL BEHIND THAT SENTENCE.
//
// Until the device register worked, an idle lock-out could never happen, so the instruction on that
// screen cost nothing. It can happen now: a practice that sets an idle limit gets one, and it lands on a
// browser whose device identifier is stable, so without a route back the person would meet the same wall
// on every visit for ever. `touchSession` lifts an idle lock-out -- and only an idle one, never one a
// person applied -- once GoTrue records a sign-in later than the lock-out, so this button genuinely
// clears it rather than merely reloading the verdict.
//
// It signs out of the CENTRAL Competen session, because that is the only sign-out this product has and
// because a new sign-in is exactly what is needed. The destination is the Practice sign-in form.
export default function IdleReSignIn() {
  return (
    <p className="mt-5">
      <button
        type="button"
        onClick={async () => {
          await createClient().auth.signOut();
          window.location.assign("/practice/sign-in?return_to=/practice/home");
        }}
        className="inline-block rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white"
      >
        Sign out and sign in again
      </button>
    </p>
  );
}
