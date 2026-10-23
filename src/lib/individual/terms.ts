import { EXPERIENCES, type ExperienceKey } from "./experiences";
import { FOUNDATION_ENTITY, acceptanceState, entityLegal, publishedVersions, type Acceptance, type EntityLegal } from "./legal";

// ── THE TERMS GATE ── owner ruling D2: "Capture applicable terms acceptance before pilot use." ───────────
//
// An experience is USABLE only when the person has accepted, at the currently published versions:
//
//   1. the shared foundation's terms and privacy notice (Competen Holdings, D2), recorded on the
//      membership row, because Holdings manages the identity, Passport, history and AI every
//      experience shares, AND
//   2. the experience operator's terms and privacy notice, recorded on that experience's entitlement row.
//
// When the operator IS the foundation's manager (Professional and Holdings today) and publishes the same
// two versions, step 1 already covers step 2 -- asking a person to accept the identical documents twice
// is noise, not consent. When the documents differ, both are asked for.
//
// Pure apart from the default `legalOf`, which reads the environment through entityLegal().

export type TermsState = "accepted" | "required" | "unpublished";

export type TermsGate = {
  foundation: { state: TermsState; legal: EntityLegal };
  experience: { state: TermsState; legal: EntityLegal };
  usable: boolean;
};

export function termsGate(input: {
  experience: ExperienceKey;
  foundationAcceptance: Acceptance | null;
  experienceAcceptance: Acceptance[] | undefined;
  legalOf?: (entity: EntityLegal["entity"]) => EntityLegal;
}): TermsGate {
  const legalOf = input.legalOf ?? ((e: EntityLegal["entity"]) => entityLegal(e));
  const fLegal = legalOf(FOUNDATION_ENTITY);
  const fCurrent = publishedVersions(fLegal);
  const foundation = acceptanceState(fCurrent, input.foundationAcceptance);

  const xEntity = EXPERIENCES[input.experience].operatingEntity;
  const xLegal = legalOf(xEntity);
  const xCurrent = publishedVersions(xLegal);
  let experience: TermsState;
  if (!xCurrent) experience = "unpublished";
  else if ((input.experienceAcceptance ?? []).some(a => acceptanceState(xCurrent, a) === "accepted")) experience = "accepted";
  else if (xEntity === FOUNDATION_ENTITY && foundation === "accepted"
    && fCurrent && fCurrent.terms === xCurrent.terms && fCurrent.privacy === xCurrent.privacy) experience = "accepted";
  else experience = "required";

  return {
    foundation: { state: foundation, legal: fLegal },
    experience: { state: experience, legal: xLegal },
    usable: foundation === "accepted" && experience === "accepted",
  };
}
