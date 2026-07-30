/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-005 — Competency Audit & Evidence Assurance Engine.
// The GOVERNANCE AUDIT TRAIL (§4.4 transparency / §16 Audit Trail Service) — the continuous action-history across
// the whole competency-governance machinery, which no surface consolidates today. It reads the two real audit
// backbones and scopes them to competency governance:
//   • audit_log (mig 040)      — actor / action / entity of every governance mutation (approvals, changes,
//     decisions, standards, AI queries) written by the CGR engines + the rest of the platform.
//   • domain_events (mig 102)  — the versioned domain-event stream (competency_decision / framework / assessment …).
// Plus an evidence-assurance HEADLINE composed from the CGR-001 registry (evidence-backed %, review compliance,
// at-risk). The DEEP statistical assurance — evidence integrity, assessor reliability, drift, assessment quality —
// is owned by the CAPA Assurance platform and cross-linked, NOT duplicated. No migration; read model.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;
const DAY = 86400000;

// Governance-scoped audit entity types / event subjects.
const GOV_ENTITY = new Set(["approval", "change_request", "competency", "framework", "framework_competency", "competency_decision", "content", "standard", "standards_mapping", "policy", "knowledge", "assessment", "cpu", "governance"]);
const GOV_SUBJECT = new Set(["competency_decision", "competency", "framework", "assessment", "evidence", "competency_lifecycle", "content", "approval"]);
const GOV_AI_ACTIONS = new Set(["cgr_ai_query"]); // governance copilot only (not other domains' AI queries)

function familyOf(action: string): string {
  const a = (action || "").toLowerCase();
  if (a.includes("reject")) return "Rejections";
  if (a.includes("approv")) return "Approvals";
  if (a.includes("change")) return "Change control";
  if (a.includes("decision")) return "Competency decisions";
  if (a.includes("standard") || a.includes("mapping")) return "Standards";
  if (a.includes("publish")) return "Publication";
  if (a.includes("lifecycle") || a.includes("transition") || a.includes("retire")) return "Lifecycle";
  if (a.includes("ai")) return "AI governance";
  if (a.includes("assess")) return "Assessment";
  if (a.includes("evidence")) return "Evidence";
  return "Other governance";
}

export async function loadGovernanceAudit(admin: Admin) {
  const [alRes, deRes, reg] = await Promise.all([
    admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(600),
    admin.from("domain_events").select("actor_name, event_type, subject_type, subject_id, occurred_at, payload").order("occurred_at", { ascending: false }).limit(400),
    loadGovernanceRegistry(admin).catch(() => ({ provisioned: false } as any)),
  ]);

  const al = (alRes.error ? [] : alRes.data ?? []).filter((r: any) => GOV_ENTITY.has(r.entity_type) && (r.entity_type !== "ai" || GOV_AI_ACTIONS.has(r.action)));
  const de = (deRes.error ? [] : deRes.data ?? []).filter((r: any) => GOV_SUBJECT.has(r.subject_type));

  const feed = [
    ...al.map((r: any) => ({ ts: r.created_at as string, actor: r.actor_name ?? "System", action: r.action ?? "—", entityType: r.entity_type as string, entityName: r.entity_name ?? "—", source: "audit" as const })),
    ...de.map((r: any) => ({ ts: r.occurred_at as string, actor: r.actor_name ?? "System", action: r.event_type as string, entityType: r.subject_type as string, entityName: (r.payload?.name ?? r.payload?.entity ?? r.payload?.entity_name ?? "—") as string, source: "event" as const })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const now = Date.now();
  const last30 = feed.filter((f) => now - new Date(f.ts).getTime() <= 30 * DAY).length;
  const last7 = feed.filter((f) => now - new Date(f.ts).getTime() <= 7 * DAY).length;

  const byFamily = new Map<string, number>();
  const byActor = new Map<string, number>();
  for (const f of feed) {
    byFamily.set(familyOf(f.action), (byFamily.get(familyOf(f.action)) ?? 0) + 1);
    byActor.set(f.actor, (byActor.get(f.actor) ?? 0) + 1);
  }
  const families = [...byFamily.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const topActors = [...byActor.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  const r: any = reg?.provisioned ? reg : null;
  const assurance = r
    ? { evidencePct: r.kpis.evidencePct, ownerPct: r.kpis.ownerPct, standardsPct: r.kpis.standardsPct, overdue: r.kpis.overdue, avgScore: r.kpis.avgScore, atRisk: r.states.at_risk + r.states.ungoverned, total: r.loaded }
    : null;

  return {
    provisioned: feed.length > 0 || !!assurance,
    feed: feed.slice(0, 25),
    totalEvents: feed.length,
    last30,
    last7,
    actors: byActor.size,
    families,
    topActors,
    assurance,
  };
}
