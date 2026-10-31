/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { judgeQuestionOffer, offerQuestion, questionOfferingOn, verbatimOverlap, grantQuestionOffering, QUESTION_OFFER_ATTESTATION_VERSION } from "./offers";
import { policyPath, resolvePolicy } from "@/lib/individual/policy";

const R = "Fever, tachycardia and hypotension are all signs of sepsis.";
const own = { kind: "mrq", stem: "Which are signs of sepsis? Choose all that apply.", options: ["Fever", "Tachycardia", "Bradypnoea", "Hypotension"], correctIndex: null, answer: { correct: [0, 1, 3] }, rationale: R, sourceQuote: "Sepsis presents with fever and a fast heart rate." };
const notes = ["Sepsis is a life-threatening response to infection. Sepsis presents with fever and a fast heart rate, and low blood pressure in shock."];

describe("judgeQuestionOffer: the deterministic gate before anything is stored", () => {
  it("a clean question becomes a library-shaped snapshot, without the quote unless asked and confirmed", () => {
    const j = judgeQuestionOffer({ question: own, sources: notes, includeQuote: false, rightsConfirmed: false });
    expect(j).toMatchObject({ ok: true, snapshot: { format: "mrq", stem: own.stem, answerKey: { correct: [0, 1, 3] }, marking: "deterministic" } });
    expect(j.ok && "sourceQuote" in j.snapshot).toBe(false);
    const withQuote = judgeQuestionOffer({ question: own, sources: notes, includeQuote: true, rightsConfirmed: true });
    expect(withQuote.ok && withQuote.snapshot.sourceQuote).toBe(own.sourceQuote);
  });
  it("blocks: a quote without the rights confirmation, an identifier anywhere, text copied from the notes, a case step", () => {
    expect(judgeQuestionOffer({ question: own, sources: notes, includeQuote: true, rightsConfirmed: false })).toEqual({ ok: false, blocks: ["quote_without_rights"] });
    expect(judgeQuestionOffer({ question: { ...own, stem: "Mr Okello on ward 3 has which signs of sepsis? Choose all." }, sources: notes, includeQuote: false, rightsConfirmed: false }))
      .toMatchObject({ ok: false, blocks: ["identifier"] });
    expect(judgeQuestionOffer({ question: { ...own, sourceQuote: "NHS 943 476 5919 presents with fever." }, sources: notes, includeQuote: true, rightsConfirmed: true }))
      .toMatchObject({ ok: false, blocks: ["identifier"] });
    const copied = { ...own, rationale: "Sepsis is a life-threatening response to infection. Sepsis presents with fever and a fast heart rate." };
    expect(judgeQuestionOffer({ question: copied, sources: notes, includeQuote: false, rightsConfirmed: false })).toMatchObject({ ok: false, blocks: ["verbatim_overlap"] });
    expect(judgeQuestionOffer({ question: { ...own, kind: "case", correctIndex: 0, answer: null, options: ["a", "b", "c", "d"] }, sources: notes, includeQuote: false, rightsConfirmed: false }))
      .toEqual({ ok: false, blocks: ["not_a_library_question"] });
  });
  it("verbatimOverlap: twelve words in a row, case and punctuation ignored, nothing for no notes", () => {
    const src = "one two three four five six seven eight nine ten eleven twelve thirteen";
    expect(verbatimOverlap(["ONE two, three four five six seven eight nine ten eleven twelve"], [src])).toBe(true);
    expect(verbatimOverlap(["one two three four five six seven eight nine ten eleven"], [src])).toBe(false);
    expect(verbatimOverlap(["anything at all"], [])).toBe(false);
  });
});

