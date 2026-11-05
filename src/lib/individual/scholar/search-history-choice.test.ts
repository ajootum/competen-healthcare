import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONSENT_FEATURE, CONSENT_NOTICE_VERSION, CROSS_EXPERIENCE_FEATURE, SEARCH_HISTORY_FEATURE, SEARCH_HISTORY_NOTICE, SEARCH_HISTORY_NOTICE_V1, SEARCH_HISTORY_NOTICE_V1_VERSION, SEARCH_HISTORY_NOTICE_VERSION } from "./config";
import { consentStatus, historyChoiceState } from "./consent-gate";
import { HISTORY_FIRST_FAILED, HISTORY_FIRST_NOTICE, HISTORY_NOTICE_OFF, HISTORY_NOTICE_ON, HISTORY_PRIVACY } from "./search-history";
import { readSearchHistoryChoice } from "./search-history-choice";
import { recordSearchHistoryNoticeSeen, resetSearchHistorySchema, setConsent } from "./store";
import { CURRENT_LEGAL_VERSION, LEGAL_VERSIONS } from "../../legal/interim";
import { SEARCH_HISTORY_SUPPLEMENT, SEARCH_HISTORY_SUPPLEMENTS, SEARCH_HISTORY_SUPPLEMENT_PATH, supplementPath } from "../../legal/search-history-supplement";

// Owner decisions 5 Nov 2026 (My Search History): on by default after a one-time notice, apart from AI help, with seeing the notice never recorded as a
// grant, an explicit Turn it off always winning, and no absolute claims about who can see it.

const U = "11111111-1111-4111-8111-111111111111";
const ENV = {
  INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION: "t", INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_URL: "/t",
  INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION: "p", INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_URL: "/p",
  INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION: "t", INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_URL: "/t",
  INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION: "p", INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_URL: "/p",
};
const V1 = SEARCH_HISTORY_NOTICE_V1_VERSION, V2 = SEARCH_HISTORY_NOTICE_VERSION;

/** A fake admin: the schema probe succeeds, and the consent read answers `row` or `error`, recording what it was asked. */
function admin(row: unknown, error: unknown = null, inserted: unknown[] = [{ user_id: U }]) {
  const asked: { feature?: string; table?: string; upsert?: Record<string, unknown>; options?: Record<string, unknown>; update?: Record<string, unknown>; eqs: [string, string][] } = { eqs: [] };
  const done = { data: inserted, error: null, select: () => Promise.resolve({ data: inserted, error: null }) };
  const chain = {
    select: () => chain,
    eq: (col: string, v: string) => { asked.eqs.push([col, v]); if (col === "feature") asked.feature = v; return chain; },
    neq: () => chain,
    maybeSingle: async () => ({ data: row, error }),
    upsert: (v: Record<string, unknown>, o: Record<string, unknown>) => { asked.upsert = v; asked.options = o; return done; },
    update: (v: Record<string, unknown>) => { asked.update = v; return chain; },
    then: (f: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f),
  };
  const client = { from: (t: string) => { asked.table = t; return chain; }, rpc: async () => ({ data: [], error: null }) };
  return { client: client as never, asked };
}
const row = (status: string, notice_version: string, over: Record<string, unknown> = {}) => ({ status, notice_version, granted_at: status === "granted" ? "2026-11-05T10:00:00Z" : null, revoked_at: status === "revoked" ? "2026-11-05T11:00:00Z" : null, updated_at: "2026-11-05T12:00:00Z", ...over });

afterEach(() => resetSearchHistorySchema());

describe("My Search History: the state table", () => {
  const blank = { granted: false, notified: false, noticeVersion: null, revokedAt: null };
  it.each([
    ["no choice: the notice is due, and nothing is kept", blank, "unseen"],
    ["saw this notice and did nothing else: on, by the notice", { ...blank, notified: true, noticeVersion: V2 }, "on_by_notice"],
    ["saw an earlier notice and did nothing else: the notice is due again", { ...blank, notified: true, noticeVersion: "an-earlier-notice" }, "unseen"],
    ["acted to keep it on under v2", { ...blank, granted: true, noticeVersion: V2 }, "on_chosen"],
    ["turned it on under v1: stays on, not asked again", { ...blank, granted: true, noticeVersion: V1 }, "on_chosen"],
    ["turned it off under v1: stays off, not asked again", { ...blank, noticeVersion: V1, revokedAt: "2026-11-05T11:00:00Z" }, "off"],
    ["turned it off under v2", { ...blank, noticeVersion: V2, revokedAt: "2026-11-05T11:00:00Z" }, "off"],
    ["turned it off under a later notice", { ...blank, noticeVersion: "a-later-notice", revokedAt: "2026-11-05T11:00:00Z" }, "off"],
    ["a grant to a version never asked under is not honoured", { ...blank, granted: true, noticeVersion: "unknown" }, "off"],
  ] as const)("%s", (_what, state, want) => {
    expect(historyChoiceState(state, true)).toBe(want);
  });
  it("with the documents unpublished, nothing is on and no notice is due", () => {
    expect(historyChoiceState(blank, false)).toBe("off");
    expect(historyChoiceState({ ...blank, granted: true, noticeVersion: V2 }, false)).toBe("off");
    expect(historyChoiceState({ ...blank, notified: true, noticeVersion: V2 }, false)).toBe("off");
  });
});

