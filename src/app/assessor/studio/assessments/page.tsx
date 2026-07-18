import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import QuestionBuilder from "@/app/super-admin/studio/questions/QuestionBuilder";

// Assessment Builder (Assessment Studio) — assessor-shell wrapper around the
// governed question-bank builder: MCQ banks with pass marks, validity periods
// and CPU links, delivered by the knowledge-assessment engine.

export const dynamic = "force-dynamic";

export default async function StudioAssessmentsPage() {
  const { admin } = await requireAnalyticsAccess();

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
      <Link href="/assessor/studio" className="text-xs text-gray-400 hover:text-gray-600">← Assessment Studio</Link>
      <div className="mb-6 mt-1">
        <h1 className="text-xl font-bold text-gray-900">✍️ Assessment Builder — Question Builder</h1>
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
