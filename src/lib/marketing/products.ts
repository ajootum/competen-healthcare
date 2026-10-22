import type { Solution, SolutionTemplate } from "@/lib/marketing/solutions";
import { EXPERIENCE_LIST } from "@/lib/marketing/individual-family";

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
  /** One sentence for the homepage product card (COMPETEN-WEB-IND-001 s1). Still an outcome, never a
   *  module list -- WEB-HOME-001 s2 forbids feature lists here. */
  summary: string;
  /** COMPETEN-WEB-IND-001 s2: the independently branded experiences a product is presented through.
   *  Only Individual has any; read from individual-family.ts so the names cannot drift. */
  experiences?: { key: string; label: string; micro: string; href: string; accent: string }[];
};

export const PRODUCTS: Product[] = [
  { key: "enterprise",  label: "Enterprise",  micro: "For organisations.",       href: "/enterprise",  accent: "#4F46E5", live: true,
    summary: "Develop capable teams and strengthen healthcare quality." },
  // ⚠ micro WIDENED by COMPETEN-WEB-IND-001 s2: Individual now serves students (Scholar) as well as
  // professionals (Professional), and "For professionals." would hide the half that starts at school.
  { key: "individual",  label: "Individual",  micro: "For students & professionals.", href: "/individual", accent: "#0F766E", live: false,
    summary: "Learn, grow and advance throughout your healthcare career.",
    experiences: EXPERIENCE_LIST.map(e => ({ key: e.key, label: e.name, micro: e.micro, href: e.href, accent: e.accent })) },
  { key: "recruitment", label: "Recruitment", micro: "For talent & employers.",  href: "/recruitment", accent: "#7C3AED", live: false,
    summary: "Connect talent and opportunities through verified professional evidence." },
  { key: "practice",    label: "Practice",    micro: "For practitioners.",       href: "/practice",    accent: "#2563EB", live: true,
    summary: "Run your practice, your patients and your clinical day in one place." },
];

const TALK = "mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen enquiry");

/**
 * The not-yet-live product page copy. ⚠ NO SIGN-IN; the CTA is a conversation, because that is the only
 * true path in today. Individual LEFT this list with COMPETEN-WEB-IND-001: its gateway presents the
 * Scholar / Professional family from src/lib/marketing/individual-family.ts, and keeping its old copy here
 * would be text that renders nowhere and gets edited anyway.
 */
export const PRODUCT_PAGES: Record<string, Solution & { template: SolutionTemplate }> = {
  recruitment: {
    slug: "recruitment", nav: "Recruitment", eyebrow: "Recruitment",
    body: "Find opportunities, manage applications, interviews and offers.",
    accent: "#7C3AED", inPrimaryNav: false,
    template: {
      headline: ["The right people,", "faster."],
      points: ["Opportunities and applications", "Verified capability, not just CVs", "Interviews and offers in one place", "Built for healthcare recruitment"],
      primary: { label: "Talk to us about Competen Recruitment", href: TALK },
      // REVISED by the owner 2026-08-11 -- see individual above. A gate with an honest notice.
      secondary: { label: "Sign in", href: "/recruitment/sign-in" },
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
