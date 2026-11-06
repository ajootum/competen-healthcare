import { LifeosError } from "./errors";
import { provisionIndividual } from "./provision";
import type { LifeosStore, Row } from "./types";

// LIFEOS-API-001 delivery step 6. Optional access for a person who already holds a live Competen Individual
// entitlement. It is their choice, it records the terms they accepted, and it can be turned off.
//
// Each of these fails closed: the flag, the eligibility read, and published terms. With any one missing, nobody opts in.

export const INDIVIDUAL_ACCESS_FLAG = "lifeos_individual_access";

/** Who is signed in, before they hold LifeOS. The adapter fills it. It grants nothing by itself. */
export type SessionIdentity = {
  issuer: string;
  subject: string;
  displayName: string;
  /** The verified sign-in address, or null. */
  email: string | null;
  /** True only when the other product's live entitlement was read successfully and exists. */
  competenIndividualLive: boolean;
};

export type AccessStatus = {
  /** The owner has turned this door on. */
  enabled: boolean;
  /** This person can use it. */
  eligible: boolean;
  /** They already hold live access. */
  active: boolean;
  terms: { version: string; title: string; url: string } | null;
};

async function publishedTerms(store: LifeosStore): Promise<AccessStatus["terms"]> {
  const rows = await store.where("lifeos_terms", { status: "published" }, { limit: 20, order: "published_at" });
  const latest = rows[rows.length - 1];
  return latest ? { version: String(latest.version), title: String(latest.title), url: String(latest.url) } : null;
}

async function liveEntitlementsOf(store: LifeosStore, id: SessionIdentity): Promise<Row[]> {
  const [link] = await store.where("lifeos_identity_link", { issuer: id.issuer, subject: id.subject, status: "active" }, { limit: 1 });
  if (!link) return [];
  return store.where("lifeos_live_entitlement", { individual_id: String(link.individual_id) }, { limit: 50 });
}

export async function accessStatus(store: LifeosStore, id: SessionIdentity): Promise<AccessStatus> {
  const [enabled, terms, live] = await Promise.all([store.flagEnabled(INDIVIDUAL_ACCESS_FLAG), publishedTerms(store), liveEntitlementsOf(store, id)]);
  return { enabled, eligible: enabled && id.competenIndividualLive, active: live.length > 0, terms };
}

/** The person's own decision. Safe to retry: a person who already holds this access is simply told so. */
export async function activateFromCompetenIndividual(store: LifeosStore, id: SessionIdentity, termsVersion: string): Promise<{ individualId: string; created: boolean }> {
  if (!(await store.flagEnabled(INDIVIDUAL_ACCESS_FLAG)) || !id.competenIndividualLive) {
    throw new LifeosError("forbidden", "LifeOS is not available for this account.");
  }
  const terms = await publishedTerms(store);
  if (!terms) throw new LifeosError("conflict", "LifeOS terms are not published yet.");
  if (terms.version !== termsVersion) {
    throw new LifeosError("conflict", "The terms have changed. Please read the current version.", { details: { current: terms.version } });
  }
  const p = await provisionIndividual(store, {
    issuer: id.issuer, subject: id.subject, displayName: id.displayName, accessSource: "competen_individual",
  });
  const live = await store.where("lifeos_live_entitlement", { individual_id: p.individualId, source: "competen_individual" }, { limit: 1 });
  if (live.length === 0) {
    await store.mutate({
      actor: p.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
      ops: [{
        t: "lifeos_entitlement", op: "insert",
        values: {
          individual_id: p.individualId, source: "competen_individual", terms_version: terms.version,
          terms_accepted_at: new Date().toISOString(), provenance_source: "user",
        },
      }],
    });
  }
  return { individualId: p.individualId, created: p.created };
}
