// Loaders for the remaining PPE modules (005 Campaigns, 006 Analytics, 008 Governance, 003 Goal-to-Action,
// 004 Personalisation, 007 AI Orchestrator). Each is a pure transform over fetchFramework + the engine resolver —
// a different lens over the same strategic stores. Read model; write workflows are the next build phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchFramework, resolveEffectivePriorities, scopeName, effectiveWeight, pct } from "./engine";

const daysBetween = (a: string, today: string) => Math.round((new Date(a).getTime() - new Date(today).getTime()) / 86400000);

// ── PPE-005 Campaign & Initiative Manager ──
export async function loadCampaigns(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { campaigns, themes, objectives, actions, nameByRef, ownerById } = f;
  const today = new Date().toISOString().slice(0, 10);
  const enriched = campaigns.map(c => ({
    ...c,
    themeName: themes.find(t => t.id === c.theme_id)?.name ?? null,
    themeColor: themes.find(t => t.id === c.theme_id)?.color ?? "#94a3b8",
    objectiveTitle: c.objective_id ? (objectives.find(o => o.id === c.objective_id)?.title ?? null) : null,
    sponsor: c.sponsor_id ? (ownerById.get(c.sponsor_id) ?? "—") : "—",
    scopeLabel: scopeName(c.scope_type, c.scope_ref, nameByRef),
    daysLeft: c.end_date ? daysBetween(c.end_date, today) : null,
    actionCount: actions.filter(a => a.campaign_id === c.id).length,
  }));
  const active = enriched.filter(c => c.status === "active");
  const kpis = {
    total: campaigns.length, active: active.length,
    planned: campaigns.filter(c => c.status === "planned").length,
    completed: campaigns.filter(c => c.status === "completed").length,
    budget: campaigns.reduce((a, c) => a + Number(c.budget || 0), 0),
    avgProgress: active.length ? Math.round(active.reduce((a, c) => a + Number(c.progress_pct || 0), 0) / active.length) : 0,
    actions: actions.filter(a => a.campaign_id).length,
  };
  const byTheme = themes.map(t => ({ name: t.name, color: t.color, n: campaigns.filter(c => c.theme_id === t.id).length })).filter(x => x.n > 0);
  return { provisioned: true as const, hasData: campaigns.length > 0, kpis, campaigns: enriched.sort((a, b) => Number(b.progress_pct) - Number(a.progress_pct)), byTheme };
}

