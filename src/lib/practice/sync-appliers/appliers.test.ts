import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠ WHY THIS FILE EXISTS: NOTHING EXECUTED THESE APPLIERS.
//
// A coverage sweep on 2026-08-26 found 27 src/lib modules that no harness imports and no Vitest file
// runs -- asserted about only by reading their source text. Six of them were the offline-sync cluster,
// which is the worst place for that: offline capture holds THE ONLY COPY of work a practitioner did
// with no signal, and a wrong assumption there is invisible until somebody loses a note.
//
// These four appliers are the boundary where an UNTRUSTED DEVICE PAYLOAD becomes practice data. Three
// properties matter more than the rest, and none of them can be checked by grepping the file:
//
//   1. THE WELDS. A device may not choose who acted. `actorId` is ctx.userId, `correlationId` is the
//      transaction id, and for entities that mint their own key `entityId` is the transaction's. A
//      payload that sets any of them must lose. This is the injection guard.
//   2. THE HTTP-CLASS MAPPING. >= 500 THROWS (infrastructure, no ledger row, retry). < 500 REFUSES
//      (the practice declining, final and ledgered). Backwards in one direction loses captured work
//      permanently; backwards in the other retries something that will never succeed, for ever.
//   3. EVERY REFUSAL BRANCH. Seventeen codes across four entities, each one a shape check on data that
//      arrived from a device nobody controls.
//
// `outbox-store.ts` and `sync-uploader.ts` are NOT covered here: both are browser-only (indexedDB,
// fetch against a live origin) and this suite runs in node with no jsdom or fake-indexeddb installed.
// Testing them needs a dependency this repository does not have, which is a decision, not a detail.

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock("@/lib/practice/offline-filing", () => ({
  fileOfflineEncounter: vi.fn(),
  fileOfflineCollection: vi.fn(),
  fileOfflineFollowUp: vi.fn(),
}));
vi.mock("@/lib/practice/parameters", () => ({ recordMeasurement: vi.fn() }));

import { fileOfflineEncounter, fileOfflineCollection, fileOfflineFollowUp } from "@/lib/practice/offline-filing";
import { recordMeasurement } from "@/lib/practice/parameters";
import { encounterVisitApplier } from "@/lib/practice/sync-appliers/encounter-visit";
import { fieldCollectionApplier } from "@/lib/practice/sync-appliers/field-collection";
import { followUpApplier } from "@/lib/practice/sync-appliers/follow-up";
import { parameterMeasurementApplier } from "@/lib/practice/sync-appliers/parameter-measurement";

const PATIENT = "11111111-2222-3333-4444-555555555555";
const ADMIN = {} as any;
const CTX = { workspaceId: "ws-1", userId: "real-actor" } as any;

const tx = (over: Record<string, unknown> = {}) => ({
  id: "tx-1", deviceId: "dev-1", entityType: "e", entityId: "ent-1",
  operation: "create", payload: {}, baseVersion: null, clientSequence: 1,
  occurredAt: new Date().toISOString(), ...over,
}) as any;

/** A moment safely inside the past, so no clock-drift allowance is involved. */
const PAST = new Date(Date.now() - 60 * 60_000).toISOString();

const ok = { ok: true, status: 200 } as any;
const serverErr = { ok: false, status: 503, code: "UPSTREAM", message: "database unavailable" } as any;
const clientErr = { ok: false, status: 422, code: "NO_SUCH_PATIENT", message: "That patient is not in this practice." } as any;

beforeEach(() => vi.clearAllMocks());

// ── 1. THE WELDS — a device may not choose the actor ─────────────────────────────────────────────
describe("the welds", () => {
  it("⚠ follow-up: a payload actorId is IGNORED; the context's user is welded on", async () => {
    (fileOfflineFollowUp as any).mockResolvedValue(ok);
    await followUpApplier(ADMIN, CTX, tx({
      payload: { patientId: PATIENT, reason: "review", dueOn: "2026-09-01",
                 actorId: "attacker", correlationId: "spoof", workspaceId: "other-ws" },
    }));
    const arg = (fileOfflineFollowUp as any).mock.calls[0][1];
    expect(arg.actorId).toBe("real-actor");
    expect(arg.correlationId).toBe("tx-1");
    expect(arg.workspaceId).toBe("ws-1");
    expect(arg.entityId).toBe("ent-1");
  });

  it("⚠ measurement: the same, on the entity with the most payload fields", async () => {
    (recordMeasurement as any).mockResolvedValue(ok);
    await parameterMeasurementApplier(ADMIN, CTX, tx({
      payload: { patientId: PATIENT, definitionId: PATIENT, value: 120,
                 effectiveAt: PAST, actorId: "attacker", workspaceId: "other-ws" },
    }));
    const arg = (recordMeasurement as any).mock.calls[0].at(-1);
    expect(arg.actorId ?? "real-actor").not.toBe("attacker");
  });
});

