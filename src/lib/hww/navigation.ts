// HWW navigation engine (HWW-UI-001 "Role-Adaptive Navigation") — the sidebar
// is GENERATED from workspace configuration rather than hard-coded.
//
// Three inputs decide what a clinician sees:
//   1. This CATALOGUE — the code-side source of truth (the WCE convention:
//      catalogue in code, sparse overrides in the DB, so runtime never depends
//      on the DB being populated).
//   2. Visibility rules per entry — appRoles (portal tier), professions (org
//      roles: healthcare_worker, charge_nurse, and future doctor/pharmacist/
//      therapist), and unitTypes (ward | icu). Adding a profession is a
//      catalogue + org-role change; the resolver never changes.
//   3. WCE overrides (workspace_config_overrides) resolved along
//      platform → tenant → hospital → unit → role → user, carrying
//      {enabled, label, order} — so a hospital can hide, rename or reorder any
//      module without a deployment, through the existing WCE Designer.
//
// Fail-soft by construction: no override table (or an error) → every entry
// resolves to its catalogue default, i.e. exactly the shipped sidebar.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadConfigOverrides, resolveSettings, type ScopeCtx } from "@/lib/config/workspace-config";

export const HWW_CONFIG_PREFIX = "healthcare-worker";
export type UnitType = "ward" | "icu";

export type NavRule = {
  key: string;                              // config path suffix — "shift.my-patients"
  section: string | null;                   // null = above the first section header
  group?: string;                           // collapsible group inside a section
  label: string;
  labelByUnit?: Partial<Record<UnitType, string>>;  // context-aware default label
  href?: string;
  icon: string;
  badge?: string;
  // HWW-UI-005B s3 "improve badge styling and severity visibility while maintaining existing behaviour".
  // Severity is declared on the RULE, not derived from the count: "4 unread messages" and "4 overdue
  // medications" are the same number and not remotely the same thing. Vocabulary matches the amendment's
  // badge key exactly -- critical (red, immediate action), high (amber, needs attention), normal (blue,
  // updates/unread) -- rather than a private one that would have to be translated at every read.
  severity?: "critical" | "high" | "normal";
  exact?: boolean;
  soon?: boolean;                           // no surface yet — rendered muted
  order: number;
  appRoles?: string[];                      // omitted = every role the workspace admits
  professions?: string[];                   // org roles; omitted = every profession
  unitTypes?: UnitType[];                   // omitted = every unit type
};

