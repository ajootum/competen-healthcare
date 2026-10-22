import type { OperatingEntity } from "./experiences";

// ── WHO OPERATES WHAT, AND WHICH TERMS APPLY ── COMPETEN-IND-003 owner rulings D2, ADR-016 ──────────────
//
// D2: "Holdings manages the shared foundation; Scholar subsidiary operates its service. Keep
// controller/processor relationships configurable pending formal legal confirmation. Capture applicable
// terms acceptance before pilot use."
//
// ⚠ NO LEGAL TEXT AND NO LEGAL NAME IS INVENTED HERE. The documents and their versions are the owner's to
// publish. Each entity's terms and privacy notice are read from the deployment's environment, so a
// version is either one somebody published for that environment or it is null. While it is null, the
// experience it governs cannot be used, and the screen says the terms have not been published rather
// than offering an acceptance of a document that does not exist.
//
//   INDIVIDUAL_LEGAL_<ENTITY>_TERMS_VERSION    INDIVIDUAL_LEGAL_<ENTITY>_TERMS_URL
//   INDIVIDUAL_LEGAL_<ENTITY>_PRIVACY_VERSION  INDIVIDUAL_LEGAL_<ENTITY>_PRIVACY_URL
//   <ENTITY> = COMPETEN_HOLDINGS | SCHOLAR_OPERATOR
//
// ⚠ THE SCHOLAR OPERATOR'S REGISTERED NAME IS PENDING (COMPETEN-IND-001 D8). `registeredName` stays null
// until the owner supplies it, and every surface renders the descriptive label instead.
//
// SERVER-ONLY: it reads process.env. Client components receive the resolved values as props.

export type LegalDocument = { version: string; url: string | null };

export type EntityLegal = {
  entity: OperatingEntity;
  /** How surfaces name the entity while its registered name is unconfirmed. */
  label: string;
  /** The registered company name. Null until the owner confirms it -- never guessed. */
  registeredName: string | null;
  terms: LegalDocument | null;
  privacy: LegalDocument | null;
};

/**
 * D2's data roles, as configuration rather than code paths. `confirmed: false` is the honest state until
 * formal legal confirmation, and Settings says so.
 */
export const DATA_ROLES = {
  confirmed: false,
  sharedFoundation: { manager: "competen_holdings" as OperatingEntity, scope: "your identity, Passport, profile and history, and personal AI" },
  experienceService: { scholar: "scholar_operator" as OperatingEntity, professional: "competen_holdings" as OperatingEntity },
} as const;

/** The shared foundation's terms are the managing entity's (D2). */
export const FOUNDATION_ENTITY: OperatingEntity = DATA_ROLES.sharedFoundation.manager;

const LABEL: Record<OperatingEntity, string> = {
  competen_holdings: "Competen Holdings",
  scholar_operator: "the Competen Scholar operating company",
};

const ENV_KEY: Record<OperatingEntity, string> = {
  competen_holdings: "COMPETEN_HOLDINGS",
  scholar_operator: "SCHOLAR_OPERATOR",
};

function doc(env: Record<string, string | undefined>, prefix: string): LegalDocument | null {
  const version = env[`${prefix}_VERSION`]?.trim();
  if (!version) return null;
  return { version, url: env[`${prefix}_URL`]?.trim() || null };
}

/** Resolve one entity's legal configuration from an environment (process.env in production code). */
export function entityLegal(entity: OperatingEntity, env: Record<string, string | undefined> = process.env): EntityLegal {
  const k = ENV_KEY[entity];
  return {
    entity,
    label: LABEL[entity],
    registeredName: env[`INDIVIDUAL_LEGAL_${k}_REGISTERED_NAME`]?.trim() || null,
    terms: doc(env, `INDIVIDUAL_LEGAL_${k}_TERMS`),
    privacy: doc(env, `INDIVIDUAL_LEGAL_${k}_PRIVACY`),
  };
}

/** Both documents published, or null. Acceptance is of a PAIR of versions, never of one alone. */
export function publishedVersions(legal: EntityLegal): { terms: string; privacy: string } | null {
  return legal.terms && legal.privacy ? { terms: legal.terms.version, privacy: legal.privacy.version } : null;
}

export type Acceptance = { termsVersion: string | null; privacyVersion: string | null };

/**
 * Pure. Whether a recorded acceptance covers the CURRENT published versions. A new version published
 * after acceptance makes it `required` again -- consent to v1 is not consent to v2.
 */
export function acceptanceState(current: { terms: string; privacy: string } | null, recorded: Acceptance | null): "accepted" | "required" | "unpublished" {
  if (!current) return "unpublished";
  return recorded && recorded.termsVersion === current.terms && recorded.privacyVersion === current.privacy ? "accepted" : "required";
}
