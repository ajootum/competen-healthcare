import { z } from "zod";
import { isMonday } from "./time";

// LIFEOS-API-001 section 3. The versioned data contracts, schema version 1.
//
// These schemas are the single source: they validate input, strip anything internal from output, and generate
// the OpenAPI document. Input objects are strict, so a client cannot set a status, an owner, a version or a
// provenance by adding a field.

export const CONTRACT_VERSION = 1;

const uuid = z.uuid();
const isoDate = z.iso.date();
const isoTime = z.iso.time();
const isoDateTime = z.iso.datetime({ offset: true });
const scope = z.enum(["private", "workspace"]);
const monday = isoDate.refine(isMonday, "A week starts on a Monday.");

// ---- Output --------------------------------------------------------------------------------------------

const stamps = {
  id: z.string(),
  schemaVersion: z.number().int(),
  accessScope: scope,
  provenanceSource: z.enum(["user", "ai_suggestion", "integration", "import", "system"]),
  provenanceRef: z.string().nullable(),
  version: z.number().int(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
};
const owned = { ...stamps, workspaceId: z.string(), ownerIndividualId: z.string() };

export const IndividualV1 = z.object({
  ...stamps,
  displayName: z.string(), timezone: z.string(), locale: z.string(),
  accessSource: z.enum(["direct", "competen_individual", "organisation", "platform_grant"]),
  status: z.enum(["active", "suspended", "closed"]),
}).meta({ title: "Individual" });

export const EntitlementV1 = z.object({
  ...stamps,
  individualId: z.string(),
  source: z.enum(["direct", "competen_individual", "organisation", "platform_grant"]),
  tenantId: z.string().nullable(), planCode: z.string().nullable(), startsAt: z.string(), endsAt: z.string().nullable(),
  status: z.enum(["active", "revoked"]),
}).meta({ title: "Entitlement" });

export const WorkspaceV1 = z.object({
  ...stamps,
  ownerIndividualId: z.string(), kind: z.enum(["personal", "organisation"]), tenantId: z.string().nullable(), name: z.string(),
  status: z.enum(["active", "suspended", "closed"]),
}).meta({ title: "Workspace" });

export const MembershipV1 = z.object({
  ...stamps,
  workspaceId: z.string(), individualId: z.string(), role: z.enum(["owner", "admin", "member"]),
  status: z.enum(["invited", "active", "suspended", "left"]),
}).meta({ title: "Membership" });

export const WorldV1 = z.object({
  ...owned,
  title: z.string(), context: z.string().nullable(), purpose: z.string().nullable(), position: z.number().int(),
  status: z.enum(["active", "paused", "retired"]),
}).meta({ title: "World" });

export const GoalV1 = z.object({
  ...owned,
  worldId: z.string().nullable(), title: z.string(), description: z.string().nullable(), targetOn: z.string().nullable(),
  status: z.enum(["active", "paused", "achieved", "dropped"]),
}).meta({ title: "Goal" });

export const ProjectV1 = z.object({
  ...owned,
  worldId: z.string().nullable(), goalId: z.string().nullable(), title: z.string(), description: z.string().nullable(), dueOn: z.string().nullable(),
  status: z.enum(["active", "on_hold", "completed", "dropped"]),
}).meta({ title: "Project" });

export const CommitmentV1 = z.object({
  ...owned,
  worldId: z.string().nullable(), goalId: z.string().nullable(), projectId: z.string().nullable(),
  title: z.string(), notes: z.string().nullable(),
  important: z.boolean().nullable(), urgent: z.boolean().nullable(),
  quadrant: z.enum(["q1", "q2", "q3", "q4"]).nullable(),
  dueOn: z.string().nullable(), scheduledOn: z.string().nullable(), scheduledTime: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(), completedAt: z.string().nullable(),
  status: z.enum(["inbox", "planned", "in_progress", "delegated", "done", "dropped"]),
}).meta({ title: "Commitment" });

export const DelegationV1 = z.object({
  ...owned,
  commitmentId: z.string(), delegateeIndividualId: z.string().nullable(), delegateeLabel: z.string().nullable(),
  followUpOn: z.string(), expectations: z.string().nullable(), closedAt: z.string().nullable(),
  status: z.enum(["active", "completed", "cancelled"]),
}).meta({ title: "Delegation" });

export const CalendarEventV1 = z.object({
  ...owned,
  worldId: z.string().nullable(), commitmentId: z.string().nullable(), connectionId: z.string().nullable(), externalRef: z.string().nullable(),
  title: z.string(), startsAt: z.string(), endsAt: z.string(), timeZone: z.string(),
  status: z.enum(["scheduled", "completed", "cancelled"]),
}).meta({ title: "CalendarEvent" });

export const ProtectedBlockV1 = z.object({
  ...owned,
  worldId: z.string().nullable(), commitmentId: z.string().nullable(), label: z.string(), startsAt: z.string(), endsAt: z.string(), timeZone: z.string(),
  status: z.enum(["active", "released"]),
}).meta({ title: "ProtectedBlock" });

export const WeeklyPlanV1 = z.object({
  ...owned,
  weekStart: z.string(), intention: z.string().nullable(),
  status: z.enum(["draft", "active", "closed"]),
}).meta({ title: "WeeklyPlan" });

export const BigRockV1 = z.object({
  ...owned,
  weeklyPlanId: z.string(), commitmentId: z.string(), position: z.number().int(),
  status: z.enum(["selected", "removed"]),
}).meta({ title: "BigRock" });

export const QuadrantClassificationV1 = z.object({
  id: z.string(), schemaVersion: z.number().int(), workspaceId: z.string(), ownerIndividualId: z.string(), commitmentId: z.string(),
  important: z.boolean(), urgent: z.boolean(), quadrant: z.enum(["q1", "q2", "q3", "q4"]),
  accessScope: scope, status: z.literal("recorded"),
  provenanceSource: stamps.provenanceSource, provenanceRef: z.string().nullable(), createdBy: z.string(), createdAt: z.string(),
}).meta({ title: "QuadrantClassification" });

export const WeeklyReviewV1 = z.object({
  ...owned,
  weeklyPlanId: z.string().nullable(), weekStart: z.string(), reflection: z.string().nullable(), nextWeekFocus: z.string().nullable(),
  snapshot: z.record(z.string(), z.unknown()).nullable(), finalisedAt: z.string().nullable(),
  status: z.enum(["draft", "final"]),
}).meta({ title: "WeeklyReview" });

export const IntegrationConnectionV1 = z.object({
  ...owned,
  provider: z.string(), grantedScopes: z.array(z.string()), externalAccountRef: z.string().nullable(), lastSyncedAt: z.string().nullable(),
  status: z.enum(["pending", "active", "suspended", "revoked"]),
}).meta({ title: "IntegrationConnection" });

export const PermissionGrantV1 = z.object({
  ...owned,
  granteeIndividualId: z.string(), resourceType: z.string(), resourceId: z.string().nullable(),
  capability: z.enum(["read", "write"]), expiresAt: z.string().nullable(), revokedAt: z.string().nullable(),
  status: z.enum(["active", "revoked"]),
}).meta({ title: "PermissionGrant" });

export const SuggestionV1 = z.object({
  ...owned,
  kind: z.string(), materiality: z.enum(["informational", "material"]), title: z.string(), rationale: z.string().nullable(),
  targetType: z.string().nullable(), targetId: z.string().nullable(), proposedChange: z.record(z.string(), z.unknown()).nullable(),
  generator: z.string(), decidedAt: z.string().nullable(), decidedBy: z.string().nullable(),
  status: z.enum(["proposed", "accepted", "dismissed", "expired"]),
}).meta({ title: "Suggestion" });

export const AuditEventV1 = z.object({
  seq: z.number().int(), id: z.string(), schemaVersion: z.number().int(), eventType: z.string(), eventVersion: z.number().int(),
  workspaceId: z.string().nullable(), ownerIndividualId: z.string().nullable(), entityType: z.string(), entityId: z.string(),
  changedFields: z.array(z.string()), fromStatus: z.string().nullable(), toStatus: z.string().nullable(),
  actorIndividualId: z.string().nullable(), actorKind: z.enum(["user", "ai", "integration", "system"]), traceId: z.string().nullable(),
  accessScope: scope, status: z.literal("recorded"), provenanceSource: z.string().nullable(), provenanceRef: z.string().nullable(), occurredAt: z.string(),
}).meta({ title: "AuditEvent" });

// ---- Input --------------------------------------------------------------------------------------------

const title200 = z.string().trim().min(1).max(200);
const title500 = z.string().trim().min(1).max(500);
const ref = uuid.nullable().optional();
const expectedVersion = z.number().int().min(1);

const worldBase = {
  title: title200,
  context: z.string().max(200).nullable().optional(),
  purpose: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).max(100000).optional(),
  accessScope: scope.optional(),
};
const goalBase = {
  worldId: ref, title: title500,
  description: z.string().max(10000).nullable().optional(),
  targetOn: isoDate.nullable().optional(),
  accessScope: scope.optional(),
};
const projectBase = {
  worldId: ref, goalId: ref, title: title500,
  description: z.string().max(10000).nullable().optional(),
  dueOn: isoDate.nullable().optional(),
  accessScope: scope.optional(),
};
const commitmentBase = {
  title: title500, worldId: ref, goalId: ref, projectId: ref,
  notes: z.string().max(10000).nullable().optional(),
  important: z.boolean().nullable().optional(),
  urgent: z.boolean().nullable().optional(),
  dueOn: isoDate.nullable().optional(),
  scheduledOn: isoDate.nullable().optional(),
  scheduledTime: isoTime.nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  accessScope: scope.optional(),
};
const delegationEditable = {
  delegateeLabel: z.string().trim().min(1).max(200).nullable().optional(),
  followUpOn: isoDate,
  expectations: z.string().max(4000).nullable().optional(),
};
const timeBlock = {
  worldId: ref, commitmentId: ref,
  startsAt: isoDateTime, endsAt: isoDateTime,
  timeZone: z.string().min(1).max(64).optional(),
  accessScope: scope.optional(),
};
const endsAfterStarts = (v: { startsAt: string; endsAt: string }) => new Date(v.endsAt) > new Date(v.startsAt);

