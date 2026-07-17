import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Practice-question attempt. Correctness is computed SERVER-side against the
// question's stored answer — the client's claim is ignored, so practice
// mastery analytics can't be inflated from the browser.
export async function POST(request: Request) {
  const { question_id, selected_answer } = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!question_id || selected_answer == null) {
    return NextResponse.json({ error: "question_id and selected_answer are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: q } = await admin.from("questions").select("correct_answer").eq("id", question_id).single();
  if (!q) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  const is_correct = selected_answer === q.correct_answer;
  const { error } = await supabase.from("quiz_attempts").insert({
    user_id: user.id,
    question_id,
    selected_answer,
    is_correct,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, is_correct });
}
