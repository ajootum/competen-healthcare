/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-PD-PROV-001 §5/§7/§9/§15 -- time-limited entitlement, and the rules the spec is specific about.
 *
 * ⚠ THE ONE THAT MATTERS MOST IS HISTORY. The first version of this engine updated the single
 * entitlement row in place, which was tidy and destroyed the record: extending a trial overwrote the
 * trial's own dates. §9 forbids it ("Do not rewrite historical entitlement periods"), §15 repeats it for
 * reactivation, and AC-09 tests it. Periods are appended now, and the tests below fail if that regresses.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import {
  grantAccessPeriod, endAccess, practiceEntitlements,
  ACCESS_STATE_LABEL, EXPIRING_SOON_DAYS_DEFAULT,
} from "./entitlement";

const DAY = 86_400_000;
// ⚠ ONE CLOCK READING FOR THE WHOLE FILE. Recomputing Date.now() per call makes two "back(30)" values
// differ by a millisecond -- which reads exactly like a stored date having been rewritten, and cost a
// failing assertion that was accusing the engine of the bug this file exists to catch.
const T0 = Date.now();
const ahead = (d: number) => new Date(T0 + d * DAY).toISOString();
const back = (d: number) => new Date(T0 - d * DAY).toISOString();

/**
 * A Supabase-shaped stub over an in-memory table, so append-versus-overwrite is observable.
 * pd_ops_config answers empty, which exercises the documented fallback threshold.
 */
function fakeDb(rows: any[] = []) {
  const store = rows.map((r, i) => ({ id: r.id ?? `row-${i}`, product_code: "practice", ...r }));
  const audits: any[] = [];
  let seq = store.length;

  const table = (name: string) => {
    if (name === "pd_ops_config") {
      const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      return q;
    }
    if (name === "practice_audit_event") {
      return { insert: (v: any) => { audits.push(v); return Promise.resolve({ error: null }); } };
    }
    // practice_entitlement
    const q: any = {
      _filterId: null as string | null,
      select() { return q; },
      eq(col: string, val: string) { if (col === "id") q._filterId = val; return q; },
      order() { return Promise.resolve({ data: [...store].sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1)), error: null }); },
      insert(v: any) {
        const row = { id: `row-${seq++}`, ...v };
        store.push(row);
        return {
          select: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
        };
      },
      update(patch: any) {
        return {
          eq(_c: string, id: string) {
            const row = store.find(r => r.id === id);
            if (row) Object.assign(row, patch);
            const res = { data: row ?? null, error: row ? null : { message: "no row" } };
            return Object.assign(Promise.resolve({ error: res.error }), {
              select: () => ({ maybeSingle: () => Promise.resolve(res) }),
            });
          },
        };
      },
    };
    return q;
  };
  return { admin: { from: table }, store, audits };
}

const ARGS = { actorId: "pd-1", reason: "owner asked for the pilot to continue", correlationId: "t" };

describe("§9/§15 -- history is preserved", () => {
  it("APPENDS a period rather than overwriting the one it replaces", async () => {
    const db = fakeDb([{ status: "trial", plan_code: "practice_trial", starts_at: back(30), ends_at: back(1) }]);
    const r = await grantAccessPeriod(db.admin as any, {
      workspaceId: "ws", status: "trial", planCode: "practice_trial",
      startsAt: new Date().toISOString(), endsAt: ahead(90), ...ARGS,
    });
    expect(r.ok).toBe(true);
    expect(db.store).toHaveLength(2);
    // ⚠ THE EXPIRED TRIAL KEEPS ITS OWN DATES. This is the assertion the first implementation failed.
    const original = db.store[0];
    expect(original.starts_at).toBe(back(30));
    expect(original.ends_at).toBe(back(1));
  });

  it("closes a period that is still granting access, by STATUS and not by rewriting its dates", async () => {
    const openEnded = { status: "active", plan_code: "p", starts_at: back(10), ends_at: null };
    const db = fakeDb([openEnded]);
    await grantAccessPeriod(db.admin as any, {
      workspaceId: "ws", status: "trial", planCode: "practice_trial",
      startsAt: new Date().toISOString(), endsAt: ahead(30), ...ARGS,
    });
    // One answer for the gate...
    expect(db.store[0].status).toBe("expired");
    // ...and its period is untouched, which is the difference between a transition and a rewrite.
    expect(db.store[0].starts_at).toBe(back(10));
    expect(db.store[0].ends_at).toBeNull();
    expect(db.store).toHaveLength(2);
  });

  it("ending access transitions the current period and leaves its dates alone", async () => {
    const db = fakeDb([{ status: "trial", plan_code: "p", starts_at: back(5), ends_at: ahead(25) }]);
    const r = await endAccess(db.admin as any, { workspaceId: "ws", status: "expired", ...ARGS });
    expect(r.ok).toBe(true);
    expect(db.store[0].status).toBe("expired");
    // ⚠ NOT rewritten to "ended today": the period genuinely ran to that date, and saying otherwise
    // makes the record claim it had always been going to end now.
    expect(db.store[0].ends_at).toBe(ahead(25));
  });
});

