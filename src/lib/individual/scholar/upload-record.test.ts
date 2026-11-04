import { describe, expect, it } from "vitest";
import { ABANDON_AFTER_MS, STALE_CLAIM_MS, abandonedObjects, finishDecision, isSha256, reusable } from "./upload-record";

// SCHOLAR-CE07C: the decisions that keep one upload = one material = one extraction (migration 960).

const now = Date.parse("2026-11-04T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const row = (over: Partial<Parameters<typeof finishDecision>[0] & object> = {}) =>
  ({ state: "issued" as const, processing_started_at: null, refusal_status: null, refusal_message: null, ...over });

describe("finishDecision", () => {
  it("no record (960 absent or an older slot): proceed as before", () => {
    expect(finishDecision(null, now)).toEqual({ kind: "proceed" });
  });
  it("issued: this finish takes the claim", () => {
    expect(finishDecision(row(), now).kind).toBe("proceed");
  });
  it("processing and fresh: a second finish waits for the first (extraction runs once)", () => {
    expect(finishDecision(row({ state: "processing", processing_started_at: iso(now - 10_000) }), now).kind).toBe("busy");
  });
  it("processing but stale (the first finish died): taken over", () => {
    expect(finishDecision(row({ state: "processing", processing_started_at: iso(now - STALE_CLAIM_MS - 1) }), now).kind).toBe("proceed");
  });
  it("refused: a retried finish gets the SAME answer", () => {
    expect(finishDecision(row({ state: "refused", refusal_status: 422, refusal_message: "patient information" }), now))
      .toEqual({ kind: "refused", status: 422, message: "patient information" });
  });
  it("cancelled and abandoned are final", () => {
    expect(finishDecision(row({ state: "cancelled" }), now).kind).toBe("cancelled");
    expect(finishDecision(row({ state: "abandoned" }), now).kind).toBe("abandoned");
  });
});

describe("reusable (one file, one upload identity)", () => {
  const sha = "a".repeat(64);
  const r = { state: "issued" as const, mime_type: "application/pdf" as never, byte_size: 100, sha256: sha, issued_at: iso(now - 3600_000) };
  it("same type, size and sha256, still issued, inside 24 h", () => {
    expect(reusable(r, { mime: "application/pdf", size: 100, sha256: sha }, now)).toBe(true);
  });
  it("different bytes, size or type: a new identity", () => {
    expect(reusable(r, { mime: "application/pdf", size: 100, sha256: "b".repeat(64) }, now)).toBe(false);
    expect(reusable(r, { mime: "application/pdf", size: 101, sha256: sha }, now)).toBe(false);
    expect(reusable(r, { mime: "text/plain", size: 100, sha256: sha }, now)).toBe(false);
  });
  it("past 24 h or no longer issued: a new identity", () => {
    expect(reusable({ ...r, issued_at: iso(now - ABANDON_AFTER_MS) }, { mime: "application/pdf", size: 100, sha256: sha }, now)).toBe(false);
    expect(reusable({ ...r, state: "processing" as never }, { mime: "application/pdf", size: 100, sha256: sha }, now)).toBe(false);
  });
});

describe("abandonedObjects (clean-up)", () => {
  const u = "11111111-1111-1111-1111-111111111111";
  const objs = [
    { name: "old-orphan.pdf", created_at: iso(now - ABANDON_AFTER_MS - 1) },
    { name: "old-kept.pdf", created_at: iso(now - 5 * ABANDON_AFTER_MS) },
    { name: "old-busy.pdf", created_at: iso(now - 2 * ABANDON_AFTER_MS) },
    { name: "fresh.pdf", created_at: iso(now - 60_000) },
    { name: ".emptyFolderPlaceholder", created_at: iso(now - 9 * ABANDON_AFTER_MS) },
    { name: "no-date.pdf", created_at: null },
  ];
  it("only old objects that no material uses and no finish is reading", () => {
    expect(abandonedObjects(u, objs, new Set([`${u}/old-kept.pdf`]), new Set([`${u}/old-busy.pdf`]), now)).toEqual([`${u}/old-orphan.pdf`]);
  });
});

it("isSha256", () => {
  expect(isSha256("0".repeat(64))).toBe(true);
  expect(isSha256("0".repeat(63))).toBe(false);
  expect(isSha256("G".repeat(64))).toBe(false);
});
