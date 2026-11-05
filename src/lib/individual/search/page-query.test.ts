import { describe, expect, it } from "vitest";
import { pageQuery } from "./page-query";

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
