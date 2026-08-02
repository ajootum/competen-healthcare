// Competen corporate homepage content (COMP-HOME-001 → WEB-HP-002 → WEB-STRAT-001, latest wins).
//
// The governing change across that chain is "minimal disclosure": communicate outcomes, not platform
// internals. The capability cards, lifecycle stages, workflow diagram and impact grid are all gone -- the
// spec says do not enumerate every module. WEB-STRAT-001 then made the page a ROUTER: its job is to get a
// visitor into the solution page that matches who they are.
//
// Copy lives here rather than in JSX so a content change is a one-file edit; a CMS fetch can later replace
// these exports without touching a component.
//
// NAV, FOOTER and WHO_WE_HELP USED TO LIVE HERE AND ARE DELETED. Nothing imported them -- the header and
// footer build their menus from PRIMARY_SOLUTIONS and their own markup -- so they were copy that could be
// edited all day with no effect on the site. They had also gone stale in a way that only mattered once
// someone revived them: six of their links pointed at "#who-we-help", an anchor the homepage stopped
// having when WEB-STRAT-001 renamed the section to "choose-your-path".
//
// LINK POLICY for what remains: the public routes are the homepage, the five solution pages, the Competen
// Practice section and its four journeys, and the access pages. `planned: true` marks a link the spec
// wants but that has no page yet -- FOOTER_LEGAL is rendered as plain text for exactly that reason. A nav
// row to a 404 looks identical to a working one until somebody clicks it.

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
  headline: ['Stronger healthcare', 'begins with'],
  headlineAccent: 'empowered people.',
  body:
    'Competen helps students, professionals, practices and hospitals build capability, ' +
    'deliver better care and improve outcomes.',
  primary: { label: 'Explore Solutions', href: '#choose-your-path' },
  secondary: { label: 'Book a Demo', href: '/signup' },
  image: '/images/home/journey-nurse.png',
  imageAlt: 'A nurse reviewing records on a tablet on the ward',
};

// WEB-STRAT-001 'Built for healthcare. Designed for Africa.' band.
//
// THE ADOPTION CLAIMS ARE GONE, at the owner's instruction and because they were not true. "100+
// Healthcare Organisations" and "10,000+ Healthcare Professionals" were CLAIMS, not aggregates -- no query
// produced them and nothing labelled them as measured. The platform is a new build, so the honest count is
// not a smaller number, it is no number.
//
// "Trusted by forward-thinking organisations across the continent" went with them. It is the same claim in
// words rather than digits, and leaving it while deleting the figures would only have made the assertion
// harder to check. What remains states what the platform is FOR, which is true on day one.
//
// scripts/public-disclosure-harness.ts now asserts that no public page carries a numeric adoption claim,
// so this cannot quietly return in a copy edit once there are a few real customers to round up from.
export const AFRICA_BAND = {
  title: 'Built for healthcare. Designed for Africa.',
  body: 'One platform for the whole health workforce -- from the classroom to the ward round.',
  stats: [
    { value: 'One Platform', label: 'Many Possibilities' },
    { value: 'Better care', label: 'Better outcomes. Better together.' },
  ],
};

// The floating intelligence cards over the hero image. Illustrative of what the platform reports, and
// labelled as a preview -- they are not a live tenant's numbers and must never read as one.
export const HERO_CARDS = {
  readiness: { title: "Workforce Readiness", value: 92, caption: "Competency Score", delta: "8% vs last month" },
  performance: { title: "Team Performance", caption: "Improving across all areas" },
  learning: { title: "Learning Progress", value: 78, caption: "Modules Completed" },
};

// The named "Trusted by" band is removed at the owner's instruction. It listed real institutions under an
// endorsement claim that had not been confirmed with any of them. If it returns it needs written
// permission per organisation; the previous implementation is in git history.

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

// Privacy and Terms have no pages yet. Kept in one list so that when the pages land it is a two-line edit,
// and rendered as plain text rather than links until then -- a legal link to nowhere is worse than none.
export const FOOTER_LEGAL: Link[] = [
  { label: "Privacy Policy", href: "#", planned: true },
  { label: "Terms of Service", href: "#", planned: true },
];
