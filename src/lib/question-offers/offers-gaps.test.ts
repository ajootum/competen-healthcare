/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { expireStaleOffers, offerExpiryCutoff, offerExpiryDays, withdrawOffersOfQuestions, myQuestionOffers, questionSourceKey, OFFER_SWEEP_CAP } from "./offers";
import { questionIdsOfMaterial } from "@/lib/individual/scholar/store";
import { listLearnerOffers } from "@/lib/knowledge/learner-offers";
import { policyPath, resolvePolicy } from "@/lib/individual/policy";

// SQIE-LIBRARY-GAPS-01. An in-memory stand-in for the offer table that applies what migration 802's guard does on the one
// move these paths make (offered -> withdrawn: the snapshot is purged and the reason must be one the CHECK knows), so the
// tests prove the right rows move and that no reason outside the CHECK is ever written.

const U = "00000000-0000-4000-8000-000000000001", V = "00000000-0000-4000-8000-000000000009";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => id(100 + n);
const NOW = new Date("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
type Row = Record<string, any>;
const REASONS = ["learner", "revoked", "erasure", "administrative"];

function world(offers: Row[], questions: Row[] = []) {
  const tables: Record<string, Row[]> = { question_contribution_offer: offers, individual_scholar_question: questions };
  const statements: string[] = [];
  const from = (table: string) => {
    const f: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null, order: [string, boolean] | null = null, max = Infinity;
    const rows = () => {
      let r = (tables[table] ?? []).filter(x => f.every(p => p(x)));
      if (order) r = [...r].sort((a, b) => (a[order![0]] < b[order![0]] ? -1 : 1) * (order![1] ? 1 : -1));
      return r.slice(0, max);
    };
    const run = () => {
      if (!patch) return { data: rows().map(r => ({ ...r })), error: null };
      const hit = rows();
      for (const r of hit) {
        if (r.status === "offered" && patch.status === "withdrawn") {
          if (!REASONS.includes(patch.withdrawn_reason)) return { data: null, error: { message: "violates check constraint question_contribution_offer_check" } };
          Object.assign(r, patch, { snapshot: null, withdrawn_at: NOW.toISOString() });
        }
      }
      return { data: hit.map(r => ({ id: r.id })), error: null };
    };
    const api: any = {
      select: () => api,
      update: (p: Row) => { patch = p; statements.push(`update ${table}`); return api; },
      eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return api; },
      lt: (k: string, v: string) => { f.push(r => r[k] < v); return api; },
      in: (k: string, vs: unknown[]) => { f.push(r => vs.includes(r[k])); return api; },
      order: (k: string, o: { ascending: boolean }) => { order = [k, o.ascending]; return api; },
      limit: (n: number) => { max = n; return api; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return api;
  };
  // The learner's own withdraw (802): the same statement the SQL function runs.
  const rpc = async (fn: string, a: Row) => {
    statements.push(fn);
    if (fn !== "question_contribution_withdraw") return { data: null, error: { message: "unknown" } };
    let n = 0;
    for (const r of tables.question_contribution_offer) if (r.id === a.p_offer && r.user_id === a.p_user && ["offered", "declined"].includes(r.status)) {
      Object.assign(r, { status: "withdrawn", withdrawn_reason: "learner", snapshot: null }); n++;
    }
    return { data: n, error: null };
  };
  return { admin: { from, rpc }, tables, statements };
}
const offer = (n: number, over: Row = {}): Row => ({ id: id(n), user_id: U, source_key: questionSourceKey(q(n)), status: "offered", snapshot: { stem: "kept" }, offered_at: daysAgo(10), ...over });

describe("the policy scholar_question_offer_days", () => {
  it("is 60 until HQ publishes 30 or 90, and anything else falls back to 60", () => {
    expect(resolvePolicy([]).scholarQuestionOfferDays).toBe(60);
    expect(resolvePolicy([{ config_path: policyPath("scholar_question_offer_days"), published: { value: "30" } }] as any).scholarQuestionOfferDays).toBe(30);
    expect(resolvePolicy([{ config_path: policyPath("scholar_question_offer_days"), published: { value: "90" } }] as any).scholarQuestionOfferDays).toBe(90);
    for (const bad of ["45", "0", "abc", 30]) expect(resolvePolicy([{ config_path: policyPath("scholar_question_offer_days"), published: { value: bad } }] as any).scholarQuestionOfferDays).toBe(60);
  });
  it("offerExpiryDays and the cutoff are pure", () => {
    expect(offerExpiryDays(30)).toBe(30); expect(offerExpiryDays("90")).toBe(90); expect(offerExpiryDays(45)).toBe(60); expect(offerExpiryDays(undefined)).toBe(60);
    expect(offerExpiryCutoff(30, NOW)).toBe(daysAgo(30));
    expect(offerExpiryCutoff(7, NOW)).toBe(daysAgo(60));
  });
});

describe("expireStaleOffers: only an untaken offer past the days, withdrawn and purged", () => {
  it("withdraws old offered offers (purged, reason administrative) and touches nothing else", async () => {
    const w = world([
      offer(1, { offered_at: daysAgo(61) }), offer(2, { offered_at: daysAgo(59) }),
      offer(3, { offered_at: daysAgo(200), status: "taken" }), offer(4, { offered_at: daysAgo(200), status: "promoted" }),
      offer(5, { offered_at: daysAgo(200), status: "withdrawn", snapshot: null }), offer(6, { offered_at: daysAgo(90), user_id: V }),
    ]);
    expect(await expireStaleOffers(w.admin, { days: 60, now: NOW })).toEqual({ expired: 2, failed: 0 });
    const by = (n: number) => w.tables.question_contribution_offer.find(r => r.id === id(n))!;
    expect(by(1)).toMatchObject({ status: "withdrawn", withdrawn_reason: "administrative", snapshot: null });
    expect(by(6)).toMatchObject({ status: "withdrawn", snapshot: null });
    expect(by(2)).toMatchObject({ status: "offered", snapshot: { stem: "kept" } });
    expect(by(3).status).toBe("taken"); expect(by(3).snapshot).not.toBeNull();
    expect(by(4).status).toBe("promoted");
  });
  it("30 days expires sooner than 90, and a learner sweep is limited to that learner", async () => {
    const w = world([offer(1, { offered_at: daysAgo(40) }), offer(2, { offered_at: daysAgo(40), user_id: V })]);
    expect(await expireStaleOffers(w.admin, { days: 90, now: NOW })).toEqual({ expired: 0, failed: 0 });
    expect(await expireStaleOffers(w.admin, { days: 30, userId: U, now: NOW })).toEqual({ expired: 1, failed: 0 });
    expect(w.tables.question_contribution_offer.find(r => r.id === id(2))!.status).toBe("offered");
  });
  it("is bounded: at most 200 a sweep, oldest first", async () => {
    const many = Array.from({ length: 250 }, (_, i) => offer(i + 1, { offered_at: daysAgo(100 + (250 - i)), source_key: `scholar:question:${q(i + 1)}` }));
    const w = world(many);
    expect(OFFER_SWEEP_CAP).toBe(200);
    expect(await expireStaleOffers(w.admin, { days: 60, now: NOW, limit: 5000 })).toEqual({ expired: 200, failed: 0 });
    expect(w.tables.question_contribution_offer.filter(r => r.status === "offered")).toHaveLength(50);
    // the oldest were taken first: the 50 left are the 50 most recent
    expect(w.tables.question_contribution_offer.filter(r => r.status === "offered").every(r => r.offered_at >= daysAgo(100 + 50))).toBe(true);
  });
  it("never throws: a missing table or an unreadable queue changes nothing", async () => {
    const missing = { from: () => ({ select: () => ({ eq: () => ({ lt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'relation "question_contribution_offer" does not exist' } }) }) }) }) }) }) };
    expect(await expireStaleOffers(missing, { days: 60 })).toEqual({ expired: 0, failed: 0 });
    expect(await expireStaleOffers({ from: () => { throw new Error("x"); } } as any, { days: 60, userId: "nope" })).toEqual({ expired: 0, failed: 0 });
  });
  it("the learner panel and the HQ queue sweep before they read", async () => {
    const w = world([offer(1, { offered_at: daysAgo(100) }), offer(2, { offered_at: daysAgo(5) })]);
    const mine = await myQuestionOffers(w.admin, U, { expireDays: 60 });
    expect(mine!.map(o => [o.id, o.status]).sort()).toEqual([[id(1), "withdrawn"], [id(2), "offered"]]);
    const w2 = world([offer(1, { offered_at: daysAgo(100) }), offer(2, { offered_at: daysAgo(5) })]);
    // HQ reads question_contribution_queue (a view over offered/taken/promoted): the swept offer is gone from it.
    const asQueue = { from: (t: string) => (t === "question_contribution_queue" ? w2.admin.from("question_contribution_offer") : w2.admin.from(t)), rpc: w2.admin.rpc };
    const swept = await expireStaleOffers(asQueue, { days: 60 });
    expect(swept.expired).toBe(1);
    const unswept = world([offer(1, { offered_at: daysAgo(100) })]);
    await myQuestionOffers(unswept.admin, U);
    expect(unswept.tables.question_contribution_offer[0].status).toBe("offered");
    expect(typeof listLearnerOffers).toBe("function");
  });
});

