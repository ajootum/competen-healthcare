// COMP-HOME-001 — public homepage content.
//
// Every string on the homepage lives here rather than in JSX. The spec asks for sections to be
// "CMS-configurable for content updates without code changes"; there is no CMS, and pretending otherwise
// would be worse than saying so. This is the honest half of that requirement: copy, links and ordering are
// data, so a content change is a one-file edit with no JSX surgery, and a CMS fetch can later replace this
// module's exports without the page components changing at all.
//
// LINK POLICY, learned the hard way in the HWW sidebar: a nav row to a page that does not exist looks
// identical to a working one until someone clicks it. Only /login and /signup exist as public routes today,
// so every other destination here is an ON-PAGE ANCHOR. `planned: true` marks the ones the spec wants as
// dedicated pages; they are rendered as anchors until those pages exist, and the flag is what a future
// build reads to switch them over.

export type Link = { label: string; href: string; planned?: boolean };

export const BRAND = {
  name: "Competen",
  tagline: "Healthcare Competency & Workforce Platform",
  eyebrow: "Healthcare Workforce Intelligence Platform",
};

export const HERO = {
  // Three lines, deliberately: the spec's headline is three sentences and reads as three promises.
  headline: ["Build competent people.", "Deploy confident teams.", "Deliver safer care."],
  // The middle line carries the accent; all three shouting is none of them shouting.
  accentLine: 1,
  body:
    "Competen connects competency management, assessments, workforce operations, learning, recruitment, " +
    "quality and AI into one configurable platform — supporting every professional from student to executive.",
  primary: { label: "Request a Demo", href: "/signup" },
  secondary: { label: "Explore Platform", href: "#platform" },
  tertiary: { label: "Watch 3 Minute Tour", href: "#platform", planned: true },
};

// The four trust markers that sit on the patterned band under the hero.
export const TRUST = [
  { title: "Configurable", body: "Built for your organisation" },
  { title: "Secure", body: "Enterprise-grade security" },
  { title: "Scalable", body: "From team to enterprise" },
  { title: "Trusted", body: "By hospitals and health systems across Africa" },
];

export type Capability = { name: string; accent: string; items: string[]; href: string };

// Six capability cards. Order matches the spec.
export const CAPABILITIES: Capability[] = [
  { name: "Competency", accent: "var(--cmp-color-primary)", href: "#lifecycle",
    items: ["Design frameworks", "Assess & validate", "Digital passports", "Career pathways"] },
  { name: "Workforce", accent: "var(--cmp-color-secondary)", href: "#lifecycle",
    items: ["Smart assignments", "Roster intelligence", "Patient allocation", "Workload balancing", "Shift command"] },
  { name: "Assessment", accent: "#7C3AED", href: "#lifecycle",
    items: ["Knowledge tests", "Skills assessments", "OSCE & simulation", "Workplace assessments", "Rubrics & checklists"] },
  { name: "Learning", accent: "#EA580C", href: "#lifecycle",
    items: ["CPD & courses", "Learning paths", "Microlearning", "Simulation training", "Continuing education"] },
  { name: "Quality & Safety", accent: "var(--cmp-color-information)", href: "#lifecycle",
    items: ["Quality events", "Audits & inspections", "Safety dashboards", "Accreditation readiness", "Compliance monitoring"] },
  { name: "Intelligence", accent: "#0891B2", href: "#lifecycle",
    items: ["AI Copilot", "Predictive insights", "Operational analytics", "Executive dashboards", "Real-time alerts"] },
];

export type LifecycleStage = { stage: string; body: string };

export const LIFECYCLE: LifecycleStage[] = [
  { stage: "Recruit", body: "Attract and onboard the right talent" },
  { stage: "Learn", body: "Develop knowledge and skills" },
  { stage: "Assess", body: "Measure competence and performance" },
  { stage: "Certify", body: "Validate and issue digital credentials" },
  { stage: "Deploy", body: "Assign and optimise workforce" },
  { stage: "Support", body: "Monitor, coach and provide support" },
  { stage: "Improve", body: "Continuous improvement" },
  { stage: "Lead", body: "Grow leaders for the future" },
];

export const JOURNEY = {
  title: "Personal to Professional Journey",
  body:
    "Start your journey early. Build your competencies, collect verified evidence and create your professional " +
    "passport. When you join an organisation using Competen, your achievements travel with you — while " +
    "organisational data stays secure and private.",
  points: ["For Students & Professionals", "For Employers & Organisations", "One Identity, Many Opportunities."],
  personal: { title: "Personal Workspace", body: "Build your professional identity",
    items: ["Competencies", "Learning", "Assessments", "Digital Passport", "Evidence Library"] },
  organisation: { title: "Organisation Workspace", body: "Join any organisation using Competen",
    items: ["Role Assignment", "Workforce Deployment", "Performance & Feedback", "Learning & Development", "Quality & Safety"] },
  assurance: "Your personal data belongs to you. Organisation data remains private and secure.",
  cta: { label: "Learn More", href: "/signup" },
};

