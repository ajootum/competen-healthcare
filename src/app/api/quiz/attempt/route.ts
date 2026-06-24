import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { question_id, selected_answer, is_correct } = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase.from("quiz_attempts").insert({
    user_id: user.id,
    question_id,
    selected_answer,
    is_correct,
  });
  return NextResponse.json({ success: true });
}
