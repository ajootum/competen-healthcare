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
  // HWW-UI-005 s14 badge severity -> colour: critical=red (act now), warning=amber (needs attention), info=green (new).
  // Carried on the RULE, not derived from the count, because "4 unread messages" and "4 overdue
  // medications" are the same number and not remotely the same thing.
  severity?: "critical" | "warning" | "info";
  exact?: boolean;
  soon?: boolean;                           // no surface yet — rendered muted
  order: number;
  appRoles?: string[];                      // omitted = every role the workspace admits
  professions?: string[];                   // org roles; omitted = every profession
  unitTypes?: UnitType[];                   // omitted = every unit type
};

// The shipped catalogue. Order values leave gaps so tenant `order` overrides
// can slot entries between defaults without renumbering.
// HWW-UI-005 restructure. Every entry below points at a surface that EXISTS and a query that returns real
// rows -- the spec's assessment domains (pain, neurological, respiratory, fluid balance) are the
// observation_type values migration 039 already defines, and its quality events (near misses, equipment,
// HAI) are op_incidents' near_miss flag and incident_type values from migration 073. Nothing here is a
// label over an empty route.
//
// Keys were renamed to match the new structure. That orphans any WCE override written against the old
// paths; there are none (workspace_config_overrides is empty), so this is the moment to do it rather than
// carrying two vocabularies.
export const HWW_NAV_CATALOGUE: NavRule[] = [
  // §16 Home -> Dashboard.
  { key: "dashboard", section: null, label: "Dashboard", href: "/healthcare-worker", icon: "🏠", exact: true, order: 10 },

  // §4 workflow order: Assignments -> My Patients -> Medications -> My Tasks -> Handover. This is the
  // shape of a shift, not alphabetical or historical: you accept your patients before you can work them.
  { key: "shift.assignments", section: "Shift", label: "Assignments", href: "/healthcare-worker/inbox", icon: "📥", badge: "inbox", severity: "warning", order: 100 },   // §15
  { key: "shift.my-patients", section: "Shift", label: "My Patients", href: "/healthcare-worker/patients", icon: "🧑‍⚕️", order: 110 },
  { key: "shift.medications", section: "Shift", label: "Medications", href: "/healthcare-worker/medications", icon: "💊", badge: "medsDue", severity: "critical", order: 120 },  // §5
  { key: "shift.my-tasks", section: "Shift", label: "My Tasks", href: "/healthcare-worker/tasks", icon: "✅", badge: "myTasks", severity: "warning", order: 130 },
  { key: "shift.handover", section: "Shift", label: "Handover", href: "/healthcare-worker/handover", icon: "🔁", order: 140 },   // §6 transfer-of-responsibility icon

  // §2 Patient Assessment. The four domains beyond acuity/workload are filtered views of op_observations,
  // whose observation_type check constraint (migration 039) already names every one of them.
  { key: "clinical.vitals", section: "Clinical", group: "Patient Assessment", label: "Vitals",
    href: "/healthcare-worker/observations?type=vital_signs", icon: "📈", badge: "obsDue", severity: "critical", order: 200 },
  { key: "clinical.observations", section: "Clinical", group: "Patient Assessment", label: "Clinical Assessment",
    labelByUnit: { ward: "Clinical Assessment (PEWS)", icu: "Clinical Assessment" }, href: "/healthcare-worker/observations", icon: "🩺", order: 205 },
  { key: "clinical.acuity", section: "Clinical", group: "Patient Assessment", label: "Acuity",
    labelByUnit: { ward: "Acuity (PEWS)", icu: "Acuity (CIAF)" }, href: "/healthcare-worker/acuity", icon: "🌡️", order: 210 },
  { key: "clinical.workload", section: "Clinical", group: "Patient Assessment", label: "Workload",
    labelByUnit: { ward: "Workload", icu: "Workload (NAS)" }, href: "/healthcare-worker/workload", icon: "⚖️", order: 220 },
  { key: "clinical.pain", section: "Clinical", group: "Patient Assessment", label: "Pain",
    href: "/healthcare-worker/observations?type=pain", icon: "😖", order: 230 },
  { key: "clinical.neuro", section: "Clinical", group: "Patient Assessment", label: "Neurological",
    href: "/healthcare-worker/observations?type=neuro", icon: "🧠", order: 240 },
  { key: "clinical.respiratory", section: "Clinical", group: "Patient Assessment", label: "Respiratory",
    href: "/healthcare-worker/observations?type=respiratory", icon: "🫁", order: 250 },
  { key: "clinical.fluid-balance", section: "Clinical", group: "Patient Assessment", label: "Fluid Balance",
    href: "/healthcare-worker/observations?type=fluid_balance", icon: "💧", order: 260 },

  { key: "clinical.alerts", section: "Clinical", label: "Alerts & Escalations", href: "/healthcare-worker/safety", icon: "🚨", badge: "alerts", severity: "critical", order: 270 },  // §3
  // §1 Procedures is ACTIVE. Never `soon` -- a greyed clinical module reads as "this hospital does not do
  // procedures" rather than "we have not built the page", and the page itself now says which it is.
  { key: "clinical.procedures", section: "Clinical", label: "Procedures", href: "/healthcare-worker/procedures", icon: "🩹", order: 280 },

  // §7 Messages and Unit Announcements merge into one Communication module; its tabs carry the split.
  { key: "communication.hub", section: "Communication", label: "Communication", href: "/healthcare-worker/communication", icon: "💬", badge: "unread", severity: "info", order: 300 },

  // §8 Quality Events, every one a real filter over op_incidents / op_concerns / op_safety_alerts.
  { key: "quality.incidents", section: "Quality Events", group: "Quality Events", label: "Incidents", href: "/healthcare-worker/safety?event=incidents", icon: "🚩", order: 400 },
  { key: "quality.near-misses", section: "Quality Events", group: "Quality Events", label: "Near Misses", href: "/healthcare-worker/safety?event=near_miss", icon: "⚡", order: 410 },
  { key: "quality.concerns", section: "Quality Events", group: "Quality Events", label: "Nurse Concerns", href: "/healthcare-worker/concerns", icon: "⚠️", badge: "concerns", severity: "warning", order: 420 },
  { key: "quality.patient-safety", section: "Quality Events", group: "Quality Events", label: "Patient Safety", href: "/healthcare-worker/safety?event=alerts", icon: "🛡️", order: 430 },
  { key: "quality.equipment", section: "Quality Events", group: "Quality Events", label: "Equipment Issues", href: "/healthcare-worker/safety?event=equipment", icon: "🔌", order: 440 },
  { key: "quality.hai", section: "Quality Events", group: "Quality Events", label: "HAI Surveillance", href: "/healthcare-worker/safety?event=infection", icon: "🦠", order: 450 },

  // §9 the standalone Intelligence section is gone; the copilot is the floating action the layout already
  // renders on every HWW screen, so a nav row for it was a second door to the same place.

  // §10 Reports moves under Tools.
  { key: "tools.settings", section: "Tools", label: "Settings", href: "/dashboard/preferences", icon: "⚙️", order: 600 },
  { key: "tools.reports", section: "Tools", label: "Reports", href: "/healthcare-worker/shift-summary", icon: "📊", order: 610 },
  // Points at /dashboard/help, the support surface that exists. The spec says "Support"; inventing
  // /dashboard/support to match the word would have shipped a 404 behind a nav row.
  { key: "tools.support", section: "Tools", label: "Support", href: "/dashboard/help", icon: "❓", order: 620 },
  // The spec's §10 lists "About" but its own Final Navigation omits it, and no About surface exists.
  // Left out rather than added as a dead row -- the one thing §1 is explicitly against.
];

// Section order + their config paths (sections are configurable objects too —
// disabling a section hides everything inside it).
export const HWW_SECTIONS: { key: string; label: string; order: number }[] = [
  { key: "shift", label: "Shift", order: 100 },
  { key: "clinical", label: "Clinical", order: 200 },
  { key: "communication", label: "Communication", order: 300 },
  { key: "quality", label: "Quality Events", order: 400 },
  { key: "tools", label: "Tools", order: 600 },
];

export type ResolvedItem = { key: string; label: string; href?: string; icon: string; badge?: string; severity?: "critical" | "warning" | "info"; exact?: boolean; soon?: boolean; group?: string; order: number };
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
