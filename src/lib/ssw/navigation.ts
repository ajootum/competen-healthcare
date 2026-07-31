// SSW navigation engine (SSW-001-R2 Ch.3-13) — the supervisor sidebar is
// GENERATED from workspace configuration rather than hard-coded, using the same
// WCE convention the HWW sidebar adopted: catalogue in code, sparse overrides in
// the DB, resolved platform -> tenant -> hospital -> unit -> role -> user.
//
// Why this replaced the hand-written NAV_GROUPS array:
//   1. 44 of the old entries pointed at only 9 distinct destinations — seven
//      "Operational Intelligence" items and eight "AI" items all opened the same
//      page under different names. Nav that lies about what exists is worse than
//      nav that admits a gap, so duplicates are collapsed to one real entry each.
//   2. SIXTEEN real supervisor surfaces had no nav entry at all and could only
//      be reached by typing the URL: Current Shift, Today's Priorities, Shift
//      Timeline, Patient Shift Management, Workspace Settings, Resource &
//      Capacity, the Clinical Operations Console, and the ENTIRE nine-page
//      Handover Centre sub-tree (incoming, outgoing, SBAR, JBI audit, board,
//      acceptance, tasks, reports, AI assistant) which the old sidebar
//      represented with a single link to its landing page. They are now
//      first-class, and the harness fails if a built page is ever orphaned again.
//   3. The workspace-catalog already declared `supervisor` for the WCE Designer
//      with `wired: false` — config was stored and versioned but had no runtime
//      effect. Consulting this engine is what makes `wired: true` true.
//
// Fail-soft by construction: no override table (or an error) -> every entry
// resolves to its catalogue default, i.e. exactly the shipped sidebar.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadConfigOverrides, resolveSettings, type ScopeCtx } from "@/lib/config/workspace-config";

export const SSW_CONFIG_PREFIX = "supervisor";

export type SswNavRule = {
  key: string;            // config path suffix — "workforce-operations.workload-intelligence"
  section: string | null; // null = above the first section header
  label: string;
  href?: string;
  icon: string;
  badge?: string;
  exact?: boolean;
  soon?: boolean;         // no surface yet — rendered muted, never a dead link
  order: number;
  appRoles?: string[];    // omitted = every role the workspace admits
};

// Section keys deliberately match the `supervisor.*` section paths already
// catalogued in workspace-catalog.ts, so any override a tenant recorded through
// the WCE Designer before this engine existed takes effect immediately.
export const SSW_SECTIONS: { key: string; label: string; order: number }[] = [
  { key: "shift-command",           label: "Shift Command",            order: 100 },
  { key: "handover",                label: "Handover & Continuity",    order: 150 },
  { key: "situation-awareness",     label: "Situation Awareness",      order: 200 },
  { key: "patient-operations",      label: "Patient Operations",       order: 300 },
  { key: "workforce-operations",    label: "Workforce Operations",     order: 400 },
  { key: "resource-capacity",       label: "Resource & Capacity",      order: 500 },
  { key: "clinical-coordination",   label: "Clinical Coordination",    order: 600 },
  { key: "task-centre",             label: "Task Centre",              order: 700 },
  { key: "communication",           label: "Communication Centre",     order: 800 },
  { key: "quality-safety",          label: "Quality & Safety",         order: 900 },
  { key: "operational-intelligence", label: "Analytics & Reporting",   order: 1000 },
  { key: "ai-copilot",              label: "AI Operational Copilot",   order: 1100 },
  { key: "config-centre",           label: "Workspace Configuration",  order: 1200 },
];

