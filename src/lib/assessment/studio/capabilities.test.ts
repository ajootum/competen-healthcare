import { describe, expect, it } from "vitest";
import { effectiveCapabilities, STUDIO_CAPABILITIES } from "./capabilities";
import { POLICY_CAP, CAP } from "./transitions";
import { refusalText } from "./api";
import { capabilityLabel } from "./capability-labels";

const holdsOnly = (...held: string[]) => async (c: string) => held.includes(c);

describe("effectiveCapabilities", () => {
  it("an owner whose appointment grants author holds author, and only what is granted", async () => {
    const caps = await effectiveCapabilities({ isOwner: true, capabilities: [] }, holdsOnly(CAP.author, CAP.assign));
    expect(caps).toEqual([CAP.author, CAP.assign]);
    expect(caps).not.toContain(CAP.publish);
  });
  it("an owner without an appointment holds nothing (can look, cannot change)", async () => {
    expect(await effectiveCapabilities({ isOwner: true, capabilities: [] }, holdsOnly())).toEqual([]);
  });
  it("an owner is not given the context's capabilities: the database answer decides", async () => {
    expect(await effectiveCapabilities({ isOwner: true, capabilities: [CAP.publish] }, holdsOnly())).toEqual([]);
  });
  it("a failing lookup is a no, never a yes", async () => {
    const boom = async () => { throw new Error("rpc down"); };
    expect(await effectiveCapabilities({ isOwner: true, capabilities: [] }, boom)).toEqual([]);
  });
  it("a non-owner is unchanged and never asks the database", async () => {
    let asked = 0;
    const holds = async () => { asked++; return true; };
    const caps = await effectiveCapabilities({ isOwner: false, capabilities: [CAP.review] }, holds);
    expect(caps).toEqual([CAP.review]);
    expect(asked).toBe(0);
  });
  it("covers every Studio capability", () => {
    expect([...STUDIO_CAPABILITIES].sort()).toEqual([...Object.values(CAP), ...Object.values(POLICY_CAP)].sort());   // 942: policy rights too
  });
});

describe("refusalText", () => {
  it("owners get the appointment explanation", () => {
    expect(refusalText(CAP.author, true)).toMatch(/A platform owner without that appointment can look but not change/);
  });
  it("everybody else is told which capability the step needs", () => {
    const t = refusalText(CAP.publish, false);
    expect(t).toBe("This step needs an appointment that holds the right to publish checklists.");
    expect(t).not.toMatch(/platform owner/);
  });
  it("every Studio capability has a label", () => {
    for (const c of STUDIO_CAPABILITIES) expect(capabilityLabel(c)).not.toMatch(/^the capability /);
  });
});
