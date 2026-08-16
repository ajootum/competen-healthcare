// Roles, Permissions & Delegated Administration (UMW-TLS-002) — migration 166.
//
// WHAT IS NOT REBUILT HERE. TLS-002 overlaps ADM-007 heavily and most of it is already live: delegated
// administration (adm_delegations), emergency access (break_glass_grant), the activity trail (audit_log)
// and role assignment (profiles.roles). Those are READ here, not reimplemented — a unit must not get two
// answers to "who can do what".
//
// THE PERMISSION MATRIX IS DERIVED FROM THE CODE, not from a table. What a role can actually reach is
// decided by the gates in the application, so a hand-maintained permissions table would drift from them
// silently and tell a manager a route is locked when it is open. See src/lib/access/scan.ts.
//
// SEGREGATION-OF-DUTY BREACHES ARE COMPUTED LIVE and never stored, because a stored breach goes stale the
// moment someone's roles change and would then accuse a person who is already clean.
/* eslint-disable @typescript-eslint/no-explicit-any */

import matrixFile from "./matrix.generated.json";
import { summarise, findSodBreaches, roleReaches, type MatrixEntry, type SodRule } from "./scan";
import { estateRolesOf } from "@/lib/roles";

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

// The tenant-plane roles a unit manager can reason about. The landlord plane (platform operators) is a
// different axis and is reported separately rather than mixed into these columns.
export const TENANT_ROLES = ["nurse", "assessor", "educator", "hospital_admin", "super_admin"];

