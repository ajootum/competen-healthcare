import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadPlatformOperations } from "@/lib/platform/operations";
import { sseStream } from "@/lib/sse";

// POS-001J — SSE stream of the Mission Control operations payload. EventSource
// sends the session cookie same-origin, so the super_admin gate still applies.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  return sseStream({ signal: req.signal, intervalMs: 15000, produce: () => loadPlatformOperations(admin) });
}
