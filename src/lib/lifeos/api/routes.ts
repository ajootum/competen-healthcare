import { z } from "zod";
import {
  AuditEventV1, EntitlementV1, GenerateInput, IndividualV1, MeInput, MembershipV1, SuggestionV1, TransitionInput, VersionInput, WorkspaceV1,
} from "../core/contracts";
import { RESOURCES, RESOURCE_NAMES, type ResourceName, camelRow } from "../core/resources";
import * as svc from "../core/service";
import type { RequestContext } from "../core/service";
import type { Row } from "../core/types";
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

export const ROUTES: Route[] = [
  {
    method: "GET", path: "/me", summary: "The caller and their workspaces", visibility: "internal", scope: null, bucket: "read", output: MeOutput,
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
    method: "GET", path: "/workspaces", summary: "Workspaces the caller is an active member of", visibility: "internal", scope: null, bucket: "read", output: WorkspaceV1, list: true,
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
  // Fixed paths above win over the parameterised resource routes below.
  ...RESOURCE_NAMES.flatMap(resourceRoutes),
  {
    method: "GET", path: "/openapi.json", summary: "This API's OpenAPI document", visibility: "internal", scope: null, bucket: "read", output: z.record(z.string(), z.unknown()),
    handler: async () => ({ data: buildOpenApi(ROUTES) }),
  },
];

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

