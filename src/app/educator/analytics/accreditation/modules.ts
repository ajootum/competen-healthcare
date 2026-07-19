// The seven Accreditation & Standards modules (Developer Functional Specification).
export type AccModule = { id: string; n: number; name: string; icon: string; tint: string; accent: string; desc: string };

export const MODULES: AccModule[] = [
  { id: "standards", n: 1, name: "Standards Compliance", icon: "🛡️", tint: "bg-purple-50 text-purple-600", accent: "text-purple-600", desc: "Monitor compliance with all applicable standards." },
  { id: "reports", n: 2, name: "Accreditation Reports", icon: "📋", tint: "bg-green-50 text-green-600", accent: "text-green-600", desc: "Create, manage and submit accreditation reports." },
  { id: "evidence", n: 3, name: "Evidence Repository", icon: "🗄️", tint: "bg-blue-50 text-blue-600", accent: "text-blue-600", desc: "Central repository for all compliance evidence." },
  { id: "mapping", n: 4, name: "Regulatory Mapping", icon: "🧭", tint: "bg-orange-50 text-orange-600", accent: "text-orange-600", desc: "Map requirements to programmes and frameworks." },
  { id: "audit", n: 5, name: "Audit Readiness", icon: "✅", tint: "bg-teal-50 text-teal-600", accent: "text-teal-600", desc: "Assess readiness for internal and external audits." },
  { id: "documents", n: 6, name: "Quality Documents", icon: "📄", tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600", desc: "Manage policies, procedures and quality documents." },
  { id: "improvement", n: 7, name: "Improvement Tracking", icon: "📈", tint: "bg-amber-50 text-amber-600", accent: "text-amber-600", desc: "Track corrective actions and improvement initiatives." },
];

export const MODULE_BY_ID = new Map(MODULES.map(m => [m.id, m]));
