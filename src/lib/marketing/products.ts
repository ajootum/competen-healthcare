import type { Solution, SolutionTemplate } from "@/lib/marketing/solutions";

// WEB-HOME-001 s5/s10 -- THE FOUR PRODUCTS, AS PUBLIC INFORMATION. Adopted by the owner 2026-08-11:
// WEB-HOME-001 supersedes WEB-STRAT-001's solutions-only rule, so product NAMES are now public. The
// disclosure harness was rewritten in the same decision -- what stays hidden is the Enterprise
// SUB-PRODUCT layer (Workforce, Assessment, Competency Studio and the rest), per s10: "Those belong to
// Enterprise discovery after the visitor chooses Enterprise."
//
// ⚠ THE MICRO-DESCRIPTIONS ARE THE SPEC'S OWN, three words each. s2 forbids feature lists here.
//
// ⚠ TWO OF THE FOUR ARE MARKETING PAGES ONLY, and their entries say so. Individual and Recruitment do
// not exist as products -- no code, no data model -- and the owner's decision (2026-08-11) is honest
// pages with conversation CTAs, NO sign-in button: a sign-in to a product that does not exist is a dead
// door, the shape /practice/page.tsx:57 documents refusing. `live: false` is what the pages read.

export type Product = {
  key: string;
  label: string;
  /** The spec's micro-description. Not a feature list. */
  micro: string;
  href: string;
  accent: string;
  /** ⚠ False = a marketing page for a product that cannot be signed into yet. The page renders no
   *  sign-in and says the conversation is the way in. */
  live: boolean;
};

export const PRODUCTS: Product[] = [
  { key: "enterprise",  label: "Enterprise",  micro: "For organisations.",       href: "/enterprise",  accent: "#4F46E5", live: true },
  { key: "individual",  label: "Individual",  micro: "For professionals.",       href: "/individual",  accent: "#0F766E", live: false },
  { key: "recruitment", label: "Recruitment", micro: "For talent & employers.",  href: "/recruitment", accent: "#7C3AED", live: false },
  { key: "practice",    label: "Practice",    micro: "For practitioners.",       href: "/practice",    accent: "#2563EB", live: true },
];

const TALK = "mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen enquiry");

/**
 * The two not-yet-live product pages, rendered by the same SolutionPage template as the landing pages so
 * the set stays one site. ⚠ NEITHER CARRIES A SIGN-IN. Both CTAs are conversations, because that is the
 * only true path in today.
 */
export const PRODUCT_PAGES: Record<string, Solution & { template: SolutionTemplate }> = {
  individual: {
    slug: "individual", nav: "Individual", eyebrow: "Individual",
    body: "Your professional record, competency passport, learning, credentials and achievements.",
    accent: "#0F766E", inPrimaryNav: false,
    template: {
      headline: ["Your professional record,", "wherever you go."],
      points: ["Your competency passport", "Learning and development", "Credentials and achievements", "A record that stays yours between employers"],
      primary: { label: "Talk to us about Competen Individual", href: TALK },
      secondary: { label: "Learn More", href: "#features" },
      image: "/images/home/path-professionals.webp",
      imageAlt: "A doctor outside a hospital",
      featuresTitle: "One record for a whole career",
      features: [
        { title: "Carry", body: "Your record moves with you" },
        { title: "Prove", body: "Verified capability and credentials" },
        { title: "Grow", body: "Learning that follows your goals" },
        { title: "Share", body: "Show employers what is true" },
      ],
      closing: { title: "Interested in Competen Individual?", body: "Talk to us and we will walk you through it.", action: "Talk to us" },
    },
  },
  recruitment: {
    slug: "recruitment", nav: "Recruitment", eyebrow: "Recruitment",
    body: "Find opportunities, manage applications, interviews and offers.",
    accent: "#7C3AED", inPrimaryNav: false,
    template: {
      headline: ["The right people,", "faster."],
      points: ["Opportunities and applications", "Verified capability, not just CVs", "Interviews and offers in one place", "Built for healthcare recruitment"],
      primary: { label: "Talk to us about Competen Recruitment", href: TALK },
      secondary: { label: "Learn More", href: "#features" },
      image: "/images/home/team-hospital.webp",
      imageAlt: "A hospital team outside the main entrance",
      featuresTitle: "Recruitment on verified ground",
      features: [
        { title: "Find", body: "Reach the right candidates" },
        { title: "Verify", body: "Capability you can trust" },
        { title: "Decide", body: "Structured interviews and offers" },
        { title: "Hire", body: "From application to onboarding" },
      ],
      closing: { title: "Interested in Competen Recruitment?", body: "Talk to us and we will walk you through it.", action: "Talk to us" },
    },
  },
};
