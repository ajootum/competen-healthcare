/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Migration 850 / owner GO "HQ User Management, Invitations and Individual Profile Completion" (2 Nov 2026).
// The ordinary (HQ Add User) invitation: its validation, its fail-closed behaviour while 850 is absent, and the
// source an accepted invitation passes to the one grant engine.

const grantSpy = vi.fn();
vi.mock("./grants", async (orig) => {
  const real = await orig<typeof import("./grants")>();
  return { ...real, grantIndividualAccess: (...a: unknown[]) => { grantSpy(...a); return Promise.resolve({ ok: true, membership: "created", granted: ["scholar"], alreadyLive: [] }); } };
});

import { validateInvitation, isRefusal, createIndividualInvitation, acceptIndividualInvitation } from "./invitations";

const NOW = new Date("2026-11-02T10:00:00Z");
const base = { email: "a@example.org", experiences: ["scholar"], adultConfirmed: true };

describe("validateInvitation -- the ordinary basis", () => {
  it("REQUIRES an end date: no open-ended access through an ordinary invite", () => {
    const r = validateInvitation(base, "ordinary", NOW);
    expect(isRefusal(r) && r.code).toBe("END_DATE_REQUIRED");
  });
  it("allows up to 366 days ahead, refuses 367 and a past date", () => {
    expect(isRefusal(validateInvitation({ ...base, endsOn: "2027-11-03" }, "ordinary", NOW))).toBe(false);
    expect(isRefusal(validateInvitation({ ...base, endsOn: "2027-11-04" }, "ordinary", NOW))).toBe(true);
    expect(isRefusal(validateInvitation({ ...base, endsOn: "2026-11-01" }, "ordinary", NOW))).toBe(true);
    expect(isRefusal(validateInvitation({ ...base, endsOn: "2026-11-02" }, "ordinary", NOW))).toBe(false);
  });
  it("control: the pilot basis is unchanged -- the default, with the end date optional and no cap", () => {
    const r = validateInvitation(base, undefined, NOW);
    expect(isRefusal(r)).toBe(false);
    expect(!isRefusal(r) && r.basis).toBe("pilot");
    expect(isRefusal(validateInvitation({ ...base, endsOn: "2035-01-01" }, "pilot", NOW))).toBe(false);
  });
  it("composes the name from the typed parts, and a pilot invitation is always a pilot participant", () => {
    const r = validateInvitation({ ...base, endsOn: "2027-01-31", givenName: "Amina", middleNames: "Grace", familyName: "Okello", participation: "staff_tester", prefill: { profession: "Nurse", role: "x" } }, "ordinary", NOW);
    expect(r).toMatchObject({ name: "Amina Grace Okello", participation: "staff_tester", prefill: { profession: "Nurse" }, basis: "ordinary" });
    const p = validateInvitation({ ...base, participation: "staff_tester" }, "pilot", NOW);
    expect(p).toMatchObject({ participation: "pilot" });
  });
  it("defaults the participation of an ordinary invitation to regular and refuses an unknown one", () => {
    expect(validateInvitation({ ...base, endsOn: "2027-01-31" }, "ordinary", NOW)).toMatchObject({ participation: "regular" });
    expect(isRefusal(validateInvitation({ ...base, endsOn: "2027-01-31", participation: "admin" }, "ordinary", NOW))).toBe(true);
  });
  it("says Competen Scholar is for people aged 18 or over (the pilot is no longer named)", () => {
    const r = validateInvitation({ email: "a@example.org", experiences: ["scholar"] });
    expect(isRefusal(r) && r.message).toMatch(/^Competen Scholar is for people aged 18 or over/);
  });
});

/** A client whose answers depend on the table and on the selected columns, and that records every call. */
function client(opts: { cols850: boolean }) {
  const inserted: any[] = [];
  const upserts: any[] = [];
  const authCalls: string[] = [];
  const from = (t: string) => {
    let cols = "";
    const b: any = {};
    b.select = (c: string) => { cols = c; return b; };
    for (const m of ["eq", "ilike", "order", "limit", "update", "in", "is", "single", "maybeSingle"]) b[m] = () => b;
    b.insert = (row: any) => { inserted.push({ t, row }); return b; };
    b.upsert = (row: any) => { upserts.push({ t, row }); return Promise.resolve({ error: null }); };
    b.then = (ok: any, ko: any) => {
      let res: any = { data: [], error: null };
      if (t === "individual_invitation" && cols.includes("entitlement_source") && !opts.cols850) res = { data: null, error: { code: "42703" } };
      if (t === "individual_invitation" && cols.startsWith("id, expires_at")) res = { data: { id: "inv1", expires_at: "2026-11-16T00:00:00Z" }, error: null };
      return Promise.resolve(res).then(ok, ko);
    };
    return b;
  };
  const admin = {
    from,
    auth: { admin: { inviteUserByEmail: async () => { authCalls.push("invite"); return { data: { user: { id: "new" } }, error: null }; }, deleteUser: async () => { authCalls.push("delete"); return {}; } } },
  };
  return { admin: admin as any, inserted, upserts, authCalls };
}
const opts = { origin: "https://staging.example", delivery: "email" as const };