// ── PPE-006 Priority Analytics & Impact Dashboard ──
export async function loadAnalytics(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { themes, objectives, keyResults, priorities, campaigns } = f;
  const published = objectives.filter(o => o.status === "published");
  const pubPrio = priorities.filter(p => p.status === "published");

  const objectiveAchievement = published.length ? Math.round(published.reduce((a, o) => a + Number(o.progress_pct || 0), 0) / published.length) : 0;
  const krOnTrack = keyResults.filter(k => ["on_track", "achieved"].includes(k.status)).length;
  const krAttainment = keyResults.length ? pct(krOnTrack, keyResults.length) : 0;
  const activeCamp = campaigns.filter(c => ["active", "completed"].includes(c.status));
  const initiativeDelivery = activeCamp.length ? Math.round(activeCamp.reduce((a, c) => a + Number(c.progress_pct || 0), 0) / activeCamp.length) : 0;
  // Strategic alignment: objectives linked to a theme, priorities linked to an objective, KRs present.
  const objLinked = objectives.length ? pct(objectives.filter(o => o.theme_id).length, objectives.length) : 100;
  const prioLinked = priorities.length ? pct(priorities.filter(p => p.objective_id).length, priorities.length) : 100;
  const objWithKr = objectives.length ? pct(objectives.filter(o => keyResults.some(k => k.objective_id === o.id)).length, objectives.length) : 0;
  const alignmentScore = Math.round((objLinked + prioLinked + objWithKr) / 3);

  const byTheme = themes.map(t => {
    const objs = published.filter(o => o.theme_id === t.id);
    return { name: t.name, color: t.color, progress: objs.length ? Math.round(objs.reduce((a, o) => a + Number(o.progress_pct || 0), 0) / objs.length) : 0, objectives: objs.length, priorities: pubPrio.filter(p => p.theme_id === t.id).length };
  }).filter(x => x.objectives > 0 || x.priorities > 0);

  // Scope comparison — avg objective progress by scope level.
  const scopeCompare = ["platform", "hospital", "department"].map(s => {
    const objs = published.filter(o => o.scope_type === s);
    return { scope: s, n: objs.length, progress: objs.length ? Math.round(objs.reduce((a, o) => a + Number(o.progress_pct || 0), 0) / objs.length) : 0 };
  }).filter(x => x.n > 0);

  const krStatus = { on_track: 0, at_risk: 0, off_track: 0, achieved: 0 } as Record<string, number>;
  keyResults.forEach(k => { krStatus[k.status] = (krStatus[k.status] ?? 0) + 1; });

  return {
    provisioned: true as const, hasData: objectives.length > 0,
    kpis: { alignmentScore, objectiveAchievement, krAttainment, initiativeDelivery, priorityCompletion: pubPrio.length ? pct(pubPrio.filter(p => p.mandatory).length, pubPrio.length) : 0, objectives: published.length, priorities: pubPrio.length },
    alignment: { objLinked, prioLinked, objWithKr }, byTheme, scopeCompare, krStatus,
    topProgress: [...published].sort((a, b) => Number(b.progress_pct) - Number(a.progress_pct)).slice(0, 5).map(o => ({ title: o.title, progress: Math.round(Number(o.progress_pct)), color: themes.find(t => t.id === o.theme_id)?.color ?? "#94a3b8" })),
    atRisk: published.filter(o => Number(o.progress_pct) < 40).map(o => ({ title: o.title, progress: Math.round(Number(o.progress_pct)) })),
  };
}

// ── PPE-008 Priority Governance & Approval Workflow ──
export async function loadGovernance(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { approvals, audit, nameByRef, ownerById } = f;
  const enrich = (a: any) => ({ ...a, requester: a.requested_by ? (ownerById.get(a.requested_by) ?? "—") : "—", decider: a.decided_by ? (ownerById.get(a.decided_by) ?? "—") : null, scopeLabel: scopeName(a.scope_type ?? "platform", a.scope_ref, nameByRef) });
  const queue = approvals.filter(a => ["pending", "changes_requested"].includes(a.state)).map(enrich);
  const decided = approvals.filter(a => ["approved", "rejected"].includes(a.state)).map(enrich);
  const decidedTimes = approvals.filter(a => a.decided_at && a.requested_at).map(a => (new Date(a.decided_at).getTime() - new Date(a.requested_at).getTime()) / 86400000);
  const kpis = {
    total: approvals.length,
    pending: approvals.filter(a => a.state === "pending").length,
    changesRequested: approvals.filter(a => a.state === "changes_requested").length,
    approved: approvals.filter(a => a.state === "approved").length,
    rejected: approvals.filter(a => a.state === "rejected").length,
    avgDays: decidedTimes.length ? Math.round(decidedTimes.reduce((a, b) => a + b, 0) / decidedTimes.length * 10) / 10 : null,
  };
  const byEntity = ["objective", "priority", "campaign", "theme"].map(e => ({ type: e, n: approvals.filter(a => a.entity_type === e).length })).filter(x => x.n > 0);
  return { provisioned: true as const, hasData: approvals.length > 0 || audit.length > 0, kpis, queue, decided, byEntity, audit: audit.map(a => ({ ...a, actor: a.actor_id ? (ownerById.get(a.actor_id) ?? "—") : "system", scopeLabel: scopeName(a.scope_type ?? "platform", a.scope_ref, nameByRef) })) };
}

