import { createClient, createAdminClient } from "@/lib/supabase/server";
import { admitToEnterprise, enterpriseRefusalSentence } from "@/lib/enterprise-membership";

// The PAGE-side resolver for the Enterprise tenant workspace -- resolvePracticeShell one plane over.
// ENT-DEC-001 D5: the walkable slice. Routes use requireEnterpriseContext; pages use this.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ D12: scan.ts LEARNED resolveEnterpriseShell IN THE SAME COMMIT THAT CREATED IT -- a shell resolver
// is a new gate idiom, and the practice shell's own history shows what an untaught idiom produces:
// SIXTY pages reported as reachable without signing in the moment the matrix went page-granular.
//
// ⚠ FAIL-CLOSED THROUGHOUT, unlike resolvePracticeShell's estate cousin. Gate 3's reasoning
// (enterprise-membership.ts): there is no role gate underneath this surface, so an unreadable store
// REFUSES -- with a sentence that says to try again, because the person refused by an outage must be
// able to tell it from a genuine no.
//
// ⚠ THE TENANT COMES FROM THE CALLER'S OWN PROFILE, NOT FROM THE URL. ENT-NAV-001 s8 wants
// /enterprise/{tenant-key}/ routes and s12 wants tenant switching; both arrive with the multi-tenant
// navigation slice. Until then one account resolves to its one tenant, and a URL cannot name somebody
// else's -- which is the safe end to start from, because widening later is additive while narrowing
// later is a lockout.

export type EnterpriseShell =
  | { state: "AUTH_REQUIRED" }
  /** Signed in, no tenant on the profile. A real person on the wrong product, not an error. */
  | { state: "NO_TENANT" }
  /** Signed in, tenant known, gate 3 refused. The sentence distinguishes outage from genuine no. */
  | { state: "REFUSED"; sentence: string }
  | {
      state: "READY";
      userId: string;
      tenantId: string;
      tenantName: string | null;
      subproducts: EnterpriseSubproduct[];
      /** ⚠ True when the catalogue read failed. The nav renders the fact, never an empty list as fact. */
      subproductsUnavailable: boolean;
    };

export type EnterpriseSubproduct = {
  code: string;
  name: string;
  description: string;
  sort: number;
};

export async function resolveEnterpriseShell(): Promise<EnterpriseShell> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "AUTH_REQUIRED" };

  const admin = createAdminClient();
  const { data: me, error: meErr } = await admin.from("profiles")
    .select("tenant_id").eq("id", user.id).maybeSingle();
  // ⚠ An unreadable profile is a REFUSAL here, not a NO_TENANT: the two produce different pages, and
  // telling somebody they are on the wrong product because a read failed sends them away for good.
  if (meErr) return { state: "REFUSED", sentence: enterpriseRefusalSentence({ state: "unreadable", status: null, detail: meErr.message }) };
  if (!me?.tenant_id) return { state: "NO_TENANT" };

  const { admitted, read } = await admitToEnterprise(admin, user.id, me.tenant_id);
  if (!admitted) return { state: "REFUSED", sentence: enterpriseRefusalSentence(read) };

  // The tenant's name, for the header. Optional: a failed read here degrades to no name, never to no page.
  const { data: tenant } = await admin.from("tenants").select("name").eq("id", me.tenant_id).maybeSingle();

  // The catalogue for the nav. ⚠ A failed read is NOT an empty catalogue -- eight sub-products
  // rendered as none would read as a broken product, so the flag travels and the nav says so.
  const { data: subs, error: subErr } = await admin.from("plat_enterprise_subproduct")
    .select("code, name, description, sort").eq("is_active", true).order("sort");

  return {
    state: "READY",
    userId: user.id,
    tenantId: me.tenant_id,
    tenantName: (tenant?.name as string) ?? null,
    subproducts: (subs ?? []) as EnterpriseSubproduct[],
    subproductsUnavailable: !!subErr || subs == null,
  };
}

// ⚠ ENTERPRISE_BUILT_SUBPRODUCTS and ENTERPRISE_NOT_BUILT_REASON live in enterprise-constants.ts, NOT
// here, because this module imports next/headers through the supabase server client -- and an import
// pulls the module, not the binding. The harness importing one constant from this file would have been
// this morning's 500 arriving in node. See enterprise-constants.ts.
