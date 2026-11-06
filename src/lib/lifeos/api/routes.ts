import { z } from "zod";
import {
  AccessStatusV1, ActivateInput, AuditEventV1, EntitlementV1, GenerateInput, VersionInput, IndividualV1, MeInput, MembershipV1, SuggestionV1, TransitionInput, WorkspaceV1,
} from "../core/contracts";
import { RESOURCES, RESOURCE_NAMES, type ResourceName, camelRow } from "../core/resources";
import { LifeosError } from "../core/errors";
import * as svc from "../core/service";
import * as tenants from "../core/tenants";
import * as invitations from "../core/invitations";
import * as oauth from "../core/oauth";
import { exportOwnRecords } from "../core/export";
import type { RequestContext } from "../core/service";
import { type SessionIdentity, accessStatus, activateFromCompetenIndividual } from "../core/optin";
import type { LifeosStore, Row } from "../core/types";
import { buildOpenApi } from "./openapi";

// LIFEOS-API-001 section 6. The one route table. The dispatcher, the scope check, the rate limit and the OpenAPI
// document all read it, so a new endpoint cannot exist without them.
//
// `visibility` is the public API boundary. EVERY ROUTE IS internal TODAY. Step 9 approves a capability by changing
// this value, and a public document can then list only those routes.

export type Bucket = "read" | "write" | "generate";
export type Visibility = "internal" | "public";

export type HandlerResult = { status?: number; data: unknown; nextCursor?: string | null; replayed?: boolean };
export type RouteInput = { ctx: RequestContext; params: Record<string, string>; body: unknown; query: Record<string, string | number | undefined> };

export type Route = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
  visibility: Visibility;
  /** Null is available to any principal. Otherwise the scope a delegated token must hold. */
  scope: string | null;
  bucket: Bucket;
  input?: z.ZodType;
  output: z.ZodType;
  list?: boolean;
  /** "session": this route comes before holding LifeOS. It has a signed-in identity and no principal. */
  /** "session": before holding LifeOS, with a signed-in identity. "open": the standard OAuth endpoints, with no identity. */
  admission?: "session" | "open";
  /** A complete response, for an endpoint whose format a standard fixes. */
  openHandler?: (i: { store: LifeosStore; body: Record<string, unknown> }) => Promise<Response>;
  sessionHandler?: (i: { store: LifeosStore; identity: SessionIdentity; body: unknown }) => Promise<HandlerResult>;
  handler: (i: RouteInput) => Promise<HandlerResult>;
};

const presentIndividual = (r: Row) => IndividualV1.parse(camelRow(r));
const presentWorkspace = (r: Row) => WorkspaceV1.parse(camelRow(r));
const presentMember = (r: Row) => MembershipV1.parse(camelRow(r));

const created = (r: svc.WriteResult): HandlerResult => ({ status: r.replayed ? 200 : 201, data: r.data, replayed: r.replayed });
const changed = (r: svc.WriteResult): HandlerResult => ({ data: r.data, replayed: r.replayed });

const MeOutput = z.object({ individual: IndividualV1, entitlements: z.array(EntitlementV1), workspaces: z.array(WorkspaceV1) }).meta({ title: "Me" });
const RefsOutput = z.array(z.object({ t: z.string(), id: z.string() }));

