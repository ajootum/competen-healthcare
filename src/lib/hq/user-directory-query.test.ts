import { describe, it, expect } from "vitest";
import { PAGE_SIZE, directoryStats, parseDirectoryFilters, queryDirectory, toQueryString, type FilterableRow } from "./user-directory-query";
import type { AccountType } from "./account-classification";

// HQ-USERS-CLASSIFY-01: the Users directory's server-side query -- filters, view counts and pagination.

const NOW = Date.parse("2026-10-28T12:00:00Z");
let n = 0;
const u = (accountType: AccountType, over: Partial<FilterableRow> = {}): FilterableRow & { id: string } => ({
  id: `u${++n}`, name: `Person ${n}`, email: `p${n}@example.org`, phone: null, roles: ["nurse"],
  organisationId: null, hospitalId: null, status: "active", lastSignIn: "2026-10-27T12:00:00Z",
  products: [], hqActive: false, accountType, ...over,
});

const base = (p: Record<string, string> = {}) => parseDirectoryFilters(p, "active_humans");

describe("parseDirectoryFilters", () => {
  it("no query string is the configured default view, page 1, every filter off", () => {
    expect(base()).toEqual({ view: "active_humans", q: "", role: "all", org: "all", facility: "all", status: "all", login: "all", product: "all", hq: "all", page: 0 });
  });
  it("an unknown view, status or page falls back rather than failing", () => {
    expect(base({ view: "everyone", status: "deleted", page: "-4" })).toMatchObject({ view: "active_humans", status: "all", page: 0 });
  });
  it("round-trips through the query string, leaving defaults out", () => {
    const f = base({ view: "demo", q: "amu", status: "pending", page: "3" });
    expect(toQueryString(f, "active_humans")).toBe("view=demo&q=amu&status=pending&page=3");
    expect(base(Object.fromEntries(new URLSearchParams(toQueryString(f, "active_humans"))))).toEqual(f);
    expect(toQueryString(base(), "active_humans")).toBe("");
  });
});

describe("queryDirectory", () => {
  const rows = [
    u("human"), u("human", { status: "pending" }), u("human", { name: "Asha Search" }),
    u("demo", { email: "ruth.nabwire@amu.competen.demo" }), u("test"), u("system"),
    u("unclassified"), u("unclassified", { status: "pending", lastSignIn: null }),
  ];

  it("the default shows only active humans", () => {
    const r = queryDirectory(rows, base(), NOW);
    expect(r.rows.map(x => x.accountType + ":" + x.status)).toEqual(["human:active", "human:active"]);
    expect(r.total).toBe(2);
  });

  it("counts every view, so each chip says what it would show", () => {
    expect(queryDirectory(rows, base(), NOW).viewCounts).toEqual({
      active_humans: 2, all_humans: 3, pending: 2, demo: 1, test: 1, system: 1, unclassified: 2, all: 8,
    });
  });

  it("the view counts follow the other filters, and the view never filters the counts", () => {
    const r = queryDirectory(rows, base({ view: "demo", status: "pending" }), NOW);
    expect(r.total).toBe(0);
    expect(r.viewCounts).toMatchObject({ all: 2, pending: 2, all_humans: 1, unclassified: 1, demo: 0 });
  });

  it("search, status and last login still filter as before", () => {
    expect(queryDirectory(rows, base({ view: "all", q: "asha" }), NOW).rows.map(x => x.name)).toEqual(["Asha Search"]);
    expect(queryDirectory(rows, base({ view: "all", login: "never" }), NOW).total).toBe(1);
    expect(queryDirectory(rows, base({ view: "pending" }), NOW).rows.every(x => x.status === "pending")).toBe(true);
  });

  it("All Accounts is every account, unchanged", () => {
    expect(queryDirectory(rows, base({ view: "all" }), NOW).total).toBe(rows.length);
  });
});

describe("pagination", () => {
  const many = Array.from({ length: PAGE_SIZE * 2 + 3 }, () => u("human"));

  it("sends one page at a time, with the total and page count", () => {
    const p1 = queryDirectory(many, base(), NOW);
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p1.total).toBe(many.length);
    expect(p1.pages).toBe(3);
    expect(p1.matched).toHaveLength(many.length);
  });

  it("the last page holds the remainder, with no overlap or gap across pages", () => {
    const ids = [0, 1, 2].flatMap(p => queryDirectory(many, base({ page: String(p + 1) }), NOW).rows.map(x => x.id));
    expect(ids).toEqual(many.map(x => x.id));
    expect(queryDirectory(many, base({ page: "3" }), NOW).rows).toHaveLength(3);
  });

  it("a page past the end shows the last page, not an empty screen", () => {
    const r = queryDirectory(many, base({ page: "99" }), NOW);
    expect(r.page).toBe(2);
    expect(r.rows).toHaveLength(3);
  });

  it("an empty view is one empty page", () => {
    const r = queryDirectory(many, base({ view: "demo" }), NOW);
    expect([r.rows.length, r.total, r.pages, r.page]).toEqual([0, 0, 1, 0]);
  });
});

describe("directoryStats", () => {
  it("counts the rows it is given per portal, with how many are active", () => {
    const s = directoryStats([
      { roles: ["nurse"], status: "active" }, { roles: ["nurse", "assessor"], status: "pending" }, { roles: ["super_admin"], status: "active" },
    ]);
    expect(s.total).toBe(3);
    expect(s.active).toBe(2);
    expect(s.byRole.nurse).toEqual({ count: 2, active: 1 });
    expect(s.byRole.assessor).toEqual({ count: 1, active: 0 });
  });
});
