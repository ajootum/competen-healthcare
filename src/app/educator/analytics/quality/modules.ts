// The eight Program Quality modules (Developer Functional Specification).
export type QualityModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: QualityModule[] = [
  { id: "program", n: 1, name: "Program KPIs", icon: "🏅", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "Executive overview of programme performance and quality." },
  { id: "faculty", n: 2, name: "Faculty KPIs", icon: "👨‍🏫", tint: "bg-blue-50 text-blue-600", accent: "text-blue-600", desc: "Measure educator performance and impact." },
  { id: "curriculum", n: 3, name: "Curriculum KPIs", icon: "📚", tint: "bg-teal-50 text-teal-600", accent: "text-teal-600", desc: "Evaluate curriculum design and alignment." },
  { id: "assessment", n: 4, name: "Assessment KPIs", icon: "📝", tint: "bg-orange-50 text-orange-600", accent: "text-orange-600", desc: "Assess assessment quality and effectiveness." },
  { id: "compliance", n: 5, name: "Compliance KPIs", icon: "🛡️", tint: "bg-green-50 text-green-600", accent: "text-green-600", desc: "Monitor compliance with policies and standards." },
  { id: "benchmarking", n: 6, name: "Benchmarking", icon: "📊", tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600", desc: "Compare performance with peers and benchmarks." },
  { id: "reviews", n: 7, name: "Annual Reviews", icon: "🗓️", tint: "bg-rose-50 text-rose-600", accent: "text-rose-600", desc: "Manage programme review cycles and improvements." },
  { id: "reports", n: 8, name: "Quality Reports", icon: "📄", tint: "bg-amber-50 text-amber-600", accent: "text-amber-600", desc: "Generate and share quality intelligence reports." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
