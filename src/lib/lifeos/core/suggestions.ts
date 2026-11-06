import { addDays } from "./time";
import type { Row } from "./types";

// LIFEOS-API-001 section 8. The Chief of Staff, rules only (generator rules-v1).
//
// A pure function over records the service already loaded, from ONE workspace, owned by ONE person. It returns
// proposals. It cannot write anything, it calls no AI model and it makes no network request.

export const RULES_GENERATOR = "rules-v1";
export const DEFAULT_BLOCK_MINUTES = 45;

export type ProposedChange =
  | { action: "create"; resource: "protected-blocks" | "big-rocks"; fields: Record<string, unknown> }
  | { action: "patch"; resource: "commitments"; id: string; expectedVersion: number; fields: Record<string, unknown> };

export type Proposal = {
  kind: "protect_q2" | "clarify_inbox" | "delegation_follow_up" | "big_rock" | "replan";
  materiality: "informational" | "material";
  title: string;
  rationale: string;
  targetType: string | null;
  targetId: string | null;
  proposedChange: ProposedChange | null;
  dedupeKey: string;
};

export type RuleInput = {
  today: string;
  /** The Monday of today's week. */
  weekStart: string;
  timeZone: string;
  commitments: Row[];
  activeBlocks: Row[];
  activeDelegations: Row[];
  /** This week's plan, if it is active. */
  activePlan: Row | null;
  bigRocks: Row[];
  interruption?: boolean;
};

const isLive = (c: Row) => !c.archived_at && ["inbox", "planned", "in_progress"].includes(String(c.status));
const blockedIds = (blocks: Row[]) => new Set(blocks.map(b => b.commitment_id).filter(Boolean));

/** Local wall-clock time as an instant in that zone, for a proposed block. */
export function startInstant(date: string, time: string, timeZone: string): string {
  const guess = new Date(`${date}T${time.slice(0, 5)}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (utc.getTime() - shown.getTime())).toISOString();
}

export function runRules(i: RuleInput): Proposal[] {
  const out: Proposal[] = [];
  const blocked = blockedIds(i.activeBlocks);
  const live = i.commitments.filter(isLive);
  const weekEnd = addDays(i.weekStart, 6);

  // Scheduled Q2 with no protected time. A time is needed, or there is nothing concrete to propose.
  for (const c of live) {
    if (c.quadrant !== "q2" || blocked.has(c.id) || !c.scheduled_on || !c.scheduled_time) continue;
    const startsAt = startInstant(String(c.scheduled_on), String(c.scheduled_time), i.timeZone);
    const minutes = Number(c.estimated_minutes ?? DEFAULT_BLOCK_MINUTES);
    out.push({
      kind: "protect_q2",
      materiality: "material",
      title: `Protect time for: ${String(c.title)}`,
      rationale: "This is important and not urgent, and no time is protected for it yet.",
      targetType: "commitment",
      targetId: String(c.id),
      proposedChange: {
        action: "create",
        resource: "protected-blocks",
        fields: {
          commitmentId: c.id, worldId: c.world_id ?? null, label: String(c.title), startsAt,
          endsAt: new Date(new Date(startsAt).getTime() + minutes * 60000).toISOString(), timeZone: i.timeZone,
        },
      },
      dedupeKey: `protect_q2:${String(c.id)}:${String(c.scheduled_on)}`,
    });
  }

  const inbox = live.filter(c => c.status === "inbox");
  if (inbox.length) {
    out.push({
      kind: "clarify_inbox",
      materiality: "informational",
      title: `${inbox.length} captured item${inbox.length === 1 ? "" : "s"} need clarifying`,
      rationale: "Capture is not yet a commitment. Choose a world, importance and urgency, or drop them.",
      targetType: null, targetId: null, proposedChange: null,
      dedupeKey: `clarify_inbox:${i.today}`,
    });
  }

  // Informational only. Contacting the delegatee would be an external communication, which is not ours to send.
  for (const d of i.activeDelegations) {
    if (String(d.follow_up_on) > i.today) continue;
    out.push({
      kind: "delegation_follow_up",
      materiality: "informational",
      title: "A delegation is due for follow-up",
      rationale: `The follow-up date was ${String(d.follow_up_on)}. You remain the owner of this commitment.`,
      targetType: "delegation", targetId: String(d.id), proposedChange: null,
      dedupeKey: `follow_up:${String(d.id)}:${String(d.follow_up_on)}`,
    });
  }

  if (i.activePlan && !i.bigRocks.some(r => r.status === "selected")) {
    for (const c of live) {
      if ((c.quadrant !== "q1" && c.quadrant !== "q2") || !c.scheduled_on) continue;
      if (String(c.scheduled_on) < i.weekStart || String(c.scheduled_on) > weekEnd) continue;
      out.push({
        kind: "big_rock",
        materiality: "material",
        title: `Make this a Big Rock: ${String(c.title)}`,
        rationale: "Your plan for this week has no Big Rock yet, and this is important work scheduled this week.",
        targetType: "commitment",
        targetId: String(c.id),
        proposedChange: { action: "create", resource: "big-rocks", fields: { weeklyPlanId: i.activePlan.id, commitmentId: c.id } },
        dedupeKey: `big_rock:${String(i.activePlan.id)}:${String(c.id)}`,
      });
    }
  }

  // The prototype's replan: one flexible item today moves to tomorrow. Never a protected one. It takes the item
  // that costs least to move: not urgent before urgent, then not important before important.
  if (i.interruption) {
    const flexible = live.filter(c => c.status === "planned" && c.scheduled_on === i.today && !blocked.has(c.id));
    const cost = (c: Row) => (c.urgent ? 2 : 0) + (c.important ? 1 : 0);
    const pick = [...flexible].sort((a, b) => cost(a) - cost(b))[0];
    if (pick) {
      const tomorrow = addDays(i.today, 1);
      out.push({
        kind: "replan",
        materiality: "material",
        title: `Move to tomorrow: ${String(pick.title)}`,
        rationale: "An interruption needs today. This keeps its world and priority, and no protected time moves. Check any external calendar yourself.",
        targetType: "commitment",
        targetId: String(pick.id),
        proposedChange: {
          action: "patch", resource: "commitments", id: String(pick.id), expectedVersion: Number(pick.version),
          fields: { scheduledOn: tomorrow },
        },
        dedupeKey: `replan:${String(pick.id)}:${i.today}`,
      });
    }
  }
  return out;
}
