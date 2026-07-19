// The seven Competency Analytics modules (Developer Functional Specification).
export type CompModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: CompModule[] = [
  { id: "coverage", n: 1, name: "Competency Coverage", icon: "🗂️", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "How competencies are mapped and covered across learning, assessment and evidence." },
  { id: "achievement", n: 2, name: "Competency Achievement", icon: "🎯", tint: "bg-blue-50 text-blue-600", accent: "text-blue-600", desc: "The extent to which learners have achieved required competencies." },
  { id: "heatmaps", n: 3, name: "Competency Heatmaps", icon: "🔥", tint: "bg-rose-50 text-rose-600", accent: "text-rose-600", desc: "Visual competency performance across learners, cohorts and domains." },
  { id: "gaps", n: 4, name: "Competency Gaps", icon: "🧩", tint: "bg-amber-50 text-amber-600", accent: "text-amber-600", desc: "Gaps between required and demonstrated competency levels." },
  { id: "domains", n: 5, name: "Domain Performance", icon: "📊", tint: "bg-teal-50 text-teal-600", accent: "text-teal-600", desc: "Competency performance across clinical and professional domains." },
  { id: "skills", n: 6, name: "Skill Mastery", icon: "🛠️", tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600", desc: "Procedural and behavioural skill mastery, recency and evidence quality." },
  { id: "trends", n: 7, name: "Competency Trends", icon: "📈", tint: "bg-green-50 text-green-600", accent: "text-green-600", desc: "How competency, gaps, mastery and readiness change over time." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