describe("My Search History: reading the choice", () => {
  const read = (a: ReturnType<typeof admin>) => readSearchHistoryChoice(a.client, U, { scholarSearchHistory: "on" }, ENV);
  it("no row: the notice is due and nothing is kept, and only this feature's row is read", async () => {
    const a = admin(null);
    expect(await read(a)).toMatchObject({ offered: true, on: false, pending: true, state: "unseen", unreadable: false });
    expect(a.asked.table).toBe("individual_scholar_consent");
    expect(a.asked.feature).toBe(SEARCH_HISTORY_FEATURE);
  });
  it("having seen the notice is on, and says when, but is no grant", async () => {
    expect(await read(admin(row("notified", V2)))).toMatchObject({ on: true, pending: false, state: "on_by_notice", grantedAt: null, notifiedAt: "2026-11-05T12:00:00Z" });
  });
  it("a v1 opt-in stays on and a v1 opt-out stays off, and neither is asked again", async () => {
    expect(await read(admin(row("granted", V1)))).toMatchObject({ on: true, pending: false, state: "on_chosen" });
    expect(await read(admin(row("revoked", V1, { granted_at: "2026-11-05T10:00:00Z" })))).toMatchObject({ on: false, pending: false, state: "off" });
  });
  it("an unreadable choice is off, asks nothing, and says so: not permission", async () => {
    expect(await read(admin(null, { code: "XX000", message: "down" }))).toMatchObject({ offered: true, on: false, pending: false, unreadable: true });
  });
  it("with HQ's key off nothing is offered and the learner's row is not read", async () => {
    const a = admin(row("granted", V2));
    expect(await readSearchHistoryChoice(a.client, U, { scholarSearchHistory: "off" }, ENV)).toMatchObject({ offered: false, on: false, pending: false });
    expect(a.asked.feature).toBeUndefined();
  });
});

describe("My Search History: what is written", () => {
  it("seeing the notice is recorded as notified, with no grant time, and only where nothing is recorded yet", async () => {
    const { client, asked } = admin(null);
    expect(await recordSearchHistoryNoticeSeen(client, U)).toBe("recorded");
    expect(asked.upsert).toMatchObject({ user_id: U, feature: SEARCH_HISTORY_FEATURE, status: "notified", notice_version: V2, granted_at: null });
    expect(asked.options).toMatchObject({ onConflict: "user_id,feature", ignoreDuplicates: true });
  });
  it("seeing it again records nothing new", async () => {
    expect(await recordSearchHistoryNoticeSeen(admin(null, null, []).client, U)).toBe("already");
  });
  it("Keep it on is a real grant, with a grant time and the notice version", async () => {
    const { client, asked } = admin(null);
    await setConsent(client, U, true, SEARCH_HISTORY_FEATURE);
    expect(asked.upsert).toMatchObject({ feature: SEARCH_HISTORY_FEATURE, status: "granted", notice_version: V2 });
    expect(asked.upsert?.granted_at).toEqual(expect.any(String));
  });
  it("Turn it off is recorded even with no row, with no false grant time, and then revokes whatever is there", async () => {
    const { client, asked } = admin(null);
    expect((await setConsent(client, U, false, SEARCH_HISTORY_FEATURE)).ok).toBe(true);
    expect(asked.upsert).toMatchObject({ feature: SEARCH_HISTORY_FEATURE, status: "revoked", granted_at: null });
    expect(asked.options).toMatchObject({ ignoreDuplicates: true });
    expect(asked.update).toMatchObject({ status: "revoked" });
  });
  it("turning AI help off still writes no new row", async () => {
    const { client, asked } = admin(null);
    await setConsent(client, U, false, CONSENT_FEATURE);
    expect(asked.upsert).toBeUndefined();
    expect(asked.update).toMatchObject({ status: "revoked" });
  });
  it("the route audits seeing the notice as that, and grants as grants", () => {
    const route = readFileSync("src/app/api/individual/scholar/consent/route.ts", "utf8");
    expect(route).toMatch(/"individual_scholar_consent_notice_shown"/);
    expect(route).toMatch(/"individual_scholar_consent_granted"/);
    expect(route.indexOf("recordSearchHistoryNoticeSeen(ctx.admin")).toBeLessThan(route.indexOf("setConsent(ctx.admin"));
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
    expect(readFileSync("src/lib/individual/scholar/http.ts", "utf8")).not.toMatch(/SEARCH_HISTORY_FEATURE/);
  });
  it("the capture route reads the choice before it reads the words", () => {
    const route = readFileSync("src/app/api/individual/scholar/library/history/route.ts", "utf8");
    const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));
    expect(post.indexOf("readSearchHistoryChoice")).toBeGreaterThan(-1);
    expect(post.indexOf("readSearchHistoryChoice")).toBeLessThan(post.indexOf("req.json"));
  });
});

