import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Educator framework authoring ────────────────────────────────────────────
// Widens framework / domain / competency authoring to the educator role, but
// ONLY on frameworks that belong to the educator's own hospital. The shared
// COMPETEN master library (scope = "master", hospital_id = null) stays
// read-only here and is governed centrally by admins via /api/content/*.
//
// Every mutation is hospital-scoped (guardFramework) and audit-logged. This
// route never touches master content, so one hospital can never rewrite the
// library every other hospital inherits.

const AUTHOR_ROLES = ["educator", "hospital_admin", "super_admin"];
const LIBRARIES = ["core", "specialty", "role"];
const LIFECYCLE: Record<string, string> = {
  submit_review: "in_review",
  publish: "published",
  archive: "archived",
  revert: "draft",
};

type Ctx = {
  admin: SupabaseClient;
  userId: string;
  name: string;
  hospitalId: string | null;
  isSuper: boolean;
};

async function context(): Promise<Ctx | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles").select("role, roles, hospital_id, full_name").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => AUTHOR_ROLES.includes(r))) return null;
  return {
    admin, userId: user.id, name: me?.full_name ?? "Educator",
    hospitalId: me?.hospital_id ?? null, isSuper: roles.includes("super_admin"),
  };
}

type Framework = { id: string; name: string; scope: string | null; hospital_id: string | null; pub_status: string | null; version_num: number | null };
type Guard = { ok: true; fw: Framework } | { ok: false; status: number; error: string };

// A framework is author-editable by an educator iff it is NOT a master-library
// framework AND it belongs to the caller's hospital. Super-admins bypass.
async function guardFramework(c: Ctx, frameworkId: string): Promise<Guard> {
  if (!frameworkId) return { ok: false, status: 400, error: "framework_id required" };
  const { data: fw } = await c.admin
    .from("frameworks").select("id, name, scope, hospital_id, pub_status, version_num")
    .eq("id", frameworkId).single<Framework>();
  if (!fw) return { ok: false, status: 404, error: "Framework not found" };
  if (c.isSuper) return { ok: true, fw };
  if ((fw.scope ?? "") === "master")
    return { ok: false, status: 403, error: "Master-library frameworks are governed centrally and are read-only here." };
  if (!c.hospitalId || fw.hospital_id !== c.hospitalId)
    return { ok: false, status: 403, error: "You can only edit frameworks that belong to your hospital." };
  return { ok: true, fw };
}

async function frameworkOfDomain(c: Ctx, domainId: string): Promise<Guard> {
  const { data: dom } = await c.admin.from("framework_domains").select("framework_id").eq("id", domainId).single();
  if (!dom) return { ok: false, status: 404, error: "Domain not found" };
  return guardFramework(c, dom.framework_id);
}

async function frameworkOfCompetency(c: Ctx, competencyId: string): Promise<Guard> {
  const { data: comp } = await c.admin.from("framework_competencies").select("domain_id").eq("id", competencyId).single();
  if (!comp) return { ok: false, status: 404, error: "Competency not found" };
  return frameworkOfDomain(c, comp.domain_id);
}

function audit(c: Ctx, action: string, entity_type: string, entity_id: string, entity_name: string, oldV: unknown, newV: unknown) {
  return c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: c.name, action,
    entity_type, entity_id, entity_name, old_value: oldV, new_value: newV,
  });
}

