import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Knowledge assessment submission — graded server-side against the bank's
// pass mark. Correct answers are never sent to the client before submission.

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { bank_id, answers } = await req.json() as { bank_id?: string; answers?: Record<string, string> };
  if (!bank_id || !answers) return NextResponse.json({ error: "bank_id and answers required" }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: bank }, { data: questions }] = await Promise.all([
    admin.from("question_banks").select("id, name, pass_mark").eq("id", bank_id).eq("is_active", true).single(),
    admin.from("questions").select("id, content, correct_answer, explanation").eq("bank_id", bank_id),
  ]);
  if (!bank || !questions?.length) return NextResponse.json({ error: "Bank not found or empty" }, { status: 404 });

  const detail = questions.map(q => {
    const chosen = answers[q.id] ?? null;
    const correct = chosen != null && chosen === q.correct_answer;
    return { question_id: q.id, content: q.content, chosen, correct_answer: q.correct_answer, correct, explanation: q.explanation };
  });
  const correctCount = detail.filter(d => d.correct).length;
  const score = Math.round((correctCount / questions.length) * 1000) / 10;
  const passed = score >= bank.pass_mark;

  const { error } = await admin.from("knowledge_attempts").insert({
    bank_id, nurse_id: user.id,
    total: questions.length, correct: correctCount, score, passed, answers,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: user.id, action: "knowledge_attempt", entity_type: "question_bank", entity_id: bank_id,
    new_value: { bank: bank.name, score, passed },
  });

  return NextResponse.json({ score, passed, pass_mark: bank.pass_mark, total: questions.length, correct: correctCount, detail });
}
