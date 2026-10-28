import { NextResponse } from "next/server";
import { requestSelfServiceReset } from "@/lib/auth/self-service-reset";

// Self-service "forgot password", requested from the server so the emailed link works on any device.
// See src/lib/auth/self-service-reset.ts.
export async function POST(request: Request) {
  let email: unknown = null;
  try { email = (await request.json())?.email; } catch { /* a malformed body is a malformed address */ }
  const r = await requestSelfServiceReset(email);
  return NextResponse.json(r.body, { status: r.status });
}
