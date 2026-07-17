import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { parseCpuBundle } from "@/lib/import/cpu-parser";
import { docxToMarkedText } from "@/lib/import/docx-text";

export const maxDuration = 60; // large documents take a moment to convert

// CPU document import — parse (preview) and commit.
//
// Design note: the source documents do not state which skill belongs to which
// competency, so we do NOT guess. Parsed skills are created in the reusable
// skill_library; the reviewer attaches them to competencies in the Skill
// Builder, which already supports that. Checklists need a skill mapping and are
// therefore reported in the preview but not committed here.

async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return { error: "Forbidden", status: 403 as const };
  return { user, admin, profile };
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  const { mode, docxBase64 } = body as { mode?: string; docxBase64?: string };
  let { text } = body as { text?: string };

  // A .docx upload is preferred: Word's real list formatting survives, which
  // pasted text loses. Falls back to pasted text.
  if (docxBase64) {
    try {
      text = await docxToMarkedText(Buffer.from(docxBase64, "base64"));
    } catch (e) {
      return NextResponse.json({ error: `Could not read that .docx file: ${(e as Error).message}` }, { status: 400 });
    }
  }
  if (!text?.trim()) return NextResponse.json({ error: "No document supplied" }, { status: 400 });

  // ── PREVIEW: parse only, never writes ──
  if (mode !== "commit") {
    const cpus = parseCpuBundle(text);
    return NextResponse.json({ cpus, text });
  }

  // ── COMMIT ──
  const { code, practice_id, domain_id } = body as { code?: string; practice_id?: string; domain_id?: string };
  if (!practice_id || !domain_id) {
    return NextResponse.json({ error: "Choose a target practice and domain before importing" }, { status: 400 });
  }

  const all = parseCpuBundle(text);
  const parsed = code ? all.find(c => c.code === code) : all[0];
  if (!parsed) return NextResponse.json({ error: "That CPU was not found in the document" }, { status: 404 });
  if (!parsed.title) return NextResponse.json({ error: "The CPU has no title — cannot import" }, { status: 400 });

  const admin = auth.admin;
  const created = { competencies: 0, skills: 0, criticalRules: 0, questions: 0, knowledgeObjects: 0, knowledgeRequirements: 0, cases: 0 };

  // Idempotency: refuse to silently duplicate an already-imported CPU
  if (parsed.code) {
    const { data: dupe } = await admin.from("clinical_practice_units").select("id").eq("code", parsed.code).maybeSingle();
    if (dupe) return NextResponse.json({ error: `${parsed.code} already exists — delete or rename it first.` }, { status: 409 });
  }

  // 1. The CPU itself
  const { data: cpu, error: cpuErr } = await admin.from("clinical_practice_units").insert({
    practice_id,
    name: parsed.title,
    code: parsed.code,
    description: [parsed.introduction, parsed.scope].filter(Boolean).join("\n\n").slice(0, 4000) || null,
    risk_category: "standard",
    complexity: 3,
    reassessment_months: 12,
    pub_status: "draft",
  }).select("id").single();
  if (cpuErr) return NextResponse.json({ error: `CPU: ${cpuErr.message}` }, { status: 500 });

  // 2. Competencies (from the rubric's competency domains), linked to the CPU
  if (parsed.competencies.length) {
    const rows = parsed.competencies.map((name, i) => ({
      domain_id, practice_id, cpu_id: cpu.id,
      name: name.slice(0, 300),
      sort_order: i + 1,
      risk_category: "standard",
    }));
    const { error } = await admin.from("framework_competencies").insert(rows);
    if (!error) created.competencies = rows.length;
  }

  // 3. Skills → reusable library (attach to competencies in the Skill Builder)
  if (parsed.skills.length) {
    const { data: existing } = await admin.from("skill_library").select("name");
    const have = new Set((existing ?? []).map(s => s.name.toLowerCase()));
    const rows = parsed.skills
      .filter(s => !have.has(s.toLowerCase()))
      .map(name => ({
        name: name.slice(0, 300),
        description: `Imported from ${parsed.code ?? "CPU document"}`,
        skill_type: "psychomotor",
        created_by: auth.user.id,
      }));
    if (rows.length) {
      const { error } = await admin.from("skill_library").insert(rows);
      if (!error) created.skills = rows.length;
    }
  }

  // 4. Red flags → critical-failure rules
  if (parsed.redFlags.length) {
    const rows = parsed.redFlags.map(description => ({ cpu_id: cpu.id, description: description.slice(0, 500) }));
    const { error } = await admin.from("critical_failure_rules").insert(rows);
    if (!error) created.criticalRules = rows.length;
  }

  // 5. MCQs → a question bank on this CPU (answered questions only)
  const answered = parsed.questions.filter(q => q.correctIndex !== null);
  if (answered.length) {
    const { data: bank } = await admin.from("question_banks").insert({
      name: `${parsed.title} — Knowledge Test`,
      description: `Imported from ${parsed.code ?? "CPU document"}`,
      cpu_id: cpu.id, pass_mark: 80, validity_months: 24,
      created_by: auth.user.id,
    }).select("id").single();
    if (bank) {
      const rows = answered.map(q => ({
        bank_id: bank.id,
        content: q.stem,
        options: q.options,
        correct_answer: q.options[q.correctIndex!],
        explanation: q.rationale,
        category: "knowledge_assessment",
        is_published: true,
      }));
      const { error } = await admin.from("questions").insert(rows);
      if (!error) created.questions = rows.length;
    }
  }

  // 6. Clinical Knowledge Objects — the authored anatomy/physiology/reasoning prose
  if (parsed.knowledgeObjects.length) {
    const rows = parsed.knowledgeObjects.map((k, i) => ({
      code: parsed.code ? `CKO-${parsed.code.replace(/^CPU-/, "")}-${String(i + 1).padStart(2, "0")}` : null,
      title: k.title.slice(0, 300),
      summary: k.content.split(/\n\n/)[0]?.slice(0, 500) ?? null,
      content: k.content,
      knowledge_type: k.type,
      cpu_id: cpu.id,
      source_ref: `${parsed.code ?? "CPU"} §${k.section}`,
      status: "draft",
      created_by: auth.user.id,
    }));
    const { data: kos, error } = await admin.from("knowledge_objects").insert(rows).select("id");
    if (!error && kos) {
      created.knowledgeObjects = kos.length;
      // Link each knowledge object to the CPU for reuse/traceability
      await admin.from("knowledge_links").insert(
        kos.map(k => ({ knowledge_object_id: k.id, target_type: "cpu", target_id: cpu.id }))
      );
    }
  }

  // 7. Knowledge outcome statements
  if (parsed.knowledge.length) {
    const rows = parsed.knowledge.map((statement, i) => ({
      cpu_id: cpu.id, statement: statement.slice(0, 500), sort_order: i + 1,
    }));
    const { error } = await admin.from("knowledge_requirements").insert(rows);
    if (!error) created.knowledgeRequirements = rows.length;
  }

  // 8. Worked clinical case studies
  if (parsed.cases.length) {
    const rows = parsed.cases.map((c, i) => ({
      code: parsed.code ? `CASE-${parsed.code.replace(/^CPU-/, "")}-${String(i + 1).padStart(2, "0")}` : null,
      title: c.title.slice(0, 300),
      cpu_id: cpu.id,
      scenario: c.scenario || null,
      findings: c.findings || null,
      questions: c.questions,
      discussion: c.discussion || null,
      learning_points: c.learningPoints,
      difficulty: "intermediate",
      status: "draft",
      source_ref: `${parsed.code ?? "CPU"} case studies`,
      created_by: auth.user.id,
    }));
    const { data, error } = await admin.from("clinical_cases").insert(rows).select("id");
    if (!error && data) created.cases = data.length;
  }

  await admin.from("audit_log").insert({
    actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
    action: "import_cpu", entity_type: "clinical_practice_unit", entity_id: cpu.id,
    new_value: { code: parsed.code, title: parsed.title, ...created },
  });

  return NextResponse.json({
    ok: true, cpuId: cpu.id, created,
    skipped: {
      unansweredQuestions: parsed.questions.length - answered.length,
      checklistItems: parsed.checklistItems.length,
    },
  }, { status: 201 });
}
