import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse, isSuper } from "@/lib/api-auth";

// GET /api/v1/practice/operations/users?q= -- find the person a pilot workspace is being provisioned FOR.
//
// Super-admin only, capped at 10, and it returns nothing for a query under two characters: a lookup that
// answers the empty string is a directory dump wearing a search box. Name and email only -- enough to
// pick the right colleague, nothing more, because the purpose is provisioning and not browsing people.
//
// It also reports whether each candidate ALREADY owns a Practice, so the operator sees the
// PRACTICE_ALREADY_EXISTS refusal before triggering it rather than as an error afterwards.

export async function GET(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [], note: "type at least two characters" });

  const like = `%${q.replace(/[%_]/g, "")}%`;
  const { data: people } = await c.admin.from("profiles")
    .select("id, full_name, email").or(`full_name.ilike.${like},email.ilike.${like}`).limit(10);

  const rows = (people ?? []) as { id: string; full_name: string; email: string | null }[];
  const { data: owned } = rows.length
    ? await c.admin.from("practice_workspace").select("owner_person_id, status")
      .in("owner_person_id", rows.map(r => r.id)).not("status", "in", "(CLOSED,FAILED)")
    : { data: [] };
  const ownerStatus = new Map(((owned ?? []) as { owner_person_id: string; status: string }[])
    .map(w => [w.owner_person_id, w.status]));

  return NextResponse.json({
    results: rows.map(r => ({
      id: r.id, name: r.full_name, email: r.email,
      existingPracticeStatus: ownerStatus.get(r.id) ?? null,
    })),
    correlationId: c.traceId,
  });
}
