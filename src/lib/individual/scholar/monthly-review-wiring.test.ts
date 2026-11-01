import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SCHOLAR-MONTHLY-REVIEW-01 -- source-level wiring checks: what the arc promises that a pure test cannot see.
const read = (p: string) => readFileSync(p, "utf8");
const STORE = read("src/lib/individual/scholar/store.ts");
const BLOCK = STORE.slice(STORE.indexOf("SCHOLAR-MONTHLY-REVIEW-01 (owner GO, 1 Nov 2026): THE STUDY CALENDAR ENTRIES"));
const UI = "src/app/individual/(app)/[experience]/(scholar)/study/_components";
const NEW_UI = ["monthly-review-panel.tsx", "monthly-results.tsx", "monthly-progress.tsx", "study-calendar.tsx"].map(f => `${UI}/${f}`);
const NEW_LIB = ["monthly-review.ts", "monthly-review-data.ts", "study-calendar.ts", "study-calendar-kinds.ts", "study-calendar-data.ts"].map(f => `src/lib/individual/scholar/${f}`);
const ROUTES = ["monthly-review", "study-calendar"].map(r => `src/app/api/individual/scholar/${r}/route.ts`);

describe("the store is the only write site, and a card date is never written", () => {
  it("found the monthly block", () => expect(BLOCK.length).toBeGreaterThan(1000));
  it("no new file but the store reaches an individual_scholar table", () => {
    for (const f of [...NEW_LIB, ...ROUTES, ...NEW_UI]) expect(read(f), f).not.toMatch(/from\("individual_scholar_/);
  });
  it("the monthly block never writes the card or review tables (SM-2 dates are the spaced review's alone)", () => {
    expect(BLOCK).not.toMatch(/from\("individual_scholar_(card|review)"\)\s*\.(insert|update|upsert|delete)/);
    expect(BLOCK).toMatch(/from\("individual_scholar_card"\)\.select\("next_review_at"\)/);
  });
  it("every statement in the block is keyed on the caller", () => {
    const stmts = BLOCK.split(/;\s*\n/).filter(s => /admin\.from\("individual_scholar_/.test(s));
    expect(stmts.length).toBeGreaterThanOrEqual(10);
    for (const s of stmts) expect(s, s.slice(0, 120)).toMatch(/\.eq\("user_id", userId\)|user_id: userId/);
  });
});

describe("routes", () => {
  it("are behind requireIndividualContext and are request-time only", () => {
    for (const f of ROUTES) { const s = read(f); expect(s, f).toMatch(/requireIndividualContext\("scholar"\)/); expect(s, f).toMatch(/dynamic = "force-dynamic"/); }
  });
  it("the calendar route fails closed without 830, validates the dates, and audits", () => {
    const s = read(ROUTES[1]);
    expect(s).toMatch(/calendarSchema/);
    expect(s).toMatch(/validateMove/);
    expect(s).toMatch(/status: 409/);
    expect(s).toMatch(/audit\(ctx, "individual_scholar_calendar_rescheduled"/);
    expect(s).not.toMatch(/body\??\.(userId|user_id)/);
  });
  it("the review is started through the existing revision route only, with no new AI call", () => {
    const d = read("src/lib/individual/scholar/monthly-review-data.ts");
    expect(d).toMatch(/revision\/sessions\/route/);
    expect(d).toMatch(/activityState\(await getScholarAiStanding/);
    expect(d).toMatch(/scholarRevisionGeneration === "saved_only"/);
    for (const f of [...NEW_LIB, ...ROUTES]) expect(read(f), f).not.toMatch(/\bgenerate\(\{|runQuestions\(|runRevisionQuestions\(|@anthropic-ai|from "openai"/);
  });
  it("the evaluation route keeps a monthly review as an evaluation of kind student, method fresh", () => {
    const s = read("src/app/api/individual/scholar/evaluations/route.ts");
    expect(s).toMatch(/scope\.kind === "month"/);
    expect(s).toMatch(/method !== "fresh"/);
    expect(s).toMatch(/monthlyReview: monthly\.monthlyReview/);
  });
});

describe("the screens", () => {
  it("use no hex colours and no browser storage", () => {
    for (const f of NEW_UI) { const s = read(f); expect(s, f).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/); expect(s, f).not.toMatch(/localStorage|sessionStorage/); }
  });
  it("the results and the panel always carry the standing line", () => {
    for (const f of NEW_UI.filter(x => /panel|results|progress/.test(x))) expect(read(f), f).toMatch(/MONTHLY_STANDING_LINE/);
    expect(read("src/lib/individual/scholar/monthly-review.ts")).toMatch(/Optional formative review · not verified competence/);
  });
  it("the calendar names each kind with a word and a glyph, hides Move without 830, and never moves a card", () => {
    const s = read(`${UI}/study-calendar.tsx`);
    expect(s).toMatch(/CALENDAR_KIND\[k\]\.word/);
    expect(s).toMatch(/item\.movable && item\.entry/);
    expect(s).toMatch(/never changes when a card is due/);
    expect(s).toMatch(/hidden md:block/);
    expect(s).toMatch(/md:hidden/);
  });
});

describe("migration 830", () => {
  const M = read("supabase/migrations/830-individual-scholar-study-calendar.sql");
  it("is additive, private, and ends with the schema reload", () => {
    expect(M).toMatch(/create table if not exists individual_scholar_calendar_entry/);
    expect(M).toMatch(/enable row level security/);
    expect(M).toMatch(/for select using \(auth\.uid\(\) = user_id\)/);
    expect(M.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(M).not.toMatch(/\bdrop table\b|\balter table (?!individual_scholar_calendar_entry)/);
    expect(M).not.toMatch(/create (unique )?index[^;]*\bwhere\b/);
    expect(/^[\x00-\x7f]*$/.test(M)).toBe(true);
  });
  it("the code reads it only through the detected store", () => {
    expect(BLOCK).toMatch(/export async function calendarSchema/);
    expect(BLOCK).toMatch(/if \(cal830 === false\) return "not_provisioned"/);
  });
});