function resourceRoutes(name: ResourceName): Route[] {
  const def = RESOURCES[name];
  const base = `/workspaces/:ws/${name}`;
  const routes: Route[] = [
    {
      method: "GET", path: base, summary: `List ${name}`, visibility: "internal", scope: def.scopes.read, bucket: "read", output: def.output, list: true,
      handler: async ({ ctx, params, query }) => svc.listResource(ctx, params.ws, name, query),
    },
    {
      method: "GET", path: `${base}/:id`, summary: `Read one of ${name}`, visibility: "internal", scope: def.scopes.read, bucket: "read", output: def.output,
      handler: async ({ ctx, params }) => ({ data: await svc.getResource(ctx, params.ws, name, params.id) }),
    },
  ];
  if (def.create) routes.push({
    method: "POST", path: base, summary: `Create in ${name}`, visibility: "internal", scope: def.scopes.write ?? null, bucket: "write", input: def.create, output: def.output,
    handler: async ({ ctx, params, body }) => created(await svc.createResource(ctx, params.ws, name, body)),
  });
  if (def.patch) routes.push({
    method: "PATCH", path: `${base}/:id`, summary: `Edit one of ${name}`, visibility: "internal", scope: def.scopes.write ?? null, bucket: "write", input: def.patch, output: def.output,
    handler: async ({ ctx, params, body }) => changed(await svc.patchResource(ctx, params.ws, name, params.id, body)),
  });
  if (def.machine) routes.push({
    method: "POST", path: `${base}/:id/transition`, summary: `Change the lifecycle status of one of ${name}`, visibility: "internal", scope: def.scopes.write ?? null, bucket: "write", input: TransitionInput, output: def.output,
    handler: async ({ ctx, params, body }) => changed(await svc.transitionResource(ctx, params.ws, name, params.id, body)),
  });
  if (def.hasArchive && def.create) routes.push(
    {
      method: "POST", path: `${base}/:id/archive`, summary: `Archive one of ${name}`, visibility: "internal", scope: def.scopes.write ?? null, bucket: "write", input: VersionInput, output: def.output,
      handler: async ({ ctx, params, body }) => changed(await svc.setArchived(ctx, params.ws, name, params.id, true, body)),
    },
    {
      method: "POST", path: `${base}/:id/restore`, summary: `Restore one of ${name}`, visibility: "internal", scope: def.scopes.write ?? null, bucket: "write", input: VersionInput, output: def.output,
      handler: async ({ ctx, params, body }) => changed(await svc.setArchived(ctx, params.ws, name, params.id, false, body)),
    },
  );
  return routes;
}

const presentTenant = (r: Row) => tenants.TenantV1.parse(camelRow(r));
const presentDomain = (r: Row) => tenants.TenantDomainV1.parse(camelRow(r));

const presentInvitation = (r: Row) => invitations.InvitationV1.parse(camelRow(r));

const noPrincipal = async (): Promise<HandlerResult> => { throw new Error("session route reached the principal path"); };

const oauthError = (e: unknown) => {
  if (e instanceof oauth.OAuthError) return Response.json({ error: e.error }, { status: e.status, headers: { "Cache-Control": "no-store" } });
  throw e;
};