export const inputs = {
  worlds: {
    create: z.object(worldBase).strict(),
    patch: z.object({ ...z.object(worldBase).partial().shape, expectedVersion }).strict(),
  },
  goals: {
    create: z.object(goalBase).strict(),
    patch: z.object({ ...z.object(goalBase).partial().shape, expectedVersion }).strict(),
  },
  projects: {
    create: z.object(projectBase).strict(),
    patch: z.object({ ...z.object(projectBase).partial().shape, expectedVersion }).strict(),
  },
  commitments: {
    create: z.object(commitmentBase).strict(),
    patch: z.object({ ...z.object(commitmentBase).partial().shape, expectedVersion }).strict(),
  },
  delegations: {
    create: z.object({ commitmentId: uuid, delegateeIndividualId: uuid.nullable().optional(), ...delegationEditable }).strict()
      .refine(v => !!v.delegateeIndividualId || !!v.delegateeLabel, "Say who this is delegated to."),
    patch: z.object({ ...z.object(delegationEditable).partial().shape, expectedVersion }).strict(),
  },
  "calendar-events": {
    create: z.object({ ...timeBlock, title: title500 }).strict().refine(endsAfterStarts, "An event must end after it starts."),
    patch: z.object({ ...z.object({ ...timeBlock, title: title500 }).partial().shape, expectedVersion }).strict(),
  },
  "protected-blocks": {
    create: z.object({ ...timeBlock, label: title500 }).strict().refine(endsAfterStarts, "A block must end after it starts."),
    patch: z.object({ ...z.object({ ...timeBlock, label: title500 }).partial().shape, expectedVersion }).strict(),
  },
  "weekly-plans": {
    create: z.object({ weekStart: monday, intention: z.string().max(4000).nullable().optional(), accessScope: scope.optional() }).strict(),
    patch: z.object({ intention: z.string().max(4000).nullable().optional(), accessScope: scope.optional(), expectedVersion }).strict(),
  },
  "big-rocks": {
    create: z.object({ weeklyPlanId: uuid, commitmentId: uuid, position: z.number().int().min(0).max(100000).optional() }).strict(),
    patch: z.object({ position: z.number().int().min(0).max(100000).optional(), expectedVersion }).strict(),
  },
  "weekly-reviews": {
    create: z.object({
      weekStart: monday, weeklyPlanId: ref,
      reflection: z.string().max(20000).nullable().optional(),
      nextWeekFocus: z.string().max(4000).nullable().optional(),
      accessScope: scope.optional(),
    }).strict(),
    patch: z.object({
      reflection: z.string().max(20000).nullable().optional(),
      nextWeekFocus: z.string().max(4000).nullable().optional(),
      accessScope: scope.optional(),
      expectedVersion,
    }).strict(),
  },
  "permission-grants": {
    create: z.object({
      granteeIndividualId: uuid,
      resourceType: z.enum([
        "world", "goal", "project", "commitment", "delegation", "calendar_event", "protected_block",
        "weekly_plan", "big_rock", "weekly_review", "integration_connection", "suggestion", "quadrant_classification",
      ]),
      resourceId: uuid.nullable().optional(),
      capability: z.enum(["read", "write"]),
      expiresAt: isoDateTime.nullable().optional(),
    }).strict(),
  },
} as const;

