import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// CSV export of the assessor's analytics aggregates (volume by month, method
// and score) — the same numbers the My Analytics page computes.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: mine } = await admin.from("assessments")
    .select("status, score, method, assessed_at").eq("assessor_id", user.id);
  const done = (mine ?? []).filter(a => a.status === "complete");

  const byMonth = new Map<string, number>();
  const byMethod = new Map<string, number>();
  const byScore = new Map<number, number>();
  for (const a of done) {
    if (a.assessed_at) byMonth.set(a.assessed_at.slice(0, 7), (byMonth.get(a.assessed_at.slice(0, 7)) ?? 0) + 1);
    byMethod.set(a.method, (byMethod.get(a.method) ?? 0) + 1);
    if (a.score !== null) byScore.set(a.score, (byScore.get(a.score) ?? 0) + 1);
  }

  const lines = ["Section,Key,Count"];
  for (const [k, v] of [...byMonth.entries()].sort()) lines.push(`Completed by month,${k},${v}`);
  for (const [k, v] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) lines.push(`Completed by method,${k},${v}`);
  for (const [k, v] of [...byScore.entries()].sort((a, b) => a[0] - b[0])) lines.push(`Score distribution,${k},${v}`);
  lines.push(`Totals,completed,${done.length}`);
  lines.push(`Totals,all statuses,${(mine ?? []).length}`);

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assessor-analytics-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
