import { MeInput, TransitionInput, VersionInput } from "./contracts";
import { type AccessContext, canRead, canWrite, hasScope, managesWorkspace, ownsWorkspace, toLiveGrant, visibilityFilter } from "./access";
import { LifeosError, notFound } from "./errors";
import { MACHINES, assertCommitmentCanMove, assertTransition, missingForWork, resumeStatus } from "./machines";
import { RESOURCES, type ResourceDef, type ResourceName, camelRow, snakeFields } from "./resources";
import { RULES_GENERATOR, type ProposedChange, runRules } from "./suggestions";
import { addDays, mondayOf, todayIn } from "./time";
import type { ActorKind, LifeosStore, Op, Principal, Provenance, Ref, Row } from "./types";

// LIFEOS-API-001 sections 4, 5 and 8. The application service: authorisation, business rules and state changes.
//
// Every write is planned as a list of ops, then committed in one transaction by store.mutate. The first op is
// always the primary record, which is the one returned. Suggestion acceptance reuses the same planning functions,
// so an AI-proposed change obeys exactly the same rules as one the person typed.

export type RequestContext = {
  store: LifeosStore;
  principal: Principal;
  traceId: string;
  idempotencyKey: string | null;
  requestHash: string | null;
  /** The TXT records at a name. Injected, so the engine holds no network code. */
  resolveTxt?: (name: string) => Promise<string[][]>;
};

export type WriteResult = { data: unknown; replayed: boolean };

const INTERNAL_READ_LIMIT = 1000;
const LIST_DEFAULT = 50;

const actorKind = (p: Principal): ActorKind => (p.kind === "session" ? "user" : "integration");
const userProvenance = (p: Principal): Provenance => ({ source: p.kind === "session" ? "user" : "integration", ref: p.clientId });
const stamp = (p: Provenance) => ({ provenance_source: p.source, provenance_ref: p.ref });

export const present = (def: ResourceDef, row: Row) => def.output.parse(camelRow(row));

// ---- Access --------------------------------------------------------------------------------------------

/**
 * Answers not_found, not forbidden, to anyone who is not an active member: they learn nothing about whether the
 * workspace exists. A workspace of a suspended or closed tenant refuses its members. A personal workspace has no
 * tenant, so it cannot be taken away by one.
 */
export async function loadAccess(store: LifeosStore, principal: Principal, workspaceId: string): Promise<AccessContext> {
  const [m] = await store.where("lifeos_membership", { workspace_id: workspaceId, individual_id: principal.individualId }, { limit: 1 });
  if (!m || m.status !== "active" || m.archived_at) throw notFound();
  const ws = await store.get("lifeos_workspace", workspaceId);
  if (!ws || ws.archived_at) throw notFound();
  if (ws.status !== "active") throw new LifeosError("forbidden", "This workspace is not active.");
  if (ws.tenant_id) {
    const tenant = await store.get("lifeos_tenant", String(ws.tenant_id));
    if (!tenant || tenant.status !== "active") throw new LifeosError("forbidden", "This organisation is not active.");
  }
  const grants = await store.liveGrants(workspaceId, principal.individualId);
  return { individualId: principal.individualId, workspaceId, role: m.role as AccessContext["role"], grants: grants.map(toLiveGrant) };
}

/** Reads one record the caller may read, or answers not_found. */
async function readable(c: RequestContext, ctx: AccessContext, def: ResourceDef, id: string): Promise<Row> {
  const row = await c.store.get(def.table, id);
  if (!row || row.workspace_id !== ctx.workspaceId || !canRead(ctx, def.entity, row, def.extraReaderColumn)) throw notFound();
  return row;
}

async function writable(c: RequestContext, ctx: AccessContext, def: ResourceDef, id: string): Promise<Row> {
  const row = await readable(c, ctx, def, id);
  if (!canWrite(ctx, def.entity, row)) throw new LifeosError("forbidden", "You can read this record but not change it.");
  if (row.archived_at) throw new LifeosError("conflict", "This record is archived. Restore it first.");
  return row;
}

