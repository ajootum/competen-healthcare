// The five Learner Outcomes modules (Developer Functional Specification).
export type OutcomeModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: OutcomeModule[] = [
  { id: "success", n: 1, name: "Learning Success", icon: "🎓", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "Track academic success and programme completion." },
  { id: "competency", n: 2, name: "Competency Achievement", icon: "🛡️", tint: "bg-blue-50 text-blue-600", accent: "text-blue-600", desc: "Measure competency attainment and development." },
  { id: "clinical", n: 3, name: "Clinical Readiness", icon: "🩺", tint: "bg-orange-50 text-orange-600", accent: "text-orange-600", desc: "Assess readiness for safe independent practice." },
  { id: "certification", n: 4, name: "Certification Readiness", icon: "📜", tint: "bg-teal-50 text-teal-600", accent: "text-teal-600", desc: "Ensure all requirements are met for certification." },
  { id: "cpd", n: 5, name: "CPD Progress", icon: "📈", tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600", desc: "Track lifelong professional development." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
