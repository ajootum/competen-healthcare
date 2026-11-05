import { describe, expect, it } from "vitest";
import type { SessionHit } from "@/lib/individual/scholar/learn-search";
import { fileTypeOf, lastActive, materialState, resumableOf, stepOf } from "./study-home-model";

const hit = (o: Partial<SessionHit>): SessionHit => ({ id: "s", title: "T", topic: null, status: "active", steps: 8, currentStep: 0, sources: [], lastActiveAt: "2026-11-05T10:00:00Z", createdAt: "2026-11-01T10:00:00Z", ...o });

describe("Study Home: Continue Learning", () => {
  it("takes the most recent active session", () => {
    expect(resumableOf([hit({ id: "a" }), hit({ id: "b" })]).session?.id).toBe("a");
  });
  it("never offers a completed session as Continue", () => {
    expect(resumableOf([hit({ id: "a", status: "completed" })])).toEqual({ session: null, blocked: false });
  });
  it("skips a session with no lessons left, and says so when none can be resumed", () => {
    expect(resumableOf([hit({ id: "a", steps: 0 }), hit({ id: "b" })]).session?.id).toBe("b");
    expect(resumableOf([hit({ id: "a", steps: 0 })])).toEqual({ session: null, blocked: true });
  });
  it("omits the section for a learner with no sessions", () => {
    expect(resumableOf([])).toEqual({ session: null, blocked: false });
  });
  it("reports the session's own step, in range, and never a percentage", () => {
    expect(stepOf({ steps: 8, currentStep: 0 })?.label).toBe("Step 1 of 8");
    expect(stepOf({ steps: 8, currentStep: 7 })?.label).toBe("Step 8 of 8");
    expect(stepOf({ steps: 8, currentStep: 40 })?.label).toBe("Step 8 of 8");
    expect(stepOf({ steps: 0, currentStep: 0 })).toBeNull();
  });
});

describe("Study Home: Recent materials", () => {
  it("states what is true of a material", () => {
    expect(materialState({ chunkCount: 10, emptyUnits: 0 })).toEqual({ label: "Ready", ready: true });
    expect(materialState({ chunkCount: 10, emptyUnits: 2 })).toEqual({ label: "Partly read", ready: true });
    expect(materialState({ chunkCount: 0, emptyUnits: 0 })).toEqual({ label: "No readable text", ready: false });
  });
  it("shortens the file type", () => {
    expect(fileTypeOf("PowerPoint (.pptx)")).toBe("PowerPoint");
    expect(fileTypeOf("Plain text (.txt or pasted)")).toBe("Plain text");
    expect(fileTypeOf("PDF")).toBe("PDF");
  });
  it("gives no date for a bad timestamp", () => {
    expect(lastActive("2026-11-05T10:00:00Z")).toBe("Last active 5 Nov 2026");
    expect(lastActive("nope")).toBeNull();
  });
});
