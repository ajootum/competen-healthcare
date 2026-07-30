import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { loadMyShift } from "@/lib/hww/my-shift";

// Current Shift (HWW-012 / HWW-001 Shift Engine) — the caller's own operational
// picture. Self-scoped: any authenticated clinician sees only their own work.
// The engine lives in @/lib/hww/my-shift so the SAME shipped logic serves this
// route (client refresh) and the server-rendered Healthcare Worker Workspace.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  return NextResponse.json(await loadMyShift(c.admin, c.userId));
}
