import { requireEducatorAccess } from "@/lib/educator-access";
import QuestionBuilder from "@/app/super-admin/studio/questions/QuestionBuilder";
import { EduHeader } from "../ui";

// Question Bank — the governed question-bank builder (same engine as the
// Studio): MCQ banks with pass marks, validity periods and CPU links,
// delivered to learners by the knowledge-assessment engine. Replaces the old
// read-only topic list.

export const dynamic = "force-dynamic";

export default async function EducatorQuestionsPage() {
  const { admin } = await requireEducatorAccess();

  const [{ data: banks }, { data: questions }, { data: cpus }, { data: attempts }, { count: practicePool }] = await Promise.all([
    admin.from("question_banks")
      .select("id, name, description, cpu_id, pass_mark, validity_months, time_limit_minutes")
      .eq("is_active", true).order("name"),
    admin.from("questions")
      .select("id, bank_id, content, options, correct_answer, explanation")
      .not("bank_id", "is", null).order("created_at"),
    admin.from("clinical_practice_units").select("id, name, code").eq("pub_status", "published").order("name"),
    admin.from("knowledge_attempts").select("bank_id, passed"),
    admin.from("questions").select("id", { count: "exact", head: true }).is("bank_id", null),
  ]);

  const parsed = (questions ?? []).map(q => ({
    ...q,
    options: (Array.isArray(q.options) ? q.options : []) as string[],
  }));

  return (
    <div className="max-w-6xl">
      <EduHeader icon="❓" title="Question Bank" sub="Create and maintain reusable, governed question libraries — banks with pass marks, validity and CPU links." />
      <QuestionBuilder
        banks={(banks ?? []) as never}
        questions={parsed as never}
        cpus={(cpus ?? []) as never}
        attempts={(attempts ?? []) as never}
      />
      <p className="text-[10px] text-gray-400 mt-4">
        {(practicePool ?? 0) > 0 && <>The learner practice-quiz pool holds a further {practicePool} ungoverned questions (daily practice engine). </>}
        Bank questions are delivered with server-side scoring; attempts and pass marks feed the knowledge-assessment record.
      </p>
    </div>
  );
}
