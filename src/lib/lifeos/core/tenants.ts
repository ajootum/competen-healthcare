import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TenantBrandingV1 } from "./contracts";
import { LifeosError, notFound } from "./errors";
import { validTenantHostname } from "../host";
import type { LifeosStore, Row } from "./types";
import type { RequestContext, WriteResult } from "./service";
import { commitOps } from "./service";

// LIFEOS-API-001 delivery step 7. A tenant's own registry: its branding and its verified domains. One shared LifeOS: no
// tenant gets its own copy of anything. Only the tenant's accountable owner can change it. A member who is not the owner
// is told it does not exist.

export const VERIFY_PREFIX = "_lifeos-verify";

export const TenantV1 = z.object({
  id: z.string(), schemaVersion: z.number().int(), ownerIndividualId: z.string(), slug: z.string(), name: z.string(),
  kind: z.enum(["organisation", "partner_platform"]), branding: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "active", "suspended", "closed"]), version: z.number().int(), createdAt: z.string(), updatedAt: z.string(),
}).meta({ title: "Tenant" });

export const TenantDomainV1 = z.object({
  id: z.string(), schemaVersion: z.number().int(), tenantId: z.string(), hostname: z.string(), verificationToken: z.string(),
  status: z.enum(["pending", "verified", "suspended", "removed"]), verifiedAt: z.string().nullable(), version: z.number().int(),
  createdAt: z.string(), updatedAt: z.string(),
}).meta({ title: "TenantDomain" });

export const TenantPatchInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  branding: TenantBrandingV1.optional(),
  expectedVersion: z.number().int().min(1),
}).strict().meta({ title: "TenantPatchInput" });

export const DomainCreateInput = z.object({ hostname: z.string().min(1).max(253) }).strict().meta({ title: "DomainCreateInput" });
export const DomainActionInput = z.object({ expectedVersion: z.number().int().min(1) }).strict().meta({ title: "DomainActionInput" });

async function ownedTenant(c: RequestContext, tenantId: string): Promise<Row> {
  const t = await c.store.get("lifeos_tenant", tenantId);
  if (!t || t.owner_individual_id !== c.principal.individualId) throw notFound();
  return t;
}

export async function listOwnedTenants(c: RequestContext): Promise<Row[]> {
  return c.store.where("lifeos_tenant", { owner_individual_id: c.principal.individualId }, { limit: 200 });
}

export async function readTenant(c: RequestContext, tenantId: string): Promise<Row> {
  return ownedTenant(c, tenantId);
}

export async function patchTenant(c: RequestContext, tenantId: string, input: unknown): Promise<WriteResult> {
  const f = TenantPatchInput.parse(input);
  return commitOps(c, "lifeos_tenant", async () => {
    await ownedTenant(c, tenantId);
    const values: Row = { provenance_source: "user" };
    if (f.name !== undefined) values.name = f.name;
    if (f.branding !== undefined) values.branding = f.branding;
    return [{ t: "lifeos_tenant", op: "update", id: tenantId, expected_version: f.expectedVersion, values }];
  });
}

export async function listDomains(c: RequestContext, tenantId: string): Promise<Row[]> {
  await ownedTenant(c, tenantId);
  return (await c.store.where("lifeos_tenant_domain", { tenant_id: tenantId }, { limit: 50 })).filter(d => d.status !== "removed");
}

export async function addDomain(c: RequestContext, tenantId: string, input: unknown): Promise<WriteResult> {
  const { hostname } = DomainCreateInput.parse(input);
  const clean = validTenantHostname(hostname);
  if (!clean) throw new LifeosError("validation_failed", "That is not a hostname your organisation can use.");
  return commitOps(c, "lifeos_tenant_domain", async () => {
    await ownedTenant(c, tenantId);
    return [{
      t: "lifeos_tenant_domain", op: "insert",
      values: { tenant_id: tenantId, hostname: clean, verification_token: randomBytes(24).toString("hex"), provenance_source: "user" },
    }];
  });
}

/** True when the expected token is among a name's TXT records. Records split into chunks are joined first. */
export function txtMatches(records: string[][], token: string): boolean {
  return records.some(chunks => chunks.join("") === token);
}

export async function verifyDomain(c: RequestContext, tenantId: string, domainId: string, input: unknown): Promise<WriteResult> {
  const { expectedVersion } = DomainActionInput.parse(input);
  if (!c.resolveTxt) throw new LifeosError("unavailable", "Domain verification is not available here.");
  return commitOps(c, "lifeos_tenant_domain", async () => {
    await ownedTenant(c, tenantId);
    const d = await c.store.get("lifeos_tenant_domain", domainId);
    if (!d || d.tenant_id !== tenantId || d.status === "removed") throw notFound();
    if (d.status === "verified") throw new LifeosError("conflict", "This domain is already verified.");
    const name = `${VERIFY_PREFIX}.${String(d.hostname)}`;
    const records = await c.resolveTxt!(name).catch(() => [] as string[][]);
    if (!txtMatches(records, String(d.verification_token))) {
      throw new LifeosError("conflict", `The TXT record was not found at ${name}. DNS changes can take time to appear.`, { details: { name } });
    }
    return [{ t: "lifeos_tenant_domain", op: "update", id: domainId, expected_version: expectedVersion, values: { status: "verified", verified_at: new Date().toISOString(), provenance_source: "user" } }];
  });
}

export async function removeDomain(c: RequestContext, tenantId: string, domainId: string, input: unknown): Promise<WriteResult> {
  const { expectedVersion } = DomainActionInput.parse(input);
  return commitOps(c, "lifeos_tenant_domain", async () => {
    await ownedTenant(c, tenantId);
    const d = await c.store.get("lifeos_tenant_domain", domainId);
    if (!d || d.tenant_id !== tenantId || d.status === "removed") throw notFound();
    return [{ t: "lifeos_tenant_domain", op: "update", id: domainId, expected_version: expectedVersion, values: { status: "removed", provenance_source: "user" } }];
  });
}

export type TenantSite = { tenantId: string; name: string; branding: { productName?: string; logoUrl?: string; primaryColor?: string } };

/** A verified host of an active tenant, or null. A hostname that is not verified serves nothing. */
export async function resolveTenantSite(store: LifeosStore, host: string): Promise<TenantSite | null> {
  const [d] = await store.where("lifeos_tenant_domain", { hostname: host, status: "verified" }, { limit: 1 });
  if (!d) return null;
  const t = await store.get("lifeos_tenant", String(d.tenant_id));
  if (!t || t.status !== "active") return null;
  const parsed = TenantBrandingV1.safeParse(t.branding ?? {});
  return { tenantId: String(t.id), name: String(t.name), branding: parsed.success ? parsed.data : {} };
}
