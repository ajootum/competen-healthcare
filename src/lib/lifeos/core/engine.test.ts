import { describe, expect, it } from "vitest";
import { type AccessContext, type LiveGrant, canRead, canWrite, hasScope, visibilityFilter } from "./access";
import { inputs, TransitionInput } from "./contracts";
import { LifeosError, fromDatabaseError } from "./errors";
import { MACHINES, assertCommitmentCanMove, assertTransition, missingForWork, resumeStatus } from "./machines";
import { RESOURCE_NAMES, RESOURCES, camelRow, snakeFields } from "./resources";
import { runRules, type RuleInput } from "./suggestions";
import { addDays, isMonday, mondayOf, todayIn } from "./time";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const REC = "33333333-3333-4333-8333-333333333333";
const WS = "44444444-4444-4444-8444-444444444444";

const ctx = (over: Partial<AccessContext> = {}): AccessContext => ({ individualId: ME, workspaceId: WS, role: "member", grants: [], ownRecordsOnly: false, ...over });
const theirs = { id: REC, owner_individual_id: THEM, access_scope: "private" };
const grant = (over: Partial<LiveGrant> = {}): LiveGrant => ({ ownerIndividualId: THEM, resourceType: "commitment", resourceId: REC, capability: "read", ...over });

describe("access: default private, explicit otherwise", () => {
  it("a member cannot read or write another person's private record", () => {
    expect(canRead(ctx(), "commitment", theirs)).toBe(false);
    expect(canWrite(ctx(), "commitment", theirs)).toBe(false);
  });
  it("an organisation admin or owner cannot read a member's private record", () => {
    expect(canRead(ctx({ role: "admin" }), "commitment", theirs)).toBe(false);
    expect(canRead(ctx({ role: "owner" }), "commitment", theirs)).toBe(false);
  });
  it("an app's token reaches only the approving person's own records, whatever their role or grants", () => {
    const app = (over: Partial<AccessContext> = {}) => ctx({ ownRecordsOnly: true, ...over });
    const shared = { ...theirs, access_scope: "workspace" };
    expect(canRead(app(), "commitment", shared)).toBe(false);
    expect(canWrite(app({ role: "admin" }), "commitment", shared)).toBe(false);
    expect(canRead(app({ grants: [grant()] }), "commitment", theirs)).toBe(false);
    expect(canRead(app(), "commitment", { ...theirs, owner_individual_id: ME })).toBe(true);
    expect(visibilityFilter(app({ grants: [grant()] }), "commitment")).toBe(`owner_individual_id.eq.${ME}`);
  });
  it("the owner reads and writes", () => {
    const mine = { ...theirs, owner_individual_id: ME };
    expect(canRead(ctx(), "commitment", mine)).toBe(true);
    expect(canWrite(ctx(), "commitment", mine)).toBe(true);
  });
  it("workspace scope is readable by members, writable by admins only", () => {
    const shared = { ...theirs, access_scope: "workspace" };
    expect(canRead(ctx(), "world", shared)).toBe(true);
    expect(canWrite(ctx(), "world", shared)).toBe(false);
    expect(canWrite(ctx({ role: "admin" }), "world", shared)).toBe(true);
  });
  it("a read grant reads and does not write. A write grant does both", () => {
    expect(canRead(ctx({ grants: [grant()] }), "commitment", theirs)).toBe(true);
    expect(canWrite(ctx({ grants: [grant()] }), "commitment", theirs)).toBe(false);
    expect(canWrite(ctx({ grants: [grant({ capability: "write" })] }), "commitment", theirs)).toBe(true);
  });
  it("a grant does not reach another record, another type or another owner's record", () => {
    expect(canRead(ctx({ grants: [grant({ resourceId: ME })] }), "commitment", theirs)).toBe(false);
    expect(canRead(ctx({ grants: [grant({ resourceType: "goal" })] }), "commitment", theirs)).toBe(false);
    expect(canRead(ctx({ grants: [grant({ ownerIndividualId: ME, resourceId: null })] }), "commitment", theirs)).toBe(false);
  });
  it("a type-wide grant reaches only that grantor's records", () => {
    expect(canRead(ctx({ grants: [grant({ resourceId: null })] }), "commitment", theirs)).toBe(true);
  });
  it("the list filter says the same as canRead", () => {
    const f = visibilityFilter(ctx({ grants: [grant()] }), "commitment");
    expect(f).toContain(`owner_individual_id.eq.${ME}`);
    expect(f).toContain("access_scope.eq.workspace");
    expect(f).toContain(`and(owner_individual_id.eq.${THEM},id.eq.${REC})`);
    expect(visibilityFilter(ctx({ grants: [grant({ resourceType: "goal" })] }), "commitment")).not.toContain(REC);
  });
  it("the list filter refuses anything that is not a UUID", () => {
    expect(() => visibilityFilter(ctx({ individualId: "x,or(id.not.is.null)" }), "commitment")).toThrow(LifeosError);
  });
  it("a session holds every scope. A delegated token holds only what it was given", () => {
    expect(hasScope({ kind: "session", individualId: ME, scopes: "*", clientId: null }, "commitments:write")).toBe(true);
    const t = { kind: "delegated_token" as const, individualId: ME, scopes: ["commitments:read"], clientId: "app" };
    expect(hasScope(t, "commitments:read")).toBe(true);
    expect(hasScope(t, "commitments:write")).toBe(false);
  });
});

