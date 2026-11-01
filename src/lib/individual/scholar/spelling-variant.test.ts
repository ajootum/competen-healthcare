import { describe, expect, it } from "vitest";
import { parseSpellingChoice, parseSpellingVariant, spellingField } from "./spelling-variant";
import { normaliseLearnerText } from "./spelling";

describe("spelling variant", () => {
  it("only en-GB and en-US are variants; everything else is leave as typed", () => {
    expect(parseSpellingVariant("en-GB")).toBe("en-GB");
    expect(parseSpellingVariant("en-US")).toBe("en-US");
    for (const v of ["none", "", null, undefined, 3, "fr", "EN-GB"]) expect(parseSpellingVariant(v)).toBeUndefined();
    expect(parseSpellingChoice("en-US")).toBe("en-US");
    expect(parseSpellingChoice("x")).toBe("none");
    expect(spellingField("none")).toEqual({});
    expect(spellingField("en-GB")).toEqual({ spellingVariant: "en-GB" });
  });
  it("the variant converts only British/American pairs and never the stored original", () => {
    const n = normaliseLearnerText("paediatric anaesthesia", { variant: "en-US" });
    expect(n.display).toBe("pediatric anesthesia");
    expect(n.original).toBe("paediatric anaesthesia");
    expect(normaliseLearnerText("paediatric", {}).corrections).toEqual([]);
  });
});
