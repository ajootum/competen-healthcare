"use client";

import { createClient } from "@/lib/supabase/client";

// Sign out of the central Competen session (IAM-001 s11: sign-out revokes the session; SHELL-001 s15:
// protected client state clears). Hard navigation afterwards so no workspace-scoped cache survives.
export default function PracticeSignOut() {
  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        window.location.assign("/practice");
      }}
      className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
    >
      Sign out
    </button>
  );
}