describe("My Search History: the Privacy Notice supplement", () => {
  it("each version is that notice's own words, and says who it applies to", () => {
    const words = (n: typeof SEARCH_HISTORY_NOTICE | typeof SEARCH_HISTORY_NOTICE_V1) => [n.kept, n.notKept, n.howLong, n.who, n.patient, n.off];
    const [one, two] = SEARCH_HISTORY_SUPPLEMENTS;
    expect(one.body).toEqual(words(SEARCH_HISTORY_NOTICE_V1));
    expect(one.version).toBe(V1);
    expect(one.applies).toMatch(/only to learners who turn on My Search History/);
    expect(two.body).toEqual(words(SEARCH_HISTORY_NOTICE));
    expect(two.version).toBe(V2);
    expect(SEARCH_HISTORY_SUPPLEMENT).toBe(two);
  });
  it("the old text stays reachable, word for word, at its own address", () => {
    expect(SEARCH_HISTORY_NOTICE_V1.kept).toMatch(/^If you turn this on, the searches you submit/);
    expect(supplementPath(SEARCH_HISTORY_SUPPLEMENTS[0].key)).toBe("/legal/search-history/notice-v1");
    expect(SEARCH_HISTORY_NOTICE.kept).not.toMatch(/If you turn this on/);
  });
  it("changes no published version, so no acceptance is asked for again", () => {
    expect(LEGAL_VERSIONS.map(v => v.version)).toEqual(["draft-2026-10-23"]);
    expect(CURRENT_LEGAL_VERSION.documents.privacy.some(d => JSON.stringify(d).includes("My Search History"))).toBe(false);
    for (const f of ["src/lib/individual/legal.ts", "src/lib/individual/terms.ts", "src/lib/individual/access.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/search-history-supplement/);
  });
  it("is beside the notice, a draft like the rest, and the notice's page links to it", () => {
    expect(SEARCH_HISTORY_SUPPLEMENT_PATH).toBe("/legal/search-history");
    expect(readFileSync("src/components/legal/SearchHistorySupplementPage.tsx", "utf8")).toMatch(/CURRENT_LEGAL_VERSION\.status/);
    expect(readFileSync("src/components/legal/LegalDocumentPage.tsx", "utf8")).toMatch(/kind === "privacy" && .*SEARCH_HISTORY_SUPPLEMENT_PATH/);
  });
});

describe("My Search History: the wording", () => {
  const all = [...Object.values(SEARCH_HISTORY_NOTICE), HISTORY_PRIVACY, HISTORY_NOTICE_ON, HISTORY_NOTICE_OFF, HISTORY_FIRST_NOTICE, HISTORY_FIRST_FAILED].join(" ");
  it("makes no absolute claim about who can see it", () => {
    expect(all).not.toMatch(/cannot see|can't see|never shown|never visible|no one can|nobody can|private to you/i);
    expect(SEARCH_HISTORY_NOTICE.who).toMatch(/not ordinarily visible to other learners, educators or employers/);
    expect(SEARCH_HISTORY_NOTICE.who).toMatch(/Authorised Competen staff and service providers may have access/);
    expect(HISTORY_PRIVACY).toMatch(/Not ordinarily visible/);
    expect(HISTORY_FIRST_NOTICE).toMatch(/not ordinarily visible/);
  });
  it("says it is on by default, apart from AI help, keeps no answers, and is not Personal AI memory", () => {
    expect(SEARCH_HISTORY_NOTICE.kept).toMatch(/on by default/);
    expect(SEARCH_HISTORY_NOTICE.off).toMatch(/separate from AI help/);
    expect(SEARCH_HISTORY_NOTICE.off).toMatch(/turn it off at any time/);
    expect(SEARCH_HISTORY_NOTICE.notKept).toMatch(/Answers are not kept/);
    expect(SEARCH_HISTORY_NOTICE.who).toMatch(/Personal AI does not use it/);
    expect(HISTORY_FIRST_NOTICE).toMatch(/Answers are not kept/);
  });
  it("names only ways out a learner has", () => {
    expect(SEARCH_HISTORY_NOTICE.howLong).toMatch(/your account is closed/);
    expect(SEARCH_HISTORY_NOTICE.howLong).not.toMatch(/delete your account/);
  });
  it("when the notice cannot be recorded, it says nothing is being kept", () => {
    expect(HISTORY_FIRST_FAILED).toMatch(/nothing is being kept/);
  });
});
