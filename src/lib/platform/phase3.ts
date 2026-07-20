// Phase 3 loaders — the 5 remaining internal-staff workspaces (Product,
// Engineering, AI Ops, Quality, Security), plus Deployments (release log) and
// Identity (per-tenant IdP config). All platform-wide, landlord-gated, defensive.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Product (PRD-001): product catalogue + feature-flag enablement ───────────
export async function loadProduct(admin: any) {
  try {
    const [{ data: products, error }, { data: flags }, { data: assigns }] = await Promise.all([
      admin.from("plat_products").select("code, name, description, is_core, default_on, sort").order("sort"),
      admin.from("plat_feature_flags").select("key, product_code"),
      admin.from("plat_feature_flag_assignments").select("flag_key").limit(20000),
    ]);
    if (error) return { ready: false, products: [] as any[] };
    const flagProduct = new Map<string, string | null>((flags ?? []).map((f: any) => [f.key, f.product_code ?? null]));
    const flagByProduct = new Map<string, number>();
    for (const a of assigns ?? []) { const pc = flagProduct.get(a.flag_key); if (pc) flagByProduct.set(pc, (flagByProduct.get(pc) ?? 0) + 1); }
    return { ready: true, products: (products ?? []).map((p: any) => ({ ...p, flag_assignments: flagByProduct.get(p.code) ?? 0 })) };
  } catch { return { ready: false, products: [] as any[] }; }
}

// ── Engineering (ENG-001): release log + platform scale ──────────────────────
export async function loadEngineering(admin: any) {
  try {
    const [{ data: deploys, error }, { count: tenants }, { count: users }] = await Promise.all([
      admin.from("plat_deployments").select("version, channel, status, notes, released_at, created_at").order("created_at", { ascending: false }).limit(50),
      admin.from("tenants").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }),
    ]);
    if (error) return { ready: false, deployments: [] as any[], current: null as any, tenants: 0, users: 0 };
    const rows = deploys ?? [];
    const current = rows.find((d: any) => d.status === "released") ?? null;
    return { ready: true, deployments: rows, current, tenants: tenants ?? 0, users: users ?? 0 };
  } catch { return { ready: false, deployments: [] as any[], current: null as any, tenants: 0, users: 0 }; }
}

// ── AI Ops (AIS-001): provider status + AI usage ─────────────────────────────
export async function loadAiOps(admin: any) {
  const ai = await import("@/lib/ai/config").then((m: any) => m.aiStatus?.() ?? { configured: false, provider: null }).catch(() => ({ configured: false, provider: null }));
  const live = !!ai.configured && ai.provider === "anthropic";
  let events30d = 0, eventsTotal = 0;
  try {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [{ count: c30 }, { count: cAll }] = await Promise.all([
      admin.from("audit_log").select("id", { count: "exact", head: true }).like("action", "ai_%").gte("created_at", since),
      admin.from("audit_log").select("id", { count: "exact", head: true }).like("action", "ai_%"),
    ]);
    events30d = c30 ?? 0; eventsTotal = cAll ?? 0;
  } catch { /* ignore */ }
  return { configured: ai.configured, provider: ai.provider ?? null, live, events30d, eventsTotal };
}

// ── Quality (QLT-001): platform-wide quality posture ─────────────────────────
export async function loadQuality(admin: any) {
  const q = async (t: string, qs?: (x: any) => any) => { try { let b = admin.from(t).select("id", { count: "exact", head: true }); if (qs) b = qs(b); const { count } = await b; return count ?? 0; } catch { return 0; } };
  const audits = await q("audits");
  const auditsCompleted = await q("audits", (b: any) => b.eq("status", "completed"));
  const capaOpen = await q("capa_actions", (b: any) => b.not("status", "in", "(completed,verified,closed)"));
  const improvements = await q("improvement_objects");
  let masterStandards = 0;
  try { const { count } = await admin.from("frameworks").select("id", { count: "exact", head: true }).is("hospital_id", null).eq("is_active", true); masterStandards = count ?? 0; } catch { /* ignore */ }
  return { audits, auditsCompleted, capaOpen, improvements, masterStandards };
}

// ── Security (SEC-001): SOC view over audit + event streams ───────────────────
const SECURITY_RE = /(login|logout|sign_in|sign_out|mfa|password|delete|suspend|archive|restore|role|permission|access|invite|deactivat|reactivat|security|threat)/i;
export async function loadSecurity(admin: any) {
  const out = { landlordActions: [] as any[], platformSecEvents: [] as any[], tenantSecEvents: [] as any[], critical: 0, warning: 0 };
  try {
    const { data: la } = await admin.from("plat_audit_events").select("actor_name, action, entity_name, tenant_id, created_at").order("created_at", { ascending: false }).limit(30);
    out.landlordActions = la ?? [];
  } catch { /* ignore */ }
  try {
    // The list is a recent window; the headline counts are true totals.
    const [{ data: ev }, { count: cCrit }, { count: cWarn }] = await Promise.all([
      admin.from("plat_platform_events").select("event_type, severity, tenant_id, created_at").in("severity", ["warning", "critical"]).order("created_at", { ascending: false }).limit(50),
      admin.from("plat_platform_events").select("id", { count: "exact", head: true }).eq("severity", "critical"),
      admin.from("plat_platform_events").select("id", { count: "exact", head: true }).eq("severity", "warning"),
    ]);
    out.platformSecEvents = ev ?? [];
    out.critical = cCrit ?? 0;
    out.warning = cWarn ?? 0;
  } catch { /* ignore */ }
  try {
    const { data: ta } = await admin.from("audit_log").select("actor_name, action, entity_name, created_at").order("created_at", { ascending: false }).limit(400);
    out.tenantSecEvents = (ta ?? []).filter((r: any) => r.action && SECURITY_RE.test(r.action)).slice(0, 25);
  } catch { /* ignore */ }
  return out;
}

// ── Deployments (control plane) + Identity ───────────────────────────────────
export async function loadDeployments(admin: any) {
  try {
    const { data, error } = await admin.from("plat_deployments").select("id, version, channel, status, notes, released_at, created_at").order("created_at", { ascending: false }).limit(100);
    if (error) return { ready: false, deployments: [] as any[], current: null as any };
    const rows = data ?? [];
    return { ready: true, deployments: rows, current: rows.find((d: any) => d.status === "released") ?? null };
  } catch { return { ready: false, deployments: [] as any[], current: null as any }; }
}

export async function loadIdentity(admin: any) {
  try {
    const [{ data: configs, error }, { data: tenants }] = await Promise.all([
      admin.from("plat_idp_configs").select("id, tenant_id, protocol, provider, mfa_required, scim_enabled, is_active").limit(3000),
      admin.from("tenants").select("id, name").not("status", "in", "(archived,deleted)").order("name").limit(3000),
    ]);
    if (error) return { ready: false, configs: [] as any[], tenants: [] as any[] };
    const name = new Map<string, string>((tenants ?? []).map((t: any) => [t.id, t.name]));
    return {
      ready: true,
      configs: (configs ?? []).map((c: any) => ({ ...c, tenant_name: name.get(c.tenant_id) ?? "—" })),
      tenants: (tenants ?? []).map((t: any) => ({ id: t.id, name: t.name })),
    };
  } catch { return { ready: false, configs: [] as any[], tenants: [] as any[] }; }
}
