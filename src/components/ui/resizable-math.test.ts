import { describe, expect, it } from "vitest";
import { clampSize, dragSize, keyboardSize, maxBesideSibling, parseStoredSize } from "./resizable-math";

describe("clampSize", () => {
  it("clamps both ways, rounds, tolerates NaN", () => {
    expect(clampSize(100, 240, 800)).toBe(240);
    expect(clampSize(5000, 240, 800)).toBe(800);
    expect(clampSize(400.4, 240, 800)).toBe(400);
    expect(clampSize(Number.NaN, 240, 800)).toBe(240);
  });
  it("a max under the min yields the min", () => { expect(clampSize(500, 160, 100)).toBe(160); });
});

describe("maxBesideSibling", () => {
  it("is 60% of the container by default", () => { expect(maxBesideSibling(1600, { min: 240 })).toBe(960); });
  it("leaves the sibling its minimum and the gutter", () => { expect(maxBesideSibling(900, { min: 240, minOther: 420, gutter: 20 })).toBe(460); });
  it("never goes under min, even in a tiny container", () => { expect(maxBesideSibling(500, { min: 240, minOther: 420 })).toBe(240); expect(maxBesideSibling(Number.NaN, { min: 240 })).toBe(240); });
});

describe("parseStoredSize", () => {
  it("reads sane numbers only", () => {
    expect(parseStoredSize("320")).toBe(320);
    expect(parseStoredSize(" 320.4 ")).toBe(320);
    for (const bad of [null, undefined, "", "abc", "-5", "0", "1e9", "NaN"]) expect(parseStoredSize(bad)).toBeNull();
  });
});

describe("keyboardSize", () => {
  it("x axis: Right/Left by 16, Shift by 64", () => {
    expect(keyboardSize("ArrowRight", false, "x", 300, 240, 600)).toBe(316);
    expect(keyboardSize("ArrowLeft", true, "x", 300, 240, 600)).toBe(240);
  });
  it("y axis: Down grows, Up shrinks; left/right ignored", () => {
    expect(keyboardSize("ArrowDown", false, "y", 300, 160, 600)).toBe(316);
    expect(keyboardSize("ArrowUp", false, "y", 300, 160, 600)).toBe(284);
    expect(keyboardSize("ArrowRight", false, "y", 300, 160, 600)).toBeNull();
  });
  it("stops at limits; Home/End jump; other keys ignored", () => {
    expect(keyboardSize("ArrowRight", true, "x", 590, 240, 600)).toBe(600);
    expect(keyboardSize("ArrowLeft", false, "x", 245, 240, 600)).toBe(240);
    expect(keyboardSize("Home", false, "x", 300, 240, 600)).toBe(240);
    expect(keyboardSize("End", false, "x", 300, 240, 600)).toBe(600);
    expect(keyboardSize("a", false, "x", 300, 240, 600)).toBeNull();
  });
});

describe("end-side panes (the pane sits after its handle)", () => {
  it("dragSize: dragging toward the end shrinks an end pane, grows a start pane", () => {
    expect(dragSize(300, 40, 200, 600, "end")).toBe(260);
    expect(dragSize(300, -40, 200, 600, "end")).toBe(340);
    expect(dragSize(300, 40, 200, 600)).toBe(340);
    expect(dragSize(300, 40, 200, 600, "start")).toBe(340);
  });
  it("dragSize: stays within min and max whichever side", () => {
    expect(dragSize(300, 500, 200, 600, "end")).toBe(200);
    expect(dragSize(300, -900, 200, 600, "end")).toBe(600);
    expect(dragSize(300, -900, 200, 600, "start")).toBe(200);
  });
  it("keyboardSize: ArrowLeft grows, ArrowRight shrinks an end pane; the result is always the pane's own (positive) size", () => {
    expect(keyboardSize("ArrowLeft", false, "x", 300, 200, 600, "end")).toBe(316);
    expect(keyboardSize("ArrowRight", true, "x", 300, 200, 600, "end")).toBe(236);
    expect(keyboardSize("ArrowUp", false, "y", 300, 160, 600, "end")).toBe(316);
    expect(keyboardSize("ArrowDown", false, "y", 300, 160, 600, "end")).toBe(284);
  });
  it("keyboardSize: Home = min and End = max for the pane, and limits hold", () => {
    expect(keyboardSize("Home", false, "x", 300, 200, 600, "end")).toBe(200);
    expect(keyboardSize("End", false, "x", 300, 200, 600, "end")).toBe(600);
    expect(keyboardSize("ArrowLeft", true, "x", 590, 200, 600, "end")).toBe(600);
    expect(keyboardSize("ArrowRight", false, "x", 205, 200, 600, "end")).toBe(200);
    for (const k of ["ArrowLeft", "ArrowRight", "Home", "End"]) expect(keyboardSize(k, true, "x", 300, 200, 600, "end")).toBeGreaterThan(0);
  });
});
