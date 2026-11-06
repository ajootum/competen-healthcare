import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { managesWorkspace } from "./access";
import { LifeosError, notFound } from "./errors";
import type { SessionIdentity } from "./optin";
import { provisionIndividual } from "./provision";
import { type RequestContext, commitOps, loadAccess } from "./service";
import type { LifeosStore, Op, Row } from "./types";

// LIFEOS-API-001 delivery step 8. Joining an organisation. A workspace owner or admin invites one email address, and the
// person who controls that signed-in address accepts. The token exists only in the link: the database holds its hash.

export const INVITE_DAYS = 14;

export const InviteInput = z.object({
  email: z.email().max(320),
  role: z.enum(["admin", "member"]).optional(),
}).strict().meta({ title: "InviteInput" });
export const AcceptInput = z.object({ token: z.string().min(20).max(200) }).strict().meta({ title: "AcceptInput" });
export const InviteActionInput = z.object({ expectedVersion: z.number().int().min(1) }).strict().meta({ title: "InviteActionInput" });

export const InvitationV1 = z.object({
  id: z.string(), workspaceId: z.string(), tenantId: z.string(), email: z.string(), role: z.enum(["admin", "member"]),
  expiresAt: z.string(), acceptedAt: z.string().nullable(), status: z.enum(["pending", "accepted", "revoked"]), version: z.number().int(), createdAt: z.string(),
}).meta({ title: "Invitation" });

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Shows just enough for a person to recognise their own address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export async function createInvitation(c: RequestContext, workspaceId: string, input: unknown): Promise<{ row: Row; token: string; replayed: boolean }> {
  const f = InviteInput.parse(input);
  const token = randomBytes(32).toString("base64url");
  const r = await commitOps(c, "lifeos_invitation", async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    if (!managesWorkspace(ctx.role)) throw new LifeosError("forbidden", "Only a workspace owner or admin can invite people.");
    const ws = await c.store.get("lifeos_workspace", workspaceId);
    if (!ws?.tenant_id) throw new LifeosError("conflict", "People can only be invited to an organisation workspace.");
    return [{
      t: "lifeos_invitation", op: "insert",
      values: {
        workspace_id: workspaceId, tenant_id: ws.tenant_id, owner_individual_id: ctx.individualId, email: f.email.toLowerCase(), role: f.role ?? "member",
        token_hash: hashToken(token), expires_at: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(), provenance_source: "user",
      },
    }];
  });
  return { row: r.data as Row, token, replayed: r.replayed };
}

export async function listInvitations(c: RequestContext, workspaceId: string): Promise<Row[]> {
  const ctx = await loadAccess(c.store, c.principal, workspaceId);
  if (!managesWorkspace(ctx.role)) throw new LifeosError("forbidden", "Only a workspace owner or admin can see invitations.");
  return c.store.where("lifeos_invitation", { workspace_id: workspaceId, status: "pending" }, { limit: 200 });
}

export async function revokeInvitation(c: RequestContext, workspaceId: string, id: string, input: unknown) {
  const { expectedVersion } = InviteActionInput.parse(input);
  return commitOps(c, "lifeos_invitation", async () => {
    const ctx = await loadAccess(c.store, c.principal, workspaceId);
    if (!managesWorkspace(ctx.role)) throw new LifeosError("forbidden", "Only a workspace owner or admin can revoke an invitation.");
    const row = await c.store.get("lifeos_invitation", id);
    if (!row || row.workspace_id !== workspaceId) throw notFound();
    if (row.status !== "pending") throw new LifeosError("conflict", "This invitation is no longer open.");
    return [{ t: "lifeos_invitation", op: "update", id, workspace_id: workspaceId, expected_version: expectedVersion, values: { status: "revoked", provenance_source: "user" } }];
  });
}

export type InvitePreview = { organisation: string; workspace: string; emailHint: string; email: string };

/** What a link says, before anyone signs in. A dead link and an unknown one read the same. */
export async function previewInvitation(store: LifeosStore, token: string): Promise<InvitePreview | null> {
  const [i] = await store.where("lifeos_live_invitation", { token_hash: hashToken(token) }, { limit: 1 });
  if (!i) return null;
  const [t, w] = await Promise.all([store.get("lifeos_tenant", String(i.tenant_id)), store.get("lifeos_workspace", String(i.workspace_id))]);
  if (!t || t.status !== "active" || !w) return null;
  return { organisation: String(t.name), workspace: String(w.name), emailHint: maskEmail(String(i.email)), email: String(i.email) };
}

/** The signed-in person accepts, and only if the invitation names their address. All of it commits together. */
export async function acceptInvitation(store: LifeosStore, id: SessionIdentity, token: string, traceId: string | null): Promise<{ workspaceId: string; individualId: string }> {
  const [i] = await store.where("lifeos_live_invitation", { token_hash: hashToken(token) }, { limit: 1 });
  if (!i) throw new LifeosError("not_found", "This invitation is no longer valid.");
  if (!id.email || id.email.toLowerCase() !== i.email) {
    throw new LifeosError("forbidden", "This invitation was sent to a different address. Sign in with that address to accept it.");
  }
  const tenant = await store.get("lifeos_tenant", String(i.tenant_id));
  if (!tenant || tenant.status !== "active") throw new LifeosError("not_found", "This invitation is no longer valid.");
  const p = await provisionIndividual(store, { issuer: id.issuer, subject: id.subject, displayName: id.displayName, accessSource: "organisation" });
  const workspaceId = String(i.workspace_id);
  const [member] = await store.where("lifeos_membership", { workspace_id: workspaceId, individual_id: p.individualId }, { limit: 1 });
  const ops: Op[] = [{
    t: "lifeos_invitation", op: "update", id: String(i.id), workspace_id: workspaceId, expected_version: Number(i.version),
    values: { status: "accepted", accepted_at: new Date().toISOString(), accepted_by: p.individualId, provenance_source: "user" },
  }];
  if (member) {
    ops.push({ t: "lifeos_membership", op: "update", id: String(member.id), workspace_id: workspaceId, values: { status: "active", role: i.role, provenance_source: "user" } });
  } else {
    ops.push({ t: "lifeos_membership", op: "insert", values: { workspace_id: workspaceId, individual_id: p.individualId, role: i.role, provenance_source: "user" } });
  }
  const live = await store.where("lifeos_live_entitlement", { individual_id: p.individualId, source: "organisation", tenant_id: String(i.tenant_id) }, { limit: 1 });
  if (live.length === 0) {
    ops.push({ t: "lifeos_entitlement", op: "insert", values: { individual_id: p.individualId, source: "organisation", tenant_id: i.tenant_id, provenance_source: "user" } });
  }
  await store.mutate({ actor: p.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId, ops });
  return { workspaceId, individualId: p.individualId };
}

/** Names of the active members of a workspace, for delegating to one of them. Nothing about what they hold. */
export async function workspaceDirectory(c: RequestContext, workspaceId: string): Promise<{ individualId: string; displayName: string }[]> {
  await loadAccess(c.store, c.principal, workspaceId);
  const members = await c.store.where("lifeos_membership", { workspace_id: workspaceId, status: "active" }, { limit: 500 });
  const people = await Promise.all(members.map(m => c.store.get("lifeos_individual", String(m.individual_id))));
  return people.filter((p): p is Row => !!p).map(p => ({ individualId: String(p.id), displayName: String(p.display_name) }));
}
