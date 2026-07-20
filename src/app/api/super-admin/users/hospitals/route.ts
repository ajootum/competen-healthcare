import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin } from "@/lib/api-auth";

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden(); // hospital id→name map is admin-only (labels)

  const { data: hospitals } = await c.admin
    .from("hospitals")
    .select("id, name");

  const map = Object.fromEntries((hospitals ?? []).map(h => [h.id, h.name]));
  return NextResponse.json({ hospitals: map });
}
