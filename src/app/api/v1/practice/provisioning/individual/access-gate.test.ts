/**
 * CPR-PD-PROV-001 §13 -- WHO MAY DETERMINE A PRACTICE'S ACCESS PERIOD.
 *
 * ⚠ THE BOUNDARY THIS FILE GUARDS. Practice self-serve signup is OPEN (owner decision, 2026-08-28), so
 * any authenticated person may create their own practice through this endpoint. The launch flags decide
 * WHO may create one; until this build nothing decided HOW LONG they got to keep it, because there was
 * nothing to decide -- the trial length came from `practice_plans`. Accepting an `access` block from the
 * request body changes that, and accepting it unconditionally would let a self-serve caller post
 * themselves an open-ended `active` period. The route strips the field and only reinstates it after the
 * capability gate.
 *
 * CLAUDE.md: "Authorization and tenancy boundaries are not optional to test."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── The stubs. Everything the route reaches for, and nothing it does not. ────────────────────────────
const runProvisioning = vi.fn();
const platformFlag = vi.fn();
const hqApiGate = vi.fn();
const getCaller = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  getCaller: () => getCaller(),
  isResponse: (x: unknown) => x instanceof Response,
  isSuper: () => false,
}));
vi.mock("@/lib/hq/api-gate", () => ({
  hqApiGate: (caps: string[]) => hqApiGate(caps),
  // A refusal is a Response; the stub returns a plain object when it allows.
  isHqRefusal: (x: unknown) => x instanceof Response,
}));
vi.mock("@/lib/practice/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/practice/provisioning", async (importOriginal) => {
  // ⚠ THE HASH AND THE VALIDATOR ARE THE REAL ONES. Stubbing them would make this test agree with
  // itself rather than with the code that ships.
  const real = await importOriginal<typeof import("@/lib/practice/provisioning")>();
  return { ...real, runProvisioning: (...a: unknown[]) => runProvisioning(...a), platformFlag: (...a: unknown[]) => platformFlag(...a) };
});

/** A Supabase-shaped stub: enough for the idempotency insert and the duplicate-practice check. */
function fakeAdmin() {
  const table = (name: string) => {
    if (name === "provisioning_request") {
      const q: any = {
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "req-1", status: "REQUESTED", workspace_id: null }, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => q, eq: () => q, single: () => Promise.resolve({ data: null, error: null }),
      };
      return q;
    }
    // practice_workspace: nobody already owns one, so the run proceeds.
    const q: any = { select: () => q, eq: () => q, not: () => q, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
    return q;
  };
  return { from: table };
}

const BODY = {
  displayName: "Nakato Family Practice", countryCode: "UG", timezone: "Africa/Kampala",
  professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  termsVersion: "t", privacyNoticeVersion: "p", source: "pilot",
};

const TEN_YEARS = new Date(Date.now() + 3650 * 86_400_000).toISOString();

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(new Request("https://x/api/v1/practice/provisioning/individual", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "k-1" },
    body: JSON.stringify(body),
  }) as any);
};

/** What runProvisioning was actually handed -- the only thing that decides what gets written. */
const payloadSeen = () => runProvisioning.mock.calls[0]?.[2] as any;

beforeEach(() => {
  vi.clearAllMocks();
  getCaller.mockResolvedValue({ admin: fakeAdmin(), userId: "self-1", traceId: "trace-1" });
  platformFlag.mockResolvedValue(true);
  hqApiGate.mockResolvedValue({ ok: true });
  runProvisioning.mockResolvedValue({ ok: true, workspaceId: "ws-1" });
});

describe("§13 -- the access period is a capability-gated field", () => {
  it("STRIPS a period a self-serve caller posted for themselves", async () => {
    // targetUserId omitted => the caller is provisioning for themselves => no capability gate runs.
    const res = await post({ ...BODY, access: { planCode: "practice_standard", basis: "active", startsAt: new Date().toISOString(), endsAt: TEN_YEARS } });
    expect(res.status).toBe(201);
    expect(runProvisioning).toHaveBeenCalledOnce();
    // ⚠ THE ASSERTION. The ten-year period never reaches the orchestrator, so step 5 falls back to the
    // trial `practice_plans` defines.
    expect(payloadSeen().access).toBeUndefined();
    // And the gate was never consulted, which is what makes this the self-serve path.
    expect(hqApiGate).not.toHaveBeenCalled();
  });

  it("KEEPS the period for a caller who passed the capability gate", async () => {
    const endsAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const res = await post({ ...BODY, targetUserId: "someone-else", access: { planCode: "practice_trial", basis: "trial", startsAt: new Date().toISOString(), endsAt } });
    expect(res.status).toBe(201);
    expect(hqApiGate).toHaveBeenCalledWith(["hq.practice.provision.execute"]);
    expect(payloadSeen().access).toMatchObject({ planCode: "practice_trial", basis: "trial", endsAt });
  });

  it("refuses an invalid interval BEFORE anything is provisioned", async () => {
    const res = await post({
      ...BODY, targetUserId: "someone-else",
      access: { planCode: "practice_trial", basis: "trial", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() - 86_400_000).toISOString() },
    });
    expect(res.status).toBe(422);
    // §15: a failure must not leave an apparently complete usable Practice. Nothing ran.
    expect(runProvisioning).not.toHaveBeenCalled();
  });

  it("a gated caller who sends NO period still provisions, on the plan's own trial", async () => {
    // The control: the field is optional, and its absence must not be mistaken for a refusal.
    const res = await post({ ...BODY, targetUserId: "someone-else" });
    expect(res.status).toBe(201);
    expect(payloadSeen().access).toBeUndefined();
  });
});
