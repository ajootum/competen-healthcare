import { createClient } from "@/lib/supabase/client";

// ADR-018. The sign-in provider, seen from the browser. The interface's only link to it, so a carve-out replaces this file.

export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false }> {
  const { error } = await createClient().auth.signInWithPassword({ email, password });
  return error ? { ok: false } : { ok: true };
}

export async function signOut(): Promise<void> {
  await createClient().auth.signOut({ scope: "local" });
}

/**
 * For someone new: an email link to the invited address, with no password. A password chosen at sign-up would let whoever
 * held the invitation link set the invitee's password before they confirmed the address.
 */
export async function emailMeALink(email: string, returnTo: string): Promise<boolean> {
  const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: returnTo, shouldCreateUser: true } });
  return !error;
}

/** Sets a password for the signed-in person, once they have proved they control the address. */
export async function choosePassword(password: string): Promise<boolean> {
  const { error } = await createClient().auth.updateUser({ password });
  return !error;
}