describe("§5 -- interval rules, refused server-side", () => {
  const grant = (over: Record<string, unknown>) =>
    grantAccessPeriod(fakeDb().admin as any, {
      workspaceId: "ws", status: "trial", planCode: "p",
      startsAt: new Date().toISOString(), endsAt: ahead(30), ...ARGS, ...over,
    } as any);

  it("rejects an end at or before the start", async () => {
    const r = await grant({ startsAt: ahead(10), endsAt: ahead(10) });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("INVALID_INTERVAL");
  });

  it("rejects an end before the start with the interval message, which is the truer one", async () => {
    // A period starting now and ending yesterday fails on ORDER first, and "the end must be after the
    // start" is what a Director needs to read -- not a note about the past.
    const r = await grant({ endsAt: back(1) });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("INVALID_INTERVAL");
  });

  it("rejects a whole period that sits in the past, because it would not restore access", async () => {
    // Both instants behind now, and the end still after the start -- the case reactivation invites.
    const r = await grant({ startsAt: back(30), endsAt: back(1) });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("END_IN_THE_PAST");
  });

  it("requires a reason, and records it", async () => {
    const r = await grant({ reason: "x" });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("REASON_REQUIRED");
  });

  it("refuses a granted period that is neither active nor trial", async () => {
    const r = await grant({ status: "expired" });
    expect(r.ok).toBe(false);
  });

  it("accepts an open-ended period only because the caller asked for one explicitly", async () => {
    // §5: a MISSING end is not unlimited access -- the route refuses that. An explicit null is a choice.
    const r = await grant({ endsAt: null });
    expect(r.ok).toBe(true);
    expect((r as any).after.endsAt).toBeNull();
  });
});

describe("§7 -- the derived state, never stored", () => {
  const read = async (rows: any[]) => practiceEntitlements(fakeDb(rows).admin as any, "ws");

  it("a future start is Scheduled and grants nothing", async () => {
    const r = await read([{ status: "trial", plan_code: "p", starts_at: ahead(3), ends_at: ahead(33) }]);
    expect(r.state).toBe("ok");
    if (r.state !== "ok") return;
    expect(r.current!.state).toBe("scheduled");
    expect(r.current!.grantsAccessNow).toBe(false);
    expect(r.hasAccess).toBe(false);
  });

  it("a lapsed period is Expired and says why", async () => {
    const r = await read([{ status: "trial", plan_code: "p", starts_at: back(40), ends_at: back(2) }]);
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.current!.state).toBe("expired");
    expect(r.current!.whyNot).toBe("the plan window has ended");
    expect(r.current!.daysRemaining).toBeNull();
  });

  it("a period ending inside the threshold is Expiring soon, with days remaining", async () => {
    const r = await read([{ status: "active", plan_code: "p", starts_at: back(10), ends_at: ahead(5) }]);
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.current!.state).toBe("expiring_soon");
    expect(r.current!.daysRemaining).toBe(5);
    expect(r.expiringSoonDays).toBe(EXPIRING_SOON_DAYS_DEFAULT);
  });

  it("a long open-ended period is Active with no countdown", async () => {
    const r = await read([{ status: "active", plan_code: "p", starts_at: back(10), ends_at: null }]);
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.current!.state).toBe("active");
    expect(r.current!.daysRemaining).toBeNull();
  });

  it("a suspended period reads as Paused rather than Expired", async () => {
    const r = await read([{ status: "suspended", plan_code: "p", starts_at: back(10), ends_at: ahead(20) }]);
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.current!.state).toBe("paused");
  });

  it("picks the period that GRANTS access as current, not merely the newest", async () => {
    const r = await read([
      { id: "live", status: "active", plan_code: "p", starts_at: back(1), ends_at: ahead(20) },
      { id: "old", status: "expired", plan_code: "p", starts_at: back(60), ends_at: back(30) },
    ]);
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.current!.id).toBe("live");
    expect(r.periods).toHaveLength(2);
  });

  it("a practice with no period at all reads `none`, not an empty success", async () => {
    const r = await read([]);
    expect(r.state).toBe("none");
    if (r.state === "unreadable") throw new Error("a table that answered is not an unreadable one");
    expect(r.hasAccess).toBe(false);
  });

  it("every state has a human label", () => {
    for (const [, label] of Object.entries(ACCESS_STATE_LABEL)) expect(label.length).toBeGreaterThan(2);
  });
});
