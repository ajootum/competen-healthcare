/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { approveMany } from "./review-decide-batch";

// Framework-level approval: one decision per version, each only while it is still in THIS reviewer's queue.

const queue = (versions: { versionId: string; competencyId: string }[]) => vi.fn(async () => ({
  appointments: [], items: versions.map(v => ({ ...v, kind: "competency", title: `T-${v.competencyId}`, appointmentId: "appt" })),
})) as any;

describe("approving a framework's competencies together", () => {
  it("records one approval per version still waiting, under the reviewer's appointment", async () => {
    const decide = vi.fn(async () => ({ ok: true as const }));
    const r = await approveMany({}, "rev", [{ versionId: "v1", competencyId: "c1" }, { versionId: "v2", competencyId: "c2" }], "Looks right",
      { queue: queue([{ versionId: "v1", competencyId: "c1" }, { versionId: "v2", competencyId: "c2" }]), decide });
    expect(r!.map(x => x.outcome)).toEqual(["approved", "approved"]);
    expect(decide).toHaveBeenNthCalledWith(1, {}, "v1", "rev", "appt", "approved", "Looks right");
  });
  it("never decides what is no longer waiting for this reviewer (changed, decided, out of scope, or not independent)", async () => {
    const decide = vi.fn(async () => ({ ok: true as const }));
    const r = await approveMany({}, "rev", [{ versionId: "v-old", competencyId: "c1" }, { versionId: "v2", competencyId: "WRONG" }], null,
      { queue: queue([{ versionId: "v2", competencyId: "c2" }]), decide });
    expect(r!.map(x => x.outcome)).toEqual(["not_waiting", "not_waiting"]);
    expect(decide).not.toHaveBeenCalled();
  });
  it("reports a database refusal per item, returns what the budget did not reach, and refuses an unreadable queue", async () => {
    const decide = vi.fn(async () => ({ ok: false as const, error: "You authored, edited or put forward this content." }));
    const clock = [0, 0, 100]; let i = 0;
    const r = await approveMany({}, "rev", [{ versionId: "v1", competencyId: "c1" }, { versionId: "v2", competencyId: "c2" }], null,
      { queue: queue([{ versionId: "v1", competencyId: "c1" }, { versionId: "v2", competencyId: "c2" }]), decide, budgetMs: 5, now: () => clock[Math.min(i++, 2)] });
    expect(r!.map(x => x.outcome)).toEqual(["failed", "not_reached"]);
    expect(await approveMany({}, "rev", [{ versionId: "v1", competencyId: "c1" }], null, { queue: vi.fn(async () => null) as any, decide })).toBeNull();
  });
});