/** A tiny PostgREST stand-in for the offer path. */
function fakeAdmin(permission: Record<string, unknown> | null | "missing") {
  const writes: any[] = [], rpcs: string[] = [];
  const admin = {
    from(table: string) {
      const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
        maybeSingle: () => Promise.resolve(permission === "missing" ? { data: null, error: { message: `relation "${table}" does not exist` } } : { data: permission, error: null }),
        insert: (row: any) => { writes.push({ table, row }); return { select: () => ({ single: () => Promise.resolve({ data: { id: "o1" }, error: null }) }) }; } };
      return q;
    },
    rpc(fn: string) { rpcs.push(fn); return Promise.resolve({ data: null, error: null }); },
  };
  return { admin, writes, rpcs };
}
const U = "00000000-0000-4000-8000-000000000001", Q = "00000000-0000-4000-8000-000000000002";

describe("offerQuestion: the permission first, the screen second, nothing stored on a finding", () => {
  const input = { question: own, sources: notes, includeQuote: false, rightsConfirmed: false };
  it("without a granted, current permission nothing is offered", async () => {
    for (const p of [null, { status: "revoked", attestation: "own_notes", attestation_version: QUESTION_OFFER_ATTESTATION_VERSION }, { status: "granted", attestation: "own_notes", attestation_version: "question-attest/0" }]) {
      const f = fakeAdmin(p);
      expect((await offerQuestion(f.admin, { userId: U, questionId: Q, input, aiWritten: true })).ok).toBe(false);
      expect(f.writes).toEqual([]);
    }
    const m = fakeAdmin("missing");
    expect(await offerQuestion(m.admin, { userId: U, questionId: Q, input, aiWritten: true })).toMatchObject({ ok: false, error: expect.stringMatching(/not available here yet/) });
  });
  it("with it, a clean question is stored as the snapshot only; a blocked one stores nothing", async () => {
    const granted = { status: "granted", attestation: "own_notes", attestation_version: QUESTION_OFFER_ATTESTATION_VERSION };
    const f = fakeAdmin(granted);
    expect(await offerQuestion(f.admin, { userId: U, questionId: Q, input, aiWritten: true })).toEqual({ ok: true, offerId: "o1", duplicate: false });
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].row).toMatchObject({ user_id: U, source_key: `scholar:question:${Q}`, status: "offered", ai_written: true, screen_version: "question-screen/1" });
    expect(Object.keys(f.writes[0].row)).not.toContain("attestation");
    const b = fakeAdmin(granted);
    const r = await offerQuestion(b.admin, { userId: U, questionId: Q, input: { ...input, question: { ...own, stem: "Mr Okello has which signs of sepsis? Choose all that apply." } }, aiWritten: true });
    expect(r).toMatchObject({ ok: false, blocks: ["identifier"] });
    expect(b.writes).toEqual([]);
  });
  it("granting needs the current attestation text and one of the two attestations", async () => {
    const f = fakeAdmin(null);
    expect((await grantQuestionOffering(f.admin, { userId: U, attestation: "own_notes", attestationVersion: "question-attest/0" })).ok).toBe(false);
    expect((await grantQuestionOffering(f.admin, { userId: U, attestation: "mine", attestationVersion: QUESTION_OFFER_ATTESTATION_VERSION })).ok).toBe(false);
    expect(f.rpcs).toEqual([]);
    expect((await grantQuestionOffering(f.admin, { userId: U, attestation: "licensed_to_share", attestationVersion: QUESTION_OFFER_ATTESTATION_VERSION })).ok).toBe(true);
    expect(f.rpcs).toEqual(["question_contribution_grant"]);
  });
});

describe("the switch scholar_question_offering", () => {
  it("is off until HQ publishes on, and an unknown value falls back to off", () => {
    expect(resolvePolicy([]).scholarQuestionOffering).toBe("off");
    expect(questionOfferingOn(resolvePolicy([]))).toBe(false);
    expect(resolvePolicy([{ config_path: policyPath("scholar_question_offering"), published: { value: "on" } }] as any).scholarQuestionOffering).toBe("on");
    expect(resolvePolicy([{ config_path: policyPath("scholar_question_offering"), published: { value: "maybe" } }] as any).scholarQuestionOffering).toBe("off");
    expect(questionOfferingOn({ scholarQuestionOffering: "on" })).toBe(true);
    expect(questionOfferingOn({})).toBe(false);
  });
});
