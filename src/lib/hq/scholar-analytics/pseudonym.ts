// SCHOLAR-ENGAGEMENT-ANALYTICS-01 -- stable pseudonyms. "Learner 4F2A" is an HMAC of the user id under a secret salt
// that lives only in hq_config (migration 910), so the label is the same on every page load and in every date range,
// and cannot be recomputed by anyone who merely knows a user id. Pseudonymous, not irreversible: the server itself maps
// back by recomputing the table for the learner set, which is how a detail request names its learner without an id.
import { createHmac } from "node:crypto";

export const PSEUDONYM_PREFIX = "Learner ";

function code(salt: string, userId: string, length: number): string {
  return createHmac("sha256", salt).update(userId).digest("hex").slice(0, length).toUpperCase();
}

/** One short code per id, unique within the set: a collision lengthens both codes until they differ. */
export function pseudonymTable(userIds: readonly string[], salt: string): Map<string, string> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)].sort();
  let length = 4;
  while (length <= 16) {
    const seen = new Map<string, string[]>();
    for (const id of ids) { const c = code(salt, id, length); seen.set(c, [...(seen.get(c) ?? []), id]); }
    if ([...seen.values()].every(v => v.length === 1)) {
      for (const [c, [id]] of seen) out.set(id, PSEUDONYM_PREFIX + c);
      return out;
    }
    length += 1;
  }
  for (const id of ids) out.set(id, PSEUDONYM_PREFIX + code(salt, id, 16));
  return out;
}

/** The id behind a pseudonym, within a table, or null. Case-insensitive on the code. */
export function resolvePseudonym(table: ReadonlyMap<string, string>, label: string): string | null {
  const want = label.trim().toUpperCase();
  for (const [id, p] of table) if (p.toUpperCase() === want) return id;
  return null;
}
