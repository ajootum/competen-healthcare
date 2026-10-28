/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_TYPES, USER_VIEWS, breakdown, breakdownLine, countViews, loadClassifications, loadDefaultView,
  parseClassifyRequest, typeOf, viewMatches, type Classifiable,
} from "./account-classification";

// HQ-USERS-CLASSIFY-01: the views, the counts, the analytics split, the request check, and the fail-safe without 650.

const row = (accountType: Classifiable["accountType"], status: Classifiable["status"]): Classifiable => ({ accountType, status });
const SAMPLE: Classifiable[] = [
  row("human", "active"), row("human", "active"), row("human", "pending"), row("human", "suspended"),
  row("demo", "active"), row("test", "active"), row("test", "pending"), row("system", "active"),
  row("unclassified", "active"), row("unclassified", "pending"),
];

describe("views", () => {
  it("Active Humans is Human AND Active, nothing else", () => {
    expect(SAMPLE.filter(r => viewMatches("active_humans", r))).toEqual([row("human", "active"), row("human", "active")]);
  });

  it("counts every view, and All Accounts is everyone", () => {
    expect(countViews(SAMPLE)).toEqual({
      active_humans: 2, all_humans: 4, pending: 3, demo: 1, test: 2, system: 1, unclassified: 2, all: 10,
    });
  });

  it("the types partition the accounts: every account is in exactly one type view", () => {
    const c = countViews(SAMPLE);
    expect(c.all_humans + c.demo + c.test + c.system + c.unclassified).toBe(c.all);
  });

  it("status is not type: a suspended human is a human, a pending test account is not a pending human", () => {
    expect(viewMatches("all_humans", row("human", "suspended"))).toBe(true);
    const b = breakdown(SAMPLE, true);
    expect(b.pendingHumans).toBe(1);
  });
});

describe("analytics breakdown", () => {
  it("separates genuine active humans from demo, test, system and unclassified, and keeps the all-accounts figure", () => {
    expect(breakdown(SAMPLE, true)).toEqual({
      available: true, all: 10, activeHumans: 2, pendingHumans: 1, humans: 4, demo: 1, test: 2, system: 1, unclassified: 2,
    });
    expect(breakdownLine(breakdown(SAMPLE, true))).toBe("2 active human · 2 unclassified · 3 demo/test · 1 system");
  });

  it("says it is not available rather than claiming zero humans without 650", () => {
    expect(breakdownLine(breakdown([row("unclassified", "active")], false))).toBe("account classification not yet available");
  });
});

describe("loading fails safe", () => {
  const client = (res: { data?: any; error?: any } | Error) => ({
    from: () => ({
      select: () => ({
        limit: async () => { if (res instanceof Error) throw res; return res; },
        eq: () => ({ limit: async () => { if (res instanceof Error) throw res; return res; } }),
      }),
    }),
  });

  it("a missing table answers unavailable, and every account Unclassified", async () => {
    const m = await loadClassifications(client({ data: null, error: { code: "42P01" } }));
    expect(m.available).toBe(false);
    expect(typeOf(m, "anyone")).toBe("unclassified");
  });

  it("a thrown read answers unavailable too", async () => {
    expect((await loadClassifications(client(new Error("network")))).available).toBe(false);
  });

  it("reads the rows, ignoring a value outside the five types", async () => {
    const m = await loadClassifications(client({ data: [{ profile_id: "a", account_type: "demo" }, { profile_id: "b", account_type: "robot" }], error: null }));
    expect(m.available).toBe(true);
    expect(typeOf(m, "a")).toBe("demo");
    expect(typeOf(m, "b")).toBe("unclassified");
    expect(typeOf(m, "c")).toBe("unclassified");
  });

  it("without 650 the screen opens on All Accounts (today's behaviour), not an empty Active Humans", async () => {
    expect(await loadDefaultView(client({ data: [{ users_default_view: "active_humans" }], error: null }), false)).toBe("all");
  });

  it("with 650 it opens on the configured view, or Active Humans when the value is unreadable", async () => {
    expect(await loadDefaultView(client({ data: [{ users_default_view: "pending" }], error: null }), true)).toBe("pending");
    expect(await loadDefaultView(client({ data: [{ users_default_view: "nonsense" }], error: null }), true)).toBe("active_humans");
    expect(await loadDefaultView(client(new Error("x")), true)).toBe("active_humans");
  });
});

describe("the request", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  it("accepts a classification, trims the reason and removes duplicate ids", () => {
    expect(parseClassifyRequest({ action: "classify", userIds: [id, id], accountType: "test", reason: "  fixture  " }))
      .toEqual({ ok: true, req: { action: "classify", userIds: [id], accountType: "test", reason: "fixture" } });
  });
  it("refuses a body that is not an object", () => {
    expect(parseClassifyRequest(null).ok).toBe(false);
  });
  it("accepts every view as a default and nothing else", () => {
    for (const v of USER_VIEWS) expect(parseClassifyRequest({ action: "set_default_view", view: v }).ok).toBe(true);
    expect(parseClassifyRequest({ action: "set_default_view", view: "everyone" }).ok).toBe(false);
  });
});

describe("the code and migration 650 agree", () => {
  const sql = readFileSync("supabase/migrations/650-hq-account-classification.sql", "utf8");
  it("the five types are the CHECK's five", () => {
    const check = sql.match(/check \(account_type in \(([^)]*)\)\)/)?.[1] ?? "";
    expect(check.split(",").map(s => s.trim().replace(/'/g, "")).sort()).toEqual([...ACCOUNT_TYPES].sort());
  });
  it("the eight views are the CHECK's eight", () => {
    const check = sql.match(/check \(users_default_view in \(([^)]*)\)\)/)?.[1] ?? "";
    expect(check.split(",").map(s => s.trim().replace(/'/g, "")).sort()).toEqual([...USER_VIEWS].sort());
  });
  it("the migration classifies nobody Human or System", () => {
    expect(/\('(human|system)', '(demo seed|test fixture)'/.test(sql)).toBe(false);
  });
});