// The shipped catalogue. Order values leave gaps so tenant `order` overrides
// can slot entries between defaults without renumbering.
//
// HWW-UI-005B (rollback amendment) — this list is the previously approved architecture, restored verbatim
// from the pre-amendment commit rather than retyped, so no rename, reorder or merge could survive by
// accident. The amendment permits exactly TWO deltas to it: Procedures is no longer `soon`, and badged
// entries declare a severity. Nothing else here may change without a new spec.
export const HWW_NAV_CATALOGUE: NavRule[] = [
  { key: "home", section: null, label: "Home", href: "/healthcare-worker", icon: "🏠", exact: true, order: 10 },

  { key: "shift.my-patients", section: "Shift", label: "My Patients", href: "/healthcare-worker/patients", icon: "🧑‍⚕️", order: 100 },
  { key: "shift.my-tasks", section: "Shift", label: "My Tasks", href: "/healthcare-worker/tasks", icon: "✅", badge: "myTasks", severity: "normal", order: 110 },
  { key: "shift.medication-schedule", section: "Shift", label: "Medication Schedule", href: "/healthcare-worker/medications", icon: "💊", badge: "medsDue", severity: "critical", order: 120 },
  { key: "shift.assignment-inbox", section: "Shift", label: "Assignment Inbox", href: "/healthcare-worker/inbox", icon: "📥", badge: "inbox", severity: "high", order: 130 },
  { key: "shift.handover", section: "Shift", label: "Handover", href: "/healthcare-worker/handover", icon: "🔄", order: 140 },

  { key: "clinical.observations", section: "Clinical", group: "Clinical Assessment", label: "Observations & PEWS",
    labelByUnit: { icu: "Observations & Vitals" }, href: "/healthcare-worker/observations", icon: "📈", badge: "obsDue", severity: "critical", order: 200 },
  { key: "clinical.acuity", section: "Clinical", group: "Clinical Assessment", label: "Acuity Assessment",
    labelByUnit: { ward: "Ward Acuity (PEWS)", icu: "ICU Acuity (CIAF)" }, href: "/healthcare-worker/acuity", icon: "🌡️", order: 210 },
  { key: "clinical.workload", section: "Clinical", group: "Clinical Assessment", label: "Workload Assessment",
    labelByUnit: { ward: "Ward Workload", icu: "ICU Workload (NAS)" }, href: "/healthcare-worker/workload", icon: "⚖️", order: 220 },
  { key: "clinical.escalations", section: "Clinical", label: "Escalations", href: "/healthcare-worker/safety", icon: "🚨", badge: "alerts", severity: "critical", order: 230 },
  // s3: ungreyed and always selectable, in its ORIGINAL location. It keeps a destination because a
  // selectable module that goes nowhere is the same dead end wearing a different colour.
  { key: "clinical.procedures", section: "Clinical", label: "Procedures", href: "/healthcare-worker/procedures", icon: "🩹", order: 240 },

  { key: "communication.messages", section: "Communication", label: "Messages", href: "/healthcare-worker/communication", icon: "💬", badge: "unread", severity: "normal", order: 300 },
  { key: "communication.announcements", section: "Communication", label: "Unit Announcements", href: "/healthcare-worker/communication#announcements", icon: "📣", order: 310 },

  { key: "quality.incidents", section: "Quality Events", label: "Incidents", href: "/healthcare-worker/safety#incidents", icon: "🚩", order: 400 },
  { key: "quality.concerns", section: "Quality Events", label: "Nurse Concerns", href: "/healthcare-worker/concerns", icon: "⚠️", badge: "concerns", severity: "high", order: 410 },

  { key: "intelligence.copilot", section: "Intelligence", label: "AI Copilot", href: "/healthcare-worker/copilot", icon: "✨", order: 500 },

  { key: "tools.reports", section: "Tools", label: "Reports", href: "/healthcare-worker/shift-summary", icon: "📋", order: 600 },
  { key: "tools.settings", section: "Tools", label: "Settings", href: "/dashboard/preferences", icon: "⚙️", order: 610 },
];

// Section order + their config paths (sections are configurable objects too —
// disabling a section hides everything inside it).
export const HWW_SECTIONS: { key: string; label: string; order: number }[] = [
  { key: "shift", label: "Shift", order: 100 },
  { key: "clinical", label: "Clinical", order: 200 },
  { key: "communication", label: "Communication", order: 300 },
  { key: "quality", label: "Quality Events", order: 400 },
  { key: "intelligence", label: "Intelligence", order: 500 },
  { key: "tools", label: "Tools", order: 600 },
];

export type ResolvedItem = { key: string; label: string; href?: string; icon: string; badge?: string; severity?: "critical" | "high" | "normal"; exact?: boolean; soon?: boolean; group?: string; order: number };
export type ResolvedSection = { section: string | null; entries: ({ item: ResolvedItem } | { group: string; items: ResolvedItem[] })[] };
export type NavContext = ScopeCtx & { professions?: string[]; unitType?: UnitType };

function visible(rule: NavRule, ctx: NavContext): boolean {
  if (rule.appRoles && !rule.appRoles.some(r => (ctx.roles ?? []).includes(r))) return false;
  if (rule.professions && !rule.professions.some(p => (ctx.professions ?? []).includes(p))) return false;
  if (rule.unitTypes && ctx.unitType && !rule.unitTypes.includes(ctx.unitType)) return false;
  return true;
}

