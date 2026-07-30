/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-009 — Competency Governance Exception, Escalation & Risk Management Engine.
// "When normal competency governance cannot be achieved, how is risk identified, authorised, monitored and
// closed?" — over real data:
//   • Escalation queue (§9) — the registry's at-risk / ungoverned / overdue competencies become the escalation
//     queue, each classified (§7 critical/high/moderate/low) with the concrete reasons and an escalation LEVEL
//     (L1 owner → L2 department → L3 executive governance). Derived live from the CGR-001 registry.
//   • Governance risk register (§7/§16) — the concerns summarised by risk class + escalation level.
//   • Exceptions register (§4.1 "no hidden exceptions" / §5.2 emergency deployment / §4.3 time-bound) — the real
//     break_glass_grant store (mig 104): authorised, justified, always time-boxed emergency access grants, with
//     active / expiring-soon / expired / revoked status.
// Enterprise risk register + break-glass admin stay owned by GOV/QAW/System — cross-linked. No migration.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;
const DAY = 86400000;

function assess(r: any): { reasons: string[]; riskClass: string; level: number } | null {
  const concern = r.state === "at_risk" || r.state === "ungoverned" || r.reviewOverdue;
  if (!concern) return null;
  const reasons: string[] = [];
  if (r.state === "ungoverned") reasons.push("Ungoverned");
  if (!r.owner) reasons.push("No accountable owner");
  if (r.reviewOverdue) reasons.push("Review overdue");
  if (r.standards === 0) reasons.push("No regulatory mapping");
  if (r.decisions === 0) reasons.push("No supporting evidence");

  const critical = r.risk === "critical";
  const highRisk = critical || r.risk === "high";
  let riskClass: string, level: number;
  if (critical && (r.state === "ungoverned" || r.reviewOverdue || !r.owner)) { riskClass = "critical"; level = 3; }
  else if (highRisk) { riskClass = "high"; level = 2; }
  else if (r.state === "at_risk" || r.reviewOverdue) { riskClass = "moderate"; level = 2; }
  else { riskClass = "low"; level = 1; }
  return { reasons, riskClass, level };
}

const CLASS_RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 };

export async function loadGovernanceRisk(admin: Admin) {
  const [reg, bgRes] = await Promise.all([
    loadGovernanceRegistry(admin).catch(() => ({ provisioned: false } as any)),
    admin.from("break_glass_grant").select("actor_name, target_type, target_ref, reason, scope, status, granted_at, expires_at").order("granted_at", { ascending: false }).limit(200),
  ]);

  const r: any = reg?.provisioned ? reg : null;
  const recs: any[] = r ? r.records : [];

  const queue = recs
    .map((x) => {
      const a = assess(x);
      return a ? { id: x.id, name: x.name, domain: x.domain, risk: x.risk, ...a } : null;
    })
    .filter(Boolean) as any[];
  queue.sort((a, b) => CLASS_RANK[a.riskClass] - CLASS_RANK[b.riskClass] || b.level - a.level || a.name.localeCompare(b.name));

  const byClass: Record<string, number> = { critical: 0, high: 0, moderate: 0, low: 0 };
  const byLevel: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const q of queue) {
    byClass[q.riskClass]++;
    byLevel[q.level] = (byLevel[q.level] ?? 0) + 1;
  }

  const bg = (bgRes.error ? [] : bgRes.data ?? []) as any[];
  const now = Date.now();
  const soon = (iso: string) => !!iso && new Date(iso).getTime() - now <= 7 * DAY;
  const active = bg.filter((g) => g.status === "active");
  const exceptions = {
    ready: !bgRes.error,
    total: bg.length,
    active: active.length,
    expiringSoon: active.filter((g) => soon(g.expires_at)).length,
    expired: bg.filter((g) => g.status === "expired").length,
    revoked: bg.filter((g) => g.status === "revoked").length,
    list: active.slice(0, 8).map((g) => ({
      actor: g.actor_name ?? "—",
      target: g.target_type ? `${g.target_type}${g.target_ref ? " · " + g.target_ref : ""}` : "broad",
      reason: g.reason,
      scope: g.scope,
      expiresAt: g.expires_at,
      expiringSoon: soon(g.expires_at),
    })),
  };

  return {
    provisioned: !!r || bg.length > 0,
    hasRegistry: !!r,
    queue: queue.slice(0, 20),
    queueTotal: queue.length,
    byClass,
    byLevel,
    exceptions,
  };
}
