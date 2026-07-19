// The six Learning Analytics modules (Developer Functional Specification).
export type LearningModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: LearningModule[] = [
  { id: "learners", n: 1, name: "Learner Analytics", icon: "👤", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "Individual learner intelligence — engagement, behaviour and risk prediction." },
  { id: "cohorts", n: 2, name: "Cohort Analytics", icon: "👥", tint: "bg-blue-50 text-blue-600", accent: "text-blue-600", desc: "Compare cohorts, benchmark performance and surface AI insights." },
  { id: "courses", n: 3, name: "Course Analytics", icon: "📚", tint: "bg-teal-50 text-teal-600", accent: "text-teal-600", desc: "Course effectiveness, learning journey and content optimisation." },
  { id: "faculty", n: 4, name: "Faculty Analytics", icon: "🎓", tint: "bg-orange-50 text-orange-600", accent: "text-orange-600", desc: "Educator performance, teaching activity and benchmarking." },
  { id: "trends", n: 5, name: "Trend Analytics", icon: "📈", tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600", desc: "Time-series analysis, institutional trends and forecasting." },
  { id: "custom", n: 6, name: "Custom Builder", icon: "🧩", tint: "bg-rose-50 text-rose-600", accent: "text-rose-600", desc: "Build your own dashboards and ask questions in natural language." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
