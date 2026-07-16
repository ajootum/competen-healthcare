import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import QuestionBuilder from "./QuestionBuilder";

// Question Builder — governed MCQ banks with pass marks and validity,
// linked to CPUs so blueprint "knowledge" methods have a delivery engine.

export default async function QuestionBuilderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [{ data: banks }, { data: questions }, { data: cpus }, { data: attempts }] = await Promise.all([
    admin.from("question_banks")
      .select("id, name, description, cpu_id, pass_mark, validity_months, time_limit_minutes")
      .eq("is_active", true).order("name"),
    admin.from("questions")
      .select("id, bank_id, content, options, correct_answer, explanation")
      .not("bank_id", "is", null).order("created_at"),
    admin.from("clinical_practice_units").select("id, name, code").eq("pub_status", "published").order("name"),
    admin.from("knowledge_attempts").select("bank_id, passed"),
  ]);

  const parsed = (questions ?? []).map(q => ({
    ...q,
    options: (Array.isArray(q.options) ? q.options : []) as string[],
  }));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Question Builder</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Question Builder</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Governed knowledge assessments — MCQ banks with pass marks, validity periods and CPU links.
        </p>
      </div>
      <QuestionBuilder
        banks={(banks ?? []) as never}
        questions={parsed as never}
        cpus={(cpus ?? []) as never}
        attempts={(attempts ?? []) as never}
      />
    </div>
  );
}
