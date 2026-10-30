import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecoveryRequest, recoveryKnown, recoveryPassage, rederiveRecovery, recoveredReply, type RecoverySources } from "./evidence-recovery";
import { mergeRecovered } from "./exam-service";
import type { Passage } from "./generation";
import type { LearnResearch } from "./learn-research";
import { DEFAULT_POLICY, type IndividualPolicy } from "../policy";
import type { IndividualContext } from "../guard";

// SCHOLAR-SQIE-02: "Explain using approved references" re-runs the learner's own request with ONLY a recovery's id, mode
// and question. These prove the server never takes evidence from the request: it checks the id names a recovery it
// recorded, finds the evidence again itself, and the three generation routes are wired that way.

const ID = "4f1c2b3a-1d2e-4f50-8a6b-7c8d9e0f1a2b";
const passage = (id: string, content: string, materialId = "m1"): Passage => ({ chunkId: id, materialId, materialTitle: "Notes", ordinal: 1, pageFrom: 2, pageTo: 2, content });
const research = (): LearnResearch => ({ state: "off", message: null, query: null, scholarLink: null, items: [], evidence: [], calls: [], codes: [], sourceVersions: {}, excerptChars: 320, furtherReading: true, licensing: {} });
const ctx = (admin: unknown = {}) => ({ admin, userId: "u1" }) as unknown as IndividualContext;
const policy: IndividualPolicy = DEFAULT_POLICY;

function sources(o: { notes?: Passage[]; approved?: boolean } = {}) {
  const log: string[] = [];
  const s: RecoverySources = {
    notes: async () => { log.push("notes"); return o.notes ?? [passage("c1", "Oxygen targets in COPD are 88 to 92 percent.")]; },
    library: async () => { log.push("library"); return o.approved === undefined ? [] : [{ origin: "library", kind: "competency", itemId: "k1", version: "1.0.0", code: "R1", title: "Oxygen therapy in COPD", outcome: "Explains target ranges", text: "Oxygen therapy in COPD: Explains target ranges", status: o.approved ? "Clinically approved" : "Draft", approved: !!o.approved }]; },
    external: async () => { log.push("external"); return research(); },
    guidelines: () => [],
  };
  return { s, log };
}

describe("parseRecoveryRequest: only an id, a mode and a question are read", () => {
  it("absent is null, so a route behaves exactly as before", () => {
    expect(parseRecoveryRequest(undefined, "notes_only", 600)).toBeNull();
    expect(parseRecoveryRequest(null, "notes_only", 600)).toBeNull();
  });
  it("refuses a malformed id, a missing or overlong question, and a patient identifier", () => {
    expect(parseRecoveryRequest({ id: "not-a-uuid", question: "oxygen" }, "notes_only", 600)).toMatchObject({ ok: false });
    expect(parseRecoveryRequest({ id: ID, question: "x" }, "notes_only", 600)).toMatchObject({ ok: false });
    expect(parseRecoveryRequest({ id: ID, question: "o".repeat(601) }, "notes_only", 600)).toMatchObject({ ok: false });
    expect(parseRecoveryRequest({ id: ID, question: "NHS number 943 476 5919 oxygen" }, "notes_only", 600)).toMatchObject({ ok: false });
  });
  it("ignores everything else the browser sends: evidence, chunk ids, references, abstracts", () => {
    const r = parseRecoveryRequest({ id: ID, mode: "research", question: " oxygen  targets ", chunkIds: ["evil"], references: [{ title: "Fake" }], evidence: "made up", abstracts: ["x"] }, "notes_only", 600);
    expect(r).toEqual({ ok: true, value: { id: ID, mode: "notes_and_references", question: "oxygen targets" } });
  });
});

