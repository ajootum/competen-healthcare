import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Clinical Library search — any authenticated user can search the governed
// knowledge base (policies, CPUs, competencies, skills, resources, quality objects).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ hits: [] });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("search_ckcm", { q, max_results: 20 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hits: data ?? [] });
}