export const ActivateInput = z.object({ termsVersion: z.string().min(1).max(80) }).strict().meta({ title: "ActivateInput" });

export const AccessStatusV1 = z.object({
  enabled: z.boolean(), eligible: z.boolean(), active: z.boolean(),
  terms: z.object({ version: z.string(), title: z.string(), url: z.string() }).nullable(),
}).meta({ title: "AccessStatus" });

export const MeInput = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().min(1).max(64).refine(tz => {
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
  }, "That is not a known time zone.").optional(),
  locale: z.string().min(2).max(35).optional(),
  expectedVersion,
}).strict().meta({ title: "MeInput" });

export const TransitionInput = z.object({
  to: z.string().min(1).max(40),
  expectedVersion,
  scheduledOn: isoDate.nullable().optional(),
  scheduledTime: isoTime.nullable().optional(),
}).strict().meta({ title: "TransitionInput" });

export const VersionInput = z.object({ expectedVersion }).strict().meta({ title: "VersionInput" });

export const GenerateInput = z.object({
  /** The prototype's "unexpected interruption": ask for a proposed replan of today. */
  interruption: z.boolean().optional(),
}).strict().meta({ title: "GenerateInput" });

export const ListQueryInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(400).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  status: z.string().min(1).max(40).optional(),
  worldId: uuid.optional(),
  goalId: uuid.optional(),
  projectId: uuid.optional(),
  commitmentId: uuid.optional(),
  weeklyPlanId: uuid.optional(),
  weekStart: isoDate.optional(),
  scheduledOn: isoDate.optional(),
  scheduledFrom: isoDate.optional(),
  scheduledTo: isoDate.optional(),
  quadrant: z.enum(["q1", "q2", "q3", "q4"]).optional(),
  entityType: z.string().min(1).max(60).optional(),
  entityId: uuid.optional(),
}).strict();

// ---- Tenant branding --------------------------------------------------------------------------------------

/** lifeos_tenant.branding. Configuration only. Step 7 reads it for white-labelled domains. */
export const TenantBrandingV1 = z.object({
  productName: z.string().max(80).optional(),
  logoUrl: z.url().max(500).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict().meta({ title: "TenantBranding" });