// The shipped catalogue. Order values leave gaps so tenant `order` overrides can
// slot entries between defaults without renumbering. EVERY href below resolves
// to a built page — there are no label-only repeats of an existing destination.
export const SSW_NAV_CATALOGUE: SswNavRule[] = [
  { key: "dashboard", section: null, label: "Dashboard", href: "/supervisor", icon: "\u{1F3E0}", exact: true, order: 10 },

  // ── Shift Command: run the shift ──
  { key: "shift-command.shift-dashboard", section: "Shift Command", label: "Shift Dashboard", href: "/supervisor/shift-operations", icon: "\u{1F5A5}️", order: 100 },
  { key: "shift-command.current-shift", section: "Shift Command", label: "Current Shift", href: "/supervisor/current-shift", icon: "\u{23F1}️", order: 110 },
  { key: "shift-command.shift-activation", section: "Shift Command", label: "Planning & Activation", href: "/supervisor/shift-activation", icon: "\u{1F680}", order: 120 },
  { key: "shift-command.priorities", section: "Shift Command", label: "Today's Priorities", href: "/supervisor/priorities", icon: "\u{1F3AF}", order: 130 },
  { key: "shift-command.operations-console", section: "Shift Command", label: "Operations Console", href: "/supervisor/operations", icon: "\u{1F39B}️", order: 140 },

  // ── Handover & Continuity: the nine-page Handover Centre, previously
  //    reachable only through its landing page ──
  { key: "handover.centre", section: "Handover & Continuity", label: "Handover Centre", href: "/supervisor/handover", icon: "\u{1F504}", exact: true, badge: "handover", order: 150 },
  { key: "handover.incoming", section: "Handover & Continuity", label: "Incoming Shift", href: "/supervisor/handover/incoming", icon: "\u{1F4E5}", order: 155 },
  { key: "handover.outgoing", section: "Handover & Continuity", label: "Outgoing Shift", href: "/supervisor/handover/outgoing", icon: "\u{1F4E4}", order: 160 },
  { key: "handover.board", section: "Handover & Continuity", label: "Patient Handover Board", href: "/supervisor/handover/board", icon: "\u{1F4CB}", order: 165 },
  { key: "handover.sbar", section: "Handover & Continuity", label: "SBAR Builder", href: "/supervisor/handover/sbar", icon: "\u{1F4DD}", order: 170 },
  { key: "handover.acceptance", section: "Handover & Continuity", label: "Acceptance & Accountability", href: "/supervisor/handover/acceptance", icon: "\u{270D}️", order: 175 },
  { key: "handover.tasks", section: "Handover & Continuity", label: "Handover Tasks", href: "/supervisor/handover/tasks", icon: "\u{2705}", order: 180 },
  { key: "handover.jbi", section: "Handover & Continuity", label: "JBI Handover Audit", href: "/supervisor/handover/jbi", icon: "\u{1F50D}", order: 185 },
  { key: "handover.reports", section: "Handover & Continuity", label: "Handover Reports", href: "/supervisor/handover/reports", icon: "\u{1F4C4}", order: 190 },
  { key: "handover.ai", section: "Handover & Continuity", label: "AI Handover Assistant", href: "/supervisor/handover/ai", icon: "\u{2728}", order: 195 },

  // ── Situation Awareness: see the unit ──
  { key: "situation-awareness.ward-map", section: "Situation Awareness", label: "Ward Map", href: "/supervisor/ward-map", icon: "\u{1F5FA}️", order: 200 },
  { key: "situation-awareness.patient-flow", section: "Situation Awareness", label: "Patient Flow", href: "/supervisor/patient-flow", icon: "\u{1F500}", order: 210 },
  { key: "situation-awareness.clinical-safety", section: "Situation Awareness", label: "Clinical Safety", href: "/supervisor/clinical-safety", icon: "\u{1F6E1}️", badge: "overdueObs", order: 220 },
  { key: "situation-awareness.timeline", section: "Situation Awareness", label: "Shift Timeline", href: "/supervisor/timeline", icon: "\u{1F5D3}️", order: 230 },

  // ── Patient Operations ──
  { key: "patient-operations.dashboard", section: "Patient Operations", label: "Patient Operations", href: "/supervisor/patient-ops", icon: "\u{1F4CA}", order: 300 },
  { key: "patient-operations.patient-list", section: "Patient Operations", label: "Patient Census", href: "/supervisor/patient-list", icon: "\u{1F464}", order: 310 },
  { key: "patient-operations.census", section: "Patient Operations", label: "Census & Assignment", href: "/supervisor/census", icon: "\u{1F5C2}️", badge: "transfersPending", order: 320 },
  { key: "patient-operations.patient-shift", section: "Patient Operations", label: "Patient Shift Management", href: "/supervisor/patient-shift", icon: "\u{1F6CF}️", order: 330 },
  { key: "patient-operations.operations-centre", section: "Patient Operations", label: "Operations Centre", href: "/supervisor/patient-operations/operations-centre", icon: "\u{1F9FE}", order: 340 },
  { key: "patient-operations.patient-ops-center", section: "Patient Operations", label: "Patient Operations Centre", href: "/supervisor/patient-ops-center", icon: "\u{1F4CB}", order: 350 },

  // ── Workforce Operations ──
  { key: "workforce-operations.staffing", section: "Workforce Operations", label: "Staffing Allocation", href: "/supervisor/workforce-operations", icon: "\u{1F465}", order: 400 },
  { key: "workforce-operations.team-assignments", section: "Workforce Operations", label: "Team Assignments", href: "/supervisor/team-assignments", icon: "\u{1F9E9}", order: 410 },
  { key: "workforce-operations.assignment-engine", section: "Workforce Operations", label: "Assignment Engine", href: "/supervisor/assignment-engine", icon: "\u{1F9E0}", order: 420 },
  { key: "workforce-operations.attendance", section: "Workforce Operations", label: "Attendance & Fatigue", href: "/supervisor/attendance", icon: "\u{1F551}", order: 425 },
  { key: "workforce-operations.workload-intelligence", section: "Workforce Operations", label: "Workload Intelligence", href: "/supervisor/workload-intelligence", icon: "\u{2696}️", order: 430 },
  { key: "workforce-operations.competency", section: "Workforce Operations", label: "Competency Readiness", href: "/supervisor/workforce-operations#competency", icon: "\u{1F396}️", order: 440 },
  { key: "workforce-operations.break", section: "Workforce Operations", label: "Break Management", href: "/supervisor/workforce-operations#break", icon: "\u{2615}", order: 450 },

  // ── Resource & Capacity ──
  { key: "resource-capacity.beds", section: "Resource & Capacity", label: "Bed & Capacity", href: "/supervisor/bed-management", icon: "\u{1F6CF}️", order: 500 },
  { key: "resource-capacity.resources", section: "Resource & Capacity", label: "Equipment & Resources", href: "/supervisor/resources", icon: "\u{1F3D7}️", order: 510 },

  // ── Clinical Coordination: the escalation + concern loop with the bedside ──
  { key: "clinical-coordination.escalations", section: "Clinical Coordination", label: "Escalation Centre", href: "/supervisor/escalations", icon: "\u{2B06}️", badge: "escalations", order: 600 },
  { key: "clinical-coordination.concerns", section: "Clinical Coordination", label: "Nurse Concerns", href: "/supervisor/concerns", icon: "\u{1F6A9}", badge: "concerns", order: 610 },
  { key: "clinical-coordination.mdt", section: "Clinical Coordination", label: "MDT Coordination", href: "/supervisor/mdt", icon: "\u{1F91D}", badge: "mdtActions", order: 620 },

  // ── Task Centre ──
  { key: "task-centre.board", section: "Task Centre", label: "Task Board", href: "/supervisor/task-center", icon: "\u{1F4CB}", badge: "openTasks", order: 700 },
  { key: "task-centre.workflow", section: "Task Centre", label: "Workflow & Automation", href: "/supervisor/task-center#workflow", icon: "\u{1F500}", order: 710 },

  // ── Communication Centre ──
  { key: "communication.hub", section: "Communication Centre", label: "Operations Hub", href: "/supervisor/communication", icon: "\u{1F4E1}", order: 800 },
  { key: "communication.console", section: "Communication Centre", label: "Team Communications", href: "/supervisor/communication#console", icon: "\u{1F4AC}", badge: "unread", order: 810 },

  // ── Quality & Safety ──
  { key: "quality-safety.command-centre", section: "Quality & Safety", label: "Safety Command Centre", href: "/supervisor/quality-safety", icon: "\u{1F6E1}️", badge: "safety", order: 900 },

  // ── Analytics & Reporting ──
  { key: "operational-intelligence.overview", section: "Analytics & Reporting", label: "Operational Intelligence", href: "/supervisor/operational-intelligence", icon: "\u{1F4C8}", order: 1000 },

  // ── AI Operational Copilot ──
  { key: "ai-copilot.command-centre", section: "AI Operational Copilot", label: "AI Command Centre", href: "/supervisor/ai", icon: "\u{2728}", order: 1100 },

  // ── Workspace Configuration ──
  { key: "config-centre.workspace", section: "Workspace Configuration", label: "Configuration Centre", href: "/supervisor/config-centre", icon: "\u{2699}️", order: 1200 },
  { key: "config-centre.settings", section: "Workspace Configuration", label: "Workspace Settings", href: "/supervisor/settings", icon: "\u{1F39B}️", order: 1210 },
  { key: "config-centre.toolkit", section: "Workspace Configuration", label: "Professional Toolkit", href: "/supervisor/toolkit", icon: "\u{1F9F0}", order: 1220 },
];