// ── PPE-003 Goal-to-Action Translation Engine ──
export async function loadGoalToAction(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { actions, priorities, objectives, campaigns, nameByRef } = f;
  const enriched = actions.map(a => ({
    ...a,
    priorityTitle: a.priority_id ? (priorities.find(p => p.id === a.priority_id)?.title ?? null) : null,
    objectiveTitle: a.objective_id ? (objectives.find(o => o.id === a.objective_id)?.title ?? null) : null,
    campaignName: a.campaign_id ? (campaigns.find(c => c.id === a.campaign_id)?.name ?? null) : null,
    targetLabel: a.target_scope_type ? scopeName(a.target_scope_type, a.target_scope_ref, nameByRef) : "—",
  }));
  const done = enriched.filter(a => a.status === "completed").length;
  const kpis = {
    total: actions.length,
    completed: done, inProgress: enriched.filter(a => a.status === "in_progress").length,
    generated: enriched.filter(a => a.status === "generated").length,
    completionRate: actions.length ? pct(done, actions.length) : 0,
  };
  const TYPES = ["task", "learning", "audit", "competency", "notification", "dashboard", "report"];
  const byType = TYPES.map(t => ({ type: t, n: enriched.filter(a => a.action_type === t).length })).filter(x => x.n > 0);
  // Traceability chains: objective → priority → generated actions.
  const chains = objectives.filter(o => enriched.some(a => a.objective_id === o.id)).slice(0, 6).map(o => ({
    objective: o.title,
    priorities: [...new Set(enriched.filter(a => a.objective_id === o.id).map(a => a.priorityTitle).filter(Boolean))],
    actions: enriched.filter(a => a.objective_id === o.id).map(a => ({ title: a.title, type: a.action_type, status: a.status })),
  }));
  return { provisioned: true as const, hasData: actions.length > 0, kpis, actions: enriched, byType, chains };
}

// ── PPE-004 Personalisation & Context Resolution Engine ──
const WORKSPACE_MAP: { workspace: string; example: string; behaviour: string; cats: string[] }[] = [
  { workspace: "Personal", example: "Mandatory learning", behaviour: "Pinned to the top of the dashboard and task list.", cats: ["learning", "workforce"] },
  { workspace: "Healthcare Worker", example: "Patient safety", behaviour: "Clinical reminders and safety alerts prioritised.", cats: ["safety"] },
  { workspace: "Shift Supervisor", example: "Safe handover", behaviour: "Operational dashboard reordered around handover.", cats: ["operations", "safety"] },
  { workspace: "Unit Manager", example: "Quality improvement", behaviour: "Executive quality widgets highlighted.", cats: ["quality", "operations"] },
  { workspace: "Quality", example: "JCI readiness", behaviour: "Audit schedules and accreditation promoted.", cats: ["quality"] },
  { workspace: "Executive", example: "Strategic KPIs", behaviour: "Organisation scorecards prioritised.", cats: ["quality", "operations", "safety"] },
];
export async function loadPersonalisation(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { priorities, nameByRef, themes } = f;
  const published = priorities.filter(p => p.status === "published");
  const hospitalId = published.find(p => p.scope_type === "hospital")?.scope_ref ?? null;
  const effective = resolveEffectivePriorities(published, { hospitalId }, nameByRef).map(p => ({ ...p, themeName: themes.find(t => t.id === p.theme_id)?.name ?? null }));

  // Per-workspace resolved view: the effective priorities most relevant to each workspace's categories, top-ranked.
  const workspaces = WORKSPACE_MAP.map(w => {
    const relevant = effective.filter(p => !p.category || w.cats.includes(p.category));
    return { ...w, top: (relevant.length ? relevant : effective).slice(0, 3).map(p => ({ title: p.title, urgency: p.urgency, mandatory: p.mandatory, weight: p.weight })) };
  });

  const contextSources = [
    { source: "Role & workspace", detail: "Active role and current workspace determine base ordering." },
    { source: "Organisational scope", detail: "Hospital / department priorities merged over platform defaults." },
    { source: "Assignments & competency", detail: "Personal learning, credentials and competency gaps." },
    { source: "Operational state", detail: "Live shift, acuity, escalations and capacity signals." },
    { source: "Preferences", detail: "Individual dashboard/layout preferences (never override mandatory)." },
  ];
  return { provisioned: true as const, hasData: published.length > 0, effectiveCount: effective.length, workspaces, contextSources, topEffective: effective.slice(0, 5) };
}

