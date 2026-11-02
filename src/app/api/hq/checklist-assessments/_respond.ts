import { NextResponse } from "next/server";
import type { Res } from "@/lib/assessment/assessor/common";

/** A service result as a response: the value on success, the status and message on failure. */
export function respond<T>(r: Res<T>, map: (v: T) => unknown = v => v): NextResponse {
  return r.ok ? NextResponse.json(map(r.value)) : NextResponse.json({ error: r.error }, { status: r.status });
}

export const readJson = (req: Request): Promise<Record<string, unknown>> =>
  req.json().then(b => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}), () => ({}));
