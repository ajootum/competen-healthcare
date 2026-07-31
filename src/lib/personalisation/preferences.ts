// Personalisation, Preferences & Workspace Experience (UMW-TLS-005) — migration 164.
//
// ONE RESOLVER, THREE LAYERS: catalogue default -> policy default (platform/tenant/hospital/unit/role) ->
// the person's own value. Each resolved preference reports WHERE its value came from and whether the person
// is allowed to change it, because "enterprise defaults inherited, permitted user overrides configurable" is
// meaningless if the surface cannot tell someone why a setting is locked.
//
// The scope vocabulary deliberately mirrors the Workspace Configuration Engine's, and module show/hide is NOT
// reimplemented here — that already resolves through workspace_config_overrides at user scope. A second
// visibility mechanism would let a personal view disagree with what the tenant actually enabled.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type PrefType = "enum" | "boolean" | "text";
export type PrefKey = keyof typeof CATALOGUE;

export type PrefDef = {
  label: string;
  group: "appearance" | "accessibility" | "regional" | "notifications" | "ai" | "workspace";
  type: PrefType;
  options?: string[];
  fallback: string | boolean | null;
  blurb: string;
};

// The catalogue is the contract: a key not here cannot be written, whatever a client sends.
export const CATALOGUE = {
  theme:          { label: "Theme", group: "appearance", type: "enum", options: ["light", "dark", "system"], fallback: "system",
                    blurb: "Light, dark, or follow the device setting." },
  density:        { label: "Density", group: "appearance", type: "enum", options: ["standard", "compact", "spacious"], fallback: "standard",
                    blurb: "How much space rows and cards take." },
  font_scale:     { label: "Text size", group: "accessibility", type: "enum", options: ["small", "standard", "large", "x-large"], fallback: "standard",
                    blurb: "Scales body text across the workspace." },
  reduced_motion: { label: "Reduce motion", group: "accessibility", type: "boolean", fallback: false,
                    blurb: "Suppresses transitions and animated transforms." },
  high_contrast:  { label: "High contrast", group: "accessibility", type: "boolean", fallback: false,
                    blurb: "Stronger borders and text contrast." },
  language:       { label: "Language", group: "regional", type: "enum", options: ["en", "fr", "ar", "sw"], fallback: "en",
                    blurb: "Interface language." },
  timezone:       { label: "Time zone", group: "regional", type: "text", fallback: "Africa/Nairobi",
                    blurb: "Used for shift times and timestamps." },
  date_format:    { label: "Date format", group: "regional", type: "enum", options: ["iso", "dmy", "mdy"], fallback: "dmy",
                    blurb: "How dates are written." },
  time_format:    { label: "Time format", group: "regional", type: "enum", options: ["12h", "24h"], fallback: "24h",
                    blurb: "Clock format for shift and event times." },
  email_digest:   { label: "Email digest", group: "notifications", type: "enum", options: ["daily", "weekly", "none"], fallback: "daily",
                    blurb: "How often a summary email is sent." },
  ai_suggestions: { label: "AI suggestions", group: "ai", type: "boolean", fallback: true,
                    blurb: "Whether copilots offer unprompted suggestions." },
  ai_verbosity:   { label: "AI detail", group: "ai", type: "enum", options: ["brief", "standard", "detailed"], fallback: "standard",
                    blurb: "How much explanation AI answers include." },
  landing_route:  { label: "Landing page", group: "workspace", type: "text", fallback: null,
                    blurb: "Where this workspace opens. Blank uses the workspace dashboard." },
} satisfies Record<string, PrefDef>;

export const PREF_KEYS = Object.keys(CATALOGUE) as PrefKey[];
export const GROUPS: { key: PrefDef["group"]; label: string }[] = [
  { key: "appearance", label: "Theme & display" },
  { key: "accessibility", label: "Accessibility" },
  { key: "regional", label: "Language & region" },
  { key: "notifications", label: "Notifications" },
  { key: "ai", label: "AI behaviour" },
  { key: "workspace", label: "Workspace" },
];

// Least -> most specific. Same ordering the configuration engine uses, on purpose.
const SCOPE_ORDER: Record<string, number> = { platform: 0, tenant: 1, hospital: 2, unit: 3, role: 4 };

export type PolicyRow = { scope_type: string; scope_ref: string | null; pref_key: string; default_value: string | null; user_editable: boolean; note: string | null };
export type PrefCtx = { hospitalId?: string | null; unitId?: string | null; roles?: string[] };

export type Resolved = {
  key: PrefKey; def: PrefDef;
  value: string | boolean | null;
  source: "user" | "policy" | "default";
  editable: boolean;
  lockedBy: string | null;   // scope that forbade the override, so the surface can say WHY
  policyDefault: string | null;
  note: string | null;
};

const policyApplies = (p: PolicyRow, ctx: PrefCtx): boolean => {
  switch (p.scope_type) {
    case "platform": return true;
    case "tenant": return !!ctx.hospitalId;                       // no tenant column on profiles yet - hospital stands in
    case "hospital": return !!ctx.hospitalId && p.scope_ref === ctx.hospitalId;
    case "unit": return !!ctx.unitId && p.scope_ref === ctx.unitId;
    case "role": return (ctx.roles ?? []).some(r => r === p.scope_ref);
    default: return false;
  }
};

