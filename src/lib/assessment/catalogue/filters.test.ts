import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT, PAGE_SIZE, hasActiveFilters, hrefFor, isUuid, moreFiltersActive, parseCatalogueQuery, toParams, toSearchArgs, withChange,
} from "./filters";

describe("parseCatalogueQuery", () => {
  it("returns the clean defaults for an empty URL", () => {
    const q = parseCatalogueQuery({});
    expect(q).toEqual({ q: "", filters: {}, sort: DEFAULT_SORT, page: 1, tab: "instruments", open: null });
    expect(hasActiveFilters(q)).toBe(false);
  });

  it("reads search, filters, sort, page and tab", () => {
    const q = parseCatalogueQuery({ q: "  chart   audit ", family: "DA", method: "chart_review", status: "published", sort: "name_asc", page: "3", tab: "collections" });
    expect(q.q).toBe("chart audit");
    expect(q.filters).toEqual({ family: "DA", method: "chart_review", status: "published" });
    expect(q.sort).toBe("name_asc");
    expect(q.page).toBe(3);
    expect(q.tab).toBe("collections");
    expect(hasActiveFilters(q)).toBe(true);
  });

  it("drops anything that is not a code, so the URL cannot widen a query", () => {
    const q = parseCatalogueQuery({ family: "CA'; drop table x", method: "a b", domain: "ok_code", level: "x".repeat(80), status: "everything" });
    expect(q.filters).toEqual({ domain: "ok_code" });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseCatalogueQuery({ family: ["CA", "DA"] }).filters.family).toBe("CA");
  });

  it("falls back on a bad sort, a bad page and a bad tab", () => {
    const q = parseCatalogueQuery({ sort: "random", page: "-4", tab: "nope" });
    expect(q.sort).toBe(DEFAULT_SORT);
    expect(q.page).toBe(1);
    expect(q.tab).toBe("instruments");
    expect(parseCatalogueQuery({ page: "abc" }).page).toBe(1);
  });

  it("accepts only a real id for the open drawer", () => {
    const id = "6f2ae8cb-1a58-43e9-89ec-8501af9cd11c";
    expect(parseCatalogueQuery({ i: id }).open).toBe(id);
    expect(parseCatalogueQuery({ i: "../etc" }).open).toBeNull();
    expect(isUuid(id)).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });

  it("limits the length of the search text and the owner text", () => {
    expect(parseCatalogueQuery({ q: "a".repeat(500) }).q).toHaveLength(120);
    expect(parseCatalogueQuery({ owner: "b".repeat(500) }).filters.owner).toHaveLength(80);
  });
});

describe("toSearchArgs", () => {
  it("pages 50 at a time from the page number", () => {
    const a = toSearchArgs({ q: "", filters: { family: "CA" }, sort: "name_asc", page: 3 });
    expect(PAGE_SIZE).toBe(50);
    expect(a).toEqual({ p_q: null, p_filters: { family: "CA" }, p_sort: "name_asc", p_limit: 50, p_offset: 100 });
  });
  it("passes the search text through", () => {
    expect(toSearchArgs({ q: "sample words", filters: {}, sort: DEFAULT_SORT, page: 1 }).p_q).toBe("sample words");
  });
});

describe("toParams and hrefFor", () => {
  it("omits defaults and round trips", () => {
    const q = parseCatalogueQuery({ q: "audit", family: "DA", page: "2", i: "6f2ae8cb-1a58-43e9-89ec-8501af9cd11c" });
    const href = hrefFor("/super-admin/assessment-catalogue", q);
    expect(href).toBe("/super-admin/assessment-catalogue?q=audit&family=DA&page=2&i=6f2ae8cb-1a58-43e9-89ec-8501af9cd11c");
    const back = parseCatalogueQuery(Object.fromEntries(new URL("http://x" + href).searchParams));
    expect(back).toEqual(q);
    expect(toParams(parseCatalogueQuery({})).toString()).toBe("");
    expect(hrefFor("/p", parseCatalogueQuery({}))).toBe("/p");
  });
});

describe("withChange", () => {
  const base = parseCatalogueQuery({ q: "x", family: "CA", page: "4", i: "6f2ae8cb-1a58-43e9-89ec-8501af9cd11c" });
  it("goes back to page 1 when the search, a filter or the sort changes", () => {
    expect(withChange(base, { q: "y" }).page).toBe(1);
    expect(withChange(base, { filters: { method: "osce" } }).page).toBe(1);
    expect(withChange(base, { sort: "name_asc" }).page).toBe(1);
  });
  it("keeps the page when only the drawer changes, and a page change is honoured", () => {
    expect(withChange(base, { open: null }).page).toBe(4);
    expect(withChange(base, { page: 5 }).page).toBe(5);
  });
  it("clears a filter set to null and keeps the others", () => {
    const q = withChange(base, { filters: { family: null, domain: "domain_a" } });
    expect(q.filters).toEqual({ domain: "domain_a" });
  });
  it("counts the filters behind More filters", () => {
    expect(moreFiltersActive({ family: "CA" })).toBe(0);
    expect(moreFiltersActive({ population: "a", domain: "b", level: "c", method: "d" })).toBe(3);
  });
});
