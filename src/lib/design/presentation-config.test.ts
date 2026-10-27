import { describe, expect, it } from "vitest";
import { checkPresentationDraft, DEFAULT_PRESENTATION, presentWith, resolvePresentation } from "./presentation-config";
import { PRODUCT_PRESENTATION, presentationFor, themeForName } from "./product-themes";
import { orderDestinations } from "@/app/login/DestinationChooser";

// COMPETEN-DESIGN-SYSTEM-01 s4: what an HQ administrator may and may not change about product presentation.

const ok = (patch: Record<string, unknown>) => checkPresentationDraft({ ...DEFAULT_PRESENTATION, ...patch });

describe("checkPresentationDraft", () => {
  it("accepts the defaults", () => expect(ok({}).ok).toBe(true));
  it("accepts an edited description and icon", () => {
    const r = ok({ scholar: { ...DEFAULT_PRESENTATION.scholar, description: "Revise from your own notes.", icon: "person" } });
    expect(r.ok && r.settings.scholar).toMatchObject({ description: "Revise from your own notes.", icon: "person" });
  });
  it("refuses a name or a colour", () => {
    expect(ok({ scholar: { ...DEFAULT_PRESENTATION.scholar, name: "Something else" } }).ok).toBe(false);
    expect(ok({ professional: { ...DEFAULT_PRESENTATION.professional, theme: "platform" } }).ok).toBe(false);
  });
  it("refuses Platform and Practice (outside this door)", () => {
    expect(ok({ platform: DEFAULT_PRESENTATION.individual }).ok).toBe(false);
    expect(ok({ practice: DEFAULT_PRESENTATION.individual }).ok).toBe(false);
  });
  it("refuses an icon outside the approved set, markup, and out-of-range lengths", () => {
    expect(ok({ individual: { ...DEFAULT_PRESENTATION.individual, icon: "rocket" } }).ok).toBe(false);
    expect(ok({ individual: { ...DEFAULT_PRESENTATION.individual, role: "<b>x</b>" } }).ok).toBe(false);
    expect(ok({ individual: { ...DEFAULT_PRESENTATION.individual, description: "short" } }).ok).toBe(false);
  });
});

describe("resolvePresentation / presentWith", () => {
  it("falls back per product when a stored entry is unreadable", () => {
    const r = resolvePresentation({ scholar: { role: "x" }, professional: { ...DEFAULT_PRESENTATION.professional, action: "Go to Professional" } });
    expect(r.scholar).toEqual(DEFAULT_PRESENTATION.scholar);
    expect(r.professional.action).toBe("Go to Professional");
    expect(resolvePresentation(null)).toEqual(DEFAULT_PRESENTATION);
  });
  it("never changes the name or theme, and leaves Platform alone", () => {
    const cfg = { ...DEFAULT_PRESENTATION, scholar: { ...DEFAULT_PRESENTATION.scholar, action: "Study now" } };
    const p = presentWith("scholar", cfg, presentationFor("scholar"));
    expect(p).toMatchObject({ name: "Competen Scholar", theme: "scholar", action: "Study now" });
    expect(presentWith("platform", cfg, presentationFor("platform"))).toEqual(PRODUCT_PRESENTATION.platform);
  });
  it("themes the sign-in banner by product name", () => {
    expect(themeForName("Competen Scholar")).toBe("scholar");
    expect(themeForName("Competen Professional")).toBe("professional");
    expect(themeForName("anything")).toBe("individual");
  });
});

describe("orderDestinations (remembered destination)", () => {
  const list = [{ code: "platform" }, { code: "individual" }];
  it("puts an authorised remembered destination first", () => expect(orderDestinations(list, "individual").map(d => d.code)).toEqual(["individual", "platform"]));
  it("ignores a remembered destination that is not in the authorised set", () => {
    expect(orderDestinations(list, "practice")).toBe(list);
    expect(orderDestinations(list, null)).toBe(list);
  });
  it("never adds or removes a destination", () => expect(orderDestinations(list, "individual")).toHaveLength(2));
});
