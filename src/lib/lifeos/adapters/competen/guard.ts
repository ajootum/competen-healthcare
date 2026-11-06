import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClientOrNull, createClient } from "@/lib/supabase/server";
import { currentTraceId } from "@/lib/trace";
import { LifeosError } from "../../core/errors";
import { ISSUER_COMPETEN_AUTH, readActiveIndividual } from "../../core/provision";
import type { LifeosStore, Principal } from "../../core/types";
import { supabaseStore } from "../supabase-store";
import { LIFEOS_CORE_FLAG } from "../../api/dispatch";
import type { SessionIdentity } from "../../core/optin";
import { type TenantSite, resolveTenantSite } from "../../core/tenants";
import { LIFEOS_TENANT_HOSTS_ENV, isFirstPartyHost, normaliseHost } from "../../host";

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
  const individual = await readActiveIndividual(store, ISSUER_COMPETEN_AUTH, user.id, async e => (
    e.source === "competen_individual" ? competenIndividualLive(user.id) : true
  ));
  return { kind: "session", individualId: String(individual.id), scopes: "*", clientId: null };
}

/**
 * The one question LifeOS asks of Competen Individual: does this person hold a live entitlement? It reads a yes or no
 * and nothing about what they do there. A failed read is no.
 */
async function competenIndividualLive(userId: string): Promise<boolean> {
  const admin = createAdminClientOrNull() as unknown as SupabaseClient | null;
  if (!admin) return false;
  try {
    const { data, error } = await admin.from("individual_live_entitlement").select("user_id").eq("user_id", userId).limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/** Who is signed in, for the opt-in door. It grants nothing. */
export async function requireLifeosSession(): Promise<SessionIdentity> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new LifeosError("unauthenticated", "Sign in to use LifeOS.");
  const admin = createAdminClientOrNull() as unknown as SupabaseClient | null;
  const profile = admin ? (await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle()).data : null;
  return {
    issuer: ISSUER_COMPETEN_AUTH,
    subject: user.id,
    displayName: String(profile?.full_name ?? "").trim() || "LifeOS member",
    email: user.email ?? null,
    competenIndividualLive: await competenIndividualLive(user.id),
  };
}

export type LifeosShell = "DISABLED" | "AUTH_REQUIRED" | "NO_ACCESS" | "READY";

/** For the interface page: the same gate and the same admission as the API, in the same order. */
export async function resolveLifeosShell(): Promise<LifeosShell> {
  const store = lifeosStore();
  if (!store) return "DISABLED";
  try {
    if (!(await store.flagEnabled(LIFEOS_CORE_FLAG))) return "DISABLED";
  } catch {
    return "DISABLED";
  }
  try {
    await requireLifeosPrincipal(store);
    return "READY";
  } catch (e) {
    if (e instanceof LifeosError && e.code === "unauthenticated") return "AUTH_REQUIRED";
    if (e instanceof LifeosError && e.code === "forbidden") return "NO_ACCESS";
    return "DISABLED";
  }
}

export type HostSite = { kind: "first_party" } | { kind: "tenant"; site: TenantSite } | { kind: "none" };

/** What this request's host is. A host that is neither ours nor a tenant's verified, active domain serves nothing. */
export async function resolveHostSite(): Promise<HostSite> {
  const host = normaliseHost((await headers()).get("host"));
  if (!host || isFirstPartyHost(host)) return { kind: "first_party" };
  if (process.env[LIFEOS_TENANT_HOSTS_ENV] !== "1") return { kind: "none" };
  const store = lifeosStore();
  if (!store) return { kind: "none" };
  try {
    const site = await resolveTenantSite(store, host);
    return site ? { kind: "tenant", site } : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

/** The signed-in address, for the invitation page. It grants nothing. */
export async function readSignedInEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}