export const ROUTES: Route[] = [
  {
    method: "POST", path: "/oauth/token", summary: "OAuth 2.1 token endpoint: authorization_code with PKCE, and refresh_token", visibility: "public", scope: null, bucket: "write", output: z.record(z.string(), z.unknown()),
    admission: "open", handler: noPrincipal,
    openHandler: async ({ store, body }) => {
      try {
        const tokens = body.grant_type === "authorization_code" ? await oauth.exchangeCode(store, body)
          : body.grant_type === "refresh_token" ? await oauth.refreshTokens(store, body)
          : (() => { throw new oauth.OAuthError("unsupported_grant_type"); })();
        return Response.json(tokens, { headers: { "Cache-Control": "no-store" } });
      } catch (e) { return oauthError(e); }
    },
  },
  {
    method: "POST", path: "/oauth/revoke", summary: "OAuth token revocation (RFC 7009)", visibility: "public", scope: null, bucket: "write", output: z.record(z.string(), z.unknown()),
    admission: "open", handler: noPrincipal,
    openHandler: async ({ store, body }) => {
      await oauth.revokeToken(store, body.token);
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    },
  },
  {
    method: "POST", path: "/oauth/authorize", summary: "The signed-in person allows an app. Never reachable with a delegated token.", visibility: "internal", scope: null, bucket: "write", input: oauth.AuthorizeInput, output: z.object({ redirect: z.string() }),
    handler: async ({ ctx, body }) => {
      if (ctx.principal.kind !== "session") throw new LifeosError("forbidden", "Allowing an app needs the person, signed in.");
      return { data: await oauth.approve(ctx.store, ctx.principal.individualId, oauth.AuthorizeInput.parse(body), ctx.traceId) };
    },
  },
  {
    method: "GET", path: "/me/connected-apps", summary: "Apps the person has allowed", visibility: "internal", scope: null, bucket: "read", output: z.object({ id: z.string(), appName: z.string(), scopes: z.array(z.string()), connectedAt: z.string() }), list: true,
    handler: async ({ ctx }) => ({ data: await oauth.listConnectedApps(ctx.store, ctx.principal.individualId), nextCursor: null }),
  },
  {
    method: "POST", path: "/me/connected-apps/:id/disconnect", summary: "End an app's access", visibility: "internal", scope: null, bucket: "write", input: z.object({}).strict(), output: z.object({ disconnected: z.boolean() }),
    handler: async ({ ctx, params }) => {
      await oauth.disconnectApp(ctx.store, ctx.principal.individualId, params.id);
      return { data: { disconnected: true } };
    },
  },
  {
    method: "GET", path: "/access/status", summary: "Whether this signed-in person may turn on LifeOS", visibility: "internal", scope: null, bucket: "read", output: AccessStatusV1,
    admission: "session", handler: noPrincipal,
    sessionHandler: async ({ store, identity }) => ({ data: await accessStatus(store, identity) }),
  },
  {
    method: "POST", path: "/access/competen-individual", summary: "A Competen Individual person's own choice to turn on LifeOS, accepting the terms", visibility: "internal", scope: null, bucket: "write", input: ActivateInput, output: z.object({ individualId: z.string(), created: z.boolean() }),
    admission: "session", handler: noPrincipal,
    sessionHandler: async ({ store, identity, body }) => {
      const r = await activateFromCompetenIndividual(store, identity, ActivateInput.parse(body).termsVersion);
      return { status: r.created ? 201 : 200, data: r };
    },
  },
  {
    method: "POST", path: "/access/invitation", summary: "The invited person accepts, signed in with the invited address", visibility: "internal", scope: null, bucket: "write", input: invitations.AcceptInput, output: z.object({ workspaceId: z.string(), individualId: z.string() }),
    admission: "session", handler: noPrincipal,
    sessionHandler: async ({ store, identity, body }) => ({ data: await invitations.acceptInvitation(store, identity, invitations.AcceptInput.parse(body).token, null) }),
  },
  {
    method: "GET", path: "/access/export", summary: "Everything the signed-in person owns, including after their access has ended", visibility: "internal", scope: null, bucket: "generate", output: z.record(z.string(), z.unknown()),
    admission: "session", handler: noPrincipal,
    sessionHandler: async ({ store, identity }) => ({ data: await exportOwnRecords(store, identity) }),
  },
  {
    method: "POST", path: "/me/entitlements/:id/end", summary: "Turn off LifeOS access the person chose. Their records are kept.", visibility: "internal", scope: null, bucket: "write", input: VersionInput, output: EntitlementV1,
    handler: async ({ ctx, params, body }) => {
      const r = await svc.endOwnEntitlement(ctx, params.id, body);
      return { data: EntitlementV1.parse(camelRow(r)) };
    },
  },
  {
    method: "GET", path: "/me", summary: "The caller and their workspaces", visibility: "internal", scope: "profile:read", bucket: "read", output: MeOutput,
    handler: async ({ ctx }) => {
      const me = await svc.getMe(ctx);
      return { data: { individual: presentIndividual(me.individual), entitlements: me.entitlements.map(r => EntitlementV1.parse(camelRow(r))), workspaces: me.workspaces.map(presentWorkspace) } };
    },
  },
  {
    method: "PATCH", path: "/me", summary: "The caller's own settings", visibility: "internal", scope: null, bucket: "write", input: MeInput, output: IndividualV1,
    handler: async ({ ctx, body }) => ({ data: presentIndividual(await svc.updateMe(ctx, body)) }),
  },
  {
    method: "GET", path: "/workspaces", summary: "Workspaces the caller is an active member of", visibility: "internal", scope: "profile:read", bucket: "read", output: WorkspaceV1, list: true,
    handler: async ({ ctx }) => ({ data: (await svc.listWorkspaces(ctx)).map(presentWorkspace), nextCursor: null }),
  },
  {
    method: "GET", path: "/workspaces/:ws", summary: "One workspace", visibility: "internal", scope: null, bucket: "read", output: WorkspaceV1,
    handler: async ({ ctx, params }) => ({ data: presentWorkspace(await svc.getWorkspace(ctx, params.ws)) }),
  },
  {
    method: "GET", path: "/workspaces/:ws/members", summary: "Members, for a workspace owner or admin", visibility: "internal", scope: "workspaces:manage", bucket: "read", output: MembershipV1, list: true,
    handler: async ({ ctx, params }) => ({ data: (await svc.listMembers(ctx, params.ws)).map(presentMember), nextCursor: null }),
  },
  {
    method: "POST", path: "/workspaces/:ws/leave", summary: "Leave an organisation workspace. The personal workspace is untouched.", visibility: "internal", scope: "workspaces:leave", bucket: "write", input: z.object({}).strict(), output: RefsOutput,
    handler: async ({ ctx, params }) => changed(await svc.leaveWorkspace(ctx, params.ws)),
  },
  {
    method: "GET", path: "/workspaces/:ws/audit-events", summary: "The caller's own audit trail in this workspace", visibility: "internal", scope: "audit:read", bucket: "read", output: AuditEventV1, list: true,
    handler: async ({ ctx, params, query }) => {
      const r = await svc.listAudit(ctx, params.ws, query);
      return { data: r.rows.map(row => AuditEventV1.parse(camelRow(row))), nextCursor: r.nextCursor };
    },
  },
  {
    method: "POST", path: "/workspaces/:ws/suggestions/generate", summary: "Run the rules. Writes only suggestion rows. Nothing else changes.", visibility: "internal", scope: "suggestions:write", bucket: "generate", input: GenerateInput, output: z.array(SuggestionV1),
    handler: async ({ ctx, params, body }) => {
      const r = await svc.generateSuggestions(ctx, params.ws, GenerateInput.parse(body ?? {}));
      return { data: r.data, replayed: r.replayed };
    },
  },
  {
    method: "POST", path: "/workspaces/:ws/suggestions/:id/accept", summary: "The person's decision to apply a suggestion", visibility: "internal", scope: "suggestions:write", bucket: "write", input: z.object({}).strict(), output: SuggestionV1,
    handler: async ({ ctx, params }) => changed(await svc.acceptSuggestion(ctx, params.ws, params.id)),
  },
  {
    method: "POST", path: "/workspaces/:ws/suggestions/:id/dismiss", summary: "The person's decision to dismiss a suggestion", visibility: "internal", scope: "suggestions:write", bucket: "write", input: z.object({}).strict(), output: SuggestionV1,
    handler: async ({ ctx, params }) => changed(await svc.dismissSuggestion(ctx, params.ws, params.id)),
  },
  {
    method: "GET", path: "/tenants", summary: "Tenants the caller is accountable for", visibility: "internal", scope: "tenants:read", bucket: "read", output: tenants.TenantV1, list: true,
    handler: async ({ ctx }) => ({ data: (await tenants.listOwnedTenants(ctx)).map(presentTenant), nextCursor: null }),
  },
  {
    method: "GET", path: "/tenants/:tenant", summary: "One tenant, for its owner", visibility: "internal", scope: "tenants:read", bucket: "read", output: tenants.TenantV1,
    handler: async ({ ctx, params }) => ({ data: presentTenant(await tenants.readTenant(ctx, params.tenant)) }),
  },
  {
    method: "PATCH", path: "/tenants/:tenant", summary: "A tenant's name and branding", visibility: "internal", scope: "tenants:write", bucket: "write", input: tenants.TenantPatchInput, output: tenants.TenantV1,
    handler: async ({ ctx, params, body }) => { const r = await tenants.patchTenant(ctx, params.tenant, body); return { data: presentTenant(r.data as Row), replayed: r.replayed }; },
  },
  {
    method: "GET", path: "/tenants/:tenant/domains", summary: "A tenant's domains", visibility: "internal", scope: "tenants:read", bucket: "read", output: tenants.TenantDomainV1, list: true,
    handler: async ({ ctx, params }) => ({ data: (await tenants.listDomains(ctx, params.tenant)).map(presentDomain), nextCursor: null }),
  },
  {
    method: "POST", path: "/tenants/:tenant/domains", summary: "Claim a domain. It serves nothing until verified.", visibility: "internal", scope: "tenants:write", bucket: "write", input: tenants.DomainCreateInput, output: tenants.TenantDomainV1,
    handler: async ({ ctx, params, body }) => { const r = await tenants.addDomain(ctx, params.tenant, body); return { status: r.replayed ? 200 : 201, data: presentDomain(r.data as Row), replayed: r.replayed }; },
  },
  {
    method: "POST", path: "/tenants/:tenant/domains/:domain/verify", summary: "Check the domain's TXT record", visibility: "internal", scope: "tenants:write", bucket: "write", input: tenants.DomainActionInput, output: tenants.TenantDomainV1,
    handler: async ({ ctx, params, body }) => { const r = await tenants.verifyDomain(ctx, params.tenant, params.domain, body); return { data: presentDomain(r.data as Row), replayed: r.replayed }; },
  },
  {
    method: "POST", path: "/tenants/:tenant/domains/:domain/remove", summary: "Stop serving a domain", visibility: "internal", scope: "tenants:write", bucket: "write", input: tenants.DomainActionInput, output: tenants.TenantDomainV1,
    handler: async ({ ctx, params, body }) => { const r = await tenants.removeDomain(ctx, params.tenant, params.domain, body); return { data: presentDomain(r.data as Row), replayed: r.replayed }; },
  },
  {
    method: "GET", path: "/workspaces/:ws/directory", summary: "Names of a workspace's active members, for delegating", visibility: "internal", scope: "workspaces:read", bucket: "read", output: z.object({ individualId: z.string(), displayName: z.string() }), list: true,
    handler: async ({ ctx, params }) => ({ data: await invitations.workspaceDirectory(ctx, params.ws), nextCursor: null }),
  },
  {
    method: "GET", path: "/workspaces/:ws/invitations", summary: "Open invitations, for a workspace owner or admin", visibility: "internal", scope: "workspaces:manage", bucket: "read", output: invitations.InvitationV1, list: true,
    handler: async ({ ctx, params }) => ({ data: (await invitations.listInvitations(ctx, params.ws)).map(presentInvitation), nextCursor: null }),
  },
  {
    method: "POST", path: "/workspaces/:ws/invitations", summary: "Invite one address. The link is returned once and only its hash is kept.", visibility: "internal", scope: "workspaces:manage", bucket: "write", input: invitations.InviteInput, output: z.object({ invitation: invitations.InvitationV1, token: z.string().nullable() }),
    handler: async ({ ctx, params, body }) => {
      const r = await invitations.createInvitation(ctx, params.ws, body);
      return { status: r.replayed ? 200 : 201, data: { invitation: presentInvitation(r.row), token: r.token }, replayed: r.replayed };
    },
  },
  {
    method: "POST", path: "/workspaces/:ws/invitations/:id/revoke", summary: "Withdraw an open invitation", visibility: "internal", scope: "workspaces:manage", bucket: "write", input: invitations.InviteActionInput, output: invitations.InvitationV1,
    handler: async ({ ctx, params, body }) => { const r = await invitations.revokeInvitation(ctx, params.ws, params.id, body); return { data: presentInvitation(r.data as Row), replayed: r.replayed }; },
  },
  // Fixed paths above win over the parameterised resource routes below.
  ...RESOURCE_NAMES.flatMap(resourceRoutes),
  {
    method: "GET", path: "/public/openapi.json", summary: "The public API's OpenAPI document", visibility: "public", scope: null, bucket: "read", output: z.record(z.string(), z.unknown()),
    admission: "open", handler: noPrincipal,
    openHandler: async () => Response.json(buildOpenApi(ROUTES, "public"), { headers: { "Cache-Control": "public, max-age=300" } }),
  },
  {
    method: "GET", path: "/openapi.json", summary: "This API's OpenAPI document", visibility: "internal", scope: null, bucket: "read", output: z.record(z.string(), z.unknown()),
    handler: async () => ({ data: buildOpenApi(ROUTES) }),
  },
];

