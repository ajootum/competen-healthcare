// The three Improvement & Action Center modules (Developer Functional Specification).
export type ImpModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: ImpModule[] = [
  { id: "plans", n: 1, name: "Improvement Plans", icon: "📋", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "Plan, implement and evaluate quality improvement initiatives." },
  { id: "capa", n: 2, name: "CAPA", icon: "🔧", tint: "bg-green-50 text-green-600", accent: "text-green-600", desc: "Manage corrective and preventive actions effectively." },
  { id: "risks", n: 3, name: "Educational Risks", icon: "⚠️", tint: "bg-orange-50 text-orange-600", accent: "text-orange-600", desc: "Identify, assess and mitigate risks to educational success." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
