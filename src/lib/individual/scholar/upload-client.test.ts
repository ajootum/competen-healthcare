import { describe, expect, it } from "vitest";
import { RESUME_TTL_MS, callJson, findRecord, liveRecords, withRecord, type ResumeRecord } from "./upload-client";

// SCHOLAR-CE07C: the browser half -- resume records and the retried JSON calls (finish idempotency is server-side).

const now = Date.parse("2026-11-04T12:00:00Z");
const rec = (over: Partial<ResumeRecord> = {}): ResumeRecord =>
  ({ uploadId: "u1", sha256: "a".repeat(64), size: 10, mime: "application/pdf", name: "deck.pdf", uploadUrl: null, startedAt: now - 1000, sent: 4, ...over });

describe("resume records", () => {
  it("keeps records younger than 24 h, drops junk and expired ones", () => {
    expect(liveRecords([rec(), rec({ uploadId: "old", startedAt: now - RESUME_TTL_MS }), { nope: 1 }, null], now).map(r => r.uploadId)).toEqual(["u1"]);
    expect(liveRecords("not an array", now)).toEqual([]);
  });
  it("matches the same bytes only (sha256, size, type)", () => {
    const list = [rec()];
    expect(findRecord(list, { sha256: "a".repeat(64), size: 10, mime: "application/pdf" })?.uploadId).toBe("u1");
    expect(findRecord(list, { sha256: "b".repeat(64), size: 10, mime: "application/pdf" })).toBeNull();
    expect(findRecord(list, { sha256: "a".repeat(64), size: 11, mime: "application/pdf" })).toBeNull();
  });
  it("one record per file, newest first", () => {
    const list = withRecord([rec(), rec({ uploadId: "u2", sha256: "c".repeat(64) })], rec({ uploadId: "u3" }));
    expect(list.map(r => r.uploadId)).toEqual(["u3", "u2"]);
  });
});

const resp = (status: number, json: unknown) => ({ status, json: async () => json }) as unknown as Response;

describe("callJson", () => {
  const quick = { sleep: async () => {}, isOnline: () => true };
  it("a lost answer is asked again (the finish is idempotent), then returns the answer", async () => {
    let n = 0;
    const r = await callJson("/x", { method: "POST" }, { ...quick, fetchImpl: (async () => { n += 1; if (n < 3) throw new TypeError("Failed to fetch"); return resp(200, { id: "m1" }); }) as typeof fetch });
    expect(n).toBe(3);
    expect(r.json.id).toBe("m1");
  });
  it("202 processing: waits for the other finish instead of starting a second extraction", async () => {
    const answers = [resp(202, { processing: true, retryAfterMs: 10 }), resp(202, { processing: true, retryAfterMs: 10 }), resp(200, { id: "m1" })];
    const phases: string[] = [];
    const r = await callJson("/x", { method: "POST" }, { ...quick, onWait: p => phases.push(p), fetchImpl: (async () => answers.shift()!) as typeof fetch });
    expect(r.json.id).toBe("m1");
    expect(phases).toEqual(["waiting", "waiting"]);
  });
  it("offline: waits for the connection, not counted as a failure", async () => {
    let up = false, waited = 0, n = 0;
    const r = await callJson("/x", { method: "POST" }, {
      sleep: async () => {}, maxAttempts: 0, isOnline: () => up, waitForOnline: async () => { waited += 1; up = true; },
      fetchImpl: (async () => { n += 1; if (!up) throw new TypeError("offline"); return resp(200, { ok: true }); }) as typeof fetch,
    });
    expect(waited).toBe(1);
    expect(r.json.ok).toBe(true);
  });
  it("a refusal is returned at once, never retried", async () => {
    let n = 0;
    const r = await callJson("/x", { method: "POST" }, { ...quick, fetchImpl: (async () => { n += 1; return resp(422, { error: "patient information" }); }) as typeof fetch });
    expect(n).toBe(1);
    expect(r.status).toBe(422);
  });
  it("gives up after the attempts with a network marker (the caller keeps the record to continue)", async () => {
    const r = await callJson("/x", { method: "POST" }, { ...quick, maxAttempts: 2, fetchImpl: (async () => { throw new TypeError("x"); }) as typeof fetch });
    expect(r.status).toBe(0);
    expect(r.json.network).toBe(true);
  });
});
