import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONSENT_FEATURE, CONSENT_NOTICE_VERSION, CROSS_EXPERIENCE_FEATURE, SEARCH_HISTORY_FEATURE, SEARCH_HISTORY_NOTICE, SEARCH_HISTORY_NOTICE_VERSION } from "./config";
import { consentStatus, historyChoiceOn } from "./consent-gate";
import { HISTORY_NOTICE_OFF, HISTORY_NOTICE_ON, HISTORY_PRIVACY } from "./search-history";
import { readSearchHistoryChoice } from "./search-history-choice";
import { resetSearchHistorySchema, setConsent } from "./store";

// Owner decision 5 Nov 2026 (My Search History privacy). Off until the learner turns it on, apart from AI help, and absolute claims about
// who can see it are not made.

const U = "11111111-1111-4111-8111-111111111111";
const ENV = {
  INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION: "t", INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_URL: "/t",
  INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION: "p", INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_URL: "/p",
  INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION: "t", INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_URL: "/t",
  INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION: "p", INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_URL: "/p",
};

/** A fake admin: the schema probe succeeds, and the consent read answers `row` or `error`, recording the feature it asked for. */
function admin(row: unknown, error: unknown = null) {
  const asked: { feature?: string; table?: string; upsert?: Record<string, unknown> } = {};
  const chain = {
    select: () => chain,
    eq: (col: string, v: string) => { if (col === "feature") asked.feature = v; return chain; },
    maybeSingle: async () => ({ data: row, error }),
    upsert: async (v: Record<string, unknown>) => { asked.upsert = v; return { error: null }; },
  };
  const client = {
    from: (t: string) => { asked.table = t; return chain; },
    rpc: async () => ({ data: [], error: null }),
  };
  return { client: client as never, asked };
}

afterEach(() => resetSearchHistorySchema());

describe("My Search History: the learner's choice", () => {
  it("is on only for a grant to the current notice, with the documents published", () => {
    expect(historyChoiceOn({ granted: true, noticeVersion: SEARCH_HISTORY_NOTICE_VERSION }, true)).toBe(true);
    expect(historyChoiceOn({ granted: false, noticeVersion: null }, true)).toBe(false);
    expect(historyChoiceOn({ granted: false, noticeVersion: SEARCH_HISTORY_NOTICE_VERSION }, true)).toBe(false);
    expect(historyChoiceOn({ granted: true, noticeVersion: "an-earlier-notice" }, true)).toBe(false);
    expect(historyChoiceOn({ granted: true, noticeVersion: SEARCH_HISTORY_NOTICE_VERSION }, false)).toBe(false);
  });

  it("no row is off, and only this feature's row is read", async () => {
    const { client, asked } = admin(null);
    expect(await readSearchHistoryChoice(client, U, { scholarSearchHistory: "on" }, ENV)).toMatchObject({ offered: true, on: false, unreadable: false });
    expect(asked.table).toBe("individual_scholar_consent");
    expect(asked.feature).toBe(SEARCH_HISTORY_FEATURE);
  });

  it("a grant to the current notice is on, a revoked one is off", async () => {
    const granted = { status: "granted", notice_version: SEARCH_HISTORY_NOTICE_VERSION, granted_at: "2026-11-05T10:00:00Z", revoked_at: null };
    expect((await readSearchHistoryChoice(admin(granted).client, U, { scholarSearchHistory: "on" }, ENV)).on).toBe(true);
    expect((await readSearchHistoryChoice(admin({ ...granted, status: "revoked" }).client, U, { scholarSearchHistory: "on" }, ENV)).on).toBe(false);
  });

  it("an unreadable choice is off, and says so: not permission", async () => {
    const r = await readSearchHistoryChoice(admin(null, { code: "XX000", message: "down" }).client, U, { scholarSearchHistory: "on" }, ENV);
    expect(r).toMatchObject({ offered: true, on: false, unreadable: true });
  });

  it("with HQ's key off nothing is offered and the learner's row is not read", async () => {
    const { client, asked } = admin({ status: "granted", notice_version: SEARCH_HISTORY_NOTICE_VERSION });
    expect(await readSearchHistoryChoice(client, U, { scholarSearchHistory: "off" }, ENV)).toMatchObject({ offered: false, on: false });
    expect(asked.feature).toBeUndefined();
  });

  it("a grant records this notice's version under this feature", async () => {
    const { client, asked } = admin(null);
    await setConsent(client, U, true, SEARCH_HISTORY_FEATURE);
    expect(asked.upsert).toMatchObject({ user_id: U, feature: SEARCH_HISTORY_FEATURE, status: "granted", notice_version: SEARCH_HISTORY_NOTICE_VERSION });
  });
});