// ── PPE-007 AI Priority Orchestrator (rule-based intelligence over the framework) ──
export async function loadAiOrchestrator(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { priorities, objectives, keyResults, approvals, themes } = f;
  const today = new Date().toISOString().slice(0, 10);
  const pub = priorities.filter(p => p.status === "published");
  const recs: { kind: string; tone: string; title: string; detail: string; source: string }[] = [];

  // Conflict detection — multiple high-weight priorities competing within one theme.
  themes.forEach(t => {
    const inTheme = pub.filter(p => p.theme_id === t.id && effectiveWeight(p) >= 120);
    if (inTheme.length >= 2) recs.push({ kind: "Conflict", tone: "amber", title: `Competing priorities in “${t.name}”`, detail: `${inTheme.length} high-weight priorities share this theme — confirm ranking to avoid dilution.`, source: inTheme.map(p => p.title).slice(0, 2).join(" vs ") });
  });
  // Strategic drift — published objectives well behind with little runway.
  objectives.filter(o => o.status === "published" && o.timeframe_end).forEach(o => {
    const daysLeft = daysBetween(o.timeframe_end, today);
    if (Number(o.progress_pct) < 50 && daysLeft < 90) recs.push({ kind: "Drift", tone: "rose", title: `Objective at risk: “${o.title.slice(0, 44)}”`, detail: `${Math.round(Number(o.progress_pct))}% complete with ${daysLeft} days left — realign resources or rescope.`, source: "objective progress vs timeframe" });
  });
  // Stale priority — validity window passed but still published.
  pub.filter(p => p.valid_to && p.valid_to < today).forEach(p => recs.push({ kind: "Hygiene", tone: "blue", title: `Expired priority still live: “${p.title}”`, detail: `Validity ended ${p.valid_to} — archive or extend.`, source: "valid_to elapsed" }));
  // Unlinked objective — no key results (unmeasurable).
  objectives.filter(o => o.status === "published" && !keyResults.some(k => k.objective_id === o.id)).forEach(o => recs.push({ kind: "Alignment", tone: "violet", title: `No key results on “${o.title.slice(0, 44)}”`, detail: "Add measurable key results so progress can be tracked.", source: "objective ↔ KR linkage" }));
  // Capacity — too many mandatory/critical priorities may overload teams.
  const heavy = pub.filter(p => p.mandatory || p.urgency === "critical").length;
  if (heavy >= 4) recs.push({ kind: "Capacity", tone: "amber", title: `${heavy} mandatory/critical priorities active`, detail: "High simultaneous load — consider staggering validity windows to protect focus.", source: "mandatory + critical count" });
  // Aging approvals.
  const agingAppr = approvals.filter(a => a.state === "pending").length;
  if (agingAppr) recs.push({ kind: "Governance", tone: "blue", title: `${agingAppr} approval(s) awaiting decision`, detail: "Pending strategy/priority approvals are blocking publication.", source: "governance queue" });

  const order = { rose: 0, amber: 1, violet: 2, blue: 3 } as Record<string, number>;
  recs.sort((a, b) => (order[a.tone] ?? 9) - (order[b.tone] ?? 9));
  const kpis = {
    recommendations: recs.length,
    conflicts: recs.filter(r => r.kind === "Conflict").length,
    drift: recs.filter(r => r.kind === "Drift").length,
    hygiene: recs.filter(r => ["Hygiene", "Alignment"].includes(r.kind)).length,
  };
  return { provisioned: true as const, hasData: pub.length > 0, kpis, recs };
}
