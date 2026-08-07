// Feature-flag evaluation (LCP-001 §9). Resolves scope precedence:
//   tenant > cohort > plan > country > global assignment > flag default.
// The most specific matching assignment wins; the flag's default_on is the floor.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A FLAG HAS THREE STATES, NOT TWO. on, off, and "we could not work it out".
//
// This module used to answer with a bare boolean and one `catch { return false }`. Fail-closed, which is
// the right direction -- and completely silent, which is the wrong way to get there. Four different
// facts arrived at a caller as the single word `false`:
//
//   - an operator switched this off                        (a decision)
//   - nobody ever switched it on and the default is off     (a default)
//   - there is no flag by that name                         (a typo, or a key that was never seeded)
//   - the flag tables could not be read at all              (an outage)
//
// The first two are answers. The last two are the ABSENCE of an answer, and a product that renders them
// identically teaches its operators that the switch is broken when the database is, and that the
// database is fine when the key is misspelt.
//
// ⚠ AND ONE OF THEM WAS NOT EVEN FAIL-CLOSED. The assignments query's error was discarded with
// `(assigns ?? [])`, so an unreadable plat_feature_flag_assignments fell through to the flag's
// default_on. For a flag whose default is ON -- executive_intelligence is one, live, today -- that means
// a tenant the operator had explicitly switched OFF would come back ON the moment that one table could
// not be read. An unreadable assignment list is the one case where the default is provably the wrong
// answer, because the assignments are exactly the rows that would have overridden it. It is now
// `unresolved`, which is closed.
//
// flagState() is the honest resolver. flagEnabled() is kept as the boolean face of it, with identical
// closed-on-doubt behaviour, so a caller that only wants a yes/no is not forced to handle a decision
// object -- but a caller that renders anything to a human should use flagState() and say which of the
// three states it is in.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type FlagContext = { tenantId?: string | null; planCode?: string | null; country?: string | null; cohort?: string | null };

/** on = allowed. off = withheld, deliberately. unresolved = we do not know, so it is withheld. */
export type FlagState = "on" | "off" | "unresolved";

/** Which link in the precedence chain actually decided. Never inferred by a reader from the boolean. */
export type FlagDecidedBy =
  | "tenant" | "cohort" | "plan" | "country" | "global"   // an assignment decided
  | "flag_default"                                        // no assignment matched
  | "no_such_flag"                                        // the key is not in the catalogue
  | "unreadable";                                         // a query failed

export type FlagDecision = {
  key: string;
  state: FlagState;
  /** True ONLY for state "on". Both other states are closed. */
  enabled: boolean;
  decidedBy: FlagDecidedBy;
  /** The scope_ref of the winning assignment, where one won. */
  scopeRef: string | null;
  /** A sentence that is true today, safe to show an operator. Never empty. */
  reason: string;
};

const decision = (
  key: string, state: FlagState, decidedBy: FlagDecidedBy, reason: string, scopeRef: string | null = null,
): FlagDecision => ({ key, state, enabled: state === "on", decidedBy, scopeRef, reason });

const SCOPE_LABEL: Record<string, string> = {
  tenant: "this tenant", cohort: "this cohort", plan: "this plan", country: "this country", global: "every tenant",
};

/**
 * Resolve one flag, and say how.
 *
 * The context is what makes the precedence chain mean anything: a scope the caller does not supply
 * cannot win, so a gate that passes no tenantId can only ever be decided globally or by the default.
 */
