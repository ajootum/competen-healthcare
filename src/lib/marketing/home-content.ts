// WEB-HP-002 — Competen corporate homepage content.
//
// This SUPERSEDES COMP-HOME-001's homepage. The governing change is "minimal disclosure": communicate
// outcomes, not platform internals. So the six capability cards, the eight-stage lifecycle, the
// personal-to-professional diagram and the eight-metric impact grid are all GONE -- the spec explicitly
// says do not enumerate every module and do not expose workflow diagrams. What replaces them is a shorter
// page whose job is to route a visitor to a solution page or a demo.
//
// Copy lives here rather than in JSX so a content change is a one-file edit; a CMS fetch can later replace
// these exports without touching a component.
//
// LINK POLICY, unchanged and load-bearing: only /login, /signup and /forgot-password exist as public
// routes. Everything else is an ON-PAGE ANCHOR, with `planned: true` marking what the spec wants as its own
// page. A nav row to a 404 looks identical to a working one until someone clicks it.

export type Link = { label: string; href: string; planned?: boolean };

export const BRAND = {
  name: "competen",
  tagline: "Healthcare. Empowered.",
  eyebrow: "The Complete Healthcare Performance Platform",
};

// The approved design uses an indigo/violet accent, which is NOT --cmp-color-primary (the product's
// teal-green). Held as one named constant rather than sprinkled as hex so the divergence is visible and
// reversible in a single edit -- flagged for confirmation, since the spec also asks for consistency with
// the Competen design system and those two instructions pull in different directions.
export const ACCENT = "#4F46E5";
export const ACCENT_DARK = "#4338CA";
export const ACCENT_SOFT = "#EEF0FF";

export const HERO = {
  headline: "Build competent people. Deploy confident teams.",
  headlineAccentLead: "Deliver ",
  headlineAccent: "safer care.",
  body:
    "Competen empowers healthcare organisations and professionals to develop skills, optimise workforce " +
    "performance, and improve outcomes — at every level.",
  primary: { label: "Book a Demo", href: "/signup" },
  secondary: { label: "Explore Solutions", href: "#who-we-help" },
  image: "/images/home/journey-nurse.png",
  imageAlt: "A nurse reviewing records on a tablet on the ward",
};

// The floating intelligence cards over the hero image. Illustrative of what the platform reports, and
// labelled as a preview -- they are not a live tenant's numbers and must never read as one.
export const HERO_CARDS = {
  readiness: { title: "Workforce Readiness", value: 92, caption: "Competency Score", delta: "8% vs last month" },
  performance: { title: "Team Performance", caption: "Improving across all areas" },
  learning: { title: "Learning Progress", value: 78, caption: "Modules Completed" },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRUSTED ORGANISATIONS — READ BEFORE PUBLISHING.
//
// These are REAL, NAMED institutions. "Trusted by" is a factual claim about a third party and an implied
// endorsement, and it uses their name commercially. Listing an organisation that has not agreed to be
// named is a misrepresentation, and in healthcare it is the kind that gets noticed.
//
// The names below are the ones in the approved design. Each needs written permission before this page is
// public. Removing one is deleting a line; there is no code change and the carousel handles any count,
// including zero -- with an empty list the whole section does not render, which is the correct behaviour
// when there is nothing that can honestly be claimed.
export type TrustedOrg = { name: string; sub?: string };
export const TRUSTED: TrustedOrg[] = [
  { name: "Aga Khan", sub: "University Hospital" },
  { name: "Kenyatta", sub: "National Hospital" },
  { name: "MEGACARE", sub: "Hospital" },
  { name: "Gertrude's", sub: "Children's Hospital" },
  { name: "AIC", sub: "Africa Healthcare" },
];
export const TRUSTED_HEADING = "Trusted by forward-thinking healthcare organisations";

export type Audience = { title: string; body: string; accent: string; icon: string; href: string };

export const WHO_WE_HELP: Audience[] = [
  { title: "Healthcare Organisations", accent: "#4F46E5", icon: "🏢", href: "#cta",
    body: "Strengthen capabilities, manage performance, and deliver quality care." },
  { title: "Healthcare Professionals", accent: "#0D9488", icon: "🧑‍⚕️", href: "#cta",
    body: "Grow your skills, build your career, and make a greater impact." },
  { title: "Educators & Training Institutions", accent: "#EA8C0B", icon: "🎓", href: "#cta",
    body: "Design, deliver, and assess competency-based education." },
  { title: "Government & Regulators", accent: "#2563EB", icon: "🏛️", href: "#cta",
    body: "Set standards, ensure compliance, and improve health systems." },
];

export const CTA_BAND = {
  title: "Ready to transform healthcare performance?",
  body: "Join leading organisations and professionals who are building a more competent, capable, and confident healthcare workforce.",
  action: { label: "Book a Demo", href: "/signup" },
};

export const ASSURANCES = [
  { title: "Secure & Compliant", body: "Enterprise-grade security and data protection" },
  { title: "Scalable & Flexible", body: "Built to grow with your organisation" },
  { title: "Interoperable", body: "Works with your existing systems" },
  { title: "Data-Driven Insights", body: "Make better decisions with real-time intelligence" },
];

// Header navigation. `planned` marks the dedicated pages the spec wants next -- including /practice, which
// the Solutions strategy names explicitly and which does not exist yet.
export const NAV: Link[] = [
  { label: "Solutions", href: "#who-we-help", planned: true },
  { label: "Who We Serve", href: "#who-we-help" },
  { label: "Resources", href: "#cta", planned: true },
  { label: "About Us", href: "#cta", planned: true },
];

export const FOOTER: { heading: string; links: Link[] }[] = [
  { heading: "Company", links: [
    { label: "About Us", href: "#cta", planned: true },
    { label: "Careers", href: "#cta", planned: true },
    { label: "Contact", href: "mailto:gabriel@semacast.com?subject=Competen%20enquiry" },
  ] },
  { heading: "Solutions", links: [
    { label: "Competen Practice", href: "#who-we-help", planned: true },   // spec: gets its own /practice page
    { label: "For Organisations", href: "#who-we-help" },
    { label: "For Professionals", href: "#who-we-help" },
    { label: "For Educators", href: "#who-we-help" },
  ] },
  { heading: "Resources", links: [
    { label: "Knowledge Centre", href: "#cta", planned: true },
    { label: "Case Studies", href: "#cta", planned: true },
    { label: "Help Centre", href: "#cta", planned: true },
  ] },
];

// Privacy and Terms have no pages yet. Kept in one list so that when the pages land it is a two-line edit,
// and rendered as plain text rather than links until then -- a legal link to nowhere is worse than none.
export const FOOTER_LEGAL: Link[] = [
  { label: "Privacy Policy", href: "#", planned: true },
  { label: "Terms of Service", href: "#", planned: true },
];