describe("createIndividualInvitation -- the ordinary path fails closed while 850 is absent", () => {
  const ordinary = validateInvitation({ ...base, endsOn: "2027-01-31", givenName: "Amina", familyName: "Okello" }, "ordinary", NOW) as any;

  it("refuses with NOT_SET_UP (503) and creates nothing: no identity, no invitation row", async () => {
    const c = client({ cols850: false });
    const r = await createIndividualInvitation(c.admin, ordinary, { id: "inviter" }, opts);
    expect(isRefusal(r) && [r.status, r.code]).toEqual([503, "NOT_SET_UP"]);
    expect(c.authCalls).toEqual([]);
    expect(c.inserted).toEqual([]);
    expect(c.upserts).toEqual([]);
  });

  it("control: with 850 present the same request is created, as hq_grant, with its prefill", async () => {
    const c = client({ cols850: true });
    const r = await createIndividualInvitation(c.admin, ordinary, { id: "inviter" }, opts);
    expect(isRefusal(r)).toBe(false);
    expect(c.inserted[0].row).toMatchObject({ entitlement_source: "hq_grant", prefill: null });
    // the Individual module writes nothing else: no profile details, no participation (those are HQ's, invitee-record.ts)
    expect(c.upserts).toEqual([]);
  });

  it("a PILOT invitation still works while 850 is absent: it simply leaves the new columns unwritten", async () => {
    const c = client({ cols850: false });
    const pilot = validateInvitation({ email: "a@example.org", experiences: ["professional"] }) as any;
    const r = await createIndividualInvitation(c.admin, pilot, { id: "inviter" }, opts);
    expect(isRefusal(r)).toBe(false);
    expect(Object.keys(c.inserted[0].row)).not.toContain("entitlement_source");
    expect(Object.keys(c.inserted[0].row)).not.toContain("prefill");
  });

  it("a pilot invitation carrying a prefill is also refused while 850 is absent", async () => {
    const c = client({ cols850: false });
    const pilot = validateInvitation({ email: "a@example.org", experiences: ["professional"], prefill: { profession: "Nurse" } }) as any;
    const r = await createIndividualInvitation(c.admin, pilot, { id: "inviter" }, opts);
    expect(isRefusal(r) && r.code).toBe("NOT_SET_UP");
    expect(c.authCalls).toEqual([]);
  });
});

describe("acceptIndividualInvitation -- the source is read apart from the live select", () => {
  const live = { id: "inv1", invited_email: "a@example.org", invite_scholar: true, invite_professional: false, adult_confirmed_at: "x", entitlement_ends_at: "2027-01-31T23:59:59.999Z", note: null, created_by: "inviter" };
  const user = { id: "u", email: "a@example.org", emailConfirmedAt: "x" };
  function accepting(source: { data: any; error: any }, liveSelects: string[] = []) {
    const from = (t: string) => {
      const b: any = {};
      b.select = (c: string) => { if (t === "individual_live_invitation") liveSelects.push(c); return b; };
      for (const m of ["eq", "order", "limit", "update", "in", "is", "single"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve(source);
      b.then = (ok: any, ko: any) => Promise.resolve(t === "individual_live_invitation" ? { data: [live], error: null } : { data: [{ id: "inv1" }], error: null }).then(ok, ko);
      return b;
    };
    return { from } as any;
  }
  beforeEach(() => grantSpy.mockClear());

  it("an hq_grant invitation passes source hq_grant to the grant engine", async () => {
    await acceptIndividualInvitation(accepting({ data: { entitlement_source: "hq_grant" }, error: null }), user);
    expect(grantSpy.mock.calls[0][1]).toMatchObject({ source: "hq_grant" });
  });
  it("a NULL source (a legacy invitation) is accepted as pilot", async () => {
    await acceptIndividualInvitation(accepting({ data: { entitlement_source: null }, error: null }), user);
    expect(grantSpy.mock.calls[0][1]).toMatchObject({ source: "pilot" });
  });
  it("⚠ with the column ABSENT (42703) the invitation is still accepted, as pilot -- never NO_INVITATION", async () => {
    const r = await acceptIndividualInvitation(accepting({ data: null, error: { code: "42703" } }), user);
    expect(isRefusal(r)).toBe(false);
    expect(grantSpy.mock.calls[0][1]).toMatchObject({ source: "pilot" });
  });
  it("the live select itself never names entitlement_source (a 42703 there would read as NO_INVITATION)", async () => {
    const selects: string[] = [];
    await acceptIndividualInvitation(accepting({ data: { entitlement_source: "hq_grant" }, error: null }, selects), user);
    expect(selects.join(" ")).not.toMatch(/entitlement_source|prefill/);
  });
  it("any other read failure refuses rather than guessing a source, and grants nothing", async () => {
    const r = await acceptIndividualInvitation(accepting({ data: null, error: { code: "57014" } }), user);
    expect(isRefusal(r) && r.code).toBe("UNAVAILABLE");
    expect(grantSpy).not.toHaveBeenCalled();
  });
});
