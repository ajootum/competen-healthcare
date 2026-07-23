// History & Audit Workspace (UMW-EA-005) loader. Reads the real, append-only audit_log
// store (migration 040) — every approval, escalation, CAPA, competency validation,
// escalation action and config change written by the Executive Actions modules lands
// here. Derives category + outcome from the action/entity_type verbs, then builds KPIs,
// the recent-activity explorer, category/outcome distribution, actions-over-time, top
// users, an audit summary and a real integrity/completeness measure. Fail-soft.
// audit_log has no IP-address, unit/area or retention-policy columns → those render as
// honest states, never fabricated. No department dimension → unit-wide.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const titleCase = (s?: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Event");

// Category from entity_type + action (order matters — access/export before domains).
function categoryOf(entity: string, action: string): string {
  const s = `${entity ?? ""} ${action ?? ""}`.toLowerCase();
  if (/login|logout|auth|access|sign_in|sign_out|session/.test(s)) return "Access";
  if (/export|download|report|generate/.test(s)) return "Export";
  if (/approval|approve/.test(s)) return "Approval";
  if (/escalat/.test(s)) return "Escalation";
  if (/quality|capa|incident/.test(s)) return "CAPA";
  if (/competen|validate|score|decision|framework/.test(s)) return "Competency";
  if (/config|setting|workspace|policy_review|feature/.test(s)) return "Change";
  if (/update|edit|change|assign|acknowledge/.test(s)) return "Change";
  return "Other";
}

// Outcome from the action verb.
function outcomeOf(action: string): string {
  const a = (action ?? "").toLowerCase();
  if (/reject|deny|denied/.test(a)) return "Rejected";
  if (/return|request_info/.test(a)) return "Returned";
  if (/delegate/.test(a)) return "Delegated";
  if (/cancel/.test(a)) return "Cancelled";
  if (/approve|approved/.test(a)) return "Approved";
  if (/complete|resolve|resolved|close|closed/.test(a)) return "Completed";
  if (/create|created|add|new/.test(a)) return "Created";
  if (/login|success|sign_in/.test(a)) return "Success";
  if (/update|edit|assign|acknowledge|escalate|change/.test(a)) return "Updated";
  return "Recorded";
}

const DECISION_OUTCOMES = new Set(["Approved", "Rejected", "Returned", "Delegated"]);

