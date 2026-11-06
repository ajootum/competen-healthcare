import type { SessionIdentity } from "./optin";
import { LifeosError } from "./errors";
import type { LifeosStore, Row } from "./types";

// LIFEOS-API-001 delivery step 10. A person can always take their own records with them, including after their access has
// ended, so that personal continuity never depends on an organisation or a subscription. It holds only what they own.

const OWNED_TABLES = [
  "lifeos_world", "lifeos_goal", "lifeos_project", "lifeos_commitment", "lifeos_quadrant_classification", "lifeos_delegation",
  "lifeos_calendar_event", "lifeos_protected_block", "lifeos_weekly_plan", "lifeos_big_rock", "lifeos_weekly_review", "lifeos_permission_grant",
] as const;

const READ_LIMIT = 10000;

export async function exportOwnRecords(store: LifeosStore, id: SessionIdentity): Promise<Record<string, unknown>> {
  const [link] = await store.where("lifeos_identity_link", { issuer: id.issuer, subject: id.subject }, { limit: 1 });
  if (!link) throw new LifeosError("not_found", "There is nothing to export for this account.");
  const individualId = String(link.individual_id);
  const person = await store.get("lifeos_individual", individualId);
  const memberships = await store.where("lifeos_membership", { individual_id: individualId }, { limit: 500 });
  const workspaces = (await Promise.all(memberships.map(m => store.get("lifeos_workspace", String(m.workspace_id)))))
    .filter((w): w is Row => !!w).map(w => ({ id: w.id, kind: w.kind, name: w.name }));
  const entries = await Promise.all(OWNED_TABLES.map(async t => [
    t.replace("lifeos_", ""),
    await store.where(t, { owner_individual_id: individualId }, { limit: READ_LIMIT }),
  ] as const));
  const records = Object.fromEntries(entries);
  const truncated = entries.filter(([, rows]) => rows.length >= READ_LIMIT).map(([name]) => name);
  return {
    format: "lifeos-export-v1",
    person: person ? { id: person.id, displayName: person.display_name, timezone: person.timezone, createdAt: person.created_at } : null,
    workspaces,
    records,
    // Said out loud, so that a partial export can never read as a complete one.
    truncated,
  };
}