const coerce = (def: PrefDef, raw: string | null): string | boolean | null => {
  if (raw == null) return null;
  if (def.type === "boolean") return raw === "true";
  if (def.type === "enum" && def.options && !def.options.includes(raw)) return null;
  return raw;
};

export function resolvePreferences(policies: PolicyRow[], own: Record<string, any> | null, ctx: PrefCtx): Resolved[] {
  return PREF_KEYS.map(key => {
    const def = CATALOGUE[key] as PrefDef;
    const applicable = policies
      .filter(p => p.pref_key === key && policyApplies(p, ctx))
      .sort((a, b) => (SCOPE_ORDER[a.scope_type] ?? 99) - (SCOPE_ORDER[b.scope_type] ?? 99));

    // Most specific applicable policy wins for the DEFAULT. Editability is stricter: a lock at ANY
    // applicable scope holds. A hospital that forbids a change cannot be unlocked by a role-level policy
    // beneath it, because the narrower rule would otherwise quietly reverse the broader one.
    const last = applicable[applicable.length - 1];
    const locking = applicable.find(p => !p.user_editable) ?? null;
    const policyDefault = applicable.map(p => p.default_value).filter(v => v != null).pop() ?? null;

    const ownRaw = own?.[key];
    const ownValue = ownRaw == null ? null : coerce(def, String(ownRaw));
    const editable = !locking;

    // A locked preference ignores any stored personal value: policy wins, and the surface says so.
    const value = !editable ? (coerce(def, policyDefault) ?? def.fallback)
      : ownValue !== null ? ownValue
      : (coerce(def, policyDefault) ?? def.fallback);

    return {
      key, def, value,
      source: !editable ? "policy" : ownValue !== null ? "user" : policyDefault != null ? "policy" : "default",
      editable, lockedBy: locking?.scope_type ?? null,
      policyDefault, note: locking?.note ?? last?.note ?? null,
    };
  });
}

// Validate one write against the catalogue AND the resolved policy. Returns the value to store, or a reason.
export function validateWrite(key: string, value: any, resolved: Resolved[]): { ok: true; stored: string | null } | { ok: false; reason: string } {
  const r = resolved.find(x => x.key === key);
  if (!r) return { ok: false, reason: `${key} is not a recognised preference.` };
  if (!r.editable) return { ok: false, reason: `${r.def.label} is set by your ${r.lockedBy} and cannot be changed here.` };
  if (value === null || value === "") return { ok: true, stored: null };   // clearing falls back to the policy default
  const def = r.def;
  if (def.type === "boolean") {
    if (typeof value !== "boolean") return { ok: false, reason: `${def.label} expects true or false.` };
    return { ok: true, stored: String(value) };
  }
  const s = String(value);
  if (def.type === "enum" && def.options && !def.options.includes(s)) return { ok: false, reason: `${def.label} must be one of ${def.options.join(", ")}.` };
  if (s.length > 60) return { ok: false, reason: `${def.label} is too long.` };
  return { ok: true, stored: s };
}

const soft = (p: any) => p.then((r: any) => r, () => ({ data: null, error: true }));

export async function loadPersonalisation(admin: any, userId: string, ctx: PrefCtx, workspace = "unit-manager") {
  const [prefRes, polRes, viewRes, auditRes, notifRes] = await Promise.all([
    soft(admin.from("user_preferences").select("*").eq("user_id", userId).maybeSingle()),
    soft(admin.from("pref_policies").select("scope_type, scope_ref, pref_key, default_value, user_editable, note").limit(500)),
    soft(admin.from("user_saved_views").select("id, workspace, name, route, filters, is_default, created_at")
      .eq("user_id", userId).eq("workspace", workspace).order("created_at", { ascending: false })),
    soft(admin.from("user_preference_audit").select("pref_key, old_value, new_value, source, created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(20)),
    soft(admin.from("notification_preferences").select("in_app, email, sms, push, quiet_from, quiet_to, min_priority, muted_categories")
      .eq("user_id", userId).maybeSingle()),
  ]);

  // provisioned=false means migration 164 has not been applied. Every surface must say that rather than
  // showing a tidy set of defaults that look like saved choices.
  const provisioned = !prefRes.error && !polRes.error;
  const policies = (polRes.data ?? []) as PolicyRow[];
  const own = (prefRes.data ?? null) as Record<string, any> | null;
  const resolved = resolvePreferences(policies, own, ctx);

  const views = (viewRes.data ?? []) as any[];
  return {
    provisioned,
    storedForUser: !!own,
    resolved,
    byGroup: GROUPS.map(g => ({ ...g, items: resolved.filter(r => r.def.group === g.key) })).filter(g => g.items.length),
    counts: {
      total: resolved.length,
      personalised: resolved.filter(r => r.source === "user").length,
      governed: resolved.filter(r => r.source === "policy").length,
      locked: resolved.filter(r => !r.editable).length,
    },
    policies: policies.filter(p => PREF_KEYS.includes(p.pref_key as PrefKey)),
    views, defaultView: views.find(v => v.is_default) ?? null,
    audit: (auditRes.data ?? []) as any[],
    notificationPrefs: (notifRes.data ?? null) as any,
    updatedAt: own?.updated_at ?? null,
  };
}

export const prefValue = (resolved: Resolved[], key: PrefKey) => resolved.find(r => r.key === key)?.value ?? (CATALOGUE[key] as PrefDef).fallback;
