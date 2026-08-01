import { getCaller, isResponse, isSuper } from "@/lib/api-auth";
import { NextResponse } from "next/server";

const NONE = "00000000-0000-0000-0000-000000000000";

// Clinical Library search — any authenticated user can search the governed knowledge base (policies,
// CPUs, competencies, skills, resources, quality objects). "Any authenticated user" is deliberate; what
// was NOT deliberate is that it used to mean any hospital's governed content.
//
// This runs through the SERVICE-ROLE client, which bypasses RLS, so the tenant filter cannot come from
// the database — it has to be passed. search_ckcm takes a mandatory p_hospital (migration 167): null
// means unrestricted and is reserved for super_admin, and a user with no hospital gets the nil uuid,
// which matches shared platform content only rather than everything.
export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ hits: [] });

  const { data, error } = await c.admin.rpc("search_ckcm", {
    q,
    max_results: 20,
    p_hospital: isSuper(c) ? null : (c.hospitalId ?? NONE),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hits: data ?? [] });
}
