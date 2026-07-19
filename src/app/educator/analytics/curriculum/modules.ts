// The six Curriculum Analytics modules (Developer Functional Specification).
export type CurModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: CurModule[] = [
  { id: "effectiveness", n: 1, name: "Curriculum Effectiveness", icon: "🎓", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "How well each curriculum achieves its intended outcomes and competencies." },
  { id: "blueprint", n: 2, name: "Blueprint Analytics", icon: "🧭", tint: "bg-blue-50 text-blue-600", accent: "text-blue-600", desc: "Blueprint completeness, integrity and mapping alignment." },
  { id: "outcomes", n: 3, name: "Learning Outcomes", icon: "🎯", tint: "bg-teal-50 text-teal-600", accent: "text-teal-600", desc: "Achievement and attainment of intended learning outcomes." },
  { id: "cpus", n: 4, name: "CPU Analytics", icon: "💠", tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600", desc: "Performance and health of Clinical Practice Units." },
  { id: "content", n: 5, name: "Content Effectiveness", icon: "🎬", tint: "bg-rose-50 text-rose-600", accent: "text-rose-600", desc: "Performance and impact of learning resources." },
  { id: "gaps", n: 6, name: "Gap Analysis", icon: "🧩", tint: "bg-amber-50 text-amber-600", accent: "text-amber-600", desc: "Curriculum gaps driving improvement and accreditation readiness." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
