import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// COMPETEN Studio write API — reusable skill library, skill↔competency
// attachment, and checklist authoring ("latest competen" spec).

async function requireKnowledgeAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return { error: "Forbidden", status: 403 as const };
  return { user, admin, profile };
}

export async function POST(req: Request) {
  const auth = await requireKnowledgeAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json();
  const kind = body.kind as string;

  // ── Create / update a library skill ──
  if (kind === "skill") {
    const { id, name, description, skill_type, performance_criteria, required_knowledge } = body;
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const row = {
      name: name.trim(), description: description?.trim() || null,
      skill_type: skill_type ?? "psychomotor",
      performance_criteria: performance_criteria?.trim() || null,
      required_knowledge: required_knowledge?.trim() || null,
    };
    if (id) {
      const { error } = await auth.admin.from("skill_library").update(row).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Keep attached competency-skill instances in sync with the library name
      await auth.admin.from("competency_skills").update({ name: row.name, description: row.description }).eq("library_skill_id", id);
      return NextResponse.json({ id });
    }
    const { data, error } = await auth.admin.from("skill_library")
      .insert({ ...row, created_by: auth.user.id }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Attach a library skill to a competency (reuse) ──
  if (kind === "attach_skill") {
    const { skill_id, competency_id } = body;
    if (!skill_id || !competency_id) return NextResponse.json({ error: "skill_id and competency_id required" }, { status: 400 });
    const { data: skill } = await auth.admin.from("skill_library").select("name, description").eq("id", skill_id).single();
    if (!skill) return NextResponse.json({ error: "skill not found" }, { status: 404 });
    const { data: dup } = await auth.admin.from("competency_skills")
      .select("id").eq("competency_id", competency_id).eq("library_skill_id", skill_id).maybeSingle();
    if (dup) return NextResponse.json({ error: "Already attached to that competency" }, { status: 409 });
    const { data: maxRow } = await auth.admin.from("competency_skills")
      .select("sort_order").eq("competency_id", competency_id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await auth.admin.from("competency_skills").insert({
      competency_id, library_skill_id: skill_id,
      name: skill.name, description: skill.description,
      sort_order: (maxRow?.sort_order ?? 0) + 1,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Detach an instance from a competency ──
  if (kind === "detach_skill") {
    const { competency_skill_id } = body;
    if (!competency_skill_id) return NextResponse.json({ error: "competency_skill_id required" }, { status: 400 });
    const { error } = await auth.admin.from("competency_skills").delete().eq("id", competency_skill_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Create a checklist on a competency skill ──
  if (kind === "checklist") {
    const { skill_id, name, description, assessor_instructions } = body;
    if (!skill_id || !name?.trim()) return NextResponse.json({ error: "skill_id and name required" }, { status: 400 });
    const { data, error } = await auth.admin.from("skill_checklists").insert({
      skill_id, name: name.trim(), description: description?.trim() || null,
      assessor_instructions: assessor_instructions?.trim() || null,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Add a checklist item ──
  if (kind === "checklist_item") {
    const { checklist_id, item, section, is_critical, is_required, scoring_method, evidence_required, assessor_note } = body;
    if (!checklist_id || !item?.trim()) return NextResponse.json({ error: "checklist_id and item required" }, { status: 400 });
    const { data: maxRow } = await auth.admin.from("checklist_items")
      .select("sort_order").eq("checklist_id", checklist_id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await auth.admin.from("checklist_items").insert({
      checklist_id, item: item.trim(),
      section: section?.trim() || null,
      is_critical: !!is_critical, is_required: is_required !== false,
      scoring_method: scoring_method ?? "done_not_done",
      evidence_required: evidence_required?.trim() || null,
      assessor_note: assessor_note?.trim() || null,
      sort_order: (maxRow?.sort_order ?? 0) + 1,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Create a question bank (governed knowledge assessment) ──
  if (kind === "question_bank") {
    const { name, description, cpu_id, pass_mark, validity_months, time_limit_minutes } = body;
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const { data, error } = await auth.admin.from("question_banks").insert({
      name: name.trim(), description: description?.trim() || null,
      cpu_id: cpu_id || null,
      pass_mark: pass_mark ?? 80, validity_months: validity_months ?? 24,
      time_limit_minutes: time_limit_minutes || null,
      created_by: auth.user.id,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Add a question to a bank (reuses the questions table) ──
  if (kind === "bank_question") {
    const { bank_id, content, options, correct_index, explanation } = body;
    const opts = (options ?? []).map((o: string) => o?.trim()).filter(Boolean);
    if (!bank_id || !content?.trim() || opts.length < 2) {
      return NextResponse.json({ error: "bank_id, content and ≥2 options required" }, { status: 400 });
    }
    if (correct_index == null || correct_index < 0 || correct_index >= opts.length) {
      return NextResponse.json({ error: "valid correct_index required" }, { status: 400 });
    }
    const { data, error } = await auth.admin.from("questions").insert({
      bank_id, content: content.trim(), options: opts,
      correct_answer: opts[correct_index],
      explanation: explanation?.trim() || null,
      category: "knowledge_assessment", is_published: true,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Clone a CPU (Clinical Practice & CPU spec — reuse service) ──
  // Copies the CPU with its blueprint, methods, evidence matrix and
  // critical-failure rules as a fresh draft. Competencies stay put —
  // attach them in the builder afterwards.
  if (kind === "clone_cpu") {
    const { cpu_id } = body;
    if (!cpu_id) return NextResponse.json({ error: "cpu_id required" }, { status: 400 });
    const { data: src } = await auth.admin.from("clinical_practice_units").select("*").eq("id", cpu_id).single();
    if (!src) return NextResponse.json({ error: "CPU not found" }, { status: 404 });

    const { id: _id, created_at: _c, ...cpuFields } = src as Record<string, unknown>;
    void _id; void _c;
    const { data: clone, error } = await auth.admin.from("clinical_practice_units").insert({
      ...cpuFields,
      name: `${src.name} (copy)`,
      code: src.code ? `${src.code}-COPY` : null,
      pub_status: "draft",
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: bp } = await auth.admin.from("assessment_blueprints")
      .select("*, blueprint_methods(*)").eq("cpu_id", cpu_id).maybeSingle();
    if (bp) {
      const { id: _b, created_at: _bc, cpu_id: _bcpu, blueprint_methods, ...bpFields } = bp as Record<string, unknown> & { blueprint_methods: Record<string, unknown>[] };
      void _b; void _bc; void _bcpu;
      const { data: newBp } = await auth.admin.from("assessment_blueprints")
        .insert({ ...bpFields, cpu_id: clone.id }).select("id").single();
      if (newBp && blueprint_methods?.length) {
        await auth.admin.from("blueprint_methods").insert(blueprint_methods.map(m => {
          const { id: _m, created_at: _mc, blueprint_id: _mb, ...mf } = m;
          void _m; void _mc; void _mb;
          return { ...mf, blueprint_id: newBp.id };
        }));
      }
    }
    for (const table of ["evidence_matrix", "critical_failure_rules"]) {
      const { data: rows } = await auth.admin.from(table).select("*").eq("cpu_id", cpu_id);
      if (rows?.length) {
        await auth.admin.from(table).insert(rows.map(r => {
          const { id: _r, created_at: _rc, ...rf } = r as Record<string, unknown>;
          void _r; void _rc;
          return { ...rf, cpu_id: clone.id };
        }));
      }
    }
    await auth.admin.from("audit_log").insert({
      actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
      action: "clone_cpu", entity_type: "clinical_practice_unit", entity_id: clone.id,
      new_value: { cloned_from: cpu_id, name: `${src.name} (copy)` },
    });
    return NextResponse.json(clone, { status: 201 });
  }

  // ── Assign a content responsibility (§15 — accountable ownership) ──
  if (kind === "responsibility") {
    const { user_id, content_type, content_id, content_name, responsibility_type, review_due } = body;
    if (!user_id || !content_type || !content_id || !responsibility_type) {
      return NextResponse.json({ error: "user_id, content_type, content_id and responsibility_type required" }, { status: 400 });
    }
    const { data, error } = await auth.admin.from("content_responsibilities").insert({
      user_id, content_type, content_id,
      content_name: content_name ?? null,
      responsibility_type,
      review_due: review_due || null,
      assigned_by: auth.user.id,
    }).select("id").single();
    if (error) {
      const msg = error.message.includes("duplicate") ? "That person already holds this responsibility for this object" : error.message;
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  }

  return NextResponse.json({ error: "unknown kind" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const auth = await requireKnowledgeAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (kind === "skill") {
    // Retire (soft) — instances on competencies keep working
    const { error } = await auth.admin.from("skill_library").update({ is_active: false }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (kind === "checklist_item") {
    const { error } = await auth.admin.from("checklist_items").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (kind === "bank_question") {
    const { error } = await auth.admin.from("questions").delete().eq("id", id).not("bank_id", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (kind === "question_bank") {
    const { error } = await auth.admin.from("question_banks").update({ is_active: false }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (kind === "responsibility") {
    const { error } = await auth.admin.from("content_responsibilities")
      .update({ status: "ended", end_date: new Date().toISOString().slice(0, 10) }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown kind" }, { status: 400 });
}
