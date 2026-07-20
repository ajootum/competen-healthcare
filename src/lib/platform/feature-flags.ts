// Feature-flag evaluation (LCP-001 §9). Resolves scope precedence:
//   tenant > cohort > plan > country > global assignment > flag default.
// The most specific matching assignment wins; the flag's default_on is the floor.
// Defensive: if the tables don't exist yet (pre-migration), returns the safe
// default (flag default_on if known, else false).
/* eslint-disable @typescript-eslint/no-explicit-any */

export type FlagContext = { tenantId?: string | null; planCode?: string | null; country?: string | null; cohort?: string | null };

export async function flagEnabled(admin: any, key: string, ctx: FlagContext = {}): Promise<boolean> {
  try {
    const [{ data: flag }, { data: assigns }] = await Promise.all([
      admin.from("plat_feature_flags").select("key, default_on").eq("key", key).maybeSingle(),
      admin.from("plat_feature_flag_assignments").select("scope_type, scope_ref, enabled").eq("flag_key", key),
    ]);
    if (!flag) return false;
    const rows = (assigns ?? []) as { scope_type: string; scope_ref: string | null; enabled: boolean }[];
    const pick = (type: string, ref: string | null | undefined): boolean | undefined => {
      const m = rows.find(a => a.scope_type === type && (ref == null ? a.scope_ref == null : a.scope_ref === ref));
      return m ? m.enabled : undefined;
    };
    const chain: (boolean | undefined)[] = [
      ctx.tenantId != null ? pick("tenant", ctx.tenantId) : undefined,
      ctx.cohort != null ? pick("cohort", ctx.cohort) : undefined,
      ctx.planCode != null ? pick("plan", ctx.planCode) : undefined,
      ctx.country != null ? pick("country", ctx.country) : undefined,
      pick("global", null),
    ];
    for (const v of chain) if (v !== undefined) return v;
    return !!flag.default_on;
  } catch {
    return false;
  }
}

// Load the flag catalogue with a per-flag effective-count summary (for the UI).
export async function loadFeatureFlags(admin: any) {
  try {
    const [{ data: flags, error }, { data: assigns }, { data: products }] = await Promise.all([
      admin.from("plat_feature_flags").select("key, description, default_on, product_code").order("key"),
      admin.from("plat_feature_flag_assignments").select("flag_key, scope_type, scope_ref, enabled").order("created_at", { ascending: false }),
      admin.from("plat_products").select("code, name"),
    ]);
    // supabase-js resolves with {data:null, error} (no throw) when the table is
    // absent — surface that as not-ready so the "apply migrations" banner shows.
    if (error) return { ready: false, flags: [] as any[] };
    const prodName = new Map<string, string>((products ?? []).map((p: any) => [p.code, p.name]));
    const byFlag = new Map<string, any[]>();
    for (const a of assigns ?? []) { const arr = byFlag.get(a.flag_key) ?? []; arr.push(a); byFlag.set(a.flag_key, arr); }
    return {
      ready: true,
      flags: (flags ?? []).map((f: any) => ({
        ...f, product_name: f.product_code ? prodName.get(f.product_code) ?? f.product_code : null,
        assignments: byFlag.get(f.key) ?? [],
      })),
    };
  } catch {
    return { ready: false, flags: [] as any[] };
  }
}
