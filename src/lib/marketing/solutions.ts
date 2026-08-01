// WEB-STRAT-001 — public solution landing pages.
//
// PROGRESSIVE DISCLOSURE IS THE POINT. The strategy is explicit: expose outcomes, market SOLUTIONS rather
// than software modules, and reveal more only after registration. So these pages describe what a person
// gets, never how the platform is built.
//
// The spec also names products that must NOT appear on the public site at all -- Competency Management,
// Workforce Management, Executive Intelligence, Recruitment, Learning platform, Competency Studio,
// Assessment Studio, AI platform, platform operations, and the configuration/integration engines. That is
// not a styling preference; "hide unauthorised products completely rather than displaying disabled menus"
// means the words themselves stay off these pages. scripts/public-disclosure-harness.ts asserts it, because
// a leak here is one careless sentence and nobody would notice until a competitor did.

export type Solution = {
  slug: string;
  nav: string;                 // label in the Solutions menu
  eyebrow: string;             // breadcrumb tail
  headline: string[];          // rendered as separate lines
  body: string;
  points: string[];
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
  image: string;
  imageAlt: string;
  featuresTitle: string;
  features: { title: string; body: string }[];
  closing: { title: string; body: string; action: string };
  accent: string;
  /** false = reachable and indexed, but kept out of the primary Solutions menu (spec: /quality). */
  inPrimaryNav: boolean;
};

const ACTION = "/signup";

export const SOLUTIONS: Solution[] = [
  {
    slug: "students", nav: "Students", eyebrow: "Students",
    headline: ["Build your future", "in healthcare."],
    body: "Competen helps you learn, practise and prove your readiness for the real world.",
    points: ["Track your learning & progress", "Build your professional portfolio", "Prepare for assessments", "Stand out to employers"],
    primary: { label: "Create Student Account", href: ACTION },
    secondary: { label: "Learn More", href: "#features" },
    image: "/images/home/path-students.png",
    imageAlt: "A student nurse with a tablet",
    featuresTitle: "Everything you need to succeed",
    features: [
      { title: "Learn", body: "Access courses and resources" },
      { title: "Practice", body: "Apply knowledge with confidence" },
      { title: "Assess", body: "Prepare and track assessments" },
      { title: "Grow", body: "Build skills for your career" },
    ],
    closing: { title: "Start your journey today.", body: "Join thousands of students preparing for a brighter future in healthcare.", action: "Get Started" },
    accent: "#0D9488", inPrimaryNav: true,
  },
  {
    slug: "professionals", nav: "Professionals", eyebrow: "Professionals",
    headline: ["Grow throughout", "your career."],
    body: "Keep your skills up to date. Showcase your competence. Unlock new opportunities.",
    points: ["Maintain your competency records", "Continuing professional development", "Career opportunities", "Professional portfolio & passport"],
    primary: { label: "Create Professional Account", href: ACTION },
    secondary: { label: "Learn More", href: "#features" },
    image: "/images/home/path-professionals.png",
    imageAlt: "A doctor outside a hospital",
    featuresTitle: "Your professional workspace",
    features: [
      { title: "Develop", body: "Learn new skills and stay current" },
      { title: "Document", body: "Store evidence and achievements" },
      { title: "Demonstrate", body: "Showcase your competence" },
      { title: "Advance", body: "Find roles and grow your career" },
    ],
    closing: { title: "Invest in your future.", body: "Join a community of professionals committed to excellence in healthcare.", action: "Get Started" },
    accent: "#4F46E5", inPrimaryNav: true,
  },
  {
    slug: "practice", nav: "Practice", eyebrow: "Practice",
    headline: ["Run your practice.", "Delight your patients."],
    body: "All the tools you need to manage appointments, patients and follow-ups in one place.",
    points: ["Online booking & scheduling", "Patient records & follow-ups", "Reminders & notifications", "Insights to grow your practice"],
    primary: { label: "Start Your Practice", href: ACTION },
    secondary: { label: "See How It Works", href: "#features" },
    image: "/images/home/path-practice.png",
    imageAlt: "A clinician in a consulting room",
    featuresTitle: "Everything in one place",
    features: [
      { title: "Calendar", body: "Manage your availability" },
      { title: "Bookings", body: "Let patients book with ease" },
      { title: "Patients", body: "Track history and follow-ups" },
      { title: "Insights", body: "Understand and grow your practice" },
    ],
    closing: { title: "Start managing your practice today.", body: "Join clinicians already using Competen Practice.", action: "Get Started" },
    accent: "#2563EB", inPrimaryNav: true,
  },
  {
    slug: "hospitals", nav: "Hospitals", eyebrow: "Hospitals",
    headline: ["Stronger teams.", "Better care.", "Better outcomes."],
    body: "An integrated platform that helps hospitals strengthen capability, improve quality and drive performance.",
    points: ["Workforce & capability management", "Quality, safety & accreditation", "Education & professional development", "Real-time insights and intelligence"],
    primary: { label: "Book a Demo", href: ACTION },
    secondary: { label: "Explore Solutions", href: "#features" },
    image: "/images/home/team-hospital.png",
    imageAlt: "A hospital team outside the main entrance",
    featuresTitle: "Built for hospital excellence",
    features: [
      { title: "Workforce", body: "Right people. Right place. Right skills." },
      { title: "Capability", body: "Build, assess and manage capability" },
      { title: "Quality", body: "Improve safety. Achieve accreditation." },
      { title: "Performance", body: "Real-time insights. Better decisions." },
    ],
    closing: { title: "Ready to transform your hospital?", body: "Book a personalised demo and see how Competen can help.", action: "Book a Demo" },
    accent: "#4F46E5", inPrimaryNav: true,
  },
  {
    // Secondary page: reachable and indexed, deliberately NOT in the Solutions menu.
    slug: "quality", nav: "Quality", eyebrow: "Quality",
    headline: ["Quality care.", "Every day."],
    body: "Drive continuous improvement, ensure safety and achieve accreditation with confidence.",
    points: ["Quality events & incident management", "Audits, checklists & assessments", "KPIs, dashboards & reports", "Accreditation readiness"],
    primary: { label: "Book a Demo", href: ACTION },
    secondary: { label: "Learn More", href: "#features" },
    image: "/images/home/journey-nurse.png",
    imageAlt: "A nurse recording observations on a tablet",
    featuresTitle: "Quality everywhere",
    features: [
      { title: "Capture", body: "Record events and risks" },
      { title: "Assess", body: "Audits and assessments" },
      { title: "Improve", body: "Corrective actions that stick" },
      { title: "Assure", body: "Be ready for accreditation" },
    ],
    closing: { title: "Build a culture of quality.", body: "Partner with Competen to deliver safer, better care for every patient.", action: "Book a Demo" },
    accent: "#0D9488", inPrimaryNav: false,
  },
];

export const bySlug = (slug: string) => SOLUTIONS.find(s => s.slug === slug);
export const PRIMARY_SOLUTIONS = SOLUTIONS.filter(s => s.inPrimaryNav);
