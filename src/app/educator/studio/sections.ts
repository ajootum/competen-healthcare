// Education Studio (Competency Design Studio) — the 7 sections and their
// modules. Each module links to a REAL educator-accessible builder or live
// view, or is a muted "soon" row where no backing store exists. hrefs stay
// inside the educator shell (never cross into /assessor/* which would redirect).

export type StudioModule = { n: number; icon: string; name: string; desc: string; href?: string; soon?: boolean };
export type StudioSection = { id: string; icon: string; title: string; sub: string; modules: StudioModule[] };

export const SECTIONS: StudioSection[] = [
  {
    id: "curriculum", icon: "🏛️", title: "Curriculum & Framework Design",
    sub: "Define what a workforce must know, demonstrate, maintain and progress through.",
    modules: [
      { n: 1, icon: "🗂️", name: "Competency Framework Builder", desc: "Frameworks, domains, competencies and criteria — the source of truth.", href: "/educator/studio/frameworks" },
      { n: 2, icon: "📚", name: "Curriculum Builder", desc: "Competency-based curricula from frameworks and CPUs.", soon: true },
      { n: 3, icon: "🎯", name: "Learning Outcomes", desc: "Measurable outcomes connecting competencies to learning.", soon: true },
      { n: 4, icon: "🛤️", name: "Learning Pathways", desc: "Structured learner journeys — live pathways from decision gaps.", href: "/educator/plans" },
      { n: 5, icon: "👥", name: "Role Competency Maps", desc: "What each role must demonstrate, at what level.", soon: true },
      { n: 6, icon: "🩺", name: "Specialty Frameworks", desc: "Specialty frameworks inheriting core standards.", href: "/educator/studio/frameworks" },
      { n: 7, icon: "🔗", name: "Competency Dependencies", desc: "Prerequisite and progression relationships.", href: "/educator/studio/gaps" },
    ],
  },
  {
    id: "assessment", icon: "📝", title: "Assessment Design Studio",
    sub: "Create, validate and continuously improve every assessment used across COMPETEN.",
    modules: [
      { n: 1, icon: "✍️", name: "Knowledge Test Builder", desc: "Governed MCQ banks with pass marks and validity.", href: "/educator/questions" },
      { n: 2, icon: "📋", name: "Clinical Skills Checklist Builder", desc: "Master checklists — sections, scoring, critical-fail items.", href: "/educator/studio/checklists" },
      { n: 3, icon: "🩹", name: "Workplace Assessment Builder", desc: "Mini-CEX / DOPS / CBD forms.", soon: true },
      { n: 4, icon: "🩺", name: "OSCE Blueprint Studio", desc: "OSCE exams, stations and circuits.", soon: true },
      { n: 5, icon: "🧪", name: "Simulation Scenario Studio", desc: "Scenarios, cases and the AI designer.", href: "/educator/simulation" },
      { n: 6, icon: "📁", name: "Case Library", desc: "Governed clinical cases for case-based learning.", href: "/educator/studio/knowledge" },
      { n: 7, icon: "✨", name: "AI Question Generator", desc: "Generate assessment content from competencies.", href: "/educator/studio/ai" },
      { n: 8, icon: "⚖️", name: "Assessment Templates", desc: "The governed Benner scale and scoring methods.", href: "/educator/studio/rubrics" },
    ],
  },
  {
    id: "content", icon: "🎬", title: "Learning Content Studio",
    sub: "Create, govern, version and analyse every learning asset within COMPETEN.",
    modules: [
      { n: 1, icon: "📖", name: "Course Builder", desc: "Courses, modules and CPD programmes.", href: "/educator/courses" },
      { n: 2, icon: "📄", name: "Lesson Builder", desc: "Lessons, blocks and knowledge checks.", soon: true },
      { n: 3, icon: "📚", name: "Clinical Library", desc: "Governed knowledge objects and clinical references.", href: "/educator/studio/knowledge" },
      { n: 4, icon: "🎥", name: "Videos & Media", desc: "Video and media asset management.", soon: true },
      { n: 5, icon: "🗂️", name: "Guidelines & Policies", desc: "Policies, guidelines and SOPs.", href: "/educator/studio/knowledge" },
      { n: 6, icon: "📱", name: "Microlearning Builder", desc: "Flash cards, mini-videos and quick-tips.", soon: true },
      { n: 7, icon: "🤖", name: "AI Tutor Configuration", desc: "Configure the personalised AI tutor.", soon: true },
    ],
  },
  {
    id: "mapping", icon: "🧭", title: "Blueprint & Mapping Centre",
    sub: "Align competencies, learning, assessment, evidence and standards across the org.",
    modules: [
      { n: 1, icon: "🎯", name: "Competency Mapping", desc: "Competency ↔ assessment and learning coverage.", href: "/educator/studio/gaps" },
      { n: 2, icon: "📊", name: "Assessment Mapping", desc: "Assessment blueprint coverage per competency.", href: "/educator/studio/gaps" },
      { n: 3, icon: "📚", name: "Curriculum Mapping", desc: "Curriculum coverage across phases.", soon: true },
      { n: 4, icon: "🛡️", name: "SafeCare Mapping", desc: "Map competencies to SafeCare standards.", soon: true },
      { n: 5, icon: "🏥", name: "JCI Mapping", desc: "Map to JCI accreditation standards.", soon: true },
      { n: 6, icon: "📋", name: "Regulatory Mapping", desc: "Map to regulatory requirements.", soon: true },
      { n: 7, icon: "🧩", name: "Gap Analysis", desc: "Critical and moderate coverage gaps.", href: "/educator/studio/gaps" },
      { n: 8, icon: "🕘", name: "Version Control", desc: "Mapping versions and change history.", href: "/educator/studio/versions" },
    ],
  },
  {
    id: "cko", icon: "💠", title: "CKO & CPU Studio",
    sub: "One governed object holding everything a competency needs — knowledge, assessment, evidence.",
    modules: [
      { n: 1, icon: "🧱", name: "CPU Builder", desc: "Reusable Clinical Practice Units and their blueprints.", href: "/educator/studio/cpus" },
      { n: 2, icon: "📚", name: "Clinical Knowledge Objects", desc: "The governed CKO library.", href: "/educator/studio/knowledge" },
      { n: 3, icon: "🧩", name: "Shared Components Library", desc: "Reusable checklists, questions and skills.", href: "/educator/studio/checklists" },
      { n: 4, icon: "🔗", name: "Reuse & Dependencies", desc: "Where each object is used across the platform.", href: "/educator/studio/analytics" },
      { n: 5, icon: "🛒", name: "CKO Marketplace", desc: "Install shared CKOs from other organisations.", soon: true },
      { n: 6, icon: "📈", name: "Object Analytics", desc: "Per-object usage, completion and coverage.", href: "/educator/studio/analytics" },
      { n: 7, icon: "🛡️", name: "Governance & Lifecycle", desc: "Object lifecycle status and review.", href: "/educator/studio/versions" },
      { n: 8, icon: "🕘", name: "Version Control", desc: "Object versions and impact analysis.", href: "/educator/studio/versions" },
    ],
  },
  {
    id: "ai", icon: "✨", title: "AI Studio",
    sub: "Intelligent tools to create, review and improve competency-based education.",
    modules: [
      { n: 1, icon: "📝", name: "AI Assessment Generator", desc: "Draft OSCE stations and checklists from competencies.", href: "/educator/studio/ai" },
      { n: 2, icon: "🧪", name: "AI Scenario Generator", desc: "Draft simulation scenarios grounded in competencies.", href: "/educator/simulation" },
      { n: 3, icon: "🧭", name: "AI Curriculum Advisor", desc: "Cohort narrative and coverage suggestions.", href: "/educator/studio/ai" },
      { n: 4, icon: "🧩", name: "AI Competency Gap Analysis", desc: "Identify current and future gaps.", href: "/educator/studio/gaps" },
      { n: 5, icon: "🔍", name: "AI Question Review", desc: "Review questions for quality and bias.", soon: true },
      { n: 6, icon: "📊", name: "AI Bloom's Optimiser", desc: "Optimise cognitive complexity distribution.", soon: true },
      { n: 7, icon: "✅", name: "AI Clinical Validator", desc: "Validate content against evidence.", soon: true },
      { n: 8, icon: "🎓", name: "AI Learning Assistant", desc: "Per-learner development plans.", href: "/educator/ai-insights" },
      { n: 9, icon: "📈", name: "AI Analytics & Intelligence", desc: "Data-driven learner insight.", href: "/educator/ai-insights" },
      { n: 10, icon: "🛡️", name: "AI Governance & Safety", desc: "Every AI action is quota-limited and audit-logged.", href: "/educator/studio/versions" },
    ],
  },
  {
    id: "publishing", icon: "🏛️", title: "Publishing & Governance",
    sub: "The control tower — nothing goes active until it passes governance.",
    modules: [
      { n: 1, icon: "✏️", name: "Draft Workspace", desc: "Objects still in draft across the studio.", href: "/educator/studio/versions" },
      { n: 2, icon: "👀", name: "Pending Review", desc: "Scores and evidence awaiting your review.", href: "/educator/validations" },
      { n: 3, icon: "🛡️", name: "Validation Centre", desc: "The full validation workflow.", href: "/educator/validations" },
      { n: 4, icon: "🕘", name: "Version History", desc: "Framework and object versions.", href: "/educator/studio/versions" },
      { n: 5, icon: "📣", name: "Publish Centre", desc: "Framework publishing lifecycle (governance).", soon: true },
      { n: 6, icon: "📦", name: "Archive Centre", desc: "Retired and superseded content.", soon: true },
      { n: 7, icon: "🔀", name: "Change Management", desc: "Content change trail from the audit log.", href: "/educator/studio/versions" },
      { n: 8, icon: "📅", name: "Review Calendar", desc: "Scheduled content reviews and meetings.", href: "/educator/meetings" },
      { n: 9, icon: "📊", name: "Governance Dashboard", desc: "Quality flags and validation analytics.", href: "/educator/quality-flags" },
      { n: 10, icon: "📋", name: "Audit & Compliance", desc: "The governed audit trail.", href: "/educator/studio/versions" },
    ],
  },
];

export const SECTION_BY_ID = new Map(SECTIONS.map(s => [s.id, s]));