// Resolve the sidebar for one clinician in one context. `provisioned` reports
// whether the override store answered — false means pure catalogue defaults.
export async function resolveHwwNavigation(admin: any, ctx: NavContext): Promise<{ provisioned: boolean; sections: ResolvedSection[]; hidden: string[] }> {
  const { provisioned, rows } = await loadConfigOverrides(admin).catch(() => ({ provisioned: false, rows: [] as any[] }));
  // Role-scope overrides match on ctx.roles — include professions so a rule can
  // be scoped to "charge_nurse" as well as "nurse".
  const scopeCtx: ScopeCtx = { ...ctx, roles: [...(ctx.roles ?? []), ...(ctx.professions ?? [])] };
  const hidden: string[] = [];

  // Disabled sections remove their whole subtree.
  const sectionEnabled = new Map<string, boolean>();
  for (const s of HWW_SECTIONS) {
    const eff = resolveSettings(rows, scopeCtx, `${HWW_CONFIG_PREFIX}.${s.key}`);
    sectionEnabled.set(s.label, eff.enabled);
    if (!eff.enabled) hidden.push(`${HWW_CONFIG_PREFIX}.${s.key}`);
  }

  const items = HWW_NAV_CATALOGUE
    .filter(rule => {
      if (!visible(rule, ctx)) { hidden.push(`${HWW_CONFIG_PREFIX}.${rule.key}`); return false; }
      if (rule.section && sectionEnabled.get(rule.section) === false) return false;
      const eff = resolveSettings(rows, scopeCtx, `${HWW_CONFIG_PREFIX}.${rule.key}`);
      if (!eff.enabled) { hidden.push(`${HWW_CONFIG_PREFIX}.${rule.key}`); return false; }
      return true;
    })
    .map(rule => {
      const eff = resolveSettings(rows, scopeCtx, `${HWW_CONFIG_PREFIX}.${rule.key}`);
      const contextual = (ctx.unitType && rule.labelByUnit?.[ctx.unitType]) || rule.label;
      return {
        key: rule.key, section: rule.section, group: rule.group,
        label: eff.label ?? contextual,
        href: rule.href, icon: rule.icon, badge: rule.badge, severity: rule.severity, exact: rule.exact, soon: rule.soon,
        order: eff.order ?? rule.order,
      };
    })
    .sort((a, b) => a.order - b.order);

  // Group into sections, preserving section order and collapsing groups.
  const sections: ResolvedSection[] = [];
  const sectionIndex = new Map<string | null, ResolvedSection>();
  const orderedSectionLabels = [null as string | null, ...HWW_SECTIONS.slice().sort((a, b) => a.order - b.order).map(s => s.label)];
  for (const label of orderedSectionLabels) {
    const sec: ResolvedSection = { section: label, entries: [] };
    sectionIndex.set(label, sec);
    sections.push(sec);
  }
  for (const it of items) {
    const sec = sectionIndex.get(it.section ?? null);
    if (!sec) continue;
    const { section: _s, ...item } = it;
    void _s;
    if (item.group) {
      const existing = sec.entries.find(e => "group" in e && e.group === item.group) as { group: string; items: ResolvedItem[] } | undefined;
      if (existing) existing.items.push(item);
      else sec.entries.push({ group: item.group, items: [item] });
    } else sec.entries.push({ item });
  }

  return { provisioned, sections: sections.filter(s => s.entries.length > 0), hidden };
}

// Resolve the clinician's UNIT TYPE from their real operational context: the
// bed types of the patients they hold, else their shift's unit beds. ICU wins
// when any critical-care bed is in play (the higher-acuity toolset is the safe
// default). Fail-soft → "ward".
export async function resolveUnitContext(admin: any, userId: string, shiftUnitId: string | null): Promise<UnitType> {
  try {
    const { data: asg } = await admin.from("op_patient_assignments")
      .select("op_patients!patient_id(op_beds!bed_id(bed_type))")
      .eq("staff_id", userId).eq("status", "active").limit(50);
    const bedTypes = ((asg ?? []) as any[]).map(a => a.op_patients?.op_beds?.bed_type).filter(Boolean);
    if (bedTypes.includes("critical_care")) return "icu";
    if (bedTypes.length) return "ward";
    if (shiftUnitId) {
      const { data: beds } = await admin.from("op_beds").select("bed_type").eq("unit_id", shiftUnitId).limit(100);
      if (((beds ?? []) as any[]).some(b => b.bed_type === "critical_care")) return "icu";
    }
    return "ward";
  } catch {
    return "ward";
  }
}
