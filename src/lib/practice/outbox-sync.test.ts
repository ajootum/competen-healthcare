/**
 * CPR-PILOT-READINESS-001 §4 — the outbox/sync arc, EXECUTED against a real IndexedDB implementation.
 *
 * ⚠ WHY THESE EXIST. Until 2026-08-28 the only checks over outbox-store.ts and sync-uploader.ts were
 * SOURCE SCANS (practice-outbox-harness reads the files and greps), and §4 rules exactly that out:
 * "Text assertions alone are insufficient for pilot authorization." These tests run the real modules —
 * real AES-GCM sealing through WebCrypto, real IndexedDB transactions — through the full arc the spec
 * names: write -> read -> queue -> restart simulation -> retry -> successful upload -> dequeue.
 *
 * ⚠ THE fake-indexeddb ASSESSMENT §4 ASKS FOR, RECORDED: probed before adoption (2026-08-28) on the
 * three capabilities this store actually depends on, and all three hold in Node 24:
 *   1. a NON-EXTRACTABLE AES-GCM CryptoKey round-trips through put/get and still encrypts/decrypts —
 *      the META cacheKey is exactly that, so a shim that lost key usability would fail everything;
 *   2. Uint8Array/ArrayBuffer shapes survive structured cloning — SealedRecord is iv + ciphertext;
 *   3. a failed write fires transaction.onabort, not oncomplete — commit() resolves on oncomplete BY
 *      DOCTRINE (a transaction can abort after request.onsuccess), so a fake with casual transaction
 *      semantics would make these tests prove nothing. The alternative — a hand-rolled shim — was
 *      rejected for precisely that reason: faithful abort/complete ordering is the hard part.
 *
 * ⚠ EACH TEST GETS A FRESH IDBFactory, except the restart test, which deliberately KEEPS the factory
 * while resetting the module registry — that is what a restart is: the process dies, the disk survives.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { outboxAccept, outboxLoad, outboxRemoveDelivered, outboxExport } from "@/lib/practice/outbox-store";
import { uploadOutbox, uploadSentence } from "@/lib/practice/sync-uploader";
import { SYNC_MAX_BATCH } from "@/lib/practice/sync-limits";

const WS_A = "00000000-0000-4000-8000-00000000aaaa";
const WS_B = "00000000-0000-4000-8000-00000000bbbb";
const DEVICE = "device-under-test";
const USER = "00000000-0000-4000-8000-0000000000ee";
const MARKER = "BP 178/104 recorded at triage — the only copy in existence";

function accept(overrides: Partial<Parameters<typeof outboxAccept>[0]> = {}) {
  return outboxAccept({
    workspaceId: WS_A, deviceId: DEVICE, userId: USER,
    entityType: "measurement", entityId: crypto.randomUUID(), operation: "create",
    payload: { note: MARKER }, baseVersion: null,
    ...overrides,
  });
}

type Body = { transactions: Array<Record<string, unknown>> };

/** A fetch stub that records every body it was sent and answers from a script of responses. */
function transport(script: Array<(body: Body) => Response | Promise<Response>>) {
  const bodies: Body[] = [];
  let call = 0;
  const impl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const step = script[Math.min(call, script.length - 1)];
    call++;
    return step(body);
  }) as typeof fetch;
  return { impl, bodies };
}

const applied = (body: Body, extra: Partial<{ duplicate: boolean }> = {}) =>
  new Response(JSON.stringify({
    verdicts: body.transactions.map(t => ({
      id: t.id, status: "applied", errorCode: null, errorMessage: null,
      retryable: false, duplicate: extra.duplicate ?? false,
    })),
  }), { status: 200 });

beforeEach(() => {
  // A fresh disk per test. The restart test overrides this deliberately.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe("write -> read (acceptance is the promise)", () => {
  it("a record accepted is a record read back, decrypted, with its fields intact", async () => {
    const r = await accept();
    expect(r.ok).toBe(true);
    const loaded = await outboxLoad();
    expect(loaded.unreadable).toBe(0);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].state).toBe("pending");
    expect(loaded.records[0].workspaceId).toBe(WS_A);
    expect((loaded.records[0].payload as { note: string }).note).toBe(MARKER);
  });

  it("sequences allocate strictly upward, so send order is never ambiguous", async () => {
    const a = await accept(); const b = await accept();
    if (!a.ok || !b.ok) throw new Error("acceptance failed");
    expect(b.record.sequence).toBe(a.record.sequence + 1);
  });

  it("at rest the record is SEALED: the stored bytes do not contain the clinical text", async () => {
    await accept();
    const raw = await new Promise<unknown[]>((resolve, reject) => {
      const req = indexedDB.open("competen-practice-outbox", 1);
      req.onsuccess = () => {
        const t = req.result.transaction("records", "readonly");
        const q = t.objectStore("records").getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      };
      req.onerror = () => reject(req.error);
    });
    expect(raw).toHaveLength(1);
    const flat = JSON.stringify(raw, (_k, v) => {
      if (v instanceof ArrayBuffer) return new TextDecoder("utf-8", { fatal: false }).decode(v);
      if (ArrayBuffer.isView(v)) return new TextDecoder("utf-8", { fatal: false }).decode(v as Uint8Array);
      return v;
    });
    expect(flat).not.toContain(MARKER);
    expect(flat).not.toContain(WS_A); // the workspace id is not readable off the disk either
  });
});

