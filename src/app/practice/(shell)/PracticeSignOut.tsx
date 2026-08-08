"use client";

import { createClient } from "@/lib/supabase/client";
import { purgeAllOffline } from "@/lib/practice/offline-store";

// Sign out of the central Competen session (IAM-001 s11: sign-out revokes the session; SHELL-001 s15:
// protected client state clears). Hard navigation afterwards so no workspace-scoped cache survives.
//
// ⚠ AND THE OFFLINE STORE GOES WITH IT (CP-OFFLINE-SURVEY-001 s3.6, "bound the lifetime"). Signing out is
// the clearest available statement that this person has finished with this browser -- a shared clinic
// machine is the realistic case in the target deployment, and it is precisely the one encryption does not
// help with. The purge runs BEFORE signOut so a failure is still on a page that can report it, and its
// result is awaited rather than fired off: a navigation that starts mid-delete leaves the record behind.
export default function PracticeSignOut() {
  return (
    <button
      type="button"
      onClick={async () => {
        await purgeAllOffline();
        await createClient().auth.signOut();
        window.location.assign("/practice");
      }}
      className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
    >
      Sign out
    </button>
  );
}
