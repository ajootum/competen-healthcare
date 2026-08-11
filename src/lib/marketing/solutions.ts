// Public solution landing pages -- the AUDIENCE pathways.
//
// ⚠ GOVERNED BY WEB-HOME-001 SINCE 2026-08-11 (WEB-DEC, the owner's decision), which SUPERSEDED
// WEB-STRAT-001. The lineage, latest wins: COMP-HOME-001 -> WEB-HP-002 -> WEB-STRAT-001 -> WEB-HOME-001.
// What changed: the four PRODUCT names (Enterprise, Individual, Recruitment, Practice) are now public
// and live in products.ts; SOLUTIONS here name AUDIENCES, never products (s3: "Solution labels are not
// product names").
//
// ⚠ WHAT SURVIVED THE SUPERSESSION, UNWEAKENED: progressive disclosure, and the hidden layer -- which
// MOVED rather than vanished. The Enterprise SUB-PRODUCTS (Competency Management, Workforce Management,
// Executive Intelligence, Learning platform, the Studios, Mock Code, the AI platform and the engines)
// must still never appear on a public page: s10 keeps them behind the Enterprise door.
// scripts/public-disclosure-harness.ts asserts the CURRENT list against rendered HTML, because a leak
// here is one careless sentence and nobody would notice until a competitor did.
//
// ONE SOLUTION IS BIGGER THAN A LANDING PAGE. Competen Practice is a named product with six capability
// pages of its own under /practice, built from src/lib/marketing/practice-content.ts. It therefore has no
// `template` below: the shared single-page template cannot carry a section, and leaving its fields filled
// in would mean fifteen lines of copy that render nowhere -- which the next person would edit, expecting
// the page to change. The optional `template` makes that difference structural. `templated()` is the only
// way to reach SolutionPage, so a page cannot render a template that is not there.

export type Solution = {
  slug: string;
  nav: string;                 // label in the Solutions menu
  eyebrow: string;             // breadcrumb tail
  body: string;                // one-line summary; also the Solutions menu blurb
  accent: string;
  /** false = reachable and indexed, but kept out of the primary Solutions menu (spec: /quality). */
  inPrimaryNav: boolean;
  /** Present when the slug renders the shared single-page template. Absent = the slug owns a section. */
  template?: SolutionTemplate;
};

export type SolutionTemplate = {
  headline: string[];          // rendered as separate lines
  points: string[];
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
  image: string;
  imageAlt: string;
  featuresTitle: string;
  features: { title: string; body: string }[];
  closing: { title: string; body: string; action: string };
};

// ⚠ A MAILTO, NOT /signup, AND THE LABELS CHANGED WITH IT. Signup is CLOSED by the owner's decision
// (Supabase signups off), so "Create Student Account" pointing at a registration form was a dishonest
// button in front of an honest wall -- the exact shape /practice/page.tsx:57 documents refusing. A
// public CTA may only promise what the product can do today, and today the path in is a conversation.
// When signup opens, this constant and the labels below change together.
const ACTION = "mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen enquiry");

