import { describe, expect, it } from "vitest";
import { effectiveCapabilities, STUDIO_CAPABILITIES } from "./capabilities";
import { CAP } from "./transitions";

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
    expect([...STUDIO_CAPABILITIES].sort()).toEqual(Object.values(CAP).sort());
  });
});
