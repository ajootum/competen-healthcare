// Credential Management (CMO-003) — the enterprise system of record for professional credentials.
// The §5 Credential Dashboard + §6 Staff Credential Register over the live professional_credentials
// store (tenant-scoped via hospital staff). Real: overall credential compliance, valid/expiring/
// expired/pending/restricted counts, compliance by credential type, named upcoming expiries, the
// staff register, credential risk alerts, activity and rule-based explainable AI insights. Honest
// next-phase: the verification-queue workflow, privileges & scope, renewal cases, exceptions/temporary
// authorisations and issuer integrations — each needs its own store (§14). Fail-soft; no fabrication.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysTo = (s: string) => Math.round((new Date(s).getTime() - Date.now()) / 86400000);
const tc = (s: string | null) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

// Derive the CMO-003 status model (§13) from the operational credential record.
function statusOf(c: any, T: string, d30: string): string {
  const st = (c.status ?? "").toLowerCase();
  if (["suspended", "revoked", "restricted", "rejected", "archived"].includes(st)) return tc(st);
  if (c.expiry_date && c.expiry_date < T) return "Expired";
  if (!c.verified && ["submitted", "pending", "pending_verification", "draft"].includes(st)) return "Pending Verification";
  if (c.expiry_date && c.expiry_date >= T && c.expiry_date <= d30) return "Expiring";
  if (c.verified || ["valid", "active", "approved"].includes(st)) return "Valid";
  return "Submitted";
}
const COMPLIANT = new Set(["Valid", "Expiring"]);

