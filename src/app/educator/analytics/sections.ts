// Analytics & Quality workspace architecture (UI & Developer Spec §2, §5).
// Eight sections, each with the spec's sub-modules. A module links out only
// when a live backing page already exists; everything else renders as an
// honest "soon" chip — visible structure, no dead links.

export type AnalyticsModule = { name: string; href?: string; soon?: boolean };
export type AnalyticsSection = {
  id: string; n: number; name: string; icon: string; tint: string; accent: string;
  desc: string; modules: AnalyticsModule[];
};

export const SECTIONS: AnalyticsSection[] = [
  {
    id: "learning", n: 1, name: "Learning Analytics", icon: "📊",
    tint: "bg-purple-50 text-purple-600", accent: "text-purple-600",
    desc: "Monitor learning performance, engagement and progress across all learners.",
    modules: [
      { name: "Learner Analytics", href: "/educator/analytics/learning/learners" },
      { name: "Cohort Analytics", href: "/educator/analytics/learning/cohorts" },
      { name: "Course Analytics", href: "/educator/analytics/learning/courses" },
      { name: "Faculty Analytics", href: "/educator/analytics/learning/faculty" },
      { name: "Trend Analytics", href: "/educator/analytics/learning/trends" },
      { name: "Custom Dashboards", href: "/educator/analytics/learning/custom" },
    ],
  },
  {
    id: "competency", n: 2, name: "Competency Analytics", icon: "🎯",
    tint: "bg-blue-50 text-blue-600", accent: "text-blue-600",
    desc: "Analyse competency achievement, mastery and identify gaps.",
    modules: [
      { name: "Competency Coverage", href: "/educator/analytics/competency/coverage" },
      { name: "Competency Achievement", href: "/educator/analytics/competency/achievement" },
      { name: "Competency Heatmaps", href: "/educator/analytics/competency/heatmaps" },
      { name: "Competency Gaps", href: "/educator/analytics/competency/gaps" },
      { name: "Domain Performance", href: "/educator/analytics/competency/domains" },
      { name: "Skill Mastery", href: "/educator/analytics/competency/skills" },
      { name: "Competency Trends", href: "/educator/analytics/competency/trends" },
    ],
  },
  {
    id: "curriculum", n: 3, name: "Curriculum Analytics", icon: "📚",
    tint: "bg-teal-50 text-teal-600", accent: "text-teal-600",
    desc: "Evaluate curriculum effectiveness, outcomes and blueprint alignment.",
    modules: [
      { name: "Curriculum Effectiveness", href: "/educator/analytics/curriculum/effectiveness" },
      { name: "Blueprint Analytics", href: "/educator/analytics/curriculum/blueprint" },
      { name: "Learning Outcomes", href: "/educator/analytics/curriculum/outcomes" },
      { name: "CPU Analytics", href: "/educator/analytics/curriculum/cpus" },
      { name: "Content Effectiveness", href: "/educator/analytics/curriculum/content" },
      { name: "Gap Analysis", href: "/educator/analytics/curriculum/gaps" },
    ],
  },
  {
    id: "assessment", n: 4, name: "Assessment Analytics", icon: "📝",
    tint: "bg-orange-50 text-orange-600", accent: "text-orange-600",
    desc: "Assess assessment quality, reliability, validity and performance.",
    modules: [
      { name: "Assessment Performance", href: "/educator/analytics/assessment/performance" },
      { name: "Question Analytics", href: "/educator/analytics/assessment/questions" },
      { name: "Reliability & Validity", href: "/educator/analytics/assessment/reliability" },
      { name: "Blueprint Performance", href: "/educator/analytics/assessment/blueprint" },
      { name: "Difficulty Analysis", href: "/educator/analytics/assessment/difficulty" },
    ],
  },
  {
    id: "outcomes", n: 5, name: "Learner Outcomes", icon: "🎓",
    tint: "bg-indigo-50 text-indigo-600", accent: "text-indigo-600",
    desc: "Track outcomes, readiness, certification and career progression.",
    modules: [
      { name: "Learning Success", href: "/educator/analytics/outcomes/success" },
      { name: "Competency Achievement", href: "/educator/analytics/outcomes/competency" },
      { name: "Clinical Readiness", href: "/educator/analytics/outcomes/clinical" },
      { name: "Certification Readiness", href: "/educator/analytics/outcomes/certification" },
      { name: "CPD Progress", href: "/educator/analytics/outcomes/cpd" },
      { name: "Portfolio Completion", href: "/educator/approvals" },
    ],
  },
  {
    id: "quality", n: 6, name: "Program Quality", icon: "🛡️",
    tint: "bg-green-50 text-green-600", accent: "text-green-600",
    desc: "Monitor programme KPIs, benchmark performance and quality indicators.",
    modules: [
      { name: "Program KPIs", href: "/educator/analytics/quality/program" },
      { name: "Faculty KPIs", href: "/educator/analytics/quality/faculty" },
      { name: "Curriculum KPIs", href: "/educator/analytics/quality/curriculum" },
      { name: "Assessment KPIs", href: "/educator/analytics/quality/assessment" },
      { name: "Compliance KPIs", href: "/educator/analytics/quality/compliance" },
      { name: "Benchmarking", href: "/educator/analytics/quality/benchmarking" },
      { name: "Annual Reviews", href: "/educator/analytics/quality/reviews" },
      { name: "Quality Reports", href: "/educator/analytics/quality/reports" },
    ],
  },
  {
    id: "accreditation", n: 7, name: "Accreditation & Standards", icon: "📜",
    tint: "bg-rose-50 text-rose-600", accent: "text-rose-600",
    desc: "Monitor compliance, accreditation and audit readiness.",
    modules: [
      { name: "Standards Compliance", href: "/educator/analytics/accreditation/standards" },
      { name: "Accreditation Reports", href: "/educator/analytics/accreditation/reports" },
      { name: "Evidence Repository", href: "/educator/analytics/accreditation/evidence" },
      { name: "Regulatory Mapping", href: "/educator/analytics/accreditation/mapping" },
      { name: "Audit Readiness", href: "/educator/analytics/accreditation/audit" },
      { name: "Quality Documents", href: "/educator/analytics/accreditation/documents" },
      { name: "Improvement Tracking", href: "/educator/analytics/accreditation/improvement" },
    ],
  },
  {
    id: "improvement", n: 8, name: "Improvement Centre", icon: "🎯",
    tint: "bg-amber-50 text-amber-600", accent: "text-amber-600",
    desc: "Manage improvement plans, CAPA, risks and AI recommendations.",
    modules: [
      { name: "Improvement Plans", href: "/educator/analytics/improvement/plans" },
      { name: "CAPA", href: "/educator/analytics/improvement/capa" },
      { name: "Educational Risks", href: "/educator/analytics/improvement/risks" },
      { name: "AI Recommendations", href: "/educator/ai-insights" },
      { name: "Follow-up Tracker", href: "/educator/meetings" },
    ],
  },
];

export const SECTION_BY_ID = new Map(SECTIONS.map(s => [s.id, s]));
