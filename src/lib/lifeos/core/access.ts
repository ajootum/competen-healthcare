import { LifeosError } from "./errors";
import type { Principal, Row } from "./types";

// LIFEOS-API-001 section 5. Default private, explicit otherwise.
//
// An organisation admin does NOT read a member's private records. That is the rule that lets one person use
// LifeOS across a family, an employer and a board. Admin only reaches records whose scope is `workspace`.

export type MemberRole = "owner" | "admin" | "member";

// LifeOS workspace roles, which are not Competen's estate roles. Read through these sets, so the estate's role-authorization
// ratchet (scripts/role-authorization-ratchet-harness.ts) keeps counting only what it is there to count.
const MANAGING_ROLES: ReadonlySet<string> = new Set<MemberRole>(["owner", "admin"]);
export const managesWorkspace = (role: string) => MANAGING_ROLES.has(role);
export const ownsWorkspace = (role: string) => role === ("owner" satisfies MemberRole);

export type LiveGrant = {
  ownerIndividualId: string;
  resourceType: string;
  resourceId: string | null;
  capability: "read" | "write";
};

export type AccessContext = {
  individualId: string;
  workspaceId: string;
  role: MemberRole;
  grants: LiveGrant[];
  /**
   * An app holding a token. It reaches only records the approving person owns: the consent screen says "your commitments",
   * and colleagues never approved the app. Workspace sharing, grants and delegation apply to people, signed in.
   */
  ownRecordsOnly: boolean;
};

export const toLiveGrant = (r: Row): LiveGrant => ({
  ownerIndividualId: String(r.owner_individual_id),
  resourceType: String(r.resource_type),
  resourceId: (r.resource_id as string | null) ?? null,
  capability: r.capability as "read" | "write",
});

const grantCovers = (g: LiveGrant, resourceType: string, record: Row, wants: "read" | "write") =>
  g.resourceType === resourceType
  && g.ownerIndividualId === record.owner_individual_id
  && (g.resourceId === null || g.resourceId === record.id)
  && (wants === "read" || g.capability === "write");

export function canRead(ctx: AccessContext, resourceType: string, record: Row, extraReaderColumn?: string): boolean {
  if (record.owner_individual_id === ctx.individualId) return true;
  if (ctx.ownRecordsOnly) return false;
  if (extraReaderColumn && record[extraReaderColumn] === ctx.individualId) return true;
  if (record.access_scope === "workspace") return true;
  return ctx.grants.some(g => grantCovers(g, resourceType, record, "read"));
}

export function canWrite(ctx: AccessContext, resourceType: string, record: Row): boolean {
  if (record.owner_individual_id === ctx.individualId) return true;
  if (ctx.ownRecordsOnly) return false;
  if (record.access_scope === "workspace" && managesWorkspace(ctx.role)) return true;
  return ctx.grants.some(g => grantCovers(g, resourceType, record, "write"));
}

/**
 * The same read rule as canRead, as a PostgREST `or` expression, so a list can never return more than a get
 * would. Every value placed in it is a validated UUID.
 */
export function visibilityFilter(ctx: AccessContext, resourceType: string, extraReaderColumn?: string): string {
  const uuid = /^[0-9a-f-]{36}$/i;
  const safe = (v: string) => {
    if (!uuid.test(v)) throw new LifeosError("unavailable", "LifeOS could not complete that just now.");
    return v;
  };
  if (ctx.ownRecordsOnly) return `owner_individual_id.eq.${safe(ctx.individualId)}`;
  const parts = [`owner_individual_id.eq.${safe(ctx.individualId)}`, "access_scope.eq.workspace"];
  if (extraReaderColumn) parts.push(`${extraReaderColumn}.eq.${safe(ctx.individualId)}`);
  for (const g of ctx.grants) {
    if (g.resourceType !== resourceType) continue;
    const owner = `owner_individual_id.eq.${safe(g.ownerIndividualId)}`;
    parts.push(g.resourceId ? `and(${owner},id.eq.${safe(g.resourceId)})` : owner);
  }
  return parts.join(",");
}

export function hasScope(p: Principal, scope: string): boolean {
  return p.scopes === "*" || p.scopes.includes(scope);
}