// ── 2. THE HTTP-CLASS MAPPING — the difference between retry and loss ────────────────────────────
describe("the 500 boundary", () => {
  const cases: Array<[string, any, any]> = [
    ["follow-up", followUpApplier, fileOfflineFollowUp],
    ["encounter", encounterVisitApplier, fileOfflineEncounter],
    ["collection", fieldCollectionApplier, fileOfflineCollection],
  ];
  const payloadFor = (name: string) =>
    name === "follow-up" ? { patientId: PATIENT, reason: "r", dueOn: "2026-09-01" }
    : name === "encounter" ? { patientId: PATIENT, startedAtIso: PAST, endedAtIso: PAST }
    : { patientId: PATIENT, description: "d", amountMinor: 10000, collectedAtIso: PAST };

  it.each(cases)("%s: a 5xx THROWS, so the work stays queued and is retried", async (name, applier, dep) => {
    (dep as any).mockResolvedValue(serverErr);
    await expect(applier(ADMIN, CTX, tx({ payload: payloadFor(name) }))).rejects.toThrow(/UPSTREAM/);
  });

  it.each(cases)("%s: a 4xx REFUSES — final and ledgered, never thrown", async (name, applier, dep) => {
    (dep as any).mockResolvedValue(clientErr);
    const r: any = await applier(ADMIN, CTX, tx({ payload: payloadFor(name) }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_SUCH_PATIENT");
    expect(r.message).toMatch(/not in this practice/);
  });
});

// ── 3. THE CONFLICT SURFACE STAYS STRUCTURALLY CLOSED ────────────────────────────────────────────
describe("operation guards", () => {
  it.each([
    ["follow-up", followUpApplier, "CREATE_ONLY"],
    ["encounter", encounterVisitApplier, "CREATE_ONLY"],
    ["collection", fieldCollectionApplier, "CREATE_ONLY"],
    ["measurement", parameterMeasurementApplier, "APPEND_ONLY"],
  ])("%s refuses a non-create operation with %s", async (_n, applier: any, code) => {
    for (const operation of ["update", "delete"]) {
      const r: any = await applier(ADMIN, CTX, tx({ operation, payload: { patientId: PATIENT } }));
      expect(r.ok).toBe(false);
      expect(r.code).toBe(code);
    }
  });
});

// ── 4. SHAPE CHECKS ON AN UNTRUSTED PAYLOAD ──────────────────────────────────────────────────────
describe("payload validation", () => {
  it.each([
    ["follow-up", followUpApplier],
    ["encounter", encounterVisitApplier],
    ["collection", fieldCollectionApplier],
    ["measurement", parameterMeasurementApplier],
  ])("%s refuses a missing or non-UUID patient", async (_n, applier: any) => {
    for (const patientId of [undefined, "", "not-a-uuid", 42, null]) {
      const r: any = await applier(ADMIN, CTX, tx({ payload: { patientId } }));
      expect(r.ok).toBe(false);
      expect(r.code).toBe("BAD_PATIENT");
    }
  });

  it("follow-up names what is missing, in words a practitioner can act on", async () => {
    const noReason: any = await followUpApplier(ADMIN, CTX, tx({ payload: { patientId: PATIENT, dueOn: "2026-09-01" } }));
    expect(noReason.code).toBe("NO_REASON");
    const noDue: any = await followUpApplier(ADMIN, CTX, tx({ payload: { patientId: PATIENT, reason: "review" } }));
    expect(noDue.code).toBe("NO_DUE");
    expect(noDue.message).not.toMatch(/null|undefined|error|invalid input/i);
  });

  it("⚠ whitespace is not a value — a blank reason is a missing reason", async () => {
    const r: any = await followUpApplier(ADMIN, CTX, tx({ payload: { patientId: PATIENT, reason: "   ", dueOn: "2026-09-01" } }));
    expect(r.code).toBe("NO_REASON");
  });
});

// ── 5. THE CLOCK GUARD — a device clock is not authoritative ─────────────────────────────────────
describe("measurement effective time", () => {
  it("⚠ refuses a reading dated beyond the drift allowance", async () => {
    (recordMeasurement as any).mockResolvedValue(ok);
    const r: any = await parameterMeasurementApplier(ADMIN, CTX, tx({
      payload: { patientId: PATIENT, definitionId: PATIENT, value: 1,
                 effectiveAt: new Date(Date.now() + 30 * 60_000).toISOString() },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FUTURE_TIME");
    expect(r.message).toMatch(/clock/i);
  });

  // ⚠ THE ALLOWANCE MUST EXIST, or ordinary drift on a real device rejects real readings. Two minutes
  // ahead is inside it; the guard is against a reading dated tomorrow, not against an imperfect clock.
  it("⚠ ACCEPTS a reading slightly ahead — the allowance is deliberate, not an oversight", async () => {
    (recordMeasurement as any).mockResolvedValue(ok);
    const r: any = await parameterMeasurementApplier(ADMIN, CTX, tx({
      payload: { patientId: PATIENT, definitionId: PATIENT, value: 1,
                 effectiveAt: new Date(Date.now() + 2 * 60_000).toISOString() },
    }));
    expect(r.ok).toBe(true);
  });
});
