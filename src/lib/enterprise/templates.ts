// Enterprise Templates module (ENT-001 §6) loaders — reusable organisational
// structures/configurations. Registry = ent_templates (all types) unified with
// plat_org_templates (control-plane org templates, read-only here). Live data.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const TEMPLATE_TYPES = ["organisation", "facility", "department", "unit", "role", "workspace", "structure"] as const;
export const TEMPLATE_STATUSES = ["draft", "review", "approved", "published", "assigned", "retired"] as const;
// Allowed forward/back transitions in the template lifecycle.
export const NEXT_STATUS: Record<string, { label: string; to: string }[]> = {
  draft: [{ label: "Submit for review", to: "review" }],
  review: [{ label: "Approve", to: "approved" }, { label: "Return to draft", to: "draft" }],
  approved: [{ label: "Publish", to: "published" }],
  published: [{ label: "Retire", to: "retired" }],
  assigned: [{ label: "Retire", to: "retired" }],
  retired: [{ label: "Restore to draft", to: "draft" }],
};

export async function loadTemplateDirectory(admin: any) {
  const [tplRes, platRes] = await Promise.all([
    admin.from("ent_templates").select("*").order("created_at", { ascending: false }).limit(4000),
    admin.from("plat_org_templates").select("id, code, name, version, is_active, created_at").limit(2000),
  ]);
  const ent = tplRes.error ? [] : ((tplRes.data ?? []) as any[]);
  const plat = platRes.error ? [] : ((platRes.data ?? []) as any[]);

  const rows = [
    ...ent.map(t => ({
      id: t.id, name: t.name, code: t.code ?? null, type: t.template_type ?? "organisation",
      version: `${t.version_major ?? 1}.${t.version_minor ?? 0}`, status: t.status ?? "draft",
      source: "ent" as const, updatedAt: t.updated_at ?? t.created_at,
    })),
    ...plat.map(t => ({
      id: t.id, name: t.name, code: t.code ?? null, type: "organisation",
      version: String(t.version ?? "1"), status: t.is_active ? "published" : "retired",
      source: "plat" as const, updatedAt: t.created_at,
    })),
  ];

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  const summary = {
    total: rows.length,
    // 'assigned' (a deployed-but-still-reusable template) counts as published so
    // the status cards always reconcile to the total.
    published: rows.filter(r => r.status === "published" || r.status === "assigned").length,
    draft: rows.filter(r => ["draft", "review", "approved"].includes(r.status)).length,
    retired: rows.filter(r => r.status === "retired").length,
    types: Object.keys(byType).length, byType,
  };
  return { rows, summary };
}

export async function loadTemplateProfile(admin: any, id: string) {
  const { data: t } = await admin.from("ent_templates").select("*").eq("id", id).maybeSingle();
  if (!t) return null;
  const [creatorRes, auditRes, orgRes] = await Promise.all([
    t.created_by ? admin.from("profiles").select("id, full_name").eq("id", t.created_by).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").eq("entity_type", "template").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
    admin.from("organisations").select("id, name").order("name").limit(2000),
  ]);
  const audit = auditRes.error ? [] : ((auditRes.data ?? []) as any[]);

  return {
    template: {
      id: t.id, name: t.name, code: t.code ?? null, type: t.template_type ?? "organisation",
      version: `${t.version_major ?? 1}.${t.version_minor ?? 0}`, status: t.status ?? "draft",
      description: t.description ?? null, spec: t.spec ?? {}, createdBy: (creatorRes as any).data?.full_name ?? null,
      createdAt: t.created_at, updatedAt: t.updated_at,
    },
    organisations: ((orgRes.data ?? []) as any[]).map(o => ({ id: o.id, name: o.name })),
    audit, auditReady: !auditRes.error,
  };
}