async function nextSort(c: Ctx, table: string, col: string, id: string): Promise<number> {
  const { data } = await c.admin.from(table).select("sort_order").eq(col, id).order("sort_order", { ascending: false }).limit(1).single();
  return (data?.sort_order ?? 0) + 1;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const c = await context();
  if (!c) return bad("Forbidden — educator, hospital-admin or super-admin role required.", 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad("Invalid JSON"); }
  const action = String(body.action ?? "");

  switch (action) {
    // ── Frameworks ──────────────────────────────────────────────────────────
    case "create_framework": {
      const name = String(body.name ?? "").trim();
      if (!name) return bad("name required");
      if (!c.isSuper && !c.hospitalId) return bad("Your account has no hospital assigned, so you cannot create a framework.", 403);
      const library = LIBRARIES.includes(String(body.library)) ? String(body.library) : "specialty";
      const hospital_id = c.isSuper ? (body.hospital_id as string ?? c.hospitalId) : c.hospitalId;
      const sort_order = await nextSort(c, "frameworks", "hospital_id", hospital_id ?? "");
      const { data, error } = await c.admin.from("frameworks").insert({
        name, description: String(body.description ?? "") || null, library,
        scope: "local", hospital_id, is_active: true, pub_status: "draft",
        owner_type: "educator", owner_id: c.userId, sort_order,
      }).select("id, name").single();
      if (error) return bad(error.message, 500);
      await audit(c, "create_framework", "framework", data.id, data.name, null, { scope: "local", hospital_id });
      return NextResponse.json(data, { status: 201 });
    }
    case "rename_framework": {
      const g = await guardFramework(c, String(body.framework_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const name = String(body.name ?? "").trim();
      if (!name) return bad("name required");
      const { error } = await c.admin.from("frameworks").update({ name, description: body.description !== undefined ? (String(body.description) || null) : undefined }).eq("id", g.fw.id);
      if (error) return bad(error.message, 500);
      await audit(c, "rename_framework", "framework", g.fw.id, name, { name: g.fw.name }, { name });
      return NextResponse.json({ ok: true });
    }
    case "lifecycle": {
      const g = await guardFramework(c, String(body.framework_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const step = String(body.step ?? "");
      const newStatus = LIFECYCLE[step];
      if (!newStatus) return bad("Invalid lifecycle step");
      const oldStatus = g.fw.pub_status ?? "draft";
      const { error } = await c.admin.from("frameworks").update({ pub_status: newStatus }).eq("id", g.fw.id);
      if (error) return bad(error.message, 500);

      if (step === "publish") {
        const { data: full } = await c.admin.from("frameworks").select(`
          name, library, description,
          framework_domains(name, sort_order, framework_competencies(name, description, sort_order))
        `).eq("id", g.fw.id).single();
        if (full) {
          const nextVersion = (g.fw.version_num ?? 0) + 1;
          await c.admin.from("framework_versions").insert({
            framework_id: g.fw.id, version_num: nextVersion, snapshot: full, published_by_name: c.name,
          });
          await c.admin.from("frameworks").update({ version_num: nextVersion }).eq("id", g.fw.id);
        }
      }
      if (step === "submit_review") {
        await c.admin.from("content_approvals").update({ status: "superseded" }).eq("framework_id", g.fw.id).eq("status", "pending");
        await c.admin.from("content_approvals").insert({
          framework_id: g.fw.id, framework_name: g.fw.name,
          submitted_by: c.userId, submitted_by_name: c.name, status: "pending",
        });
      }
      await audit(c, step, "framework", g.fw.id, g.fw.name, { pub_status: oldStatus }, { pub_status: newStatus });
      return NextResponse.json({ ok: true, pub_status: newStatus });
    }

    // ── Domains ─────────────────────────────────────────────────────────────
    case "create_domain": {
      const g = await guardFramework(c, String(body.framework_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const name = String(body.name ?? "").trim();
      if (!name) return bad("name required");
      const sort_order = await nextSort(c, "framework_domains", "framework_id", g.fw.id);
      const { data, error } = await c.admin.from("framework_domains")
        .insert({ framework_id: g.fw.id, name, sort_order }).select("id, name, sort_order").single();
      if (error) return bad(error.message, 500);
      await audit(c, "create_domain", "domain", data.id, name, null, { framework_id: g.fw.id });
      return NextResponse.json(data, { status: 201 });
    }
    case "rename_domain": {
      const g = await frameworkOfDomain(c, String(body.domain_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const name = String(body.name ?? "").trim();
      if (!name) return bad("name required");
      const { error } = await c.admin.from("framework_domains").update({ name }).eq("id", body.domain_id);
      if (error) return bad(error.message, 500);
      await audit(c, "rename_domain", "domain", String(body.domain_id), name, null, { name });
      return NextResponse.json({ ok: true });
    }
    case "delete_domain": {
      const g = await frameworkOfDomain(c, String(body.domain_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const domainId = String(body.domain_id);
      const { data: comps } = await c.admin.from("framework_competencies").select("id").eq("domain_id", domainId);
      const compIds = (comps ?? []).map(x => x.id);
      if (compIds.length) {
        await c.admin.from("competency_skills").delete().in("competency_id", compIds);
        await c.admin.from("framework_competencies").delete().eq("domain_id", domainId);
      }
      const { error } = await c.admin.from("framework_domains").delete().eq("id", domainId);
      if (error) return bad(error.message, 500);
      await audit(c, "delete_domain", "domain", domainId, "", { competencies: compIds.length }, null);
      return NextResponse.json({ ok: true });
    }
    case "reorder_domains": {
      const g = await guardFramework(c, String(body.framework_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const order = (body.order as string[]) ?? [];
      await Promise.all(order.map((id, i) => c.admin.from("framework_domains").update({ sort_order: i + 1 }).eq("id", id).eq("framework_id", g.fw.id)));
      await audit(c, "reorder_domains", "framework", g.fw.id, g.fw.name, null, { order });
      return NextResponse.json({ ok: true });
    }

    // ── Competencies ────────────────────────────────────────────────────────
    case "create_competency": {
      const g = await frameworkOfDomain(c, String(body.domain_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const name = String(body.name ?? "").trim();
      if (!name) return bad("name required");
      const domainId = String(body.domain_id);
      const sort_order = await nextSort(c, "framework_competencies", "domain_id", domainId);
      const { data, error } = await c.admin.from("framework_competencies").insert({
        domain_id: domainId, name, description: String(body.description ?? "") || null,
        code: String(body.code ?? "") || null,
        risk_category: String(body.risk_category ?? "") || null, sort_order,
      }).select("id, name, code, sort_order").single();
      if (error) return bad(error.message, 500);
      await audit(c, "create_competency", "competency", data.id, name, null, { domain_id: domainId });
      return NextResponse.json(data, { status: 201 });
    }
    case "update_competency": {
      const g = await frameworkOfCompetency(c, String(body.competency_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const allowed = ["name", "description", "code", "risk_category"] as const;
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (body[k] !== undefined) update[k] = String(body[k]) || null;
      if (update.name !== undefined && !update.name) return bad("name cannot be empty");
      if (!Object.keys(update).length) return bad("no valid fields");
      const { error } = await c.admin.from("framework_competencies").update(update).eq("id", body.competency_id);
      if (error) return bad(error.message, 500);
      await audit(c, "update_competency", "competency", String(body.competency_id), String(update.name ?? ""), null, update);
      return NextResponse.json({ ok: true });
    }
    case "delete_competency": {
      const g = await frameworkOfCompetency(c, String(body.competency_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const compId = String(body.competency_id);
      await c.admin.from("competency_skills").delete().eq("competency_id", compId);
      const { error } = await c.admin.from("framework_competencies").delete().eq("id", compId);
      if (error) return bad(error.message, 500);
      await audit(c, "delete_competency", "competency", compId, "", null, null);
      return NextResponse.json({ ok: true });
    }
    case "reorder_competencies": {
      const g = await frameworkOfDomain(c, String(body.domain_id ?? ""));
      if (!g.ok) return bad(g.error, g.status);
      const domainId = String(body.domain_id);
      const order = (body.order as string[]) ?? [];
      await Promise.all(order.map((id, i) => c.admin.from("framework_competencies").update({ sort_order: i + 1 }).eq("id", id).eq("domain_id", domainId)));
      await audit(c, "reorder_competencies", "domain", domainId, "", null, { order });
      return NextResponse.json({ ok: true });
    }

    default:
      return bad("Unknown action");
  }
}
