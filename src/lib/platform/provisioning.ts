// Tenant Provisioning Engine (LCP-001 §2 — the headline acceptance criterion).
// One call turns a template + a name into a fully-formed tenant: tenant →
// organisation → hospital → default departments → subscription, in one audited,
// idempotent, rollback-capable workflow. Replaces the bare `INSERT into
// organisations` that "create org" was before. Runs on the service-role client;
// the caller (an API route) must already have enforced landlord access.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { landlordAudit } from "./landlord";

export type ProvisionInput = {
  name: string;
  templateCode: string;
  country?: string | null;
  status?: "trial" | "active";
};

export type ProvisionResult = {
  ok: boolean;
  tenantId?: string; organisationId?: string; hospitalId?: string;
  departments?: number;
  error?: string;
  steps: string[];
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "tenant";

export async function provisionTenant(
  admin: any,
  caller: { userId: string; fullName: string | null },
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const steps: string[] = [];
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Name is required", steps };

  // Rollback ledger — delete in reverse on any failure.
  const created: { table: string; id: string }[] = [];
  const rollback = async () => {
    for (const c of created.reverse()) { try { await admin.from(c.table).delete().eq("id", c.id); } catch { /* best effort */ } }
  };

  try {
    // 1. Template
    const { data: tpl } = await admin.from("plat_org_templates").select("code, name, spec").eq("code", input.templateCode).eq("is_active", true).maybeSingle();
    if (!tpl) return { ok: false, error: `Unknown template "${input.templateCode}"`, steps };
    const spec = (tpl.spec ?? {}) as any;
    const tenantType = spec.tenant_type ?? "hospital";
    const planCode = spec.plan ?? "starter";
    const depts: string[] = Array.isArray(spec.default_departments) ? spec.default_departments : [];
    steps.push(`Loaded template "${tpl.name}"`);

    // 2. Tenant — idempotent by slug
    const baseSlug = slugify(name);
    const { data: existing } = await admin.from("tenants").select("id").eq("slug", baseSlug).maybeSingle();
    if (existing) return { ok: false, error: `A tenant with slug "${baseSlug}" already exists`, steps };

    const { data: tenant, error: tErr } = await admin.from("tenants").insert({
      name, slug: baseSlug, tenant_type: tenantType, status: input.status ?? "trial",
      primary_country: input.country ?? null,
    }).select("id").single();
    if (tErr || !tenant) throw new Error(`Tenant create failed: ${tErr?.message ?? "unknown"}`);
    created.push({ table: "tenants", id: tenant.id });
    steps.push("Created tenant");

    // 3. Organisation
    const orgType = tenantType === "university" || tenantType === "nursing_school" ? "academic"
      : tenantType === "ministry" ? "government" : tenantType === "ngo" ? "ngo" : "private";
    const { data: org, error: oErr } = await admin.from("organisations").insert({
      name, type: orgType, hq_country: input.country ?? null, is_active: true, tenant_id: tenant.id,
    }).select("id").single();
    if (oErr || !org) throw new Error(`Organisation create failed: ${oErr?.message ?? "unknown"}`);
    created.push({ table: "organisations", id: org.id });
    steps.push("Created organisation");

    // 4. Hospital / primary facility
    const { data: hosp, error: hErr } = await admin.from("hospitals").insert({
      name, country: input.country ?? "Unknown", type: tenantType === "clinic" ? "clinic" : "hospital",
      organisation_id: org.id, tenant_id: tenant.id,
    }).select("id").single();
    if (hErr || !hosp) throw new Error(`Facility create failed: ${hErr?.message ?? "unknown"}`);
    created.push({ table: "hospitals", id: hosp.id });
    steps.push("Created primary facility");

    // 5. Default departments (best-effort; not rollback-critical)
    let deptCount = 0;
    if (depts.length) {
      const rows = depts.map(d => ({ hospital_id: hosp.id, name: d, is_active: true }));
      const { data: dins } = await admin.from("departments").insert(rows).select("id");
      deptCount = (dins ?? []).length;
      steps.push(`Seeded ${deptCount} departments`);
    }

    // 6. Subscription from the template's plan
    try {
      const { data: plan } = await admin.from("plat_plans").select("id").eq("code", planCode).maybeSingle();
      if (plan) {
        await admin.from("plat_subscriptions").insert({
          tenant_id: tenant.id, plan_id: plan.id, status: input.status === "active" ? "active" : "trialing",
          trial_ends_at: input.status === "active" ? null : new Date(Date.now() + 30 * 864e5).toISOString(),
        });
        steps.push(`Attached "${planCode}" plan`);
      }
    } catch { /* plan/subscription optional */ }

    // 7. Audit
    await landlordAudit(admin, caller, {
      action: "provision_tenant", entity_type: "tenant", entity_id: tenant.id, entity_name: name,
      tenant_id: tenant.id, new_value: { template: input.templateCode, plan: planCode, departments: deptCount },
    });

    return { ok: true, tenantId: tenant.id, organisationId: org.id, hospitalId: hosp.id, departments: deptCount, steps };
  } catch (e: any) {
    await rollback();
    steps.push("Rolled back");
    return { ok: false, error: e?.message ?? "Provisioning failed", steps };
  }
}