/**
 * THE PUBLIC API BOUNDARY. Only these capabilities are reachable with a delegated token. Adding one is a product decision,
 * written here and held by scripts/lifeos-seal-harness.ts. Approving apps, deciding suggestions, sharing, grants, tenants and
 * invitations stay with the person.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  "GET /me", "GET /workspaces",
  "GET /workspaces/:ws/commitments", "POST /workspaces/:ws/commitments",
  "GET /workspaces/:ws/commitments/:id", "PATCH /workspaces/:ws/commitments/:id", "POST /workspaces/:ws/commitments/:id/transition",
  "GET /workspaces/:ws/worlds", "GET /workspaces/:ws/worlds/:id",
  "GET /workspaces/:ws/calendar-events", "GET /workspaces/:ws/protected-blocks",
];
for (const r of ROUTES) if (PUBLIC_ROUTES.includes(`${r.method} ${r.path}`)) r.visibility = "public";

export function matchRoute(method: string, segments: string[]): { route: Route; params: Record<string, string> } | "method_not_allowed" | null {
  let pathMatched = false;
  for (const route of ROUTES) {
    const parts = route.path.split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = parts.every((p, i) => {
      if (p.startsWith(":")) { params[p.slice(1)] = segments[i]; return true; }
      return p === segments[i];
    });
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? "method_not_allowed" : null;
}