export async function loadCredentialManagement(admin: any, hid: string | null, isSuper: boolean) {
  const T = today(), d30 = plusDays(30), d90 = plusDays(90);

  // Staff in scope (tenant isolation via nurse_id).
  let staffIds: string[] = [];
  try {
    const { data } = isSuper ? await admin.from("profiles").select("id").limit(20000)
      : await admin.from("profiles").select("id").eq("hospital_id", hid ?? NONE).limit(20000);
    staffIds = (data ?? []).map((p: any) => p.id);
  } catch { /* fail-soft */ }

  let provisioned = true;
  let creds: any[] = [];
  try {
    const base = admin.from("professional_credentials").select("id, credential_type, title, issuing_body, issue_date, expiry_date, status, verified, nurse_id, profiles!nurse_id(full_name, role)");
    const q = isSuper ? base.limit(20000) : (staffIds.length ? base.in("nurse_id", staffIds).limit(20000) : base.eq("nurse_id", NONE));
    const { data, error } = await q;
    if (error) throw error;
    creds = (data ?? []).map((c: any) => ({ ...c, computed: statusOf(c, T, d30), name: c.profiles?.full_name ?? "—", role: (c.profiles?.role ?? "").replace(/_/g, " ") }));
  } catch { provisioned = false; creds = []; }

  const count = (s: string) => creds.filter(c => c.computed === s).length;
  const kpis = {
    total: creds.length,
    valid: count("Valid"),
    expiring: count("Expiring"),
    expired: count("Expired"),
    pending: creds.filter(c => c.computed === "Pending Verification" || c.computed === "Submitted").length,
    restricted: creds.filter(c => ["Restricted", "Suspended", "Revoked"].includes(c.computed)).length,
    compliance: creds.length ? Math.round((creds.filter(c => COMPLIANT.has(c.computed)).length / creds.length) * 100) : 0,
    verifiedPct: creds.length ? Math.round((creds.filter(c => c.verified).length / creds.length) * 100) : 0,
  };

  // Compliance by credential type (heatmap — unit grouping needs active assignments; type is reliable).
  const byType = new Map<string, { total: number; ok: number }>();
  creds.forEach(c => { const t = tc(c.credential_type ?? "Other"); const g = byType.get(t) ?? { total: 0, ok: 0 }; g.total++; if (COMPLIANT.has(c.computed)) g.ok++; byType.set(t, g); });
  const complianceByType = [...byType.entries()].map(([name, g]) => ({ name, total: g.total, ok: g.ok, pct: g.total ? Math.round((g.ok / g.total) * 100) : 0 })).sort((a, b) => a.pct - b.pct).slice(0, 8);

  // Upcoming expiries (≤90 days, named).
  const upcomingExpiries = creds
    .filter(c => c.expiry_date && c.expiry_date >= T && c.expiry_date <= d90)
    .sort((a, b) => (a.expiry_date ?? "").localeCompare(b.expiry_date ?? ""))
    .slice(0, 10)
    .map(c => ({ name: c.name, credential: c.title ?? tc(c.credential_type), issuer: c.issuing_body ?? "—", days: daysTo(c.expiry_date), status: c.computed }));

  // Staff register preview (most recently affected first — expired/expiring/pending on top).
  const rank: Record<string, number> = { Expired: 0, Suspended: 0, Revoked: 0, Restricted: 1, "Pending Verification": 2, Expiring: 3, Submitted: 4, Valid: 5 };
  const register = [...creds].sort((a, b) => (rank[a.computed] ?? 9) - (rank[b.computed] ?? 9)).slice(0, 12)
    .map(c => ({ name: c.name, role: c.role, credential: c.title ?? tc(c.credential_type), issuer: c.issuing_body ?? "—", status: c.computed, expiry: c.expiry_date, verified: c.verified }));

  // Credential risk alerts (§5.3).
  const risks: { label: string; detail: string; severity: "high" | "medium" }[] = [];
  if (kpis.expired) risks.push({ label: `${kpis.expired} expired credential${kpis.expired === 1 ? "" : "s"}`, detail: "Required credentials no longer valid — deployment impact", severity: "high" });
  if (kpis.restricted) risks.push({ label: `${kpis.restricted} restricted / suspended`, detail: "Active restrictions affecting deployment", severity: "high" });
  if (kpis.expiring) risks.push({ label: `${kpis.expiring} expiring within 30 days`, detail: `${new Set(creds.filter(c => c.computed === "Expiring").map(c => c.nurse_id)).size} staff — start renewal`, severity: "medium" });
  if (kpis.pending) risks.push({ label: `${kpis.pending} awaiting verification`, detail: "Submitted credentials pending primary-source check", severity: "medium" });

  // Activity feed (audit_log credential events). Fail-soft, tenant-scoped.
  let activity: any[] = [];
  try {
    const { data: au } = isSuper
      ? await admin.from("audit_log").select("id, action, created_at, actor:profiles!actor_id(full_name)").ilike("action", "%credential%").order("created_at", { ascending: false }).limit(12)
      : await admin.from("audit_log").select("id, action, created_at, actor:profiles!actor_id(full_name)").eq("hospital_id", hid ?? NONE).ilike("action", "%credential%").order("created_at", { ascending: false }).limit(12);
    activity = au ?? [];
  } catch { /* fail-soft */ }

  // Rule-based explainable AI insights (§23 — recommendation only).
  const ai: { text: string; why: string; priority: "high" | "medium" | "low" }[] = [];
  if (kpis.expired) ai.push({ text: `Prioritise re-verification / renewal for ${kpis.expired} expired credential(s)`, why: "Expired required credentials block deployment (BR-004)", priority: "high" });
  if (kpis.expiring) ai.push({ text: `Open renewal cases for ${kpis.expiring} credential(s) expiring ≤30 days`, why: "Prevents lapse-driven roster blocks", priority: "medium" });
  if (kpis.pending) ai.push({ text: `Clear the verification backlog — ${kpis.pending} pending`, why: "Verification gates valid status (BR-001)", priority: "medium" });
  if (complianceByType.length && complianceByType[0].pct < 80) ai.push({ text: `Review ${complianceByType[0].name} (${complianceByType[0].pct}% valid — lowest type)`, why: "Lowest-compliance credential type", priority: "low" });

  return { provisioned, ready: provisioned, kpis, complianceByType, upcomingExpiries, register, risks, activity, ai };
}