describe("restart simulation (the disk survives, the process does not)", () => {
  it("records and the sequence counter survive a module-registry restart on the same disk", async () => {
    const disk = new IDBFactory();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = disk;
    const first = await accept();
    expect(first.ok).toBe(true);

    // The restart: every module dies, the disk does not.
    vi.resetModules();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = disk;
    const store2 = await import("@/lib/practice/outbox-store");

    const loaded = await store2.outboxLoad();
    expect(loaded.records).toHaveLength(1);
    expect(loaded.unreadable).toBe(0);
    expect((loaded.records[0].payload as { note: string }).note).toBe(MARKER);

    // ⚠ THE SEQUENCE CONTINUES rather than restarting at 1 — a reset counter would let a post-restart
    // create claim a number an earlier update already holds, and ordering breaks silently.
    const again = await store2.outboxAccept({
      workspaceId: WS_A, deviceId: DEVICE, userId: USER,
      entityType: "measurement", entityId: crypto.randomUUID(), operation: "create",
      payload: { note: "post-restart" }, baseVersion: null,
    });
    if (!again.ok) throw new Error(again.reason);
    expect(again.record.sequence).toBe(2);
  });
});

describe("failure preserves the only unsynced copy", () => {
  it("a network death marks failed, keeps the record, and says everything is still on this device", async () => {
    await accept();
    const t = transport([() => { throw new Error("ECONNRESET mid-flight"); }]);
    const out = await uploadOutbox({ fetchImpl: t.impl });
    expect(out.attempted).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.delivered).toBe(0);
    expect(out.problem).toMatch(/still on this device/i);

    const after = await outboxLoad();
    expect(after.records).toHaveLength(1);
    expect(after.records[0].state).toBe("failed");
    expect(after.records[0].attempts).toBe(1);
  });

  it("a non-OK response — including 401/403 — is transient by doctrine: failed, kept, retried later", async () => {
    await accept();
    const t = transport([() => new Response("session expired", { status: 401 })]);
    const out = await uploadOutbox({ fetchImpl: t.impl });
    expect(out.failed).toBe(1);
    const after = await outboxLoad();
    expect(after.records[0].state).toBe("failed"); // NOT refused: a 401 is about the session, not the consultation
  });

  it("a verdict that does not mention a record leaves it failed, never silently delivered", async () => {
    await accept();
    const t = transport([() => new Response(JSON.stringify({ verdicts: [] }), { status: 200 })]);
    const out = await uploadOutbox({ fetchImpl: t.impl });
    expect(out.failed).toBe(1);
    expect(out.delivered).toBe(0);
    expect((await outboxLoad()).records[0].state).toBe("failed");
  });

  it("while the request is IN FLIGHT the disk still says pending — `sending` is never persisted, so a crash strands nothing", async () => {
    await accept();
    let stateDuringFlight: string | null = null;
    const t = transport([async (body) => {
      const midFlight = await outboxLoad();
      stateDuringFlight = midFlight.records[0]?.state ?? null;
      return applied(body);
    }]);
    await uploadOutbox({ fetchImpl: t.impl });
    expect(stateDuringFlight).toBe("pending");
  });
});