describe("the commitment lifecycle", () => {
  const clarified = { status: "inbox", world_id: REC, important: true, urgent: false, scheduled_on: null };
  it("delegated is no state's target. Only creating a delegation reaches it", () => {
    for (const targets of Object.values(MACHINES.commitment)) expect(targets).not.toContain("delegated");
  });
  it("an unclarified commitment cannot start or be planned, and says what is missing", () => {
    const raw = { status: "inbox", world_id: null, important: null, urgent: null };
    expect(missingForWork(raw)).toEqual(["worldId", "important", "urgent"]);
    expect(() => assertCommitmentCanMove(raw, "in_progress", {})).toThrow(/Clarify/);
    expect(() => assertCommitmentCanMove(raw, "planned", { scheduledOn: "2026-11-09" })).toThrow(/Clarify/);
  });
  it("an unclarified commitment can still be done or dropped from the inbox", () => {
    const raw = { status: "inbox", world_id: null, important: null, urgent: null };
    expect(() => assertCommitmentCanMove(raw, "done", {})).not.toThrow();
    expect(() => assertCommitmentCanMove(raw, "dropped", {})).not.toThrow();
  });
  it("planning needs a date", () => {
    expect(() => assertCommitmentCanMove(clarified, "planned", {})).toThrow(/date/);
    expect(() => assertCommitmentCanMove(clarified, "planned", { scheduledOn: "2026-11-09" })).not.toThrow();
  });
  it("not urgent and not important are real answers, not missing ones", () => {
    expect(missingForWork({ world_id: REC, important: false, urgent: false })).toEqual([]);
  });
  it("an illegal move is refused with what is allowed", () => {
    try {
      assertTransition(MACHINES.commitment, "dropped", "done");
      expect.unreachable();
    } catch (e) {
      expect((e as LifeosError).code).toBe("invalid_transition");
      expect((e as LifeosError).details).toEqual({ from: "dropped", to: "done", allowed: ["inbox"] });
    }
  });
  it("after a delegation, a commitment returns to its owner according to what it has", () => {
    expect(resumeStatus({ ...clarified, scheduled_on: "2026-11-09" })).toBe("planned");
    expect(resumeStatus(clarified)).toBe("in_progress");
    expect(resumeStatus({ world_id: null })).toBe("inbox");
  });
  it("closed delegations and final reviews have nowhere to go", () => {
    expect(MACHINES.delegation.completed).toEqual([]);
    expect(MACHINES.weekly_review.final).toEqual([]);
    expect(MACHINES.permission_grant.revoked).toEqual([]);
  });
});