export type SswResolvedItem = { key: string; label: string; href?: string; icon: string; badge?: string; exact?: boolean; soon?: boolean; order: number };
export type SswResolvedSection = { section: string | null; items: SswResolvedItem[] };

// Resolve the sidebar for one supervisor in one context. `provisioned` reports
// whether the override store answered — false means pure catalogue defaults.
export async function resolveSswNavigation(admin: any, ctx: ScopeCtx): Promise<{ provisioned: boolean; sections: SswResolvedSection[]; hidden: string[] }> {
  const { provisioned, rows } = await loadConfigOverrides(admin).catch(() => ({ provisioned: false, rows: [] as any[] }));
  const hidden: string[] = [];

  // Disabled sections remove their whole subtree.
  const sectionEnabled = new Map<string, boolean>();
  for (const s of SSW_SECTIONS) {
    const eff = resolveSettings(rows, ctx, `${SSW_CONFIG_PREFIX}.${s.key}`);
    sectionEnabled.set(s.label, eff.enabled);
    if (!eff.enabled) hidden.push(`${SSW_CONFIG_PREFIX}.${s.key}`);
  }

  const items = SSW_NAV_CATALOGUE
    .filter(rule => {
      if (rule.appRoles && !rule.appRoles.some(r => (ctx.roles ?? []).includes(r))) { hidden.push(`${SSW_CONFIG_PREFIX}.${rule.key}`); return false; }
      if (rule.section && sectionEnabled.get(rule.section) === false) return false;
      const eff = resolveSettings(rows, ctx, `${SSW_CONFIG_PREFIX}.${rule.key}`);
      if (!eff.enabled) { hidden.push(`${SSW_CONFIG_PREFIX}.${rule.key}`); return false; }
      return true;
    })
    .map(rule => {
      const eff = resolveSettings(rows, ctx, `${SSW_CONFIG_PREFIX}.${rule.key}`);
      return {
        key: rule.key, section: rule.section,
        label: eff.label ?? rule.label,
        href: rule.href, icon: rule.icon, badge: rule.badge, exact: rule.exact, soon: rule.soon,
        order: eff.order ?? rule.order,
      };
    })
    .sort((a, b) => a.order - b.order);

  const sections: SswResolvedSection[] = [];
  const index = new Map<string | null, SswResolvedSection>();
  for (const label of [null as string | null, ...SSW_SECTIONS.slice().sort((a, b) => a.order - b.order).map(s => s.label)]) {
    const sec: SswResolvedSection = { section: label, items: [] };
    index.set(label, sec);
    sections.push(sec);
  }
  for (const it of items) {
    const sec = index.get(it.section ?? null);
    if (!sec) continue;
    const { section: _s, ...item } = it;
    void _s;
    sec.items.push(item);
  }

  return { provisioned, sections: sections.filter(s => s.items.length > 0), hidden };
}
