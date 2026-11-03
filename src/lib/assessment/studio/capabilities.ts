// Checklist Studio: which capabilities does the person HOLD? Pure part (no I/O), so it is unit-tested.
//
// ⚠ A PLATFORM OWNER IS ADMITTED TO HQ WITH NO APPOINTMENT, and the HQ context therefore gives the owner
// `capabilities: []`. The 890 definitions database gives the owner NO short-circuit: it asks
// individual_holds_capability(person, capability), which is true only through an active appointment. So the app
// has to ask the SAME question for an owner, or an owner who IS appointed (author, coordinator) is refused by
// the app while the database would have allowed the write. Non-owners are unchanged: their context already
// carries the capabilities of their appointments.

import { CAP } from "./transitions";

/** Asks the database whether this person holds the capability through a live appointment. Throws are treated as "no". */
export type HoldsCapability = (capability: string) => Promise<boolean>;

/** Every capability the Studio, review and assessor-assignment code tests against ctx.capabilities. */
export const STUDIO_CAPABILITIES: readonly string[] = Object.values(CAP);

/**
 * The capabilities to test. A non-owner: exactly what the HQ context resolved. An owner: ONLY the ones a live
 * appointment grants (the context's empty list is not trusted and not merged in), so the app's answer equals the
 * database's. An owner with no appointment gets [] -- can look (the page gate admits them), cannot change.
 */
export async function effectiveCapabilities(
  who: { isOwner: boolean; capabilities: string[] },
  holds: HoldsCapability,
  candidates: readonly string[] = STUDIO_CAPABILITIES,
): Promise<string[]> {
  if (!who.isOwner) return who.capabilities;
  const answers = await Promise.all(candidates.map(async (c) => {
    try { return (await holds(c)) === true; } catch { return false; }
  }));
  return candidates.filter((_, i) => answers[i]);
}
