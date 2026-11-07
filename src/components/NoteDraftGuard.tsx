"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { guardDrafts } from "@/lib/individual/scholar/note-drafts";

// COMPETEN-NOTEBOOK-001: on every page, so it holds whichever way a session ended, including where the Notebook's own sign-out never ran: another product's sign-out, an
// expired session, or another account on the same device. Asks who is signed in only when this device holds a draft, so nobody else loads the auth client for it.
export function NoteDraftGuard() {
  const path = usePathname();
  useEffect(() => {
    let store: Storage;
    try { store = window.localStorage; } catch { return; }
    void guardDrafts(store, async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const { data, error } = await createClient().auth.getSession();
        return { userId: data.session?.user.id ?? null, failed: !!error };
      } catch { return { userId: null, failed: true }; }
    }).catch(() => { /* the drafts stay, and the next page asks again */ });
  }, [path]);
  return null;
}