describe("recoveryKnown: the id must name a recovery this server recorded (fails closed)", () => {
  const admin = (result: { data?: unknown; error?: unknown }, seen: string[] = []) => ({
    from: (t: string) => { seen.push(t); const q = { select: () => q, eq: (k: string, v: string) => { seen.push(`${k}=${v}`); return q; }, limit: async () => result }; return q; },
  });
  it("a recorded recovery row: known", async () => {
    const seen: string[] = [];
    expect(await recoveryKnown(admin({ data: [{ action_id: ID }] }, seen), ID)).toBe(true);
    expect(seen).toEqual(["plat_ai_outcomes", `action_id=${ID}`, "activity=evidence_recovery"]);
  });
  it("no row, an unreadable table, or a malformed id: not known", async () => {
    expect(await recoveryKnown(admin({ data: [] }), ID)).toBe(false);
    expect(await recoveryKnown(admin({ error: { code: "42P01" } }), ID)).toBe(false);
    const seen: string[] = [];
    expect(await recoveryKnown(admin({ data: [{}] }, seen), "x")).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe("rederiveRecovery: the evidence is found again on the server", () => {
  it("an unknown recovery is refused before any source is read", async () => {
    const { s, log } = sources();
    const r = await rederiveRecovery(ctx(), policy, { id: ID, mode: "notes_only", question: "oxygen targets copd" }, {}, { known: async () => false, sources: s, operational: false });
    expect(r).toEqual({ ok: false, reason: "unknown", result: null });
    expect(log).toEqual([]);
  });
  it("notes only: nothing approved to explain from means no inputs, so the route makes no AI call", async () => {
    const { s } = sources({ approved: false });
    const r = await rederiveRecovery(ctx(), policy, { id: ID, mode: "notes_only", question: "oxygen targets copd" }, {}, { known: async () => true, sources: s, operational: false });
    expect(r).toMatchObject({ ok: false, reason: "no_evidence" });
    expect(recoveredReply(r, false)).toMatchObject({ shown: false, label: "AI explanation from your notes + approved references" });
  });
  it("with approved library evidence: the server's own passages and references, the excluded material left out", async () => {
    const { s, log } = sources({ approved: true, notes: [passage("c1", "Oxygen targets in COPD."), passage("p1", "Q3. Oxygen targets in COPD?", "paper")] });
    const r = await rederiveRecovery(ctx(), policy, { id: ID, mode: "notes_only", question: "oxygen targets copd" }, { excludeMaterialId: "paper" }, { known: async () => true, sources: s, operational: false });
    expect(log).toEqual(["notes", "library"]); // notes only: never external
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inputs.passages.map(p => p.chunkId)).toEqual(["c1"]);
    expect(r.inputs.passages[0].content).toBe("Oxygen targets in COPD."); // read from the learner's rows, full text
    expect(r.inputs.references).toEqual([expect.objectContaining({ competencyId: "k1", approved: true, library: true })]);
    expect(r.inputs.result.recoveryId).toBe(ID);
  });
});

describe("recoveryPassage: one passage for the evaluation, every word the learner's notes or approved library", () => {
  it("adds the recovered notes and library under their own headings, and no abstract", () => {
    const own = passage("c0", "Own section.");
    const p = recoveryPassage(own, { passages: [own, passage("c1", "More notes.")], references: [{ title: "Oxygen therapy", code: "R1", outcome: "Explains targets", status: "Clinically approved", approved: true }] });
    expect(p.chunkId).toBe("c0");
    expect(p.content).toBe("Own section.\n\nMORE FROM MY NOTES (Notes, page 2):\nMore notes.\n\nAPPROVED COMPETEN LIBRARY: R1 Oxygen therapy: Explains targets");
  });
});

describe("mergeRecovered (paper answer): each source once, abstracts as cited records", () => {
  it("adds only what the answer did not have", () => {
    const m = mergeRecovered(
      { passages: [passage("c1", "a")], library: [{ id: "k1", code: null, title: "T", outcome: null, contentStatus: "approved" }] },
      [{ url: "https://who.int/x", title: "WHO", publisher: "who.int", published: null, retrievedAt: "2026-10-30", excerpt: "e" }],
      { passages: [passage("c1", "a"), passage("c2", "b")], references: [{ competencyId: "k1", code: null, title: "T", outcome: null }, { competencyId: "k2", code: "R2", title: "U", outcome: "o" }],
        abstracts: [{ title: "Trial", journal: "Thorax", year: 2023, url: "https://pubmed.ncbi.nlm.nih.gov/1/", abstract: "An abstract.", retrievedAt: "2026-10-30" }] },
    );
    expect(m.passages.map(p => p.chunkId)).toEqual(["c1", "c2"]);
    expect(m.library.map(l => l.id)).toEqual(["k1", "k2"]);
    expect(m.library[1].contentStatus).toBe("approved");
    expect(m.web.map(w => w.url)).toEqual(["https://who.int/x", "https://pubmed.ncbi.nlm.nih.gov/1/"]);
    expect(m.web[1]).toMatchObject({ publisher: "Thorax", published: "2023", excerpt: "An abstract." });
  });
});

// ── the route option, as wired: static reads of the three generation routes and the recovery route ─────────────────

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const ROUTES = {
  paper: "src/app/api/individual/scholar/papers/answer/route.ts",
  learn: "src/app/api/individual/scholar/learn/act/route.ts",
  revision: "src/app/api/individual/scholar/revision/answer/route.ts",
};
const EXAM = "src/lib/individual/scholar/exam-service.ts";
const RECOVER = "src/app/api/individual/scholar/evidence/recover/route.ts";
/** A route reads browser-sent evidence when it touches anything of body.recovery beyond what parseRecoveryRequest returns. */
const readsClientEvidence = (s: string) => /body\??\.recovery\??\.(?!$)\w+/.test(s) || /recovery\??\.(chunkIds|references|evidence|passages|abstracts|research|generation)\b/.test(s);
const wired = (route: string, impl: string) =>
  route.includes("parseRecoveryRequest(body?.recovery") && /rederiveRecovery\(ctx, policy, /.test(impl) && /recordRecoveryResult\(ctx\.admin, (input\.)?recovery\.id, /.test(impl)
  && !readsClientEvidence(route) && !readsClientEvidence(impl);

describe("the route option: every generation route takes only the recovery's id, mode and question", () => {
  it("paper answer, Learn and the short-answer evaluation each parse, re-derive and record the result", () => {
    expect(wired(read(ROUTES.paper), read(EXAM))).toBe(true);
    expect(wired(read(ROUTES.learn), read(ROUTES.learn))).toBe(true);
    expect(wired(read(ROUTES.revision), read(ROUTES.revision))).toBe(true);
  });
  it("the paper answer re-derives for the server's own question text, with the paper itself excluded", () => {
    expect(read(EXAM)).toContain("rederiveRecovery(ctx, policy, { ...input.recovery, question: text.slice(0, 600) }, { materialId: q.materialId, excludeMaterialId: q.materialId })");
  });
  it("no evidence means no AI call: each route answers before its runner on no_evidence", () => {
    const learn = read(ROUTES.learn);
    expect(learn.indexOf("recovered = await rederiveRecovery(")).toBeGreaterThan(0);
    expect(learn.indexOf("recovered = await rederiveRecovery(")).toBeLessThan(learn.indexOf("const ai = scholarAiRunner("));
    const exam = read(EXAM);
    expect(exam.indexOf('reason: "no_evidence" }, ...kept, message: RECOVERY_STILL_WITHHELD')).toBeLessThan(exam.indexOf("EXAM_ACTIVITY.answer, await scholarRisk"));
    const rev = read(ROUTES.revision);
    expect(rev.indexOf("recovered = await rederiveRecovery(")).toBeLessThan(rev.indexOf('scholarAiRunner(ctx, req, "evaluate"'));
  });
  it("the activity is never relabelled: the paper stays on its answer activity, Learn on the action, the evaluation on evaluate", () => {
    expect(read(EXAM)).toContain("scholarAiRunner(ctx, req, EXAM_ACTIVITY.answer,");
    expect(read(ROUTES.learn)).toContain("scholarAiRunner(ctx, req, action as LearnAction | \"check\" | \"clarify\", risk)");
    expect(read(ROUTES.revision)).toContain('scholarAiRunner(ctx, req, "evaluate",');
  });
  it("the recovery route keeps the generation inputs on the server", () => {
    expect(read(RECOVER)).toMatch(/const \{ generation: _g, \.\.\.shown \} = r;/);
    expect(read(RECOVER)).toContain("NextResponse.json({ ...shown,");
  });
  it("⚠ the check goes red when a route reads evidence the browser sent", () => {
    const planted = read(ROUTES.learn).replace("const recovery = recoveryAsked?.value ?? null;", "const recovery = recoveryAsked?.value ?? null; const extra = body?.recovery?.chunkIds;");
    expect(wired(planted, planted)).toBe(false);
    const noRecord = read(ROUTES.revision).replace("await recordRecoveryResult(ctx.admin, recovery.id, e.evaluation.ok);", "");
    expect(wired(noRecord, noRecord)).toBe(false);
  });
});