export const SOLUTIONS: Solution[] = [
  {
    slug: "students", nav: "Students", eyebrow: "Students",
    body: "Competen helps you learn, practise and prove your readiness for the real world.",
    // teal-700, not teal-600. The 600 shade measures 3.74:1 as the 13px "Explore" link on the homepage
    // cards -- the same failure already fixed on the Practice pages, missed here because this catalogue
    // was not re-measured when they were.
    accent: "#0F766E", inPrimaryNav: true,
    template: {
      headline: ["Build your future", "in healthcare."],
      points: ["Track your learning & progress", "Build your professional portfolio", "Prepare for assessments", "Stand out to employers"],
      primary: { label: "Talk to us about getting started", href: ACTION },
      // The owner, 2026-08-11: Student and Professional both GATE into Competen Individual -- one site
      // for both audiences. The login page says the site is still being built BEFORE the password field.
      secondary: { label: "Sign in", href: "/individual/sign-in" },
      image: "/images/home/path-students.webp",
      imageAlt: "A student nurse with a tablet",
      featuresTitle: "Everything you need to succeed",
      features: [
        { title: "Learn", body: "Access courses and resources" },
        { title: "Practice", body: "Apply knowledge with confidence" },
        { title: "Assess", body: "Prepare and track assessments" },
        { title: "Grow", body: "Build skills for your career" },
      ],
      closing: { title: "Start your journey today.", body: "Join thousands of students preparing for a brighter future in healthcare.", action: "Get Started" },
    },
  },
  {
    slug: "professionals", nav: "Professionals", eyebrow: "Professionals",
    body: "Keep your skills up to date. Showcase your competence. Unlock new opportunities.",
    accent: "#4F46E5", inPrimaryNav: true,
    template: {
      headline: ["Grow throughout", "your career."],
      points: ["Maintain your competency records", "Continuing professional development", "Career opportunities", "Professional portfolio & passport"],
      primary: { label: "Talk to us about getting started", href: ACTION },
      // Same gate as Students -- one Individual site serves both audience pathways.
      secondary: { label: "Sign in", href: "/individual/sign-in" },
      image: "/images/home/path-professionals.webp",
      imageAlt: "A doctor outside a hospital",
      featuresTitle: "Your professional workspace",
      features: [
        { title: "Develop", body: "Learn new skills and stay current" },
        { title: "Document", body: "Store evidence and achievements" },
        { title: "Demonstrate", body: "Showcase your competence" },
        { title: "Advance", body: "Find roles and grow your career" },
      ],
      closing: { title: "Invest in your future.", body: "Join a community of professionals committed to excellence in healthcare.", action: "Get Started" },
    },
  },
  {
    // No `template`: /practice is a six-page section built from practice-content.ts. See the note above.
    // ⚠ nav says "Practitioners", not "Practice" -- WEB-DEC 2026-08-11 adopted WEB-HOME-001 s3's rule
    // that SOLUTION labels name AUDIENCES and product names live in the Products menu. Same slug, same
    // pages: the practitioner pathway and the Practice product marketing share a front door.
    slug: "practice", nav: "Practitioners", eyebrow: "Practice",
    body: "All the tools you need to manage appointments, patients and follow-ups in one place.",
    accent: "#2563EB", inPrimaryNav: true,
  },
  {
    // ⚠ RENAMED from "hospitals" -- WEB-HOME-001 s20: "Hospitals is replaced by the broader organisation
    // pathway", adopted by the owner 2026-08-11. /hospitals is a LIVE INDEXED route, so it now issues a
    // permanent redirect here rather than 404ing a URL that is in the sitemap and other people's links.
    slug: "organisations", nav: "Organisations", eyebrow: "Organisations",
    body: "An integrated platform that helps healthcare organisations strengthen capability, improve quality and drive performance.",
    accent: "#4F46E5", inPrimaryNav: true,
    template: {
      headline: ["Stronger teams.", "Better care.", "Better outcomes."],
      points: ["Workforce & capability management", "Quality, safety & accreditation", "Education & professional development", "Real-time insights and intelligence"],
      primary: { label: "Book a Demo", href: ACTION },
      secondary: { label: "Explore Solutions", href: "#features" },
      image: "/images/home/team-hospital.webp",
      imageAlt: "A hospital team outside the main entrance",
      featuresTitle: "Built for organisational excellence",
      features: [
        { title: "Workforce", body: "Right people. Right place. Right skills." },
        { title: "Capability", body: "Build, assess and manage capability" },
        { title: "Quality", body: "Improve safety. Achieve accreditation." },
        { title: "Performance", body: "Real-time insights. Better decisions." },
      ],
      closing: { title: "Ready to transform your organisation?", body: "Book a personalised demo and see how Competen can help.", action: "Book a Demo" },
    },
  },
  {
    // ⚠ No `template`: /recruitment is the Recruitment PRODUCT page (products.ts), and this entry is the
    // Recruiters AUDIENCE pathway pointing at it -- WEB-HOME-001 s6's fifth audience, adopted 2026-08-11.
    // Same structural rule as /practice above: the slug owns its page, so the template stays absent.
    slug: "recruitment", nav: "Recruiters", eyebrow: "Recruitment",
    body: "Find the right people faster with verified capability and credentials.",
    accent: "#7C3AED", inPrimaryNav: true,
  },
  {
    // Secondary page: reachable and indexed, deliberately NOT in the Solutions menu.
    slug: "quality", nav: "Quality", eyebrow: "Quality",
    body: "Drive continuous improvement, ensure safety and achieve accreditation with confidence.",
    accent: "#0F766E", inPrimaryNav: false,
    template: {
      headline: ["Quality care.", "Every day."],
      points: ["Quality events & incident management", "Audits, checklists & assessments", "KPIs, dashboards & reports", "Accreditation readiness"],
      primary: { label: "Book a Demo", href: ACTION },
      secondary: { label: "Learn More", href: "#features" },
      image: "/images/home/journey-nurse.webp",
      imageAlt: "A nurse recording observations on a tablet",
      featuresTitle: "Quality everywhere",
      features: [
        { title: "Capture", body: "Record events and risks" },
        { title: "Assess", body: "Audits and assessments" },
        { title: "Improve", body: "Corrective actions that stick" },
        { title: "Assure", body: "Be ready for accreditation" },
      ],
      closing: { title: "Build a culture of quality.", body: "Partner with Competen to deliver safer, better care for every patient.", action: "Book a Demo" },
    },
  },
];

export const bySlug = (slug: string) => SOLUTIONS.find(s => s.slug === slug);
export const PRIMARY_SOLUTIONS = SOLUTIONS.filter(s => s.inPrimaryNav);

/** A solution narrowed to one that SolutionPage can actually render. Throws at build time rather than
 *  rendering a page with an empty features grid. */
export function templated(slug: string): Solution & { template: SolutionTemplate } {
  const s = bySlug(slug);
  if (!s?.template) throw new Error(`Solution "${slug}" has no SolutionPage template.`);
  return s as Solution & { template: SolutionTemplate };
}
