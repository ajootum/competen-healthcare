import { describe, it, expect } from "vitest";
import { subjectHospital, type Caller } from "@/lib/api-auth";

// subjectHospital decides WHICH TENANT a subject-bound row is written into. This suite exists for one
// question only: what does it do when the read fails?
//
// The answer used to be "silently return the CALLER's hospital", which filed the row under the wrong tenant
// — and, for a super_admin (hospitalId null), unscoped. Two callers compared that value against
// c.hospitalId to authorise the write, so a transient database fault turned a cross-tenant guard into a pass.
//
// ⚠ NO DATABASE. The failure is INJECTED through a stub client, because the point is what the function does
// with an error, not that errors exist — and an engine tested only against a healthy database is untested
// against the answer that matters. That also makes this suite runnable in CI, which the 177 harnesses that
// need service-role credentials are not.

/** Minimal stand-in for the PostgREST chain subjectHospital uses: .from().select().eq().maybeSingle() */
function stubCaller(result: { data: unknown; error: unknown }, hospitalId: string | null): Caller {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return {
    admin: { from: () => chain },
    userId: "caller-user",
    role: "hospital_admin",
    roles: ["hospital_admin"],
    hospitalId,
    organisationId: null,
    traceId: "trace",
  } as unknown as Caller;
}

const CALLER_HOSPITAL = "hospital-A";
const SUBJECT_HOSPITAL = "hospital-B";
const ok = (data: unknown) => ({ data, error: null });
const failed = { data: null, error: { message: "connection terminated unexpectedly" } };

describe("subjectHospital", () => {
  it("REFUSES when the read fails, instead of falling back to the caller's hospital", async () => {
    const c = stubCaller(failed, CALLER_HOSPITAL);
    const s = await subjectHospital(c, "op_patients", "patient-in-hospital-B");

    expect(s.ok).toBe(false);
    // The regression this guards: any shape that still yields a usable hospital id would let the caller's
    // tenant be written onto another tenant's subject.
    expect(s).not.toHaveProperty("hospitalId");
    if (!s.ok) expect(s.detail).toContain("connection terminated");
  });

  it("REFUSES for a super_admin too — whose fallback was null, i.e. an UNSCOPED row", async () => {
    const c = stubCaller(failed, null);
    const s = await subjectHospital(c, "op_patients", "patient-in-hospital-B");
    expect(s.ok).toBe(false);
  });

  it("returns the SUBJECT's hospital when the read succeeds", async () => {
    const c = stubCaller(ok({ hospital_id: SUBJECT_HOSPITAL }), CALLER_HOSPITAL);
    const s = await subjectHospital(c, "op_patients", "patient-in-hospital-B");
    expect(s).toEqual({ ok: true, hospitalId: SUBJECT_HOSPITAL });
  });

  it("keeps the caller fallback for a subject with NO tenant of its own (shared/master records)", async () => {
    const c = stubCaller(ok({ hospital_id: null }), CALLER_HOSPITAL);
    const s = await subjectHospital(c, "frameworks", "master-framework");
    expect(s).toEqual({ ok: true, hospitalId: CALLER_HOSPITAL });
  });

  it("keeps the caller fallback when NOT FOUND — deliberately still ok, only read failure was split out", async () => {
    const c = stubCaller(ok(null), CALLER_HOSPITAL);
    const s = await subjectHospital(c, "op_patients", "no-such-patient");
    expect(s).toEqual({ ok: true, hospitalId: CALLER_HOSPITAL });
  });

  it("does not read at all when there is no id", async () => {
    let read = false;
    const c = stubCaller(ok(null), CALLER_HOSPITAL);
    (c as unknown as { admin: { from: () => unknown } }).admin.from = () => { read = true; throw new Error("must not read"); };

    const s = await subjectHospital(c, "profiles", null);
    expect(s).toEqual({ ok: true, hospitalId: CALLER_HOSPITAL });
    expect(read).toBe(false);
  });

  it("honours a non-default column", async () => {
    const c = stubCaller(ok({ owner_hospital: SUBJECT_HOSPITAL }), CALLER_HOSPITAL);
    const s = await subjectHospital(c, "gov_risks", "risk-1", "owner_hospital");
    expect(s).toEqual({ ok: true, hospitalId: SUBJECT_HOSPITAL });
  });
});
