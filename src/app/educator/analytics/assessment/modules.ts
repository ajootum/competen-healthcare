// The five Assessment Analytics modules (Developer Functional Specification).
export type AsmModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: AsmModule[] = [
  { id: "performance", n: 1, name: "Assessment Performance", icon: "📊", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "Overall performance of assessments across programs and cohorts." },
  { id: "questions", n: 2, name: "Question Analytics", icon: "❓", tint: "bg-blue-50 text-blue-600", accent: "text-blue-600", desc: "Item analysis and quality across the question bank." },
  { id: "reliability", n: 3, name: "Reliability & Validity", icon: "🎯", tint: "bg-teal-50 text-teal-600", accent: "text-teal-600", desc: "Reliability, validity and consistency of assessments." },
  { id: "blueprint", n: 4, name: "Blueprint Performance", icon: "🧭", tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600", desc: "Alignment of assessments with the approved blueprint." },
  { id: "difficulty", n: 5, name: "Difficulty Analysis", icon: "⚖️", tint: "bg-rose-50 text-rose-600", accent: "text-rose-600", desc: "Difficulty level and challenge balance of assessments." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