export async function loadHistoryAudit(admin: any, hid: string | null, isSuper: boolean, _dept?: string, cat?: string) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("audit_log").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  const nowMs = Date.now();
  const since30 = new Date(nowMs - 30 * 864e5).toISOString();
  const since7 = new Date(nowMs - 7 * 864e5).toISOString();
  const { data } = await scope(admin.from("audit_log")
    .select("id, actor_name, action, entity_type, entity_id, entity_name, created_at")
    .gte("created_at", since30).order("created_at", { ascending: false })).limit(6000);

  const rows = (data ?? []) as any[];
  const enrich = (a: any) => ({
    id: a.id, at: a.created_at, user: a.actor_name ?? "System",
    action: titleCase(a.action), rawAction: a.action ?? "", entity: a.entity_name ?? "—",
    entityType: titleCase(a.entity_type), category: categoryOf(a.entity_type, a.action),
    outcome: outcomeOf(a.action),
  });
  const all = rows.map(enrich);

  if (!all.length) return { provisioned: true as const, empty: true, kpis: emptyKpis(), recent: [], filterCounts: emptyFilterCounts(), summary: [], byCategory: [], byOutcome: [], overTime: [], topUsers: [], integrity: emptyIntegrity() };

  // ── KPIs ────────────────────────────────────────────────────────────────
  const complete = all.filter((a: any) => a.rawAction && a.entityType && a.entityType !== "Event").length;
  const kpis = {
    total: all.length,
    decisions: all.filter((a: any) => DECISION_OUTCOMES.has(a.outcome)).length,
    changes: all.filter((a: any) => a.outcome === "Updated" || a.category === "Change").length,
    access: all.filter((a: any) => a.category === "Access").length,
    exports: all.filter((a: any) => a.category === "Export").length,
    integrity: all.length ? Math.round((complete / all.length) * 100) : 100,
    thisWeek: all.filter((a: any) => a.at >= since7).length,
  };

  // ── Recent activity (category filter via ?cat=) ──────────────────────────
  const CATS = ["Decisions", "Changes", "Access", "Exports", "Logins"];
  const matchesCat = (a: any, c: string) => {
    if (c === "Decisions") return DECISION_OUTCOMES.has(a.outcome);
    if (c === "Changes") return a.outcome === "Updated" || a.category === "Change";
    if (c === "Access" || c === "Logins") return a.category === "Access";
    if (c === "Exports") return a.category === "Export";
    return true;
  };
  const activeCat = CATS.includes(cat ?? "") ? cat! : "All";
  const recent = (activeCat === "All" ? all : all.filter((a: any) => matchesCat(a, activeCat))).slice(0, 12);
  const filterCounts = { All: all.length, Decisions: all.filter((a: any) => matchesCat(a, "Decisions")).length, Changes: all.filter((a: any) => matchesCat(a, "Changes")).length, Access: all.filter((a: any) => matchesCat(a, "Access")).length, Exports: all.filter((a: any) => matchesCat(a, "Exports")).length, active: activeCat };

  // ── Distribution ──────────────────────────────────────────────────────────
  const grp = (arr: any[], key: (a: any) => string) => { const m: Record<string, number> = {}; for (const a of arr) { const k = key(a); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label, n, pct: arr.length ? Math.round((n / arr.length) * 100) : 0 })).sort((a, b) => b.n - a.n); };
  const byCategory = grp(all, (a: any) => a.category);
  const byOutcome = grp(all, (a: any) => a.outcome);

  // Audit summary — the executive-action categories with share.
  const SUMMARY_CATS = ["Approval", "Escalation", "CAPA", "Competency"];
  const summary = SUMMARY_CATS.map(c => { const n = all.filter((a: any) => a.category === c).length; return { label: c === "Approval" ? "Approvals" : c === "Escalation" ? "Escalations" : c === "CAPA" ? "CAPA Actions" : "Competency Validations", n, pct: all.length ? Math.round((n / all.length) * 100) : 0 }; }).filter(x => x.n > 0);

  // ── Actions over time (14 days) ──────────────────────────────────────────
  const days: { label: string; date: string }[] = [];
  for (let i = 13; i >= 0; i--) { const dt = new Date(nowMs - i * 864e5).toISOString().slice(0, 10); days.push({ label: dt.slice(5), date: dt }); }
  const overTime = days.map(d => ({ label: d.label, n: all.filter((a: any) => (a.at ?? "").slice(0, 10) === d.date).length }));

  // ── Top users ──────────────────────────────────────────────────────────────
  const topUsers = grp(all, (a: any) => a.user).slice(0, 6);

  // ── Integrity (real, append-only) ──────────────────────────────────────────
  const integrity = {
    completeness: kpis.integrity,
    lastEntry: all[0]?.at ?? null,
    records: all.length,
    orphans: all.length - complete, // rows missing action/entity metadata
  };

  return { provisioned: true as const, empty: false, kpis, recent, filterCounts, summary, byCategory, byOutcome, overTime, topUsers, integrity };
}

function emptyKpis() { return { total: 0, decisions: 0, changes: 0, access: 0, exports: 0, integrity: 100, thisWeek: 0 }; }
function emptyFilterCounts() { return { All: 0, Decisions: 0, Changes: 0, Access: 0, Exports: 0, active: "All" }; }
function emptyIntegrity() { return { completeness: 100, lastEntry: null, records: 0, orphans: 0 }; }