describe("My Search History: AI help is not touched", () => {
  it("is its own feature, and the AI notice stays v3", () => {
    expect(SEARCH_HISTORY_FEATURE).toBe("scholar_search_history");
    expect(SEARCH_HISTORY_FEATURE).not.toBe(CONSENT_FEATURE);
    expect(SEARCH_HISTORY_FEATURE).not.toBe(CROSS_EXPERIENCE_FEATURE);
    expect(CONSENT_NOTICE_VERSION).toBe("scholar-ai-uploads-notice-v3");
  });

  it("a v3 learner stays on, whatever their history choice", () => {
    expect(consentStatus({ granted: true, noticeVersion: "scholar-ai-uploads-notice-v3" }, true)).toBe("on");
  });

  it("the AI gate reads only the AI feature, by default", () => {
    const store = readFileSync("src/lib/individual/scholar/store.ts", "utf8");
    expect(store).toMatch(/export async function readConsent\(admin: Admin, userId: string, feature: ConsentFeature = CONSENT_FEATURE\)/);
    const http = readFileSync("src/lib/individual/scholar/http.ts", "utf8");
    expect(http).not.toMatch(/SEARCH_HISTORY_FEATURE/);
  });

  it("the capture route reads the choice before it reads the words", () => {
    const route = readFileSync("src/app/api/individual/scholar/library/history/route.ts", "utf8");
    const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));
    expect(post.indexOf("readSearchHistoryChoice")).toBeGreaterThan(-1);
    expect(post.indexOf("readSearchHistoryChoice")).toBeLessThan(post.indexOf("req.json"));
  });
});

describe("My Search History: the wording (owner decision item 5)", () => {
  const all = [...Object.values(SEARCH_HISTORY_NOTICE), HISTORY_PRIVACY, HISTORY_NOTICE_ON, HISTORY_NOTICE_OFF].join(" ");
  it("makes no absolute claim about who can see it", () => {
    expect(all).not.toMatch(/cannot see|can't see|never shown|never visible|no one can|nobody can|private to you/i);
    expect(SEARCH_HISTORY_NOTICE.who).toMatch(/not ordinarily visible to other learners, educators or employers/);
    expect(SEARCH_HISTORY_NOTICE.who).toMatch(/Authorised Competen staff and service providers may have access/);
    expect(HISTORY_PRIVACY).toMatch(/Not ordinarily visible/);
  });
  it("says it is apart from AI help, keeps no answers, and is not Personal AI memory", () => {
    expect(SEARCH_HISTORY_NOTICE.off).toMatch(/separate from AI help/);
    expect(SEARCH_HISTORY_NOTICE.notKept).toMatch(/Answers are not kept/);
    expect(SEARCH_HISTORY_NOTICE.who).toMatch(/Personal AI does not use it/);
  });
  it("names only ways out a learner has", () => {
    expect(SEARCH_HISTORY_NOTICE.howLong).toMatch(/your account is closed/);
    expect(SEARCH_HISTORY_NOTICE.howLong).not.toMatch(/delete your account/);
  });
});
