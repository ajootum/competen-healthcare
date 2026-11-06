import type { z } from "zod";
import {
  BigRockV1, CalendarEventV1, CommitmentV1, DelegationV1, GoalV1, IntegrationConnectionV1, PermissionGrantV1, ProjectV1,
  ProtectedBlockV1, QuadrantClassificationV1, SuggestionV1, WeeklyPlanV1, WeeklyReviewV1, WorldV1, inputs,
} from "./contracts";
import { MACHINES, type Machine } from "./machines";

// LIFEOS-API-001 section 6. One table of what each resource is. The route table, the service and the OpenAPI
// document all read it, so they cannot disagree.

export type ResourceName =
  | "worlds" | "goals" | "projects" | "commitments" | "delegations" | "calendar-events" | "protected-blocks"
  | "weekly-plans" | "big-rocks" | "weekly-reviews" | "permission-grants"
  | "quadrant-classifications" | "integration-connections" | "suggestions";

export type ResourceDef = {
  name: ResourceName;
  /** The contract name: audit `entity_type` and grant `resource_type`. */
  entity: string;
  table: string;
  output: z.ZodType;
  create?: z.ZodType;
  patch?: z.ZodType;
  machine?: Machine;
  /** API field -> column, for the filters this resource allows. */
  filters: Record<string, string>;
  /** Fields that reference another record, which the caller must be able to read: field -> resource name. */
  refs?: Record<string, ResourceName>;
  /** A column naming a second person who may read this record. */
  extraReaderColumn?: string;
  hasArchive: boolean;
  scopes: { read: string; write?: string };
};

const statusFilter = { status: "status" };
const worldFilter = { worldId: "world_id" };

export const RESOURCES: Record<ResourceName, ResourceDef> = {
  worlds: {
    name: "worlds", entity: "world", table: "lifeos_world", output: WorldV1, ...inputs.worlds, machine: MACHINES.world,
    filters: statusFilter, hasArchive: true, scopes: { read: "worlds:read", write: "worlds:write" },
  },
  goals: {
    name: "goals", entity: "goal", table: "lifeos_goal", output: GoalV1, ...inputs.goals, machine: MACHINES.goal,
    filters: { ...statusFilter, ...worldFilter }, refs: { worldId: "worlds" }, hasArchive: true,
    scopes: { read: "goals:read", write: "goals:write" },
  },
  projects: {
    name: "projects", entity: "project", table: "lifeos_project", output: ProjectV1, ...inputs.projects, machine: MACHINES.project,
    filters: { ...statusFilter, ...worldFilter, goalId: "goal_id" }, refs: { worldId: "worlds", goalId: "goals" }, hasArchive: true,
    scopes: { read: "projects:read", write: "projects:write" },
  },
  commitments: {
    name: "commitments", entity: "commitment", table: "lifeos_commitment", output: CommitmentV1, ...inputs.commitments, machine: MACHINES.commitment,
    filters: { ...statusFilter, ...worldFilter, goalId: "goal_id", projectId: "project_id", quadrant: "quadrant", scheduledOn: "scheduled_on" },
    refs: { worldId: "worlds", goalId: "goals", projectId: "projects" }, hasArchive: true,
    scopes: { read: "commitments:read", write: "commitments:write" },
  },
  delegations: {
    name: "delegations", entity: "delegation", table: "lifeos_delegation", output: DelegationV1, ...inputs.delegations, machine: MACHINES.delegation,
    filters: { ...statusFilter, commitmentId: "commitment_id" }, hasArchive: true,
    scopes: { read: "delegations:read", write: "delegations:write" },
  },
  "calendar-events": {
    name: "calendar-events", entity: "calendar_event", table: "lifeos_calendar_event", output: CalendarEventV1, ...inputs["calendar-events"],
    machine: MACHINES.calendar_event, filters: { ...statusFilter, ...worldFilter, commitmentId: "commitment_id" },
    refs: { worldId: "worlds", commitmentId: "commitments" }, hasArchive: true, scopes: { read: "schedules:read", write: "schedules:write" },
  },
  "protected-blocks": {
    name: "protected-blocks", entity: "protected_block", table: "lifeos_protected_block", output: ProtectedBlockV1, ...inputs["protected-blocks"],
    machine: MACHINES.protected_block, filters: { ...statusFilter, ...worldFilter, commitmentId: "commitment_id" },
    refs: { worldId: "worlds", commitmentId: "commitments" }, hasArchive: true, scopes: { read: "schedules:read", write: "schedules:write" },
  },
  "weekly-plans": {
    name: "weekly-plans", entity: "weekly_plan", table: "lifeos_weekly_plan", output: WeeklyPlanV1, ...inputs["weekly-plans"], machine: MACHINES.weekly_plan,
    filters: { ...statusFilter, weekStart: "week_start" }, hasArchive: true, scopes: { read: "plans:read", write: "plans:write" },
  },
  "big-rocks": {
    name: "big-rocks", entity: "big_rock", table: "lifeos_big_rock", output: BigRockV1, ...inputs["big-rocks"], machine: MACHINES.big_rock,
    filters: { ...statusFilter, weeklyPlanId: "weekly_plan_id", commitmentId: "commitment_id" },
    refs: { weeklyPlanId: "weekly-plans", commitmentId: "commitments" }, hasArchive: true, scopes: { read: "plans:read", write: "plans:write" },
  },
  "weekly-reviews": {
    name: "weekly-reviews", entity: "weekly_review", table: "lifeos_weekly_review", output: WeeklyReviewV1, ...inputs["weekly-reviews"],
    machine: MACHINES.weekly_review, filters: { ...statusFilter, weekStart: "week_start" }, refs: { weeklyPlanId: "weekly-plans" },
    hasArchive: true, scopes: { read: "reviews:read", write: "reviews:write" },
  },
  "permission-grants": {
    name: "permission-grants", entity: "permission_grant", table: "lifeos_permission_grant", output: PermissionGrantV1, ...inputs["permission-grants"],
    machine: MACHINES.permission_grant, filters: statusFilter, extraReaderColumn: "grantee_individual_id", hasArchive: false,
    scopes: { read: "grants:read", write: "grants:write" },
  },
  "quadrant-classifications": {
    name: "quadrant-classifications", entity: "quadrant_classification", table: "lifeos_quadrant_classification", output: QuadrantClassificationV1,
    filters: { commitmentId: "commitment_id" }, hasArchive: false, scopes: { read: "commitments:read" },
  },
  "integration-connections": {
    name: "integration-connections", entity: "integration_connection", table: "lifeos_integration_connection", output: IntegrationConnectionV1,
    filters: statusFilter, hasArchive: true, scopes: { read: "integrations:read" },
  },
  suggestions: {
    name: "suggestions", entity: "suggestion", table: "lifeos_suggestion", output: SuggestionV1,
    filters: statusFilter, hasArchive: true, scopes: { read: "suggestions:read", write: "suggestions:write" },
  },
};

export const RESOURCE_NAMES = Object.keys(RESOURCES) as ResourceName[];

/** Plain field copy between the API (camelCase) and the database (snake_case). */
export const toSnake = (k: string) => k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
export const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function camelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

export function snakeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[toSnake(k)] = v;
  return out;
}