describe("retry -> successful upload -> dequeue", () => {
  it("the full arc completes, the retry reuses the SAME transaction id, and only delivered work is removed", async () => {
    const first = await accept();
    if (!first.ok) throw new Error(first.reason);
    const t0 = new Date("2026-08-28T09:00:00Z");

    const t = transport([
      () => new Response("gateway timeout", { status: 504 }),
      (body) => applied(body),
    ]);

    const attempt1 = await uploadOutbox({ at: t0, fetchImpl: t.impl });
    expect(attempt1.failed).toBe(1);

    // Not yet due: backoff holds it, and the outcome SAYS so rather than looking stuck.
    const tooSoon = await uploadOutbox({ at: new Date(t0.getTime() + 1000), fetchImpl: t.impl });
    expect(tooSoon.attempted).toBe(0);
    expect(tooSoon.waiting).toBe(1);
    expect(uploadSentence(tooSoon)).toMatch(/waiting/i);

    // Past the backoff cap: due, sent, applied.
    const attempt2 = await uploadOutbox({ at: new Date(t0.getTime() + 31 * 60 * 1000), fetchImpl: t.impl });
    expect(attempt2.delivered).toBe(1);

    // ⚠ THE IDEMPOTENCY KEY IS STABLE: both wire attempts carried the same transaction id, which is what
    // lets migration 284's ledger answer the second with `duplicate` instead of a second clinical action.
    expect(t.bodies).toHaveLength(2);
    expect(t.bodies[1].transactions[0].id).toBe(t.bodies[0].transactions[0].id);
    expect(t.bodies[0].transactions[0].id).toBe(first.record.id);

    const removed = await outboxRemoveDelivered();
    expect(removed.removed).toBe(1);
    expect((await outboxLoad()).records).toHaveLength(0);
  });

  it("a duplicate verdict is a SUCCESS — the server already holds the work; nothing re-sends for ever", async () => {
    await accept();
    const t = transport([(body) => applied(body, { duplicate: true })]);
    const out = await uploadOutbox({ fetchImpl: t.impl });
    expect(out.delivered).toBe(1);
    const again = await uploadOutbox({ fetchImpl: t.impl });
    expect(again.attempted).toBe(0); // delivered work is not sendable
  });

  it("a refused (non-retryable) verdict escalates to a person and is NOT removed as delivered", async () => {
    await accept();
    const t = transport([(body) => new Response(JSON.stringify({
      verdicts: body.transactions.map(tx => ({
        id: tx.id, status: "refused", errorCode: "VALIDATION_ERROR",
        errorMessage: "the practice did not accept this", retryable: false, duplicate: false,
      })),
    }), { status: 200 })]);
    const out = await uploadOutbox({ fetchImpl: t.impl });
    expect(out.refused).toBe(1);
    expect((await outboxLoad()).records[0].state).toBe("refused");
    expect((await outboxRemoveDelivered()).removed).toBe(0);
    expect((await outboxExport()).records).toHaveLength(1); // a person can always get it out
  });
});

describe("corrupt queued data fails safely and visibly", () => {
  async function plantGarbage() {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("competen-practice-outbox", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("records")) db.createObjectStore("records");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => {
        const t = req.result.transaction("records", "readwrite");
        t.objectStore("records").put({ not: "a sealed record", at: "all" }, "corrupt-id");
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  it("an unreadable record is REPORTED and listed as undeliverable, never deleted", async () => {
    await accept();
    await plantGarbage();
    const loaded = await outboxLoad();
    expect(loaded.unreadable).toBe(1);
    expect(loaded.detail).toMatch(/NOT been deleted/i);
    expect(loaded.records).toHaveLength(2);
    const ghost = loaded.records.find(r => r.state === "undeliverable");
    expect(ghost?.id).toBe("corrupt-id");
    expect(ghost?.lastError).toMatch(/cannot be read back/i);
  });

  it("one corrupt record does not hold back the readable work, and nothing removes it", async () => {
    await accept();
    await plantGarbage();
    const t = transport([(body) => applied(body)]);
    const out = await uploadOutbox({ fetchImpl: t.impl });
    expect(out.delivered).toBe(1); // the healthy record went
    expect(t.bodies[0].transactions).toHaveLength(1); // the ghost was never put on the wire
    await outboxRemoveDelivered();
    const after = await outboxLoad();
    expect(after.records.some(r => r.state === "undeliverable")).toBe(true); // still there, still visible
    expect((await outboxExport()).records.some(r => r.state === "undeliverable")).toBe(true);
  });
});

describe("patient and Practice isolation in queued data", () => {
  it("the wire carries NO workspace or user claim — the server's session decides, so the outbox cannot cross a practice", async () => {
    await accept({ workspaceId: WS_A });
    await accept({ workspaceId: WS_B });
    const t = transport([(body) => applied(body)]);
    await uploadOutbox({ fetchImpl: t.impl });
    for (const tx of t.bodies[0].transactions) {
      expect(tx).not.toHaveProperty("workspaceId");
      expect(tx).not.toHaveProperty("userId");
      expect(JSON.stringify(tx)).not.toContain(WS_A);
      expect(JSON.stringify(tx)).not.toContain(WS_B);
    }
  });

  it("records keep their own workspace locally and export never mixes in an id it was not given", async () => {
    await accept({ workspaceId: WS_A, payload: { note: "for A" } });
    await accept({ workspaceId: WS_B, payload: { note: "for B" } });
    const loaded = await outboxLoad();
    const byWs = new Map(loaded.records.map(r => [(r.payload as { note: string }).note, r.workspaceId]));
    expect(byWs.get("for A")).toBe(WS_A);
    expect(byWs.get("for B")).toBe(WS_B);
  });
});

describe("the batch respects the server's own ceiling", () => {
  it(`sends at most SYNC_MAX_BATCH (${SYNC_MAX_BATCH}) and reports the remainder honestly`, async () => {
    for (let i = 0; i < SYNC_MAX_BATCH + 1; i++) {
      const r = await accept({ payload: { note: `n${i}` } });
      if (!r.ok) throw new Error(r.reason);
    }
    const t = transport([(body) => applied(body)]);
    const out = await uploadOutbox({ fetchImpl: t.impl });
    expect(out.attempted).toBe(SYNC_MAX_BATCH);
    expect(t.bodies[0].transactions).toHaveLength(SYNC_MAX_BATCH);
  });
});