async function assertRefsReadable(c: RequestContext, ctx: AccessContext, def: ResourceDef, fields: Record<string, unknown>) {
  for (const [field, resource] of Object.entries(def.refs ?? {})) {
    const id = fields[field];
    if (id === null || id === undefined) continue;
    try {
      await readable(c, ctx, RESOURCES[resource], String(id));
    } catch (e) {
      if (e instanceof LifeosError && e.code === "not_found") {
        throw new LifeosError("validation_failed", `${field} does not refer to a record you can use in this workspace.`, { details: { field } });
      }
      throw e;
    }
  }
}

// ---- The write path ------------------------------------------------------------------------------------

/**
 * Replay is checked before planning, because a retry of a transition that already happened would otherwise fail
 * planning with invalid_transition. If planning fails, the key is checked once more: a concurrent first attempt
 * may have committed in between. lifeos_mutate holds the final word, in the same transaction as the writes.
 */
async function commit(c: RequestContext, workspaceId: string, def: ResourceDef | null, plan: () => Promise<Op[]>): Promise<WriteResult> {
  const replay = async (): Promise<WriteResult | null> => {
    if (!c.idempotencyKey) return null;
    const hit = await c.store.peekIdempotency(c.principal.individualId, c.idempotencyKey);
    if (!hit) return null;
    if (hit.requestHash !== c.requestHash) {
      throw new LifeosError("idempotency_key_reused", "This Idempotency-Key was already used for a different request.");
    }
    return { data: await presentRefs(c, workspaceId, def, hit.refs), replayed: true };
  };
  const first = await replay();
  if (first) return first;

  let ops: Op[];
  try {
    ops = await plan();
  } catch (e) {
    const again = await replay();
    if (again) return again;
    throw e;
  }
  if (ops.length === 0) return { data: [], replayed: false };
  const res = await c.store.mutate({
    actor: c.principal.individualId, actorKind: actorKind(c.principal),
    idempotencyKey: c.idempotencyKey, requestHash: c.requestHash, traceId: c.traceId, ops,
  });
  if (res.replayed) return { data: await presentRefs(c, workspaceId, def, res.refs), replayed: true };
  return { data: def ? present(def, res.rows[0]) : res.refs, replayed: false };
}

/**
 * A replay goes through the same access check as a read. Holding the key proves the person once made this request,
 * not that they may still see the record. With no def the refs are ids only, so a retried leave still succeeds.
 */
async function presentRefs(c: RequestContext, workspaceId: string, def: ResourceDef | null, refs: Ref[]) {
  if (!def) return refs;
  const primary = refs.find(r => r.t === def.table) ?? refs[0];
  if (!primary) throw notFound();
  const ctx = await loadAccess(c.store, c.principal, workspaceId);
  return present(def, await readable(c, ctx, def, primary.id));
}

/** Commits ops on a table outside any workspace, and returns its row. The caller has already checked authority. */
export async function commitOps(c: RequestContext, table: string, plan: () => Promise<Op[]>): Promise<WriteResult> {
  const r = await commit(c, "", null, plan);
  const ref = (r.data as Ref[]).find(x => x.t === table);
  const row = ref ? await c.store.get(table, ref.id) : null;
  if (!row) throw notFound();
  return { data: row, replayed: r.replayed };
}

const update = (def: ResourceDef, row: Row, values: Row, expectedVersion?: number): Op => ({
  t: def.table, op: "update", id: String(row.id), workspace_id: String(row.workspace_id),
  ...(expectedVersion ? { expected_version: expectedVersion } : {}), values,
});

// ---- Planning: create ------------------------------------------------------------------------------------

type Plan = { ops: Op[]; id: string };

async function planCreate(c: RequestContext, ctx: AccessContext, def: ResourceDef, input: unknown, prov: Provenance): Promise<Plan> {
  if (!def.create) throw new LifeosError("method_not_allowed", "This resource cannot be created through the API.");
  const parsed = def.create.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  const fields = parsed.data as Record<string, unknown>;
  await assertRefsReadable(c, ctx, def, fields);
  const id = crypto.randomUUID();
  const base: Row = { id, workspace_id: ctx.workspaceId, owner_individual_id: ctx.individualId, ...stamp(prov), ...snakeFields(fields) };

  switch (def.name) {
    case "commitments": {
      const ready = missingForWork(base).length === 0 && !!base.scheduled_on;
      return { id, ops: [{ t: def.table, op: "insert", values: { ...base, status: ready ? "planned" : "inbox" } }] };
    }
    case "delegations":
      return planDelegate(c, ctx, id, base, prov);
    case "big-rocks": {
      const plan = await readable(c, ctx, RESOURCES["weekly-plans"], String(fields.weeklyPlanId));
      if (!canWrite(ctx, "weekly_plan", plan)) throw new LifeosError("forbidden", "Only the owner of this plan can add to it.");
      return { id, ops: [{ t: def.table, op: "insert", values: base }] };
    }
    case "permission-grants": {
      if (fields.granteeIndividualId === ctx.individualId) throw new LifeosError("validation_failed", "You already have access to your own records.");
      if (fields.resourceId) await assertOwnsResource(c, ctx, String(fields.resourceType), String(fields.resourceId));
      return { id, ops: [{ t: def.table, op: "insert", values: base }] };
    }
    default:
      return { id, ops: [{ t: def.table, op: "insert", values: base }] };
  }
}

