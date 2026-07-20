// Platform Super Admin Workspace data (PSA-001) — platform-wide operational
// control: tenant lifecycle, platform analytics, security/audit and AI ops.
//
// This is a super_admin-only, platform-wide view (no tenant scoping — the super
// admin legitimately sees everything). HONEST-UI: Competen runs on managed cloud
// (Vercel + Supabase) and has NO in-app infrastructure telemetry — CPU, memory,
// queues, containers and uptime are not measured here, so those modules are
// explicit "no telemetry" surfaces rather than fabricated gauges. Only what the
// database genuinely knows (tenants, users, audit trail, AI configuration) drives
// live figures.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Tenant = { id: string; name: string | null; active: boolean; type: string | null; country: string | null; created_at: string | null; facilities: number; users: number };
export type AuditRow = { actor_name: string | null; action: string | null; entity_name: string | null; entity_type: string | null; created_at: string | null };
export type Bar = { label: string; count: number };

// Security-relevant admin actions we can surface from the audit trail.
const SECURITY_RE = /(login|logout|sign_in|sign_out|mfa|password|delete|suspend|archive|restore|role|permission|access|invite|deactivat|reactivat)/i;

export async function loadPlatformAdmin(admin: any) {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 864e5).toISOString();
  const d30 = iso(30), d90 = iso(90);

  // ── Tenants (organisations) + facilities + users ───────────────────────────
  const [{ data: orgsRaw, error: orgsErr }, { data: hosps }, { data: profs }] = await Promise.all([
    admin.from("organisations").select("id, name, is_active, type, hq_country, created_at").limit(5000),
    admin.from("hospitals").select("id, organisation_id, created_at").limit(20000),
    admin.from("profiles").select("id, role, roles, hospital_id, created_at").limit(60000),
  ]);
  // supabase-js resolves with {data:null, error} on failure (it does not throw),
  // so DB health must be derived from the actual result, never assumed.
  const dbReachable = !orgsErr && orgsRaw != null;
  const orgs = orgsRaw ?? [];
  const hospitals = hosps ?? [];
  const profiles = profs ?? [];

  const hospToOrg = new Map<string, string>(hospitals.map((h: any) => [h.id, h.organisation_id]));
  const facByOrg = new Map<string, number>();
  for (const h of hospitals) if (h.organisation_id) facByOrg.set(h.organisation_id, (facByOrg.get(h.organisation_id) ?? 0) + 1);
  const userByOrg = new Map<string, number>();
  for (const p of profiles) { const o = p.hospital_id && hospToOrg.get(p.hospital_id); if (o) userByOrg.set(o, (userByOrg.get(o) ?? 0) + 1); }

  const tenants: Tenant[] = orgs.map((o: any) => ({
    id: o.id, name: o.name, active: o.is_active !== false, type: o.type ?? null, country: o.hq_country ?? null, created_at: o.created_at ?? null,
    facilities: facByOrg.get(o.id) ?? 0, users: userByOrg.get(o.id) ?? 0,
  })).sort((a: Tenant, b: Tenant) => b.users - a.users);

  const activeTenants = tenants.filter(t => t.active).length;
  const summary = {
    tenants: tenants.length,
    activeTenants,
    inactiveTenants: tenants.length - activeTenants,
    facilities: hospitals.length,
    users: profiles.length,
    newTenants30d: orgs.filter((o: any) => o.created_at && o.created_at >= d30).length,
    newUsers30d: profiles.filter((p: any) => p.created_at && p.created_at >= d30).length,
  };

  // ── Platform growth (tenants + users created, 30/90d) ──────────────────────
  const growth = {
    tenants30d: summary.newTenants30d,
    tenants90d: orgs.filter((o: any) => o.created_at && o.created_at >= d90).length,
    users30d: summary.newUsers30d,
    users90d: profiles.filter((p: any) => p.created_at && p.created_at >= d90).length,
    facilities30d: hospitals.filter((h: any) => h.created_at && h.created_at >= d30).length,
  };

  // ── Platform role distribution ─────────────────────────────────────────────
  const roleMap = new Map<string, number>();
  for (const p of profiles) {
    const rs: string[] = (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
    const key = rs.includes("super_admin") ? "super_admin" : rs.includes("hospital_admin") ? "hospital_admin" : rs.includes("educator") ? "educator" : rs.includes("assessor") ? "assessor" : rs.includes("nurse") ? "nurse" : "other";
    roleMap.set(key, (roleMap.get(key) ?? 0) + 1);
  }
  const roleBars: Bar[] = [...roleMap.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  // ── Audit trail + security events (platform-wide) ──────────────────────────
  const audit = { total: 0, distinctActions: 0, securityEvents: 0, recent: [] as AuditRow[], securityRecent: [] as AuditRow[], actionBars: [] as Bar[] };
  try {
    const { data } = await admin.from("audit_log").select("actor_name, action, entity_name, entity_type, created_at").order("created_at", { ascending: false }).limit(2000);
    const rows = data ?? [];
    audit.total = rows.length;
    const am = new Map<string, number>();
    for (const r of rows) if (r.action) am.set(r.action, (am.get(r.action) ?? 0) + 1);
    audit.distinctActions = am.size;
    audit.actionBars = [...am.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    audit.recent = rows.slice(0, 12);
    const sec = rows.filter((r: any) => r.action && SECURITY_RE.test(r.action));
    audit.securityEvents = sec.length;
    audit.securityRecent = sec.slice(0, 12);
  } catch { /* ignore */ }

  // ── AI platform operations ─────────────────────────────────────────────────
  const ai = await import("@/lib/ai/config").then((m: any) => m.aiStatus?.() ?? { configured: false, provider: null }).catch(() => ({ configured: false, provider: null }));
  const aiLive = !!ai.configured && ai.provider === "anthropic";
  let aiEvents = 0;
  try {
    const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true }).like("action", "ai_%").gte("created_at", d30);
    aiEvents = count ?? 0;
  } catch { /* ignore */ }

  // ── Integration health (only what is genuinely wired) ──────────────────────
  const integrations = [
    { name: "AI Intelligence Layer", status: aiLive ? "live" : "off", detail: aiLive ? "Model provider configured (Anthropic)" : ai.configured ? `${ai.provider === "openai" ? "OpenAI" : ai.provider === "gemini" ? "Gemini" : "Provider"} key set — not wired end-to-end` : "No model provider key set" },
    { name: "Database (Supabase Postgres)", status: dbReachable ? "live" : "off", detail: dbReachable ? "Reachable — platform queries succeeding" : "Primary query failed — datastore may be unavailable" },
    { name: "Auth (Supabase)", status: "native", detail: "Platform-native session auth" },
    { name: "Notification Engine", status: "native", detail: "Platform-native" },
    { name: "Identity providers (SSO/SAML)", status: "off", detail: "No external IdP connected" },
    { name: "Email / SMS providers", status: "off", detail: "No external messaging provider connected" },
    { name: "EHR / EMR / LMS", status: "off", detail: "No external clinical systems connected" },
  ];
  const integrationHealth = { live: integrations.filter(i => i.status === "live").length, native: integrations.filter(i => i.status === "native").length, off: integrations.filter(i => i.status === "off").length };

  // ── System health — honest: DB reachable + platform counts; no infra telemetry
  const health = {
    dbReachable, // derived from the organisations query actually succeeding
    aiLive,
    tenants: summary.tenants,
    activeTenants,
  };

  return { summary, tenants, growth, roleBars, audit, ai: { configured: ai.configured, provider: ai.provider ?? null, live: aiLive, events30d: aiEvents }, integrations, integrationHealth, health };
}
