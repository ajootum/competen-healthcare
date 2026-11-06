import { createClient } from "@/lib/supabase/client";

// ADR-018. The sign-in provider, seen from the browser. The interface's only link to it, so a carve-out replaces this file.

export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false }> {
  const { error } = await createClient().auth.signInWithPassword({ email, password });
  return error ? { ok: false } : { ok: true };
}

export async function signOut(): Promise<void> {
  await createClient().auth.signOut({ scope: "local" });
}