async function assertOwnsResource(c: RequestContext, ctx: AccessContext, resourceType: string, resourceId: string) {
  const def = Object.values(RESOURCES).find(r => r.entity === resourceType);
  const row = def ? await c.store.get(def.table, resourceId) : null;
  if (!row || row.workspace_id !== ctx.workspaceId || row.owner_individual_id !== ctx.individualId) {
    throw new LifeosError("validation_failed", "You can only share a record you own in this workspace.");
  }
}

const COMMITMENT = RESOURCES.commitments;
const DELEGATION = RESOURCES.delegations;
const GRANT = RESOURCES["permission-grants"];

/**
 * Delegation keeps ownership: the commitment's owner does not change. A delegatee who is a LifeOS member receives
 * read grants on these two records only, in the same transaction, and closing the delegation revokes them.
 */
async function planDelegate(c: RequestContext, ctx: AccessContext, id: string, base: Row, prov: Provenance): Promise<Plan> {
  const commitment = await readable(c, ctx, COMMITMENT, String(base.commitment_id));
  if (commitment.owner_individual_id !== ctx.individualId) throw new LifeosError("forbidden", "Only the owner of a commitment can delegate it.");
  if (commitment.archived_at) throw new LifeosError("conflict", "This record is archived. Restore it first.");
  if (!["inbox", "planned", "in_progress"].includes(String(commitment.status))) {
    throw new LifeosError("invalid_transition", `A ${String(commitment.status)} commitment cannot be delegated.`);
  }
  const missing = missingForWork(commitment);
  if (missing.length) throw new LifeosError("invalid_transition", "Clarify this commitment first: choose its world, importance and urgency.", { details: { missing } });
  const ops: Op[] = [
    { t: DELEGATION.table, op: "insert", values: base },
    update(COMMITMENT, commitment, { status: "delegated", ...stamp(prov) }),
  ];
  const grantee = base.delegatee_individual_id as string | null | undefined;
  if (grantee && grantee !== ctx.individualId) {
    const grant = (resource_type: string, resource_id: unknown): Op => ({
      t: GRANT.table, op: "insert",
      values: {
        workspace_id: ctx.workspaceId, owner_individual_id: ctx.individualId, grantee_individual_id: grantee,
        resource_type, resource_id, capability: "read", provenance_source: "system", provenance_ref: id,
      },
    });
    ops.push(grant("commitment", commitment.id), grant("delegation", id));
  }
  return { id, ops };
}

async function planCloseDelegation(c: RequestContext, ctx: AccessContext, delegation: Row, to: "completed" | "cancelled", prov: Provenance, expected?: number): Promise<Op[]> {
  const ops: Op[] = [update(DELEGATION, delegation, { status: to, closed_at: new Date().toISOString(), ...stamp(prov) }, expected)];
  const grants = await c.store.where(GRANT.table, { workspace_id: ctx.workspaceId, provenance_ref: String(delegation.id), status: "active" }, { limit: 10 });
  for (const g of grants) ops.push(update(GRANT, g, { status: "revoked", revoked_at: new Date().toISOString() }));
  return ops;
}

// ---- Planning: patch and transition ------------------------------------------------------------------------