describe("contracts: input cannot set what the server owns", () => {
  for (const name of ["status", "ownerIndividualId", "provenanceSource", "version", "workspaceId", "quadrant", "createdBy"]) {
    it(`a commitment create refuses ${name}`, () => {
      expect(inputs.commitments.create.safeParse({ title: "x", [name]: "q1" }).success).toBe(false);
    });
    it(`a commitment patch refuses ${name}`, () => {
      expect(inputs.commitments.patch.safeParse({ expectedVersion: 1, [name]: "q1" }).success).toBe(false);
    });
  }
  it("capture needs only a title", () => {
    expect(inputs.commitments.create.safeParse({ title: "Call aunt" }).success).toBe(true);
    expect(inputs.commitments.create.safeParse({ title: "   " }).success).toBe(false);
  });
  it("a patch needs the version it was read at", () => {
    expect(inputs.commitments.patch.safeParse({ title: "x" }).success).toBe(false);
    expect(TransitionInput.safeParse({ to: "done" }).success).toBe(false);
  });
  it("a week starts on a Monday", () => {
    expect(inputs["weekly-plans"].create.safeParse({ weekStart: "2026-11-02" }).success).toBe(true);
    expect(inputs["weekly-plans"].create.safeParse({ weekStart: "2026-11-03" }).success).toBe(false);
  });
  it("a delegation names someone and has a follow-up date", () => {
    const base = { commitmentId: REC, followUpOn: "2026-11-09" };
    expect(inputs.delegations.create.safeParse(base).success).toBe(false);
    expect(inputs.delegations.create.safeParse({ ...base, delegateeLabel: "Night team" }).success).toBe(true);
    expect(inputs.delegations.create.safeParse({ commitmentId: REC, delegateeLabel: "Night team" }).success).toBe(false);
  });
  it("a block ends after it starts", () => {
    const t = { label: "x", startsAt: "2026-11-09T10:00:00Z" };
    expect(inputs["protected-blocks"].create.safeParse({ ...t, endsAt: "2026-11-09T09:00:00Z" }).success).toBe(false);
    expect(inputs["protected-blocks"].create.safeParse({ ...t, endsAt: "2026-11-09T11:00:00Z" }).success).toBe(true);
  });
  it("a grant is read or write on a named type", () => {
    const base = { granteeIndividualId: THEM, resourceType: "commitment", capability: "read" };
    expect(inputs["permission-grants"].create.safeParse(base).success).toBe(true);
    expect(inputs["permission-grants"].create.safeParse({ ...base, capability: "admin" }).success).toBe(false);
    expect(inputs["permission-grants"].create.safeParse({ ...base, resourceType: "lifeos_flag" }).success).toBe(false);
  });
});

describe("the output contract strips what is internal", () => {
  const stamps = {
    id: REC, schema_version: 1, workspace_id: WS, owner_individual_id: ME, access_scope: "private", provenance_source: "user", provenance_ref: null,
    version: 1, created_by: ME, updated_by: ME, created_at: "t", updated_at: "t", archived_at: null,
  };
  it("an integration connection never returns its credential reference", () => {
    const row = {
      ...stamps, provider: "x", granted_scopes: [], external_account_ref: null, last_synced_at: null, status: "active",
      credential_ref: "vault://secret",
    };
    expect(JSON.stringify(RESOURCES["integration-connections"].output.parse(camelRow(row)))).not.toContain("vault");
  });
  it("a delegation does not return its internal uniqueness column", () => {
    const row = {
      ...stamps, commitment_id: REC, delegatee_individual_id: null, delegatee_label: "x", follow_up_on: "d", expectations: null, closed_at: null,
      status: "active", active_key: true,
    };
    expect(RESOURCES.delegations.output.parse(camelRow(row))).not.toHaveProperty("activeKey");
  });
  it("snakeFields leaves undefined out, so a patch never clears what it did not mention", () => {
    expect(snakeFields({ scheduledOn: "d", notes: undefined, worldId: null })).toEqual({ scheduled_on: "d", world_id: null });
  });
  it("every resource has a lifeos_ table and a read scope", () => {
    for (const n of RESOURCE_NAMES) {
      expect(RESOURCES[n].table).toMatch(/^lifeos_/);
      expect(RESOURCES[n].scopes.read).toBeTruthy();
    }
  });
});

describe("database errors become contract errors and leak nothing", () => {
  it("maps the codes the engine relies on", () => {
    expect(fromDatabaseError({ code: "LO409" }).code).toBe("version_conflict");
    expect(fromDatabaseError({ code: "LO410" }).code).toBe("idempotency_key_reused");
    expect(fromDatabaseError({ code: "LO404" }).code).toBe("not_found");
    expect(fromDatabaseError({ code: "23505" }).code).toBe("conflict");
    expect(fromDatabaseError({ code: "23503" }).status).toBe(422);
    expect(fromDatabaseError({ code: "23514" }).status).toBe(422);
  });
  it("an unknown error says nothing of its cause", () => {
    const e = fromDatabaseError({ code: "42P01", message: 'relation "lifeos_secret" does not exist' });
    expect(e.code).toBe("unavailable");
    expect(e.message).not.toContain("lifeos_secret");
  });
});

