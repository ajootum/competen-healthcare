/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-BOOK-FLOW-002 s19 -- the funnel's arithmetic, which is where a funnel lies.
 *
 * Three ways this kind of screen misleads, all tested here:
 *
 *   1. DIVIDING BY NOUGHT. A step nobody reached has no conversion; rendering that as "0%" reports a
 *      step nobody got to as a step everybody abandoned.
 *   2. AN OUTAGE DRAWN AS AN EMPTY FUNNEL. "Nobody visited" and "the counts could not be read" are
 *      opposite messages, and only one of them should make a practitioner change their diary.
 *   3. A MEAN OVER A LONG TAIL. One patient who left a tab open over lunch moves an average enough to
 *      make it useless, and with no journey id there is no way to spot them.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import {
  bookingFunnel, deviceClass, recordFunnelStep, FUNNEL_STEPS, FUNNEL_LABELS,
} from "./booking-funnel";

/** A Supabase-shaped stub: one table, one canned answer. */
function fakeAdmin(rows: any[] | null, error: { message: string } | null = null) {
  const q: any = {
    select: () => q, eq: () => q, gte: () => q,
    limit: () => Promise.resolve({ data: rows, error }),
    insert: (v: any) => { q.inserted.push(v); return Promise.resolve({ error: null }); },
    inserted: [] as any[],
  };
  return { from: () => q, _q: q };
}

const row = (step: string, extra: Record<string, unknown> = {}) =>
  ({ step, device: null, measure: null, ...extra });

describe("device class", () => {
  it("collapses a user agent to one of three words, never a fingerprint", () => {
    expect(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)")).toBe("desktop");
    expect(deviceClass("")).toBe("unknown");
    expect(deviceClass(null)).toBe("unknown");
  });
});

describe("recording", () => {
  it("writes the step, and never anything a patient typed", async () => {
    const admin = fakeAdmin([]);
    await recordFunnelStep(admin as any, { workspaceId: "ws-1", step: "booking_confirmed", device: "mobile", measure: 240 });
    expect(admin._q.inserted).toHaveLength(1);
    const written = admin._q.inserted[0];
    expect(written).toEqual({ workspace_id: "ws-1", step: "booking_confirmed", device: "mobile", measure: 240 });
    // ⚠ THE SHAPE IS THE GUARANTEE. There is no metadata key to put a reason for a visit in.
    expect(Object.keys(written).sort()).toEqual(["device", "measure", "step", "workspace_id"]);
  });

  it("writes nothing without a workspace, and nothing for a step off the list", async () => {
    const a = fakeAdmin([]);
    await recordFunnelStep(a as any, { workspaceId: null, step: "booking_confirmed" });
    await recordFunnelStep(a as any, { workspaceId: "ws-1", step: "not_a_step" as any });
    expect(a._q.inserted).toHaveLength(0);
  });

  it("clamps a nonsense duration rather than losing the completion it belongs to", async () => {
    const a = fakeAdmin([]);
    await recordFunnelStep(a as any, { workspaceId: "ws-1", step: "booking_confirmed", measure: 999_999 });
    expect(a._q.inserted[0].measure).toBe(86_400);
    const b = fakeAdmin([]);
    await recordFunnelStep(b as any, { workspaceId: "ws-1", step: "booking_confirmed", measure: -5 });
    expect(b._q.inserted[0].measure).toBe(0);
  });

  it("⚠ NEVER THROWS, because a measurement must not be able to cost a booking", async () => {
    const exploding = { from: () => { throw new Error("database is on fire"); } };
    await expect(recordFunnelStep(exploding as any, { workspaceId: "ws-1", step: "profile_viewed" }))
      .resolves.toBeUndefined();
  });
});