async function planPatch(c: RequestContext, ctx: AccessContext, def: ResourceDef, id: string, input: unknown, prov: Provenance): Promise<Plan> {
  if (!def.patch) throw new LifeosError("method_not_allowed", "This resource cannot be edited through the API.");
  const parsed = def.patch.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  const { expectedVersion, ...fields } = parsed.data as { expectedVersion: number } & Record<string, unknown>;
  if (Object.keys(fields).length === 0) throw new LifeosError("validation_failed", "Nothing to change.");
  const row = await writable(c, ctx, def, id);
  if (fields.accessScope !== undefined && fields.accessScope !== row.access_scope && row.owner_individual_id !== ctx.individualId) {
    throw new LifeosError("forbidden", "Only the owner can change who can see this record.");
  }
  if (def.name === "weekly-reviews" && row.status === "final") throw new LifeosError("conflict", "A finalised review cannot be edited.");
  await assertRefsReadable(c, ctx, def, fields);
  return { id, ops: [update(def, row, { ...snakeFields(fields), ...stamp(prov) }, expectedVersion)] };
}

async function planTransition(c: RequestContext, ctx: AccessContext, def: ResourceDef, id: string, input: unknown, prov: Provenance): Promise<Plan> {
  if (!def.machine) throw new LifeosError("method_not_allowed", "This resource has no lifecycle to change through the API.");
  const parsed = TransitionInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  const { to, expectedVersion, scheduledOn, scheduledTime } = parsed.data;
  if (def.name !== "commitments" && (scheduledOn !== undefined || scheduledTime !== undefined)) {
    throw new LifeosError("validation_failed", "scheduledOn and scheduledTime apply only to a commitment.");
  }
  const row = await writable(c, ctx, def, id);
  const from = String(row.status);
  const base: Row = { status: to, ...stamp(prov) };

  switch (def.name) {
    case "commitments": {
      assertCommitmentCanMove(row, to, { scheduledOn });
      const values: Row = { ...base, completed_at: to === "done" ? new Date().toISOString() : null };
      if (scheduledOn !== undefined) values.scheduled_on = scheduledOn;
      if (scheduledTime !== undefined) values.scheduled_time = scheduledTime;
      const ops: Op[] = [update(def, row, values, expectedVersion)];
      if (from === "delegated") {
        if (row.owner_individual_id !== ctx.individualId) throw new LifeosError("forbidden", "Only the owner can close a delegation.");
        // Completing or dropping a delegated commitment closes the delegation, so nothing is left waiting on it.
        const [active] = await c.store.where(DELEGATION.table, { workspace_id: ctx.workspaceId, commitment_id: id, status: "active" }, { limit: 1 });
        if (active) ops.push(...await planCloseDelegation(c, ctx, active, to === "done" ? "completed" : "cancelled", prov));
      }
      return { id, ops };
    }
    case "delegations": {
      assertTransition(MACHINES.delegation, from, to);
      if (row.owner_individual_id !== ctx.individualId) throw new LifeosError("forbidden", "Only the owner can close a delegation.");
      const ops = await planCloseDelegation(c, ctx, row, to as "completed" | "cancelled", prov, expectedVersion);
      // Follow-through: the commitment returns to its owner, who decides when it is done.
      const commitment = await c.store.get(COMMITMENT.table, String(row.commitment_id));
      if (commitment && commitment.status === "delegated") ops.push(update(COMMITMENT, commitment, { status: resumeStatus(commitment), ...stamp(prov) }));
      return { id, ops };
    }
    case "weekly-reviews": {
      assertTransition(MACHINES.weekly_review, from, to);
      if (row.owner_individual_id !== ctx.individualId) throw new LifeosError("forbidden", "Only the owner can finalise a review.");
      const snapshot = await weekSnapshot(c, ctx, row);
      return { id, ops: [update(def, row, { ...base, snapshot, finalised_at: new Date().toISOString() }, expectedVersion)] };
    }
    case "permission-grants": {
      assertTransition(MACHINES.permission_grant, from, to);
      if (row.owner_individual_id !== ctx.individualId) throw new LifeosError("forbidden", "Only the person who gave this access can revoke it.");
      return { id, ops: [update(def, row, { ...base, revoked_at: new Date().toISOString() }, expectedVersion)] };
    }
    default:
      assertTransition(def.machine, from, to);
      return { id, ops: [update(def, row, base, expectedVersion)] };
  }
}

