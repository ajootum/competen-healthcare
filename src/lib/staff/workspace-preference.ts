/* eslint-disable @typescript-eslint/no-explicit-any */

// COMP-HQ-ACCESS-001 s7 -- WHERE A MULTI-ASSIGNMENT STAFF MEMBER WAS LAST WORKING (migration 310).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// The Default Context Resolver's two remembered facts: the workspace somebody was last in
// (observed), and the assignment an administrator nominated as primary (administered). Two fields
// because they answer different questions -- a last visit must never silently overwrite a
// deliberate assignment.
//
// ⚠ A HINT, NEVER AN AUTHORITY. Nothing here grants anything. The pure decision validates whatever
// this returns against the workspaces the account ACTUALLY holds today and discards a stale one, so
// a workspace withdrawn since the last visit cannot be reopened by a remembered href. That check
// lives in the decision (selector.ts) rather than here, because a reader that pre-filtered would be
// a second place authorisation is decided.
//
// ⚠ FAIL-SOFT, IN THE DIRECTION THAT ASKS RATHER THAN ASSUMES. An unreadable preference returns
// nothing, and nothing means the selector -- the person is asked where they are working instead of
// being sent somewhere on the strength of a read that did not happen.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type StaffWorkspacePreference = {
  lastWorkspaceHref: string | null;
  primaryWorkspaceHref: string | null;
};

const EMPTY: StaffWorkspacePreference = { lastWorkspaceHref: null, primaryWorkspaceHref: null };

/** An internal path, and only that. The column carries the same check -- this is the reader's half. */
const internalPath = (v: unknown): string | null =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null;

export async function readStaffWorkspacePreference(admin: any, userId: string): Promise<StaffWorkspacePreference> {
  try {
    const { data, error } = await admin
      .from("plat_staff_workspace_preference")
      .select("last_workspace_href, primary_workspace_href")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return EMPTY;
    return {
      lastWorkspaceHref: internalPath(data.last_workspace_href),
      primaryWorkspaceHref: internalPath(data.primary_workspace_href),
    };
  } catch {
    // Pre-migration estate or a transient failure. Asking beats guessing -- see the header.
    return EMPTY;
  }
}

/**
 * Record where somebody is working, on arrival.
 *
 * ⚠ CALLED BY THE WORKSPACE ITSELF, NOT BY THE DOOR, because the door is not the only way in: a
 * bookmark, the switcher and the Workspace Launcher all reach a workspace without passing through
 * it. Today only the HQ layout calls this; every other staff workspace adopts the behaviour by
 * calling the same helper from its own layout, and until it does, a multi-assignment person's
 * "last workspace" remembers only their HQ visits. That is a partial memory rather than a wrong
 * one -- an unremembered workspace simply leaves the resolver asking.
 *
 * ⚠ NEVER THROWS AND NEVER BLOCKS. This is bookkeeping behind a page render: a failed write costs a
 * convenience, and costing somebody their workspace instead would be the wrong trade by a mile.
 */
export async function rememberStaffWorkspace(admin: any, userId: string, href: string): Promise<void> {
  const path = internalPath(href);
  if (!path) return;
  try {
    await admin
      .from("plat_staff_workspace_preference")
      .upsert({
        user_id: userId,
        last_workspace_href: path,
        last_workspace_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
  } catch {
    // Deliberately silent -- see the header.
  }
}
