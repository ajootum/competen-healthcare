/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dueRenewals } from "./renewals";
import { loadReminderPrefs, parsePrefs, REMINDER_DEFAULTS } from "./preferences";

// COMPETEN-IND-007, migration 374: in-app reminders default ON, email reminders default OFF and opt-in, the
// two independent, entitlement respected, and nothing written to the estate notification stores.

const dispatched: { ids: string[]; channels: string[] }[] = [];
// What the provider answers: "sent", "failed" (provider error) or "skipped" (provider not configured).
let deliveryStatus: "sent" | "failed" | "skipped" = "sent";
vi.mock("@/lib/notifications/dispatch", () => ({
  dispatch: async (_admin: any, ids: string[], _n: any, channels: string[]) => {
    dispatched.push({ ids, channels });
    return { deliveries: ids.map(user_id => ({ user_id, channel: "email", status: deliveryStatus, error: deliveryStatus === "sent" ? null : `provider said ${deliveryStatus}` })) };
  },
}));

const TODAY = "2026-10-23";

describe("what is due", () => {
  it("is the registration and credentials expiring within 60 days or already expired, soonest first", () => {
    const due = dueRenewals({
      registration: { body: "UNMC", expiresOn: "2026-12-10" },
      credentials: [
        { id: "a", kind: "credential", title: "Licence", expires_on: "2026-11-01" },
        { id: "b", kind: "credential", title: "Old cert", expires_on: "2026-01-01" },
        { id: "c", kind: "credential", title: "Far away", expires_on: "2027-06-01" },
        { id: "d", kind: "competency", title: "Not a credential", expires_on: null },
      ],
    }, TODAY);
    expect(due.map(d => d.id ?? "registration")).toEqual(["b", "a", "registration"]);
    expect(due[0].expired).toBe(true);
    expect(due[2].title).toBe("Your registration with UNMC");
  });
});