/** Counts for the week under review, computed from the person's own records and stored when it is finalised. */
async function weekSnapshot(c: RequestContext, ctx: AccessContext, review: Row): Promise<Row> {
  const owner = String(review.owner_individual_id);
  const weekStart = String(review.week_start);
  const weekEnd = addDays(weekStart, 6);
  const scope = { workspace_id: ctx.workspaceId, owner_individual_id: owner };
  const commitments = (await c.store.where(COMMITMENT.table, scope, { limit: INTERNAL_READ_LIMIT }))
    .filter(x => !x.archived_at && x.scheduled_on && String(x.scheduled_on) >= weekStart && String(x.scheduled_on) <= weekEnd);
  const done = new Set(commitments.filter(x => x.status === "done").map(x => x.id));
  const [plan] = await c.store.where(RESOURCES["weekly-plans"].table, { ...scope, week_start: weekStart }, { limit: 1 });
  const rocks = plan
    ? (await c.store.where(RESOURCES["big-rocks"].table, { workspace_id: ctx.workspaceId, weekly_plan_id: String(plan.id) }, { limit: INTERNAL_READ_LIMIT })).filter(r => r.status === "selected")
    : [];
  const blocks = (await c.store.where(RESOURCES["protected-blocks"].table, { ...scope, status: "active" }, { limit: INTERNAL_READ_LIMIT }))
    .filter(b => !b.archived_at && String(b.starts_at).slice(0, 10) >= weekStart && String(b.starts_at).slice(0, 10) <= weekEnd);
  return {
    weekStart, weekEnd,
    committed: commitments.length,
    completed: done.size,
    open: commitments.length - done.size,
    bigRocksSelected: rocks.length,
    bigRocksAchieved: rocks.filter(r => done.has(r.commitment_id)).length,
    protectedBlocks: blocks.length,
  };
}

const validationError = (error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }) =>
  new LifeosError("validation_failed", "Some of those values are not valid.", {
    details: error.issues.map(i => ({ path: i.path.map(String).join("."), message: i.message })),
  });

// ---- The public service --------------------------------------------------------------------------------------

const assertScope = (p: Principal, scope: string | undefined) => {
  if (!scope || !hasScope(p, scope)) throw new LifeosError("forbidden", "This access does not include that action.");
};

export async function getMe(c: RequestContext) {
  const individual = await c.store.get("lifeos_individual", c.principal.individualId);
  if (!individual) throw notFound();
  const entitlements = await c.store.where("lifeos_live_entitlement", { individual_id: c.principal.individualId }, { limit: 50 });
  return { individual, entitlements, workspaces: await listWorkspaces(c) };
}

/** A person's own settings. They own this record, so no workspace access applies. */
export async function updateMe(c: RequestContext, input: unknown): Promise<Row> {
  const parsed = MeInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  const { expectedVersion, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) throw new LifeosError("validation_failed", "Nothing to change.");
  await commit(c, "", null, async () => [{
    t: "lifeos_individual", op: "update", id: c.principal.individualId, expected_version: expectedVersion,
    values: { ...snakeFields(fields), provenance_source: "user" },
  }]);
  const row = await c.store.get("lifeos_individual", c.principal.individualId);
  if (!row) throw notFound();
  return row;
}

/** A person's own choice to stop. Only access they chose themselves can be ended here. Their records stay. */
export async function endOwnEntitlement(c: RequestContext, id: string, input: unknown): Promise<Row> {
  const parsed = VersionInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  const row = await c.store.get("lifeos_entitlement", id);
  if (!row || row.individual_id !== c.principal.individualId) throw notFound();
  if (row.source !== "competen_individual") throw new LifeosError("forbidden", "This access was given to you, so it is ended by whoever gave it.");
  if (row.status !== "active") throw new LifeosError("conflict", "This access has already ended.");
  await commit(c, "", null, async () => [{
    t: "lifeos_entitlement", op: "update", id, expected_version: parsed.data.expectedVersion,
    values: { status: "revoked", revoked_at: new Date().toISOString(), provenance_source: "user" },
  }]);
  const after = await c.store.get("lifeos_entitlement", id);
  if (!after) throw notFound();
  return after;
}

export async function listWorkspaces(c: RequestContext): Promise<Row[]> {
  const memberships = await c.store.where("lifeos_membership", { individual_id: c.principal.individualId, status: "active" }, { limit: INTERNAL_READ_LIMIT });
  const rows = await Promise.all(memberships.map(m => c.store.get("lifeos_workspace", String(m.workspace_id))));
  return rows.filter((w): w is Row => !!w && !w.archived_at);
}

