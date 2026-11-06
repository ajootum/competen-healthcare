import { LifeosError } from "./errors";
import type { LifeosStore, Op, Row } from "./types";

// LIFEOS-API-001 section 9. Explicit provisioning. There is no self-registration and nothing here is an API
// route at this stage: it is called by a script or a harness. Step 6 and step 7 add governed doors to it.

export const ISSUER_COMPETEN_AUTH = "competen-supabase-auth";

const system = { provenance_source: "system" } as const;

export type NewIndividual = {
  issuer: string;
  subject: string;
  displayName: string;
  timezone?: string;
  accessSource: "direct" | "competen_individual" | "organisation" | "platform_grant";
};

/** One person, their identity link, their personal workspace and their membership, in one transaction. */
export async function provisionIndividual(store: LifeosStore, n: NewIndividual): Promise<{ individualId: string; personalWorkspaceId: string; created: boolean }> {
  const [link] = await store.where("lifeos_identity_link", { issuer: n.issuer, subject: n.subject }, { limit: 1 });
  if (link) {
    const individualId = String(link.individual_id);
    const [ws] = await store.where("lifeos_workspace", { owner_individual_id: individualId, kind: "personal" }, { limit: 1 });
    return { individualId, personalWorkspaceId: String(ws?.id), created: false };
  }
  const individualId = crypto.randomUUID();
  const personalWorkspaceId = crypto.randomUUID();
  const by = { created_by: individualId, updated_by: individualId };
  const ops: Op[] = [
    { t: "lifeos_individual", op: "insert", values: { id: individualId, display_name: n.displayName, timezone: n.timezone ?? "UTC", access_source: n.accessSource, ...system, ...by } },
    { t: "lifeos_identity_link", op: "insert", values: { individual_id: individualId, issuer: n.issuer, subject: n.subject, ...system, ...by } },
    { t: "lifeos_workspace", op: "insert", values: { id: personalWorkspaceId, owner_individual_id: individualId, kind: "personal", name: "Personal", ...system, ...by } },
    { t: "lifeos_membership", op: "insert", values: { workspace_id: personalWorkspaceId, individual_id: individualId, role: "owner", ...system, ...by } },
  ];
  await store.mutate({ actor: null, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops });
  return { individualId, personalWorkspaceId, created: true };
}

/** A tenant and its first workspace, owned by the person who is accountable for it. */
export async function provisionOrganisation(
  store: LifeosStore, actor: string, o: { slug: string; name: string; kind?: "organisation" | "partner_platform"; branding?: Row },
): Promise<{ tenantId: string; workspaceId: string }> {
  const tenantId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  await store.mutate({
    actor, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [
      { t: "lifeos_tenant", op: "insert", values: { id: tenantId, owner_individual_id: actor, slug: o.slug, name: o.name, kind: o.kind ?? "organisation", status: "active", branding: o.branding ?? {}, ...system } },
      { t: "lifeos_workspace", op: "insert", values: { id: workspaceId, owner_individual_id: actor, kind: "organisation", tenant_id: tenantId, name: o.name, ...system } },
      { t: "lifeos_membership", op: "insert", values: { workspace_id: workspaceId, individual_id: actor, role: "owner", ...system } },
    ],
  });
  return { tenantId, workspaceId };
}

export async function addMember(store: LifeosStore, actor: string, workspaceId: string, individualId: string, role: "admin" | "member" = "member") {
  await store.mutate({
    actor, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_membership", op: "insert", values: { workspace_id: workspaceId, individual_id: individualId, role, ...system } }],
  });
}

export type NewEntitlement = {
  individualId: string;
  source: "direct" | "competen_individual" | "organisation" | "platform_grant";
  tenantId?: string;
  planCode?: string;
  endsAt?: string;
};

/** One access period for one person. Step 6 gives Competen Individual a governed door to this. */
export async function grantEntitlement(store: LifeosStore, actor: string, e: NewEntitlement): Promise<string> {
  const id = crypto.randomUUID();
  await store.mutate({
    actor, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{
      t: "lifeos_entitlement", op: "insert",
      values: { id, individual_id: e.individualId, source: e.source, tenant_id: e.tenantId ?? null, plan_code: e.planCode ?? null, ends_at: e.endsAt ?? null, ...system },
    }],
  });
  return id;
}

/** The person's account exists and is active, and they hold a live entitlement. */
export async function readActiveIndividual(store: LifeosStore, issuer: string, subject: string): Promise<Row> {
  const [link] = await store.where("lifeos_identity_link", { issuer, subject, status: "active" }, { limit: 1 });
  if (!link) throw new LifeosError("forbidden", "LifeOS has not been enabled for this account.");
  const individual = await store.get("lifeos_individual", String(link.individual_id));
  if (!individual || individual.status !== "active") throw new LifeosError("forbidden", "This LifeOS account is not active.");
  // The live view judges the period by the database clock. No live entitlement means no access.
  const live = await store.where("lifeos_live_entitlement", { individual_id: String(individual.id) }, { limit: 1 });
  if (live.length === 0) throw new LifeosError("forbidden", "This account does not currently hold LifeOS access.");
  return individual;
}