describe("dates", () => {
  it("finds Monday, including from a Sunday", () => {
    expect(mondayOf("2026-11-05")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(isMonday("2026-11-02")).toBe(true);
  });
  it("today follows the person's time zone, and a bad zone falls back", () => {
    const at = new Date("2026-11-05T22:30:00Z");
    expect(todayIn("Africa/Kampala", at)).toBe("2026-11-06");
    expect(todayIn("UTC", at)).toBe("2026-11-05");
    expect(todayIn("Not/AZone", at)).toBe("2026-11-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("the Chief of Staff rules", () => {
  const today = "2026-11-05";
  const base: RuleInput = {
    today, weekStart: "2026-11-02", timeZone: "UTC", commitments: [], activeBlocks: [], activeDelegations: [], activePlan: null, bigRocks: [],
  };
  const c = (over: Record<string, unknown>) => ({
    id: REC, title: "Work", status: "planned", quadrant: "q2", urgent: false, version: 3, world_id: WS,
    scheduled_on: today, scheduled_time: "09:00:00", estimated_minutes: 30, archived_at: null, ...over,
  });

  it("proposes protected time for scheduled Q2, for its own time and length", () => {
    const [p] = runRules({ ...base, commitments: [c({})] });
    expect(p.kind).toBe("protect_q2");
    expect(p.materiality).toBe("material");
    const f = (p.proposedChange as { fields: Record<string, string> }).fields;
    expect(f.startsAt).toBe("2026-11-05T09:00:00.000Z");
    expect(f.endsAt).toBe("2026-11-05T09:30:00.000Z");
  });
  it("uses the person's zone for the proposed time", () => {
    const [p] = runRules({ ...base, timeZone: "Africa/Kampala", commitments: [c({})] });
    expect((p.proposedChange as { fields: Record<string, string> }).fields.startsAt).toBe("2026-11-05T06:00:00.000Z");
  });
  it("does not propose what is already protected", () => {
    expect(runRules({ ...base, commitments: [c({})], activeBlocks: [{ commitment_id: REC }] })).toEqual([]);
  });
  it("informational suggestions carry no change at all", () => {
    const out = runRules({
      ...base,
      commitments: [c({ id: ME, status: "inbox", quadrant: null, scheduled_on: null })],
      activeDelegations: [{ id: THEM, follow_up_on: today }],
    });
    expect(out.map(p => p.kind).sort()).toEqual(["clarify_inbox", "delegation_follow_up"]);
    expect(out.every(p => p.materiality === "informational" && p.proposedChange === null)).toBe(true);
  });
  it("does not chase a delegation before its follow-up date", () => {
    expect(runRules({ ...base, activeDelegations: [{ id: THEM, follow_up_on: "2026-11-06" }] })).toEqual([]);
  });
  it("proposes a Big Rock only for an active plan with none selected", () => {
    const plan = { id: THEM };
    expect(runRules({ ...base, activePlan: plan, commitments: [c({ scheduled_time: null })] }).map(p => p.kind)).toEqual(["big_rock"]);
    expect(runRules({ ...base, activePlan: plan, bigRocks: [{ status: "selected" }], commitments: [c({ scheduled_time: null })] })).toEqual([]);
    expect(runRules({ ...base, activePlan: plan, commitments: [c({ scheduled_time: null, scheduled_on: "2026-11-20" })] })).toEqual([]);
  });
  it("replan proposes only on request, and moves today's item to tomorrow at the version read", () => {
    const flex = c({ quadrant: "q4", scheduled_time: null });
    expect(runRules({ ...base, commitments: [flex] })).toEqual([]);
    const [p] = runRules({ ...base, commitments: [flex], interruption: true });
    expect(p.proposedChange).toEqual({ action: "patch", resource: "commitments", id: REC, expectedVersion: 3, fields: { scheduledOn: "2026-11-06" } });
  });
  it("replan never picks protected time, even when it is the only item today", () => {
    const out = runRules({ ...base, commitments: [c({ quadrant: "q4" })], activeBlocks: [{ commitment_id: REC }], interruption: true });
    expect(out.filter(p => p.kind === "replan")).toEqual([]);
  });
  it("replan moves the least important item, so important work holds its place", () => {
    const important = c({ id: ME, urgent: false, important: true, quadrant: "q2", scheduled_time: null });
    const minor = c({ id: THEM, urgent: false, important: false, quadrant: "q4", scheduled_time: null });
    const [p] = runRules({ ...base, commitments: [important, minor], interruption: true }).filter(x => x.kind === "replan");
    expect(p.targetId).toBe(THEM);
  });
  it("replan prefers an item that is not urgent", () => {
    const urgent = c({ id: ME, urgent: true, quadrant: "q3" });
    const calm = c({ id: THEM, urgent: false, quadrant: "q4" });
    const [p] = runRules({ ...base, commitments: [urgent, calm], interruption: true });
    expect(p.targetId).toBe(THEM);
  });
});