export async function getWorkspace(c: RequestContext, workspaceId: string): Promise<Row> {
  await loadAccess(c.store, c.principal, workspaceId);
  const ws = await c.store.get("lifeos_workspace", workspaceId);
  if (!ws) throw notFound();
  return ws;
}

export async function listMembers(c: RequestContext, workspaceId: string): Promise<Row[]> {
  const ctx = await loadAccess(c.store, c.principal, workspaceId);
  if (!managesWorkspace(ctx.role)) throw new LifeosError("forbidden", "Only a workspace owner or admin can list members.");
  return c.store.where("lifeos_membership", { workspace_id: workspaceId }, { limit: INTERNAL_READ_LIMIT });
}

/** Leaving ends access to this workspace. The personal workspace is separate and untouched. */
export async function leaveWorkspace(c: RequestContext, workspaceId: string): Promise<WriteResult> {
  return commit(c, workspaceId, null, async () => {
    await loadAccess(c.store, c.principal, workspaceId);
    const ws = await c.store.get("lifeos_workspace", workspaceId);
    if (!ws || ws.kind === "personal") throw new LifeosError("conflict", "You cannot leave your personal workspace.");
    const [m] = await c.store.where("lifeos_membership", { workspace_id: workspaceId, individual_id: c.principal.individualId }, { limit: 1 });
    if (ownsWorkspace(String(m.role))) throw new LifeosError("conflict", "The owner of an organisation workspace cannot leave it.");
    const given = await c.store.where(GRANT.table, { workspace_id: workspaceId, owner_individual_id: c.principal.individualId, status: "active" }, { limit: INTERNAL_READ_LIMIT });
    return [
      { t: "lifeos_membership", op: "update", id: String(m.id), workspace_id: workspaceId, values: { status: "left", provenance_source: "user" } },
      ...given.map(g => update(GRANT, g, { status: "revoked", revoked_at: new Date().toISOString() })),
    ];
  });
}

export type ListParams = Record<string, string | number | undefined>;

const encodeCursor = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function decodeCursor(raw: string): { at: string; id: string } {
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
    const at = String(v.at);
    const id = String(v.id);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(at) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("bad");
    return { at, id };
  } catch {
    throw new LifeosError("validation_failed", "That cursor is not valid.");
  }
}
function decodeSeqCursor(raw: string): { seq: number } {
  const seq = Number(raw);
  if (!Number.isSafeInteger(seq) || seq < 0) throw new LifeosError("validation_failed", "That cursor is not valid.");
  return { seq };
}

export async function listResource(c: RequestContext, workspaceId: string, name: ResourceName, params: ListParams) {
  const def = RESOURCES[name];
  assertScope(c.principal, def.scopes.read);
  const ctx = await loadAccess(c.store, c.principal, workspaceId);
  const filters: Record<string, string> = {};
  for (const [field, column] of Object.entries(def.filters)) {
    const v = params[field];
    if (v !== undefined) filters[column] = String(v);
  }
  const limit = Number(params.limit ?? LIST_DEFAULT);
  const rows = await c.store.list(def.table, {
    workspaceId, filters, visibility: visibilityFilter(ctx, def.entity, def.extraReaderColumn), hasArchive: def.hasArchive,
    range: def.name === "commitments" && (params.scheduledFrom || params.scheduledTo)
      ? { column: "scheduled_on", from: params.scheduledFrom as string | undefined, to: params.scheduledTo as string | undefined }
      : null,
    includeArchived: params.includeArchived === "true", orderColumn: "created_at",
    cursor: params.cursor ? decodeCursor(String(params.cursor)) : null, limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: page.map(r => present(def, r)),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
  };
}

export async function getResource(c: RequestContext, workspaceId: string, name: ResourceName, id: string) {
  const def = RESOURCES[name];
  assertScope(c.principal, def.scopes.read);
  const ctx = await loadAccess(c.store, c.principal, workspaceId);
  return present(def, await readable(c, ctx, def, id));
}

export async function createResource(c: RequestContext, workspaceId: string, name: ResourceName, input: unknown): Promise<WriteResult> {
  const def = RESOURCES[name];
  assertScope(c.principal, def.scopes.write);
  return commit(c, workspaceId, def, async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    return (await planCreate(c, ctx, def, input, userProvenance(c.principal))).ops;
  });
}

