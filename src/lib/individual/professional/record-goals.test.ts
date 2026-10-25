/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// LCPD-01 with PLAN-01 (migration 480): Stage 4 links what happened to the goals it served ONLY through Stage 3's writers.
const calls: string[] = [];
const outcome: { attach: any; link: any } = { attach: { ok: true, id: "a1" }, link: { ok: true, activityId: "a1" } };
vi.mock("./plan-store", () => ({
  attachRecordToActivity: vi.fn(async (_a: any, u: string, act: string, ref: any) => { calls.push(`attach ${u} ${act} ${JSON.stringify(ref)}`); return outcome.attach; }),
  linkCpdToGoal: vi.fn(async (_a: any, u: string, goal: string, ref: any) => { calls.push(`link ${u} ${goal} ${JSON.stringify(ref)}`); return outcome.link; }),
}));
const { goalsByRecord, linkSavedCpd, openActivities, planReady } = await import("./record-goals");

const act = (id: string, o: Partial<{ cpd_id: string; learning_record_id: string; status: string; title: string }>) =>
  ({ id, title: o.title ?? id, status: o.status ?? "completed", cpd_id: o.cpd_id ?? null, learning_record_id: o.learning_record_id ?? null }) as any;

beforeEach(() => { calls.length = 0; outcome.attach = { ok: true, id: "a1" }; outcome.link = { ok: true, activityId: "a1" }; });

describe("the goals a record served, read from the plan", () => {
  const ws: any = {
    goals: [{ id: "g1", title: "Interpret ECGs" }, { id: "g2", title: "Lead resuscitation" }],
    activities: [act("a1", { cpd_id: "c1" }), act("a2", { learning_record_id: "r1" }), act("a3", { status: "planned", title: "Shadow cardiology" }), act("a4", { cpd_id: "c9" })],
    activityGoals: [{ activity_id: "a1", goal_id: "g1", position: 0 }, { activity_id: "a1", goal_id: "g2", position: 1 }, { activity_id: "a2", goal_id: "g1", position: 0 }, { activity_id: "a4", goal_id: "gone", position: 0 }],
  };

  it("keys CPD entries and learning records as the reflections do, through the activity that references each", () => {
    const m = goalsByRecord(ws);
    expect(m.get("cpd:c1")).toEqual([{ goalId: "g1", title: "Interpret ECGs" }, { goalId: "g2", title: "Lead resuscitation" }]);
    expect(m.get("rec:r1")).toEqual([{ goalId: "g1", title: "Interpret ECGs" }]);
  });

  it("a link to a goal the person no longer has shows nothing, and an unreadable plan gives no links", () => {
    expect(goalsByRecord(ws).has("cpd:c9")).toBe(false);
    expect(goalsByRecord({ goals: null, activities: null, activityGoals: null }).size).toBe(0);
  });

  it("a new entry can complete only open planned work that references no record yet", () => {
    expect(openActivities({ activities: [...ws.activities, act("a5", { status: "active" }), act("a6", { status: "cancelled" }), act("a7", { status: "deferred" })] })).toEqual([{ id: "a3", title: "Shadow cardiology" }, { id: "a5", title: "a5" }]);
  });
});

describe("linking a saved CPD entry, through Stage 3's writers", () => {
  it("the planned activity is completed first, then the goal is linked, both for the person's own entry", async () => {
    expect(await linkSavedCpd({}, "u1", "c1", { goalId: "g1", activityId: "a3" })).toBeNull();
    expect(calls).toEqual(['attach u1 a3 {"cpdId":"c1"}', 'link u1 g1 {"cpdId":"c1"}']);
  });

  it("nothing asked, nothing written", async () => {
    expect(await linkSavedCpd({}, "u1", "c1", { goalId: null, activityId: null })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("a refused link is reported in words and the entry is kept: nothing is undone", async () => {
    outcome.link = { ok: false, status: 404, error: "That is not on your record." };
    expect(await linkSavedCpd({}, "u1", "c1", { goalId: "g1", activityId: null })).toMatch(/^It is saved, but it could not be linked to your goal: That is not on your record\.$/);
    outcome.attach = { ok: false, status: 409, error: "That record already belongs to another activity in your plan." };
    expect(await linkSavedCpd({}, "u1", "c1", { goalId: "g1", activityId: "a3" })).toMatch(/could not be marked as your planned activity/);
    expect(calls.filter(c => c.startsWith("link"))).toHaveLength(1);
  });

  it("the 480 gate is a zero-row read, and absent or failing means the 373 goal stands", async () => {
    const probe = (error: any) => ({ from: (t: string) => ({ select: () => ({ limit: async (n: number) => { calls.push(`${t} limit ${n}`); return { error }; } }) }) });
    expect(await planReady(probe(null))).toBe(true);
    expect(await planReady(probe({ message: "relation does not exist" }))).toBe(false);
    expect(await planReady({ from: () => { throw new Error("down"); } })).toBe(false);
    expect(calls).toEqual(["individual_professional_activity limit 0", "individual_professional_activity limit 0"]);
  });
});

describe("Stage 4 never writes Stage 3's tables", () => {
  it("no insert, update, upsert or delete on a 480 table outside plan-store", () => {
    const files = ["src/lib/individual/professional/record-goals.ts", "src/app/api/individual/professional/cpd/route.ts",
      "src/app/individual/(app)/[experience]/(professional)/cpd/page.tsx", "src/app/individual/_components/professional/RecordGoalLink.tsx"];
    const src = files.map(f => readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "")).join("\n");
    expect(src).not.toMatch(/from\("individual_professional_(activity|activity_goal|goal_history|milestone|plan_competency|goal_evidence|goal_review)"\)\s*\.(insert|update|upsert|delete)/);
  });

  it("with 480 the CPD route no longer writes goal_id: cleared on create, left alone on edit", () => {
    const route = readFileSync("src/app/api/individual/professional/cpd/route.ts", "utf8");
    expect(route).toMatch(/\.\.\.\(plan \? \{ goal_id: null \} : \{\}\)/);
    expect(route).toMatch(/if \(await planReady\(ctx\.admin\)\) delete cols\.goal_id;/);
  });
});
