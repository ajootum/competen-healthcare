import { describe, expect, it } from "vitest";
import {
  CONTENT_REVIEW_SCOPE, DEFAULT_CONTENT_REVIEW, contentReviewPath, loadContentReviewPolicy, numericValues, resolveContentReview, reviewMatches, validateContentReview,
} from "./content-review";
import { loadContentReviewVersions, publishContentReview, rollbackContentReview, saveContentReviewDraft } from "./content-review-admin";
import { cardSensitiveFlag } from "@/lib/individual/scholar/flashcard-sensitive";
import { respiratoryCards } from "@/lib/individual/scholar/flashcard-pdf.fixture";

// SCHOLAR-FLASHCARDS-QA-01 (c), owner GO 31 Oct 2026: HQ-configurable clinical educational content review rules, through
// CONFIG-002 (draft -> publish -> version -> rollback) in their own scope. A small in-memory workspace_config_* is
// enough to run the real engine functions end to end.

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function memoryDb() {
  const t: Record<string, Row[]> = { workspace_config_overrides: [], workspace_config_versions: [], workspace_config_audit: [] };
  let n = 0;
  const from = (table: string) => {
    let filters: [string, unknown][] = [];
    let op: { kind: "select" | "insert" | "upsert" | "update" | "delete"; row?: Row } = { kind: "select" };
    let order: string | null = null;
    const match = (r: Row) => filters.every(([c, v]) => r[c] === v);
    const run = () => {
      const rows = t[table] ?? (t[table] = []);
      if (op.kind === "insert") { const r = { id: `v${++n}`, created_at: new Date(Date.UTC(2026, 9, 31, 0, n)).toISOString(), ...op.row }; rows.push(r); return { data: r, error: null }; }
      if (op.kind === "upsert") {
        const r = op.row!; const i = rows.findIndex(x => x.scope_type === r.scope_type && x.scope_ref === r.scope_ref && x.config_path === r.config_path);
        if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ ...r }); return { data: null, error: null };
      }
      if (op.kind === "update") { for (const r of rows.filter(match)) Object.assign(r, op.row); return { data: null, error: null }; }
      if (op.kind === "delete") { t[table] = rows.filter(r => !match(r)); return { data: null, error: null }; }
      let out = rows.filter(match);
      if (order) out = [...out].sort((a, b) => String(b[order!]).localeCompare(String(a[order!])));
      return { data: out, error: null };
    };
    const q: Row = {
      select: () => q, eq: (c: string, v: unknown) => { filters.push([c, v]); return q; }, limit: () => q,
      order: (c: string) => { order = c; return q; },
      insert: (row: Row) => { op = { kind: "insert", row }; return q; }, upsert: (row: Row) => { op = { kind: "upsert", row }; return q; },
      update: (row: Row) => { op = { kind: "update", row }; return q; }, delete: () => { op = { kind: "delete" }; return q; },
      maybeSingle: () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }); },
      then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    void filters; filters = [];
    return q;
  };
  return { from, tables: t };
}
const actor = { userId: "hq-1", name: "Platform Director" };
const flagged = (policy = DEFAULT_CONTENT_REVIEW, professions: string[] | null = null) =>
  respiratoryCards().map((c, i) => (cardSensitiveFlag(c, { policy, professions }) ? i + 1 : null)).filter(Boolean);