export async function patchResource(c: RequestContext, workspaceId: string, name: ResourceName, id: string, input: unknown): Promise<WriteResult> {
  const def = RESOURCES[name];
  assertScope(c.principal, def.scopes.write);
  return commit(c, workspaceId, def, async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    return (await planPatch(c, ctx, def, id, input, userProvenance(c.principal))).ops;
  });
}

export async function transitionResource(c: RequestContext, workspaceId: string, name: ResourceName, id: string, input: unknown): Promise<WriteResult> {
  const def = RESOURCES[name];
  assertScope(c.principal, def.scopes.write);
  return commit(c, workspaceId, def, async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    return (await planTransition(c, ctx, def, id, input, userProvenance(c.principal))).ops;
  });
}

/** Soft removal only. Nothing in LifeOS is hard-deleted through the API. */
export async function setArchived(c: RequestContext, workspaceId: string, name: ResourceName, id: string, archived: boolean, input: unknown): Promise<WriteResult> {
  const def = RESOURCES[name];
  assertScope(c.principal, def.scopes.write);
  if (!def.hasArchive) throw new LifeosError("method_not_allowed", "This resource cannot be archived.");
  const parsed = VersionInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  return commit(c, workspaceId, def, async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    const row = await readable(c, ctx, def, id);
    if (!canWrite(ctx, def.entity, row)) throw new LifeosError("forbidden", "You can read this record but not change it.");
    if (!!row.archived_at === archived) throw new LifeosError("conflict", archived ? "This record is already archived." : "This record is not archived.");
    if (archived && def.name === "delegations" && row.status === "active") throw new LifeosError("conflict", "Close this delegation before archiving it.");
    return [update(def, row, { archived_at: archived ? new Date().toISOString() : null }, parsed.data.expectedVersion)];
  });
}

/** The caller's own audit trail in this workspace. Rows hold field names and statuses, never content. */
export async function listAudit(c: RequestContext, workspaceId: string, params: ListParams) {
  await loadAccess(c.store, c.principal, workspaceId);
  const filters: Record<string, string> = { owner_individual_id: c.principal.individualId };
  if (params.entityType) filters.entity_type = String(params.entityType);
  if (params.entityId) filters.entity_id = String(params.entityId);
  const limit = Number(params.limit ?? LIST_DEFAULT);
  const rows = await c.store.list("lifeos_audit_event", {
    workspaceId, filters, visibility: null, hasArchive: false, orderColumn: "seq",
    cursor: params.cursor ? decodeSeqCursor(String(params.cursor)) : null, limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > limit && last ? String(last.seq) : null };
}

// ---- The Chief of Staff boundary ------------------------------------------------------------------------------

const SUGGESTION = RESOURCES.suggestions;

/**
 * Reads the caller's own records in ONE workspace and writes ONLY suggestion rows. There is no parameter that could
 * widen this to another workspace or another person.
 */
export async function generateSuggestions(c: RequestContext, workspaceId: string, opts: { interruption?: boolean }): Promise<{ data: unknown[]; replayed: boolean }> {
  assertScope(c.principal, SUGGESTION.scopes.write);
  const res = await commit(c, workspaceId, null, async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    const me = await c.store.get("lifeos_individual", ctx.individualId);
    const timeZone = String(me?.timezone ?? "UTC");
    const today = todayIn(timeZone);
    const weekStart = mondayOf(today);
    const scope = { workspace_id: workspaceId, owner_individual_id: ctx.individualId };

    const [commitments, activeBlocks, activeDelegations, plans, existing] = await Promise.all([
      c.store.where(COMMITMENT.table, scope, { limit: INTERNAL_READ_LIMIT }),
      c.store.where(RESOURCES["protected-blocks"].table, { ...scope, status: "active" }, { limit: INTERNAL_READ_LIMIT }),
      c.store.where(DELEGATION.table, { ...scope, status: "active" }, { limit: INTERNAL_READ_LIMIT }),
      c.store.where(RESOURCES["weekly-plans"].table, { ...scope, week_start: weekStart, status: "active" }, { limit: 1 }),
      c.store.where(SUGGESTION.table, scope, { limit: INTERNAL_READ_LIMIT }),
    ]);
    const activePlan = plans[0] ?? null;
    const bigRocks = activePlan
      ? await c.store.where(RESOURCES["big-rocks"].table, { workspace_id: workspaceId, weekly_plan_id: String(activePlan.id) }, { limit: INTERNAL_READ_LIMIT })
      : [];
    const seen = new Set(existing.map(s => s.dedupe_key));
    return runRules({ today, weekStart, timeZone, commitments, activeBlocks, activeDelegations, activePlan, bigRocks, interruption: opts.interruption })
      .filter(p => !seen.has(p.dedupeKey))
      .map(p => ({
        t: SUGGESTION.table, op: "insert" as const,
        values: {
          id: crypto.randomUUID(), workspace_id: workspaceId, owner_individual_id: ctx.individualId, kind: p.kind, materiality: p.materiality,
          title: p.title, rationale: p.rationale, target_type: p.targetType, target_id: p.targetId, proposed_change: p.proposedChange,
          generator: RULES_GENERATOR, dedupe_key: p.dedupeKey, provenance_source: "system" as const,
        },
      }));
  });
  // A replay reaches here without planning, so access is checked again before anything is returned.
  const ctx = await loadAccess(c.store, c.principal, workspaceId);
  const rows = await Promise.all((res.data as Ref[]).map(r => c.store.get(SUGGESTION.table, r.id)));
  return {
    data: rows.filter((r): r is Row => !!r && canRead(ctx, SUGGESTION.entity, r)).map(r => present(SUGGESTION, r)),
    replayed: res.replayed,
  };
}

