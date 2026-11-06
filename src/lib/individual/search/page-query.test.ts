import { describe, expect, it } from "vitest";
import { clearSearchHref, pageQuery } from "./page-query";

describe("pageQuery", () => {
  it("tidies the words and takes the first value", () => {
    expect(pageQuery("  sepsis   care ")).toBe("sepsis care");
    expect(pageQuery(["a b", "c"])).toBe("a b");
  });
  it("is null where there is nothing to search", () => {
    expect(pageQuery(undefined)).toBeNull();
    expect(pageQuery("   ")).toBeNull();
  });
  it("is capped", () => {
    expect(pageQuery("x".repeat(500))?.length).toBe(200);
  });
});

describe("clearSearchHref", () => {
  it("keeps the filters and drops the words", () => {
    expect(clearSearchHref("/p/development", { view: "overdue", plan: "done", q: null })).toBe("/p/development?view=overdue&plan=done");
  });
  it("is the bare page with no filters", () => {
    expect(clearSearchHref("/p/development", { view: undefined, plan: "" })).toBe("/p/development");
  });
});
