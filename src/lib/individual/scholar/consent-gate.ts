import { FOUNDATION_ENTITY, entityLegal, type EntityLegal } from "../legal";
import { SCHOLAR } from "../experiences";
import { CONSENT_AWAITING_LEGAL, CONSENT_NOTICE_VERSION, CONSENT_UPDATED } from "./config";
import type { ConsentState } from "./store";

// ── WHEN AI HELP MAY BE TURNED ON ── COMPETEN-IND-004 s10 consistency items 3 and 7, owner GO 2026-10-23 ──
//
// "Do not activate consent-dependent experiences until the applicable Privacy Notice and Terms are
// published and legally approved." The consent notice refers the person to those documents, so agreeing
// to it before they exist would be agreeing to something they cannot read. Published means every
// applicable document -- the Scholar operator's and the shared foundation's Privacy Notice and Terms of
// Use -- has a version AND a URL in the Individual legal configuration (legal.ts). A version without a
// URL is a document nobody can open, so it does not count.
//
// The gate is configuration, not code: an environment opens it by publishing the documents' versions and
// URLs, and nothing here has to change. The consent route refuses a grant, aiPreflight refuses every AI
// call, and the page shows the honest state while it is closed.
//
// And a grant counts only for the notice version CURRENT now. A grant to an earlier version stays as the
// record of what was agreed then, but the person is asked again before AI help runs.
//
// SERVER-ONLY: entityLegal reads process.env. Pure given an environment, so the unit tests pass one in.

/** A legal document the notice points to, as the configuration publishes it (never an invented URL). */
export type LegalLink = { title: string; version: string; url: string | null };

export type ConsentDocuments = {
  links: LegalLink[];
  /** Every applicable Privacy Notice and Terms of Use has a version and a URL. */
  published: boolean;
};

export function consentDocuments(env: Record<string, string | undefined> = process.env): ConsentDocuments {
  const foundation = entityLegal(FOUNDATION_ENTITY, env);
  const operator = entityLegal(SCHOLAR.operatingEntity, env);
  const entities: EntityLegal[] = operator.entity === foundation.entity ? [foundation] : [operator, foundation];
  const links: LegalLink[] = [];
  let published = true;
  for (const l of entities) {
    const raw = l.registeredName ?? l.label;
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);
    for (const [doc, title] of [[l.privacy, "Privacy Notice"], [l.terms, "Terms of Use"]] as const) {
      if (!doc?.url) published = false;
      if (doc) links.push({ title: `${name} ${title}`, version: doc.version, url: doc.url });
    }
  }
  return { links, published };
}

/**
 * Pure. Where the person stands:
 *   awaiting_legal  the documents are not published, so AI help cannot be turned on (whatever is recorded)
 *   off             never agreed, or turned it off
 *   outdated        agreed to an earlier notice version, so asked again
 *   on              agreed to the current notice
 */
export type ConsentStatus = "awaiting_legal" | "off" | "outdated" | "on";

export function consentStatus(state: Pick<ConsentState, "granted" | "noticeVersion">, documentsPublished: boolean): ConsentStatus {
  if (!documentsPublished) return "awaiting_legal";
  if (!state.granted) return "off";
  return state.noticeVersion === CONSENT_NOTICE_VERSION ? "on" : "outdated";
}

/** What an AI surface says in place of its controls while AI help is not on. Null when it is on. */
export function aiOffMessage(status: ConsentStatus): string | null {
  if (status === "on") return null;
  if (status === "awaiting_legal") return CONSENT_AWAITING_LEGAL;
  if (status === "outdated") return `${CONSENT_UPDATED} You can do that in My Learning.`;
  return "AI help is off, so explanations and practice questions are not available. You can turn it on in My Learning.";
}
