import { LifeosError } from "./errors";
import type { Row } from "./types";

// LIFEOS-API-001 section 4. Lifecycles, as data. PATCH cannot change a status, only a transition can.

export type Machine = Record<string, readonly string[]>;

export const MACHINES = {
  world: { active: ["paused", "retired"], paused: ["active", "retired"], retired: ["active"] },
  goal: { active: ["paused", "achieved", "dropped"], paused: ["active", "dropped"], achieved: ["active"], dropped: ["active"] },
  project: { active: ["on_hold", "completed", "dropped"], on_hold: ["active", "dropped"], completed: ["active"], dropped: ["active"] },
  // `delegated` is reached only by creating a delegation, so it is no state's target here.
  commitment: {
    inbox: ["planned", "in_progress", "done", "dropped"],
    planned: ["in_progress", "done", "dropped", "inbox"],
    in_progress: ["planned", "done", "dropped"],
    delegated: ["done", "dropped"],
    done: ["planned", "in_progress", "inbox"],
    dropped: ["inbox"],
  },
  delegation: { active: ["completed", "cancelled"], completed: [], cancelled: [] },
  calendar_event: { scheduled: ["completed", "cancelled"], completed: ["scheduled"], cancelled: ["scheduled"] },
  protected_block: { active: ["released"], released: ["active"] },
  weekly_plan: { draft: ["active"], active: ["draft", "closed"], closed: ["active"] },
  big_rock: { selected: ["removed"], removed: ["selected"] },
  weekly_review: { draft: ["final"], final: [] },
  permission_grant: { active: ["revoked"], revoked: [] },
} as const satisfies Record<string, Machine>;

export function assertTransition(machine: Machine, from: string, to: string) {
  if (!(machine[from] ?? []).includes(to)) {
    throw new LifeosError("invalid_transition", `This record cannot move from ${from} to ${to}.`, {
      details: { from, to, allowed: machine[from] ?? [] },
    });
  }
}

/** The fields a commitment needs before it can leave the inbox for real work. */
export function missingForWork(c: Row): string[] {
  const missing: string[] = [];
  if (!c.world_id) missing.push("worldId");
  if (c.important === null || c.important === undefined) missing.push("important");
  if (c.urgent === null || c.urgent === undefined) missing.push("urgent");
  return missing;
}

/** Where a commitment goes when the person it was delegated to is finished. */
export function resumeStatus(c: Row): "planned" | "in_progress" | "inbox" {
  if (missingForWork(c).length) return "inbox";
  return c.scheduled_on ? "planned" : "in_progress";
}

/** Refuses a commitment transition with a clear reason, before the database check would. */
export function assertCommitmentCanMove(c: Row, to: string, next: { scheduledOn?: string | null }) {
  assertTransition(MACHINES.commitment, String(c.status), to);
  if (to === "planned" || to === "in_progress") {
    const missing = missingForWork(c);
    if (missing.length) {
      throw new LifeosError("invalid_transition", "Clarify this commitment first: choose its world, importance and urgency.", { details: { missing } });
    }
  }
  if (to === "planned" && !(next.scheduledOn ?? c.scheduled_on)) {
    throw new LifeosError("invalid_transition", "Give this commitment a date to plan it.", { details: { missing: ["scheduledOn"] } });
  }
}