describe("content review rules: defaults, matching, validation", () => {
  it("the defaults reproduce the flashcard flags on the ten-card fixture", () => {
    expect(flagged()).toEqual([2, 3, 4, 6, 8, 9]);
    expect(cardSensitiveFlag(respiratoryCards()[2])).toMatchObject({ codes: ["paediatric_rr", "numeric_value"], values: ["30-40 breaths/min", "20-30", "15-20"], action: "flag" });
    expect(cardSensitiveFlag(respiratoryCards()[3])!.codes).toEqual(["oxygen_target", "emergency_resp", "numeric_value"]);
  });
  it("numeric values: kinds, exclusions (ages, durations) and never the 2 of SpO2", () => {
    expect(numericValues("SpO2 86% on room air, a 68-year-old, for 60 seconds, 12 to 20 breaths per minute, above 5", DEFAULT_CONTENT_REVIEW))
      .toEqual([{ value: "86%", kinds: ["percent"] }, { value: "12 to 20 breaths per minute", kinds: ["unit", "range"] }, { value: "above 5", kinds: ["comparison"] }]);
  });
  it("profession applicability filters: a rule for one profession does not flag another's content; unknown applies all", () => {
    const only = resolveContentReview({ rules: [{ id: "peds_only", label: "Paediatric content", all: [["children"]], professions: ["Midwifery"], action: "flag" }] });
    const subject = { text: "Normal respiratory rate in children" };
    expect(reviewMatches(only, subject, ["Midwifery"]).map(h => h.rule.id)).toEqual(["peds_only"]);
    expect(reviewMatches(only, subject, ["Pharmacy"])).toEqual([]);
    expect(reviewMatches(only, subject, null).map(h => h.rule.id)).toEqual(["peds_only"]);
  });
  it("topic patterns and review actions: note_only lists without a card marker; flag_strong uses its marker; a rule's own marker wins", () => {
    const p = resolveContentReview({ rules: [
      { id: "esc_topic", label: "Escalation topic", topics: ["escalat*"], action: "note_only" },
      { id: "copd_strong", label: "COPD", all: [["copd"]], action: "flag_strong", marker: "COPD content: check your local COPD pathway." },
    ] });
    const cards = respiratoryCards();
    expect(cardSensitiveFlag(cards[9], { policy: p })).toMatchObject({ codes: ["esc_topic"], action: "note_only", marker: null });
    expect(cardSensitiveFlag(cards[7], { policy: p })).toMatchObject({ codes: ["esc_topic", "copd_strong"], action: "flag_strong", marker: "COPD content: check your local COPD pathway." });
  });
  it("an invalid rule is refused at save, with its reason; nothing is silently dropped", () => {
    const bad = [
      [{ id: "Bad Id", label: "x", all: [["a1"]] }, /an id is/],
      [{ id: "nothing", label: "Matches nothing" }, /matches nothing/],
      [{ id: "kind", label: "x", numeric: ["dose"] }, /numeric kind/],
      [{ id: "act", label: "x", all: [["copd"]], action: "block" }, /review action/],
      [{ id: "grp", label: "x", all: [["copd"], []] }, /every term group/],
      [{ id: "nolabel", label: " ", all: [["copd"]] }, /label/],
    ] as const;
    for (const [rule, why] of bad) { const v = validateContentReview({ rules: [rule] }); expect(v.ok, JSON.stringify(rule)).toBe(false); if (!v.ok) expect(v.error).toMatch(why); }
    expect(validateContentReview({ rules: [{ id: "a1", label: "A", all: [["copd"]] }, { id: "a1", label: "B", all: [["copd"]] }] })).toMatchObject({ ok: false, error: "Two rules have the id a1." });
    expect(validateContentReview({ rules: DEFAULT_CONTENT_REVIEW.rules }).ok).toBe(true);
  });
});

describe("content review rules through CONFIG-002: publish changes the flags, rollback restores them", () => {
  it("nothing published: defaults; a published change alters the flags; rollback restores the previous rules", async () => {
    const db = memoryDb();
    expect(await loadContentReviewPolicy(db)).toBe(DEFAULT_CONTENT_REVIEW);
    // v1: the defaults, published as they are.
    expect(await saveContentReviewDraft(db, actor, "scholar", { rules: DEFAULT_CONTENT_REVIEW.rules })).toMatchObject({ ok: true });
    expect(await publishContentReview(db, actor, "baseline")).toMatchObject({ ok: true });
    expect(flagged(await loadContentReviewPolicy(db))).toEqual([2, 3, 4, 6, 8, 9]);
    // A draft does not run.
    const onlyCopd = { rules: [{ id: "copd_deterioration", label: "COPD deterioration", all: [["copd"], ["drows*"]], action: "flag" }] };
    expect(await saveContentReviewDraft(db, actor, "scholar", onlyCopd)).toMatchObject({ ok: true });
    expect(flagged(await loadContentReviewPolicy(db))).toEqual([2, 3, 4, 6, 8, 9]);
    // Published: only card 8 is flagged now.
    expect(await publishContentReview(db, actor, "COPD only")).toMatchObject({ ok: true });
    expect(flagged(await loadContentReviewPolicy(db))).toEqual([8]);
    // An invalid draft is refused and changes nothing.
    expect(await saveContentReviewDraft(db, actor, "scholar", { rules: [{ id: "x1", label: "x" }] })).toMatchObject({ ok: false, status: 422 });
    // Roll back to v1: the previous rules run again, recorded as a new version.
    const versions = (await loadContentReviewVersions(db))!;
    expect(versions.map(v => v.note)).toEqual(["COPD only", "baseline"]);
    expect(await rollbackContentReview(db, actor, versions[1].id)).toMatchObject({ ok: true });
    expect(flagged(await loadContentReviewPolicy(db))).toEqual([2, 3, 4, 6, 8, 9]);
    expect((await loadContentReviewVersions(db))!.length).toBe(3);
    // Its own scope: nothing outside platform / ai_content_review was written.
    expect(db.tables.workspace_config_overrides.every(r => r.scope_type === CONTENT_REVIEW_SCOPE.scopeType && r.scope_ref === CONTENT_REVIEW_SCOPE.scopeRef && r.config_path === contentReviewPath("scholar"))).toBe(true);
  });
  it("a rollback refuses a version from another scope (the AI fair-use policies are never restored from here)", async () => {
    const db = memoryDb();
    db.tables.workspace_config_versions.push({ id: "other", scope_type: "platform", scope_ref: "ai_fair_use", snapshot: [], created_at: "2026-10-30" });
    expect(await rollbackContentReview(db, actor, "other")).toMatchObject({ ok: false, error: "version not found" });
  });
});