export async function loadAccessGovernance(
  admin: any, hid: string | null, isSuper: boolean, opts: { now?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: null, error: true }));

  const [peopleRes, ruleRes, excRes, reviewRes, itemRes, delegRes, glassRes, auditRes] = await Promise.all([
    soft(scope(admin.from("profiles").select("id, full_name, role, roles").limit(2000))),
    soft(scope(admin.from("sod_rules").select("id, code, label, role_a, role_b, severity, rationale, active"))),
    soft(scope(admin.from("sod_exceptions").select("rule_id, subject_id, subject_name, reason, approved_by_name, expires_at"))),
    soft(scope(admin.from("access_reviews").select("id, name, scope, scope_ref, status, opened_at, due_at, closed_at, owner_name, note, created_at")
      .order("created_at", { ascending: false }).limit(50))),
    soft(admin.from("access_review_items").select("id, review_id, subject_id, subject_name, access_type, access_ref, decision, decided_by_name, decided_at").limit(5000)),
    soft(scope(admin.from("adm_delegations").select("id, position, delegate_id, delegated_by, valid_from, valid_to, status"))),
    soft(scope(admin.from("break_glass_grant").select("id, status, created_at")).limit(100)),
    // audit_log DOES carry hospital_id, so it is scoped like everything else — an unscoped access trail on a
    // unit page would show a manager who changed roles in another tenant.
    soft(scope(admin.from("audit_log").select("action, entity_type, entity_name, actor_name, created_at"))
      .order("created_at", { ascending: false }).limit(400)),
  ]);

  // provisioned=false means migration 166 has not been applied. The matrix and delegations still render.
  const provisioned = !ruleRes.error && !reviewRes.error;

  const people = ((peopleRes.data ?? []) as any[]).map(p => ({
    id: p.id, full_name: p.full_name,
    roles: estateRolesOf(p) as string[],
  }));

  // ── Role distribution, from the roles people actually hold ──
  const roleCounts: Record<string, number> = {};
  for (const p of people) (p.roles.length ? p.roles : ["unassigned"]).forEach(r => { roleCounts[r] = (roleCounts[r] ?? 0) + 1; });
  const roles = Object.entries(roleCounts).map(([role, n]) => ({ role, n })).sort((a, b) => b.n - a.n);
  const multiRole = people.filter(p => p.roles.length > 1);

  // ── Permission matrix ──
  const entries = (matrixFile as { entries: MatrixEntry[] }).entries;
  const matrix = summarise(entries, TENANT_ROLES);
  const workspaces = entries.filter(e => e.kind === "workspace").map(e => ({
    ...e, reach: TENANT_ROLES.map(r => ({ role: r, allowed: roleReaches(e.gate, r) })),
  }));
  // The entries a manager should actually look at: no check at all, or a gate the scanner could not read.
  const attention = entries.filter(e => e.gate.kind === "none" || e.gate.kind === "unknown");
  const authOnlyApis = entries.filter(e => e.kind === "api" && e.gate.kind === "auth-only");

  // ── Segregation of duties, computed against the real role sets ──
  const rules = (ruleRes.data ?? []) as SodRule[];
  const exceptions = (excRes.data ?? []) as any[];
  const breaches = provisioned ? findSodBreaches(rules, people, exceptions, now) : [];
  const liveBreaches = breaches.filter(b => !b.excepted);

  // ── Access review campaigns ──
  const reviews = (reviewRes.data ?? []) as any[];
  const items = (itemRes.data ?? []) as any[];
  const reviewRows = reviews.map(r => {
    const mine = items.filter(i => i.review_id === r.id);
    const decided = mine.filter(i => i.decision != null);
    return {
      ...r, items: mine.length, decided: decided.length,
      // An undecided item is NEVER counted as approved. A campaign nobody completed must not read as a
      // clean bill of health, which is exactly what a "0 revocations" figure would imply.
      retain: decided.filter(i => i.decision === "retain").length,
      revoke: decided.filter(i => i.decision === "revoke").length,
      modify: decided.filter(i => i.decision === "modify").length,
      progress: mine.length ? Math.round((decided.length / mine.length) * 100) : null,
      overdue: !!r.due_at && r.status === "open" && new Date(r.due_at).getTime() < now,
      daysToDue: r.due_at ? Math.round((new Date(r.due_at).getTime() - now) / DAY) : null,
    };
  });
  const openReviews = reviewRows.filter(r => r.status === "open");

  // ── Delegated administration + emergency access (existing stores) ──
  const delegations = ((delegRes.data ?? []) as any[]).map(d => ({
    ...d,
    delegateName: people.find(p => p.id === d.delegate_id)?.full_name ?? null,
    grantedByName: people.find(p => p.id === d.delegated_by)?.full_name ?? null,
    // An "active" row whose end date has passed is not active. Trusting the status column alone would
    // leave expired authority showing as current.
    lapsed: d.status === "active" && !!d.valid_to && new Date(d.valid_to).getTime() < now,
    endingSoon: d.status === "active" && !!d.valid_to && new Date(d.valid_to).getTime() - now < 14 * DAY,
  }));
  const activeDelegations = delegations.filter(d => d.status === "active" && !d.lapsed);
  const glass = (glassRes.data ?? []) as any[];
  const openGlass = glass.filter(g => ["active", "open", "granted"].includes(String(g.status)));

  // ── Access-related activity ──
  const ACCESS_ACTIONS = /role|permission|delegat|grant|revoke|access|break_glass|appoint/i;
  const accessAudit = ((auditRes.data ?? []) as any[])
    .filter(a => ACCESS_ACTIONS.test(String(a.action)) || ACCESS_ACTIONS.test(String(a.entity_type)))
    .slice(0, 15);

  const signals: { severity: "high" | "medium"; text: string }[] = [];
  const critical = liveBreaches.filter(b => ["critical", "high"].includes(b.rule.severity));
  if (critical.length) signals.push({ severity: "high", text: `${critical.length} unmitigated segregation-of-duty breach(es) at high or critical severity.` });
  else if (liveBreaches.length) signals.push({ severity: "medium", text: `${liveBreaches.length} segregation-of-duty breach(es) with no recorded exception.` });
  const expiredEx = breaches.filter(b => b.exceptionExpired);
  if (expiredEx.length) signals.push({ severity: "medium", text: `${expiredEx.length} breach(es) are covered only by an EXPIRED exception, which no longer authorises anything.` });
  const overdueReviews = reviewRows.filter(r => r.overdue);
  if (overdueReviews.length) signals.push({ severity: "high", text: `${overdueReviews.length} access review campaign(s) are past their due date.` });
  const stalled = openReviews.filter(r => r.progress != null && r.progress < 50 && r.daysToDue != null && r.daysToDue < 7);
  for (const r of stalled) signals.push({ severity: "medium", text: `"${r.name}" is ${r.progress}% decided with ${r.daysToDue} day(s) left.` });
  if (delegations.some(d => d.lapsed)) signals.push({ severity: "medium", text: `${delegations.filter(d => d.lapsed).length} delegation(s) are marked active but their end date has passed.` });
  if (openGlass.length) signals.push({ severity: "high", text: `${openGlass.length} emergency (break-glass) access grant(s) are still open.` });
  if (attention.length) signals.push({ severity: "medium", text: `${attention.length} route(s) have no detected access check or a gate the scanner could not read — each needs a human look.` });

  return {
    provisioned,
    matrix: {
      ...matrix, entries, workspaces, attention, authOnlyApis,
      roles: TENANT_ROLES,
    },
    people: { total: people.length, roles, multiRole: multiRole.length },
    sod: {
      rules: rules.length, breaches, live: liveBreaches.length,
      excepted: breaches.filter(b => b.excepted).length,
      expiredExceptions: expiredEx.length,
    },
    reviews: { recorded: reviews.length, rows: reviewRows, open: openReviews.length, overdue: overdueReviews.length },
    delegations: { recorded: delegations.length, rows: delegations, active: activeDelegations.length, lapsed: delegations.filter(d => d.lapsed).length },
    breakGlass: { recorded: glass.length, open: openGlass.length },
    audit: accessAudit,
    signals,
  };
}