describe("deleting a material withdraws the open offers made from its questions", () => {
  it("reads the material's question ids (keyed on the user), then withdraws exactly the offered ones through the learner's own withdraw", async () => {
    const w = world(
      [offer(1), offer(2), offer(3, { status: "taken" }), offer(4, { status: "promoted" }), offer(5, { status: "declined", snapshot: null }), offer(7), offer(8, { user_id: V, source_key: questionSourceKey(q(1)) })],
      [{ id: q(1), user_id: U, material_id: "M1" }, { id: q(2), user_id: U, material_id: "M1" }, { id: q(3), user_id: U, material_id: "M1" }, { id: q(4), user_id: U, material_id: "M1" },
        { id: q(5), user_id: U, material_id: "M1" }, { id: q(7), user_id: U, material_id: "M2" }],
    );
    const ids = await questionIdsOfMaterial(w.admin as any, U, "00000000-0000-4000-8000-0000000000b1");
    expect(ids).toEqual([]); // not that material: a uuid is required and matched exactly
    const mats = w.tables.individual_scholar_question.map(r => ({ ...r, material_id: r.material_id === "M1" ? "00000000-0000-4000-8000-0000000000b1" : "00000000-0000-4000-8000-0000000000b2" }));
    w.tables.individual_scholar_question.splice(0, w.tables.individual_scholar_question.length, ...mats);
    const qIds = await questionIdsOfMaterial(w.admin as any, U, "00000000-0000-4000-8000-0000000000b1");
    expect(qIds!.sort()).toEqual([q(1), q(2), q(3), q(4), q(5)]);

    expect(await withdrawOffersOfQuestions(w.admin, U, qIds!)).toEqual({ withdrawn: 2, failed: 0 });
    const by = (n: number, user = U) => w.tables.question_contribution_offer.find(r => r.id === id(n) && r.user_id === user)!;
    expect(by(1)).toMatchObject({ status: "withdrawn", withdrawn_reason: "learner", snapshot: null });
    expect(by(2)).toMatchObject({ status: "withdrawn", snapshot: null });
    // taken / promoted: the educator's own draft, left alone
    expect(by(3)).toMatchObject({ status: "taken", snapshot: { stem: "kept" } });
    expect(by(4).status).toBe("promoted");
    // another material's offer, and another person's offer of the same key, are not touched
    expect(by(7).status).toBe("offered");
    expect(by(8, V).status).toBe("offered");
    expect(w.statements.filter(s => s === "question_contribution_withdraw")).toHaveLength(2);
  });
  it("is a no-op for no questions, and says failed (never throws) when a withdraw is refused", async () => {
    const w = world([offer(1)]);
    expect(await withdrawOffersOfQuestions(w.admin, U, [])).toEqual({ withdrawn: 0, failed: 0 });
    const refusing = { from: w.admin.from, rpc: async () => ({ data: null, error: { message: "boom" } }) };
    expect(await withdrawOffersOfQuestions(refusing, U, [q(1)])).toEqual({ withdrawn: 0, failed: 1 });
    expect(w.tables.question_contribution_offer[0].status).toBe("offered");
  });
});
