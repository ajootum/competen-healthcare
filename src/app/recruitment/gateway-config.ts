// ── RECRUITMENT GATEWAY ACQUISITION CONFIG ── COMP-REC-UX-001 s7 / s11 / s13 ────────────────────
//
// ⚠ THIS MODULE IMPORTS NOTHING -- the constants-file rule (src/lib/enterprise-constants.ts records
// the day that trap nearly recurred). The gateway page reads it; nothing else needs to.
//
// THE PHASING THIS ENCODES. The spec's own note (s13): "Employer acquisition may initially remain
// sales-assisted ('Talk to us') while candidate registration is self-service." Today that phasing
// runs in its MOST-CLOSED mode: self-registration is closed by the owner's standing decision (the
// Supabase allow-signups switch is OFF -- the gate that is invisible from this repo and bites
// first), so BOTH paths acquire through the site's honest mailto pattern. The candidate CTA is
// config-driven so the day candidate self-service opens is a one-word flip of CANDIDATE_CTA_MODE,
// not a redesign: both modes are fully written below and the page renders whichever the constant
// names.
//
// ⚠ FLIPPING TO "self_service" IS AN OWNER DECISION, NOT A BUILD STEP. The flip changes only which
// CTA renders; registration itself stays behind its own gates (estate_public_signup and the
// Supabase project switch). A flipped CTA in front of a closed registration would be a dishonest
// button in front of an honest wall -- flip it only when the whole path is real.

/** The two acquisition modes the spec's phasing allows for the candidate path. */
export type CandidateCtaMode = "talk_to_us" | "self_service";

/** Which mode the gateway renders today. */
export const CANDIDATE_CTA_MODE: CandidateCtaMode = "talk_to_us";

/**
 * Both modes, fully spelled, so the flip is a rename and never a rewrite.
 *
 * The self_service href is the estate's REAL registration route carrying the spec's intent
 * parameters (s8: product + persona). Query parameters communicate intent only -- they grant no
 * role, entitlement or organisation access (s2); the server resolves everything after auth.
 */
export const CANDIDATE_CTA: Record<CandidateCtaMode, { label: string; href: string }> = {
  // Live today: the conversation -- the same honest-mailto shape as DEMO_REQUEST and the product
  // pages (home-content.ts: "An honest mailto beats a button that walks a visitor into a form
  // that cannot succeed").
  talk_to_us: {
    label: "Join as talent — talk to us",
    href: "mailto:gabriel@semacast.com?subject="
      + encodeURIComponent("Competen Recruitment — joining as talent"),
  },
  // Inert until flipped: candidate-aware registration (s11's route family, spelled with the
  // estate's real /signup rather than the spec's illustrative /auth/register).
  self_service: {
    label: "Join as talent",
    href: "/signup?product=recruitment&persona=candidate",
  },
};

/** Employer acquisition stays sales-assisted by the spec's own phasing (s13). One mode, no flip. */
export const EMPLOYER_CTA = {
  label: "Recruit healthcare talent — talk to us",
  href: "mailto:gabriel@semacast.com?subject="
    + encodeURIComponent("Competen Recruitment — employer enquiry"),
} as const;

/** The gateway-level conversation for a visitor on neither side yet (the closing strip). */
export const RECRUITMENT_ENQUIRY =
  "mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen Recruitment enquiry");