// Photo tiles, per the approved design. `img` points at /public/images/home; the tile falls back to a
// patterned panel if the file is missing, so a deleted asset degrades instead of breaking the row.
export const AUDIENCES: { label: string; img: string }[] = [
  { label: "Hospitals", img: "/images/home/serve-hospitals.png" },
  { label: "Health Systems", img: "/images/home/serve-health-systems.png" },
  { label: "Universities", img: "/images/home/serve-universities.png" },
  { label: "Training Schools", img: "/images/home/serve-training.png" },
  { label: "NGOs", img: "/images/home/serve-ngos.png" },
  { label: "Governments", img: "/images/home/serve-governments.png" },
  { label: "Professional Councils", img: "/images/home/serve-councils.png" },
];

// Photography extracted from the approved COMP-HOME-001 comp. NOTE THE SIZES: the comp is 1024x1536 for
// the WHOLE page, so the hero crop is 205x330 and each audience tile 112x66. They are correct in content
// and colour and will read fine at tile scale, but they are comp-resolution, not asset-resolution -- the
// hero will look soft on a large display. Replacing any file at the same path is the whole fix; no code
// changes. Named here so the limitation travels with the asset rather than living only in a commit message.
export const PHOTOS = {
  hero: "/images/home/hero-clinicians.png",
  student: "/images/home/journey-student.png",
  nurse: "/images/home/journey-nurse.png",
  consultant: "/images/home/journey-consultant.png",
  sunset: "/images/home/closing-sunset.png",
};

export type Metric = { value: string; label: string; sub: string };

// IMPORTANT: these are the spec's stated outcome figures, presented as the product claim they are. They are
// NOT computed from platform data -- no tenant has been running long enough to produce a benchmark, and a
// marketing figure dressed as a measured one is the kind of claim a hospital will eventually ask to see the
// working for. If they are ever replaced by real aggregates, that is a data source, not a copy change.
export const METRICS: Metric[] = [
  { value: "96%", label: "Improved Competency", sub: "Competency visibility" },
  { value: "25%", label: "Workforce Efficiency", sub: "Better staffing efficiency" },
  { value: "98%", label: "Assessment Accuracy", sub: "Accurate & standardised" },
  { value: "35%", label: "Quality Improvement", sub: "Reduction in adverse events" },
  { value: "90%", label: "Learning Engagement", sub: "Learner completion rate" },
  { value: "100%", label: "Accreditation Ready", sub: "Audit readiness" },
  { value: "Smarter", label: "AI-Driven Decisions", sub: "Faster. Safer. Better" },
  { value: "End-to-End", label: "One Integrated Platform", sub: "From student to executive" },
];

export const CLOSING = {
  title: "Ready to build a more competent, efficient and safer healthcare workforce?",
  body: "Let's build the future of healthcare — together.",
  primary: { label: "Request a Demo", href: "/signup" },
  secondary: { label: "Talk to Our Team", href: "mailto:gabriel@semacast.com?subject=Competen%20enquiry" },
};

// Header navigation. Anchors today; `planned` marks what the spec wants as its own page.
export const NAV: { label: string; href: string; planned?: boolean }[] = [
  { label: "Platform", href: "#platform" },
  { label: "Solutions", href: "#audiences" },
  { label: "Products", href: "#platform", planned: true },
  { label: "By Role", href: "#journey", planned: true },
  { label: "Resources", href: "#impact", planned: true },
  { label: "Company", href: "#closing", planned: true },
];

export const FOOTER: { heading: string; links: Link[] }[] = [
  { heading: "Platform", links: [
    { label: "Overview", href: "#platform" },
    { label: "Architecture", href: "#lifecycle", planned: true },
    { label: "Security", href: "#trust", planned: true },
    { label: "AI Platform", href: "#platform", planned: true },
    { label: "Integrations", href: "#platform", planned: true },
  ] },
  { heading: "Products", links: CAPABILITIES.map(c => ({ label: c.name, href: "#platform", planned: true })) },
  { heading: "By Role", links: [
    { label: "Healthcare Worker", href: "#journey", planned: true },
    { label: "Shift Supervisor", href: "#journey", planned: true },
    { label: "Unit Manager", href: "#journey", planned: true },
    { label: "Educator", href: "#journey", planned: true },
    { label: "Executive", href: "#journey", planned: true },
  ] },
  { heading: "Resources", links: [
    { label: "Knowledge Centre", href: "#impact", planned: true },
    { label: "Documentation", href: "#impact", planned: true },
    { label: "Webinars", href: "#impact", planned: true },
    { label: "Case Studies", href: "#impact", planned: true },
    { label: "Help Centre", href: "#impact", planned: true },
  ] },
  { heading: "Company", links: [
    { label: "About Us", href: "#closing", planned: true },
    { label: "Careers", href: "#closing", planned: true },
    { label: "Partners", href: "#closing", planned: true },
    { label: "Contact Us", href: "mailto:gabriel@semacast.com?subject=Competen%20enquiry" },
  ] },
];

export const FOOTER_LEGAL: Link[] = [
  { label: "Privacy Policy", href: "#closing", planned: true },
  { label: "Terms of Service", href: "#closing", planned: true },
  { label: "Security", href: "#trust", planned: true },
];
