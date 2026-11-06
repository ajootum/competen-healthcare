import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClientOrNull, createClient } from "@/lib/supabase/server";
import { currentTraceId } from "@/lib/trace";
import { LifeosError } from "../../core/errors";
import { ISSUER_COMPETEN_AUTH, readActiveIndividual } from "../../core/provision";
import type { LifeosStore, Principal } from "../../core/types";
import { supabaseStore } from "../supabase-store";

// ADR-018. THE ONLY FILE IN LIFEOS THAT IMPORTS FROM THE REST OF COMPETEN (scripts/lifeos-seal-harness.ts holds this).
// A carve-out replaces this one file.
//
// NOT getCaller() and NOT requireIndividualContext(). LifeOS is its own product gate. Holding a Competen account or
// a Competen Individual membership grants no LifeOS access, and holding LifeOS grants neither of those.

/** Null when the service key is unavailable (Vercel Preview, a mis-set rotation), which counts as the gate off. */
export function lifeosStore(): LifeosStore | null {
  const admin = createAdminClientOrNull() as unknown as SupabaseClient | null;
  return admin ? supabaseStore(admin) : null;
}

export const lifeosTraceId = currentTraceId;

/**
 * The route boundary (registered in scripts/auth-boundary-harness.ts). Absence of an identity link means no access,
 * and a signed-in person with no link is refused rather than provisioned.
 */
export async function requireLifeosPrincipal(store: LifeosStore): Promise<Principal> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new LifeosError("unauthenticated", "Sign in to use LifeOS.");
  const individual = await readActiveIndividual(store, ISSUER_COMPETEN_AUTH, user.id);
  return { kind: "session", individualId: String(individual.id), scopes: "*", clientId: null };
}