export async function flagState(admin: any, key: string, ctx: FlagContext = {}): Promise<FlagDecision> {
  try {
    const [flagRes, assignRes] = await Promise.all([
      admin.from("plat_feature_flags").select("key, default_on").eq("key", key).maybeSingle(),
      admin.from("plat_feature_flag_assignments").select("scope_type, scope_ref, enabled").eq("flag_key", key),
    ]);

    // supabase-js resolves with {data:null, error} rather than throwing when a table is absent, so the
    // errors have to be read explicitly -- the catch below would never see them.
    if (flagRes.error)
      return decision(key, "unresolved", "unreadable",
        `the flag catalogue could not be read, so "${key}" is withheld rather than guessed: ${flagRes.error.message}`);
    if (!flagRes.data)
      return decision(key, "unresolved", "no_such_flag",
        `there is no feature flag called "${key}" in the catalogue, so nothing can switch it on. Withheld.`);
    if (assignRes.error)
      return decision(key, "unresolved", "unreadable",
        `"${key}" has a default, but the per-scope assignments that would override it could not be read, so the default cannot be trusted: ${assignRes.error.message}`);

    const rows = (assignRes.data ?? []) as { scope_type: string; scope_ref: string | null; enabled: boolean }[];
    const pick = (type: string, ref: string | null | undefined) =>
      rows.find(a => a.scope_type === type && (ref == null ? a.scope_ref == null : a.scope_ref === ref));

    const chain: { type: string; ref: string | null }[] = [
      ...(ctx.tenantId != null ? [{ type: "tenant", ref: ctx.tenantId }] : []),
      ...(ctx.cohort != null ? [{ type: "cohort", ref: ctx.cohort }] : []),
      ...(ctx.planCode != null ? [{ type: "plan", ref: ctx.planCode }] : []),
      ...(ctx.country != null ? [{ type: "country", ref: ctx.country }] : []),
      { type: "global", ref: null },
    ];

    for (const link of chain) {
      const hit = pick(link.type, link.ref);
      if (!hit) continue;
      return decision(
        key, hit.enabled ? "on" : "off", link.type as FlagDecidedBy,
        `switched ${hit.enabled ? "on" : "off"} for ${SCOPE_LABEL[link.type] ?? link.type}${link.ref ? ` (${link.ref})` : ""}`,
        link.ref,
      );
    }

    const on = !!flagRes.data.default_on;
    return decision(key, on ? "on" : "off", "flag_default",
      `no assignment matches this context, so the flag's own default (${on ? "on" : "off"}) decides`);
  } catch (e: any) {
    return decision(key, "unresolved", "unreadable",
      `"${key}" could not be evaluated, so it is withheld: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}

/**
 * The boolean face of flagState. Closed on doubt, exactly as before -- but a caller that shows anything
 * to a person should prefer flagState() so that "off" and "we could not tell" do not render alike.
 */
export async function flagEnabled(admin: any, key: string, ctx: FlagContext = {}): Promise<boolean> {
  return (await flagState(admin, key, ctx)).enabled;
}

/**
 * The context a tenant-plane gate needs, built from live rows: profiles.tenant_id, the tenant's country
 * and its subscribed plan code.
 *
 * ⚠ IT REPORTS FAILURE RATHER THAN RETURNING AN EMPTY CONTEXT. An empty context is not a neutral one --
 * it removes the tenant, plan and country links from the precedence chain, so a flag an operator
 * switched OFF for one tenant would silently resolve at the global scope or the default instead. A
 * context that could not be built is therefore an `unresolved` input, and the gate below treats it as
 * one.
 *
 * `country` is passed through EXACTLY as the tenants row holds it. Live rows hold full country names
 * ("Kenya", "Mauritius"), while the assignment UI's placeholder suggests ISO-2 -- so a country-scoped
 * assignment written as "KE" will not match, and the decision will honestly report that the default
 * decided rather than pretending the assignment applied. Normalising here would hide that mismatch
 * instead of surfacing it.
 */
export async function tenantFlagContext(admin: any, userId: string): Promise<
  { ok: true; ctx: FlagContext } | { ok: false; reason: string }
> {
  const { data: profile, error } = await admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (error) return { ok: false, reason: `the caller's tenant could not be read: ${error.message}` };
  const tenantId = (profile?.tenant_id as string | null) ?? null;
  if (!tenantId) return { ok: true, ctx: {} };

  // Country and plan are enrichment: a failure here narrows the chain rather than falsifying it, but it
  // still has to be visible, so each is only added when it was actually read.
  const [tenantRes, subRes] = await Promise.all([
    admin.from("tenants").select("primary_country").eq("id", tenantId).maybeSingle(),
    admin.from("plat_subscriptions").select("plan_id, status").eq("tenant_id", tenantId).eq("status", "active").limit(1),
  ]);
  if (tenantRes.error) return { ok: false, reason: `the tenant record could not be read: ${tenantRes.error.message}` };
  if (subRes.error) return { ok: false, reason: `the tenant's plan could not be read: ${subRes.error.message}` };

  let planCode: string | null = null;
  const planId = ((subRes.data ?? []) as any[])[0]?.plan_id ?? null;
  if (planId) {
    const { data: plan, error: planErr } = await admin.from("plat_plans").select("code").eq("id", planId).maybeSingle();
    if (planErr) return { ok: false, reason: `the tenant's plan could not be read: ${planErr.message}` };
    planCode = (plan?.code as string) ?? null;
  }

  return { ok: true, ctx: { tenantId, country: (tenantRes.data?.primary_country as string) ?? null, planCode } };
}

/**
 * ONE GATE, END TO END. Resolve the caller's scope and then the flag, collapsing a failure at either
 * step into the same `unresolved` state -- because to the person looking at a switched-off module, "we
 * could not tell which tenant you are" and "we could not read the flag" are the same fact: nobody
 * decided this, so it is withheld.
 */
export async function gateFor(admin: any, key: string, userId: string): Promise<FlagDecision> {
  const scope = await tenantFlagContext(admin, userId);
  if (!scope.ok)
    return decision(key, "unresolved", "unreadable",
      `"${key}" could not be evaluated for this user, so it is withheld: ${scope.reason}`);
  return flagState(admin, key, scope.ctx);
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

/**
 * ⚠ THE CATALOGUE IS NOT THE SAME THING AS A LIST OF LIVE GATES.
 *
 * Five keys are seeded; for a long time NONE of them was read by anything, and the flag page said "these
 * switches work" over a resolver with no callers. This list is the honest answer to "what does throwing
 * this switch actually do", and the page renders it against the catalogue so an unwired key is visibly
 * unwired rather than presumed live. Adding a gate means adding a line here, in the same change.
 */
export const WIRED_GATES: Record<string, string> = {
  executive_intelligence: "Hospital Executive → Executive Intelligence (/hospital-executive/intelligence)",
};
