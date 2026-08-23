import { describe, it, expect } from "vitest";
import { claimedHandlesForWorkspace, handleForWorkspace } from "@/lib/practice/identity-service";

// handleForWorkspace decides which handle a booking page adopts, and the branch that matters most is the
// one live data cannot reach: TWO practitioners pointing at one workspace. Migration 348's count(*)=1
// subquery encodes the same rule in SQL, and no workspace currently has two claimed handles -- so until
// one does, this file is the only thing exercising the judgement both of them rest on.
//
// It lives in Vitest rather than only in practice-handle-adoption-harness.ts because that harness is one
// of the 188 LOCAL-ONLY ones, not the 25 in scripts/ci-harnesses.ts. The branch logic here is unit-level
// (TESTING.md's own taxonomy), so it belongs where every push runs it.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** PostgREST stand-in: the chain is awaited directly after .limit(), so it is thenable. */
function stub(result: { data: unknown; error: unknown }) {
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: any) => res(result);
      return () => chain;
    },
  });
  return { from: () => chain };
}

const rows = (...handles: string[]) => ({ data: handles.map(handle => ({ handle })), error: null });
const FAIL = { data: null, error: { message: "canceling statement due to statement timeout" } };

describe("handleForWorkspace", () => {
  it("resolves the handle when exactly one identity claims one", async () => {
    expect(await handleForWorkspace(stub(rows("elisham1")), "ws-1")).toBe("elisham1");
  });

  it("resolves null when nobody has claimed one", async () => {
    expect(await handleForWorkspace(stub(rows()), "ws-1")).toBeNull();
  });

  it("REFUSES rather than picking one when two identities claim — the branch live data cannot reach", async () => {
    // Choosing either would print one clinician's personal address on a practice they share, and the
    // page carries exactly one handle (ux_practice_booking_access_handle) so there is no third option.
    expect(await handleForWorkspace(stub(rows("elisham1", "amina2")), "ws-1")).toBeNull();
  });

  it("resolves null when the read FAILED — never a handle it could not confirm", async () => {
    // Fails closed on purpose: writing an unconfirmed handle is the only outcome here that could put one
    // clinician's address on another's page.
    expect(await handleForWorkspace(stub(FAIL), "ws-1")).toBeNull();
  });
});

describe("claimedHandlesForWorkspace — where the three nulls become distinguishable", () => {
  it("an UNREADABLE table is not an empty one", async () => {
    const r = await claimedHandlesForWorkspace(stub(FAIL), "ws-1");

    expect(r.ok).toBe(false);
    // The regression this guards: any shape still offering a usable list would let the readiness check
    // say "no handle has been claimed" about a table nobody managed to read — which is, word for word,
    // the false sentence this whole arc exists to remove.
    expect(r).not.toHaveProperty("handles");
    if (!r.ok) expect(r.detail).toContain("timeout");
  });

  it("an EMPTY table is reported as genuinely empty", async () => {
    const r = await claimedHandlesForWorkspace(stub(rows()), "ws-1");
    expect(r).toEqual({ ok: true, handles: [] });
    // Without this control the assertion above could pass for the wrong reason.
  });

  it("reports the ambiguity rather than hiding it, so a person can resolve it", async () => {
    const r = await claimedHandlesForWorkspace(stub(rows("elisham1", "amina2")), "ws-1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.handles).toEqual(["elisham1", "amina2"]);
    // handleForWorkspace turns this into null; the readiness check turns it into a sentence naming the
    // choice nobody has made. Both need the list, which is why the null is not computed here.
  });

  it("agrees with migration 348's count(*) = 1 rule at every arity", async () => {
    // The SQL backfills only where exactly one identity claims; these two implementations of one rule
    // must not drift, because a page backfilled by the migration and a page created by the code would
    // then disagree about the same workspace.
    const adopts = async (...h: string[]) => (await handleForWorkspace(stub(rows(...h)), "ws-1")) !== null;

    expect(await adopts()).toBe(false);                        // count = 0 -> SQL skips
    expect(await adopts("elisham1")).toBe(true);               // count = 1 -> SQL writes
    expect(await adopts("elisham1", "amina2")).toBe(false);    // count = 2 -> SQL skips
  });
});