/** A minimal chainable stand-in: each table answers from `tables`, filtered by the eq/in calls made. */
function fakeAdmin(tables: Record<string, any[]>, opts: { prefsError?: any; flag?: boolean } = {}) {
  const writes: { table: string; op: string; payload: any }[] = [];
  return {
    writes,
    from(table: string) {
      const filters: ((r: any) => boolean)[] = [];
      let op = "select"; let payload: any = null;
      const rows = () => (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      const b: any = {
        select: () => b, limit: () => b, order: () => b, or: () => b,
        eq: (k: string, v: any) => { filters.push(r => r[k] === v); return b; },
        in: (k: string, vs: any[]) => { filters.push(r => vs.includes(r[k])); return b; },
        not: (k: string) => { filters.push(r => r[k] != null); return b; },
        lte: (k: string, v: any) => { filters.push(r => r[k] <= v); return b; },
        update: (p: any) => { op = "update"; payload = p; writes.push({ table, op, payload: p }); return b; },
        maybeSingle: async () => {
          if (table === "practice_platform_flags") return { data: { enabled: opts.flag !== false }, error: null };
          if (table === "individual_professional_profile" && opts.prefsError) return { data: null, error: opts.prefsError };
          return { data: rows()[0] ?? null, error: null };
        },
        then: (res: any, rej: any) => {
          if (table === "individual_professional_profile" && opts.prefsError && op === "select" && filters.length && !payload) {
            return Promise.resolve({ data: null, error: opts.prefsError }).then(res, rej);
          }
          // Updates really change the rows, so a claim and its release can be checked end to end.
          const matched = rows();
          if (op === "update") matched.forEach(r => Object.assign(r, payload));
          return Promise.resolve({ data: matched, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
}

describe("preferences", () => {
  it("default to in-app ON and email OFF, and accept only two booleans", () => {
    expect(REMINDER_DEFAULTS).toEqual({ inApp: true, email: false });
    expect(parsePrefs({ inApp: true, email: "yes" })).toBeNull();
    expect(parsePrefs({ inApp: false, email: true })).toEqual({ reminder_in_app: false, reminder_email: true });
  });

  it("read as the defaults, not configurable, when migration 374 is absent", async () => {
    const admin = fakeAdmin({}, { prefsError: { code: "42703", message: "column does not exist" } });
    expect(await loadReminderPrefs(admin, "u")).toEqual({ inApp: true, email: false, configurable: false });
  });

  it("read as the defaults for a person with no row yet, and each switch independently once set", async () => {
    expect(await loadReminderPrefs(fakeAdmin({ individual_professional_profile: [] }), "u")).toEqual({ inApp: true, email: false, configurable: true });
    const admin = fakeAdmin({ individual_professional_profile: [{ user_id: "u", reminder_in_app: false, reminder_email: true }] });
    expect(await loadReminderPrefs(admin, "u")).toEqual({ inApp: false, email: true, configurable: true });
  });
});

describe("the email scan", () => {
  beforeEach(() => { dispatched.length = 0; deliveryStatus = "sent"; });

  it("⚠ a FAILED send does not consume the once-only reminder: the claim is released and the failure is reported", async () => {
    const { scanProfessionalReminders } = await import("./reminders");
    deliveryStatus = "failed";
    const tables = base();
    const admin = fakeAdmin(tables);
    const r = await scanProfessionalReminders(admin, new Date(`${TODAY}T06:00:00Z`));
    expect(r.recipients).toEqual([]);
    expect(r.failed).toBe(1);
    expect(r.failures[0]).toMatchObject({ userId: "in" });
    expect(r.failures[0].error).toContain("provider said failed");
    expect(tables.individual_professional_evidence.find((e: any) => e.id === "e1")!.expiry_reminded_for).toBeNull();
    // The next run tries again, and a delivered email is then marked once.
    deliveryStatus = "sent";
    const again = await scanProfessionalReminders(admin, new Date(`${TODAY}T06:00:00Z`));
    expect(again.recipients).toEqual(["in"]);
    expect(tables.individual_professional_evidence.find((e: any) => e.id === "e1")!.expiry_reminded_for).toBe("2026-11-01");
  });

  it("a SKIPPED send (provider not configured) is released too, and an injected sender can plant any outcome", async () => {
    const { scanProfessionalReminders } = await import("./reminders");
    deliveryStatus = "skipped";
    const tables = base();
    expect((await scanProfessionalReminders(fakeAdmin(tables), new Date(`${TODAY}T06:00:00Z`))).failed).toBe(1);
    expect(tables.individual_professional_evidence.find((e: any) => e.id === "e1")!.expiry_reminded_for).toBeNull();
    const thrown = await scanProfessionalReminders(fakeAdmin(base()), new Date(`${TODAY}T06:00:00Z`), async () => ({ sent: false, error: "boom" }));
    expect(thrown).toMatchObject({ sent: 0, failed: 1 });
  });

  const base = () => ({
    individual_live_entitlement: [{ user_id: "in", experience_code: "professional" }, { user_id: "out", experience_code: "professional" }],
    individual_membership: [{ user_id: "in", status: "active" }, { user_id: "out", status: "active" }, { user_id: "ended", status: "active" }],
    individual_professional_profile: [
      { id: "p1", user_id: "in", reminder_email: true },
      { id: "p2", user_id: "out", reminder_email: false },
      { id: "p3", user_id: "ended", reminder_email: true },
    ],
    individual_professional_evidence: [
      { id: "e1", user_id: "in", kind: "credential", title: "Licence", expires_on: "2026-11-01", expiry_reminded_for: null },
      { id: "e2", user_id: "out", kind: "credential", title: "Licence", expires_on: "2026-11-01", expiry_reminded_for: null },
      { id: "e3", user_id: "ended", kind: "credential", title: "Licence", expires_on: "2026-11-01", expiry_reminded_for: null },
    ],
  });

  it("emails only people who opted in AND hold Professional now, by email only, and writes no estate notification", async () => {
    const { scanProfessionalReminders } = await import("./reminders");
    const admin = fakeAdmin(base());
    const r = await scanProfessionalReminders(admin, new Date(`${TODAY}T06:00:00Z`));
    expect(r.recipients).toEqual(["in"]);
    expect(dispatched).toEqual([{ ids: ["in"], channels: ["email"] }]);
    expect(admin.writes.every(w => w.table.startsWith("individual_professional_"))).toBe(true);
  });

  it("emails nobody when the opt-in cannot be read (374 absent), and nobody while the release gate is off", async () => {
    const { scanProfessionalReminders } = await import("./reminders");
    expect((await scanProfessionalReminders(fakeAdmin(base(), { prefsError: { code: "42703", message: "x" } }), new Date(`${TODAY}T06:00:00Z`))).recipients).toEqual([]);
    expect((await scanProfessionalReminders(fakeAdmin(base(), { flag: false }), new Date(`${TODAY}T06:00:00Z`))).disabled).toBe(true);
    expect(dispatched).toEqual([]);
  });
});