describe("reading the funnel", () => {
  it("distinguishes an unreadable store from an empty one", async () => {
    const bad = await bookingFunnel(fakeAdmin(null, { message: "connection reset" }) as any, { workspaceId: "ws-1" });
    expect(bad.state).toBe("unreadable");
    expect(bad.reason).toContain("connection reset");

    const none = await bookingFunnel(fakeAdmin([]) as any, { workspaceId: "ws-1" });
    expect(none.state).toBe("empty");
    expect(none.reason).toBeNull();
  });

  it("counts each rung and converts against the rung above", async () => {
    const rows = [
      ...Array(10).fill(0).map(() => row("profile_viewed")),
      ...Array(5).fill(0).map(() => row("booking_started")),
      ...Array(4).fill(0).map(() => row("availability_viewed")),
      ...Array(2).fill(0).map(() => row("details_started")),
      row("verification_started"),
      row("booking_confirmed", { measure: 300, device: "mobile" }),
    ];
    const f = await bookingFunnel(fakeAdmin(rows) as any, { workspaceId: "ws-1" });
    expect(f.state).toBe("ok");
    expect(f.rungs.map(r => r.count)).toEqual([10, 5, 4, 2, 1, 1]);
    // The first rung has nothing above it, so it has no conversion.
    expect(f.rungs[0].fromPrevious).toBeNull();
    expect(f.rungs[1].fromPrevious).toBe(50);
    expect(f.rungs[2].fromPrevious).toBe(80);
  });

  it("⚠ REPORTS NO CONVERSION WHERE THE STEP ABOVE RECORDED NOTHING, rather than 0%", async () => {
    // Nobody reached "availability_viewed", so the conversion into "details_started" is unknowable --
    // not nought. 0% would read as "everybody who got there gave up", which nobody did.
    const f = await bookingFunnel(fakeAdmin([row("profile_viewed"), row("details_started")]) as any, { workspaceId: "ws-1" });
    const details = f.rungs.find(r => r.step === "details_started")!;
    expect(details.count).toBe(1);
    expect(details.fromPrevious).toBeNull();
    // ...and no rung carries Infinity or NaN, which is what dividing by nought would have produced.
    for (const r of f.rungs)
      expect(r.fromPrevious === null || Number.isFinite(r.fromPrevious)).toBe(true);
  });

  it("lists the asides only when they happened", async () => {
    const quiet = await bookingFunnel(fakeAdmin([row("profile_viewed")]) as any, { workspaceId: "ws-1" });
    expect(quiet.asides).toHaveLength(0);

    const noisy = await bookingFunnel(
      fakeAdmin([row("profile_viewed"), row("slot_taken_at_commit"), row("verification_failed")]) as any,
      { workspaceId: "ws-1" });
    expect(noisy.asides.map(a => a.step).sort()).toEqual(["slot_taken_at_commit", "verification_failed"]);
  });

  it("takes the MEDIAN completion time, so one abandoned tab cannot move it", async () => {
    const rows = [
      row("booking_confirmed", { measure: 120 }),
      row("booking_confirmed", { measure: 180 }),
      row("booking_confirmed", { measure: 240 }),
      // Somebody who left the page open for hours and came back. A mean would be ruined by this.
      row("booking_confirmed", { measure: 86_400 }),
      row("booking_confirmed", { measure: 200 }),
    ];
    const f = await bookingFunnel(fakeAdmin(rows) as any, { workspaceId: "ws-1" });
    expect(f.medianSecondsToBook).toBe(200);
  });

  it("reports no completion time at all when nothing completed", async () => {
    const f = await bookingFunnel(fakeAdmin([row("profile_viewed")]) as any, { workspaceId: "ws-1" });
    expect(f.medianSecondsToBook).toBeNull();
  });

  it("splits completions by device, and omits a device nobody used", async () => {
    const f = await bookingFunnel(fakeAdmin([
      row("booking_confirmed", { device: "mobile" }),
      row("booking_confirmed", { device: "mobile" }),
      row("booking_confirmed", { device: "desktop" }),
    ]) as any, { workspaceId: "ws-1" });
    expect(f.byDevice).toEqual([{ device: "mobile", confirmed: 2 }, { device: "desktop", confirmed: 1 }]);
  });

  it("carries the caveat and the window with the numbers, never separately", async () => {
    const f = await bookingFunnel(fakeAdmin([row("profile_viewed")]) as any, { workspaceId: "ws-1", days: 7 });
    expect(f.note).toMatch(/page visits rather than people/i);
    expect(Date.parse(f.sinceIso)).toBeLessThan(Date.now());
    // Every state carries it, including the ones with no numbers to caveat.
    const empty = await bookingFunnel(fakeAdmin([]) as any, { workspaceId: "ws-1" });
    expect(empty.note).toBe(f.note);
  });

  it("every rung has a human label, and the order is the journey's order", () => {
    for (const step of FUNNEL_STEPS) {
      expect(FUNNEL_LABELS[step]).toBeTruthy();
      expect(FUNNEL_LABELS[step]).not.toBe(step);
    }
    expect(FUNNEL_STEPS[0]).toBe("profile_viewed");
    expect(FUNNEL_STEPS[FUNNEL_STEPS.length - 1]).toBe("booking_confirmed");
  });
});
