/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = any;

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-PROV-001 s10 / AC-13 -- WHAT A LOCKED-OUT PRACTICE IS TOLD.
//
// The screen this feeds used to say "The trial or subscription covering this workspace has ended" and
// stop there. Every word of that was true and it left the person with nothing: not WHEN it ended, not
// whether their patient records still exist, and not one route to getting back in. s10 calls that a
// "generic dead-end" and asks for a role-aware state instead.
//
// ⚠ THIS IS A TENANT-PLANE READ OF THE TENANT'S OWN ROW, AND IT STAYS THAT WAY. The identical facts are
// derived on the landlord plane by src/lib/hq/entitlement.ts, and it would have been half the code to
// import that here. It is not imported, and nothing under src/app/practice or src/lib/practice imports
// from src/lib/hq at all -- checked before writing this file. The landlord reader answers "what has this
// practice been sold", across practices, for somebody who administers them; this one answers "what
// happened to MY access", for one workspace, for the person locked out of it. Merging them would put a
// cross-practice reader one argument away from a tenant page.
//
// ⚠ WHY THE SPLIT IS TWO QUERIES ON THE DATABASE'S CLOCK. `starts_at` defaults to the database's now(),
// and access.ts carries the scar from comparing it against this process's clock: a brand-new practice
// read as NOT_ENTITLED on its first page load. The stake here is smaller -- a sentence, not a lock -- but
// a period beginning in the next second is exactly the case that decides between "your access ended"
// and "your access resumes", and those are opposite sentences.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** The statuses that mean a period was MEANT to grant access. Mirrors the gate in access.ts. */
const GRANTING = ["active", "trial"] as const;

export type AccessEndedReading =
  /** Nothing was read. NOT the same as "no plan" -- see the note on the screen. */
  | { state: "unreadable"; reason: string }
  /** No entitlement row has ever existed for this workspace. A provisioning fault, not an expiry. */
  | { state: "none" }
  | {
      state: "known";
      /** The instant access ran out, or null when the period was stopped by status rather than by time. */
      endedAt: string | null;
      /** Set when a period is waiting to begin (s15: Scheduled). The sentence changes completely. */
      resumesAt: string | null;
      planCode: string;
      status: string;
      startedAt: string | null;
    };

/**
 * The most recent access period for one workspace, and whether another is waiting to start.
 *
 * Only ever called for a workspace the caller is already a proven member of -- the screen resolves the
 * membership first, and a non-member never reaches it.
 */
export async function accessEndedReading(admin: Admin, workspaceId: string): Promise<AccessEndedReading> {
  const COLS = "plan_code, status, starts_at, ends_at";
  const [past, future] = await Promise.all([
    // Periods already under way or over: the newest one is the one that just ended.
    admin.from("practice_entitlement").select(COLS)
      .eq("workspace_id", workspaceId).lte("starts_at", "now")
      .order("starts_at", { ascending: false }).limit(1),
    // A period not yet begun, which only counts as a resumption if its status would grant access.
    admin.from("practice_entitlement").select(COLS)
      .eq("workspace_id", workspaceId).gt("starts_at", "now").in("status", GRANTING as unknown as string[])
      .order("starts_at", { ascending: true }).limit(1),
  ]);

  // ⚠ ONE FAILED READ POISONS THE WHOLE ANSWER. If the future query failed, "your access ended" might be
  // wrong in the one way that matters -- there could be a period starting tomorrow that this screen would
  // then deny. Saying nothing was read is the honest state; guessing from the half that worked is not.
  if (past.error) return { state: "unreadable", reason: "This practice's access record could not be read." };
  if (future.error) return { state: "unreadable", reason: "This practice's access record could not be read in full." };

  const latest = ((past.data ?? []) as any[])[0] ?? null;
  const next = ((future.data ?? []) as any[])[0] ?? null;

  if (!latest && !next) return { state: "none" };

  // A practice whose ONLY period is a future one has not ended; it has not started.
  if (!latest && next) {
    return {
      state: "known", endedAt: null, resumesAt: next.starts_at ?? null,
      planCode: next.plan_code, status: next.status, startedAt: null,
    };
  }

  return {
    state: "known",
    endedAt: latest.ends_at ?? null,
    resumesAt: next?.starts_at ?? null,
    planCode: latest.plan_code,
    status: latest.status,
    startedAt: latest.starts_at ?? null,
  };
}

/**
 * Why this period is not granting access, in the person's own terms.
 *
 * ⚠ IT ANSWERS FROM THE ROW, NOT FROM THE FACT THAT WE ARE ON THIS SCREEN. A period whose status was set
 * to `suspended` and a period that simply ran out are both "locked out", and telling somebody their trial
 * expired when an administrator actually suspended them sends them to argue with the wrong person.
 */
export function endedBecause(r: Extract<AccessEndedReading, { state: "known" }>): string {
  if (r.status === "suspended") return "access to this practice was suspended";
  if (r.status === "cancelled") return "this practice's plan was cancelled";
  if (r.startedAt === null) return "this practice's access period has not started yet";
  if (r.endedAt === null) return `the plan covering this practice is recorded as ${r.status}`;
  return "the plan covering this practice reached its end date";
}
