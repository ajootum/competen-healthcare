import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadRuntimeStatus } from "@/lib/platform/runtime";
import { sseStream } from "@/lib/sse";

// POS-001J — SSE stream of the Infrastructure Status Bar payload. Super_admin
// (EventSource carries the session cookie same-origin).
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  return sseStream({ signal: req.signal, intervalMs: 15000, produce: () => loadRuntimeStatus(admin) });
}
