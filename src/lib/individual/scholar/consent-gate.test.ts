import { describe, expect, it } from "vitest";
import { aiOffMessage, consentDocuments, consentStatus } from "./consent-gate";
import { CONSENT_AWAITING_LEGAL, CONSENT_NOTICE_VERSION, CONSENT_UPDATED } from "./config";

// COMPETEN-IND-004 s10, owner GO 2026-10-23: AI help waits for the published Privacy Notice and Terms of
// Use, and a grant counts only for the current notice version.

const ENTITIES = ["COMPETEN_HOLDINGS", "SCHOLAR_OPERATOR"];
const DOCS = ["TERMS", "PRIVACY"];
/** Every applicable document published. Test values only. */
const published = (over: Record<string, string | undefined> = {}) => ({
  ...Object.fromEntries(ENTITIES.flatMap(e => DOCS.flatMap(d => [
    [`INDIVIDUAL_LEGAL_${e}_${d}_VERSION`, `${e.toLowerCase()}-${d.toLowerCase()}-1`],
    [`INDIVIDUAL_LEGAL_${e}_${d}_URL`, `https://example.test/${e.toLowerCase()}/${d.toLowerCase()}`],
  ]))),
  ...over,
});

describe("consent documents", () => {
  it("are published only when all four documents have a version and a URL", () => {
    const d = consentDocuments(published());
    expect(d.published).toBe(true);
    expect(d.links.map(l => l.title)).toEqual([
      "The Competen Scholar operating company Privacy Notice", "The Competen Scholar operating company Terms of Use",
      "Competen Holdings Privacy Notice", "Competen Holdings Terms of Use",
    ]);
  });

  it("⚠ a version with no URL is not published: nobody can open it", () => {
    for (const e of ENTITIES) for (const doc of DOCS) {
      expect(consentDocuments(published({ [`INDIVIDUAL_LEGAL_${e}_${doc}_URL`]: undefined })).published).toBe(false);
    }
  });

  it("an unconfigured environment publishes nothing and invents no link", () => {
    expect(consentDocuments({})).toEqual({ links: [], published: false });
  });

  it("names a document by the registered name once the owner has supplied it", () => {
    const d = consentDocuments(published({ INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_REGISTERED_NAME: "Example Holdings Ltd" }));
    expect(d.links.at(-1)?.title).toBe("Example Holdings Ltd Terms of Use");
  });
});

describe("consent status", () => {
  const current = { granted: true, noticeVersion: CONSENT_NOTICE_VERSION };
  it("is on only for a grant to the current notice, with the documents published", () => {
    expect(consentStatus(current, true)).toBe("on");
    expect(aiOffMessage("on")).toBeNull();
  });

  it("⚠ waits for the documents whatever is recorded", () => {
    expect(consentStatus(current, false)).toBe("awaiting_legal");
    expect(consentStatus({ granted: false, noticeVersion: null }, false)).toBe("awaiting_legal");
    expect(aiOffMessage("awaiting_legal")).toBe(CONSENT_AWAITING_LEGAL);
  });

  it("⚠ keeps a v2 grant as a record but asks again", () => {
    expect(consentStatus({ granted: true, noticeVersion: "scholar-ai-uploads-notice-v2" }, true)).toBe("outdated");
    expect(aiOffMessage("outdated")).toContain(CONSENT_UPDATED);
  });

  it("is off when never granted or turned off", () => {
    expect(consentStatus({ granted: false, noticeVersion: null }, true)).toBe("off");
    expect(consentStatus({ granted: false, noticeVersion: CONSENT_NOTICE_VERSION }, true)).toBe("off");
  });
});
