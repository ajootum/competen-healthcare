import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Global educator search across live entities: hospital learners, framework
// competencies, courses and question bank. Read-only, role-gated.

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ learners: [], competencies: [], courses: [], questions: [] });
  }
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const isSuper = roles.includes("super_admin");

  // Competencies are tenant-authored (framework_competencies → domain → framework
  // → hospital_id), so scope suggestions to the caller's hospital frameworks plus
  // the shared master library (hospital_id null). Without this a hospital's
  // framework/competency names leak cross-tenant in search (§19). super_admin is
  // unscoped. (Courses and questions have no hospital column — global catalogue.)
  let scopedDomainIds: string[] | null = null;
  if (!isSuper) {
    const { data: fws } = await admin.from("frameworks").select("id")
      .or(`hospital_id.eq.${profile?.hospital_id ?? "00000000-0000-0000-0000-000000000000"},hospital_id.is.null`);
    const fwIds = (fws ?? []).map(f => f.id);
    const { data: doms } = fwIds.length
      ? await admin.from("framework_domains").select("id").in("framework_id", fwIds)
      : { data: [] };
    scopedDomainIds = (doms ?? []).map(d => d.id);
  }

  const compQuery = admin.from("framework_competencies").select("id, name").ilike("name", like).limit(5);
  if (scopedDomainIds !== null) compQuery.in("domain_id", scopedDomainIds.length ? scopedDomainIds : ["00000000-0000-0000-0000-000000000000"]);

  const [learners, competencies, courses, questions] = await Promise.all([
    admin.from("profiles").select("id, full_name")
      .eq("hospital_id", profile?.hospital_id ?? "").eq("role", "nurse")
      .ilike("full_name", like).limit(5),
    compQuery,
    admin.from("courses").select("id, title")
      .ilike("title", like).limit(5),
    admin.from("questions").select("id, topic, question_text")
      .or(`topic.ilike.${like},question_text.ilike.${like}`).limit(5),
  ]);

  return NextResponse.json({
    learners: (learners.data ?? []).map(r => ({ id: r.id, name: r.full_name })),
    competencies: (competencies.data ?? []).map(r => ({ id: r.id, name: r.name })),
    courses: (courses.data ?? []).map(r => ({ id: r.id, name: r.title })),
    questions: (questions.data ?? []).map(r => ({
      id: r.id,
      name: r.topic ? `${r.topic}: ${r.question_text?.slice(0, 60) ?? ""}` : (r.question_text?.slice(0, 60) ?? "Question"),
    })),
  });
}
