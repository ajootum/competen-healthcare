// The ten Intelligence Workspaces (AI & Intelligence Hub spec §3). Each deep-
// links into the live workspace that provides its intelligence — the hub is the
// orchestration layer, not a duplicate of the analytics it surfaces.
export type Workspace = { n: string; name: string; tagline: string; icon: string; href: string; from: string; to: string };

export const WORKSPACES: Workspace[] = [
  { n: "01", name: "AI Copilot", tagline: "Ask. Create. Automate.", icon: "🧠", href: "/dashboard/copilot", from: "#8b5cf6", to: "#6366f1" },
  { n: "02", name: "Curriculum Intelligence", tagline: "Analyze. Align. Improve.", icon: "📖", href: "/educator/analytics/curriculum", from: "#f59e0b", to: "#f97316" },
  { n: "03", name: "Assessment Intelligence", tagline: "Evaluate. Optimize. Assure.", icon: "📋", href: "/educator/analytics/assessment", from: "#3b82f6", to: "#06b6d4" },
  { n: "04", name: "Learning Intelligence", tagline: "Predict. Personalize. Support.", icon: "📈", href: "/educator/analytics/learning", from: "#22c55e", to: "#14b8a6" },
  { n: "05", name: "Competency Intelligence", tagline: "Mastery. Evidence. Progress.", icon: "🎯", href: "/educator/analytics/competency", from: "#14b8a6", to: "#0ea5e9" },
  { n: "06", name: "Educator Intelligence", tagline: "Support. Develop. Empower.", icon: "🧑‍🏫", href: "/educator/analytics/learning/faculty", from: "#a855f7", to: "#d946ef" },
  { n: "07", name: "Institution Intelligence", tagline: "Monitor. Manage. Improve.", icon: "🏛️", href: "/educator/analytics/quality", from: "#6366f1", to: "#8b5cf6" },
  { n: "08", name: "Accreditation Intelligence", tagline: "Comply. Monitor. Assure.", icon: "🛡️", href: "/educator/analytics/accreditation", from: "#ec4899", to: "#f43f5e" },
  { n: "09", name: "Predictive Intelligence", tagline: "Anticipate. Alert. Act.", icon: "🔮", href: "/educator/at-risk", from: "#06b6d4", to: "#0ea5e9" },
  { n: "10", name: "Executive Intelligence", tagline: "Strategize. Decide. Lead.", icon: "👑", href: "/educator/analytics/quality", from: "#eab308", to: "#f59e0b" },
];

// Node positions on the Institution Intelligence Map (% of the map container).
export const NODE_POS: Record<string, { x: number; y: number }> = {
  learners: { x: 50, y: 10 },
  competencies: { x: 24, y: 28 },
  curriculum: { x: 76, y: 28 },
  assessments: { x: 13, y: 56 },
  educators: { x: 87, y: 56 },
  institution: { x: 27, y: 88 },
  accreditation: { x: 50, y: 92 },
  predictions: { x: 73, y: 88 },
};
