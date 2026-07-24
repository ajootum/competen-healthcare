// Patient Operations configuration schema (POS-112). The coded DEFAULTS + shape for the governed
// rule store (op_config_rules, migration 086). A rule with no tenant override falls back to its
// default here — so the surface is always populated with an honest, meaningful value rather than a
// blank. Only keys defined here are accepted by the config API (allow-list). `consumerNote` states
// where each domain is consumed; wiring every consumer to read these overrides is progressive and
// called out honestly on the surface.

export type ConfigRule = { key: string; label: string; type: "minutes" | "score"; default: number; help?: string };
export type ConfigDomain = { domain: string; name: string; icon: string; consumerNote: string; rules: ConfigRule[] };

export const CONFIG_SCHEMA: ConfigDomain[] = [
  {
    domain: "observation", name: "Observation Rules", icon: "🌡️",
    consumerNote: "Observation frequency by acuity. Consumed by the observation scheduler & compliance monitor (POS-107) — progressive wiring.",
    rules: [
      { key: "obs_freq_critical", label: "Critical acuity — observe every", type: "minutes", default: 15 },
      { key: "obs_freq_high", label: "High acuity — observe every", type: "minutes", default: 30 },
      { key: "obs_freq_moderate", label: "Moderate acuity — observe every", type: "minutes", default: 60 },
      { key: "obs_freq_stable", label: "Stable — observe every", type: "minutes", default: 240 },
    ],
  },
  {
    domain: "escalation", name: "Escalation Thresholds", icon: "🚨",
    consumerNote: "PEWS bands + response SLA. Consumed by Clinical Safety (POS-107) & the Operational Pressure Score (POS-101) — progressive wiring.",
    rules: [
      { key: "pews_escalate", label: "PEWS score to trigger escalation", type: "score", default: 5 },
      { key: "pews_critical", label: "PEWS score classed as critical", type: "score", default: 7 },
      { key: "response_sla_min", label: "Escalation response SLA", type: "minutes", default: 15 },
    ],
  },
];

// Honest next-phase configuration domains (structure lives operationally; the rest need their stores).
export const CONFIG_NEXT_PHASE = [
  { name: "Bed & Ward Types", icon: "🛏️", note: "Bed/ward types & isolation categories are live in op_beds + ward config; a governed type registry with effective-dating is next-phase." },
  { name: "Forms & Custom Fields", icon: "📝", note: "Form templates run today (POS-106); tenant-configurable field templates & custom fields need a template store (next-phase)." },
  { name: "Permissions", icon: "🔐", note: "Role/unit/field capabilities are enforced by platform IAM + per-page gates; a configurable permission matrix is next-phase." },
  { name: "AI Rules", icon: "✨", note: "Pressure-score weights & recommendation policy are rule-based today; a governed AI-rules store is next-phase." },
];

export const configRule = (domain: string, key: string) =>
  CONFIG_SCHEMA.find(d => d.domain === domain)?.rules.find(r => r.key === key) ?? null;