async function ownedProposal(c: RequestContext, ctx: AccessContext, id: string): Promise<Row> {
  const row = await readable(c, ctx, SUGGESTION, id);
  if (row.owner_individual_id !== ctx.individualId) throw new LifeosError("forbidden", "Only the person a suggestion is for can decide on it.");
  if (row.status !== "proposed") throw new LifeosError("conflict", `This suggestion is already ${String(row.status)}.`);
  return row;
}

export async function dismissSuggestion(c: RequestContext, workspaceId: string, id: string): Promise<WriteResult> {
  assertScope(c.principal, SUGGESTION.scopes.write);
  return commit(c, workspaceId, SUGGESTION, async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    const row = await ownedProposal(c, ctx, id);
    return [update(SUGGESTION, row, { status: "dismissed", decided_at: new Date().toISOString(), decided_by: ctx.individualId }, Number(row.version))];
  });
}

/**
 * The person's decision. The change goes through the same planning as if they had made it by hand, with provenance
 * ai_suggestion, and commits in one transaction with the decision. A session-only act: a delegated token cannot
 * approve material changes on the person's behalf.
 */
export async function acceptSuggestion(c: RequestContext, workspaceId: string, id: string): Promise<WriteResult> {
  assertScope(c.principal, SUGGESTION.scopes.write);
  if (c.principal.kind !== "session") throw new LifeosError("forbidden", "Accepting a suggestion needs the person, signed in.");
  return commit(c, workspaceId, SUGGESTION, async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    const row = await ownedProposal(c, ctx, id);
    const change = row.proposed_change as ProposedChange | null;
    if (!change) throw new LifeosError("conflict", "This suggestion has nothing to apply. Dismiss it when you have dealt with it.");
    const prov: Provenance = { source: "ai_suggestion", ref: id };
    let plan: Plan;
    if (change.action === "create") {
      plan = await planCreate(c, ctx, RESOURCES[change.resource], change.fields, prov);
    } else {
      // A replan is refused if time has since been protected for this commitment. Protected time never moves by proposal.
      const blocks = await c.store.where(RESOURCES["protected-blocks"].table, { workspace_id: workspaceId, commitment_id: change.id, owner_individual_id: ctx.individualId, status: "active" }, { limit: 50 });
      if (blocks.some(b => !b.archived_at)) throw new LifeosError("conflict", "Time is now protected for this commitment, so this proposal no longer applies.");
      plan = await planPatch(c, ctx, RESOURCES[change.resource], change.id, { ...change.fields, expectedVersion: change.expectedVersion }, prov);
    }
    const decision = update(SUGGESTION, row, {
      status: "accepted", decided_at: new Date().toISOString(), decided_by: ctx.individualId,
      target_type: RESOURCES[change.resource].entity, target_id: plan.id,
    }, Number(row.version));
    return [decision, ...plan.ops];
  });
}
