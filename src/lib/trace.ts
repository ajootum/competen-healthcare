import { headers } from "next/headers";

// One trace id per request (XWI P2-15).
//
// src/proxy.ts stamps `x-trace-id` on every matched request, so any server code can read the SAME id
// without being handed one. That is the difference between tracing and decoration: an id minted locally
// at each write site is unique per row and joins nothing.
//
// FALLS BACK TO A FRESH UUID rather than throwing or returning null. Some server code runs outside a
// request the proxy matched -- cron jobs, scripts, the odd static render -- and an audit row with an id
// that joins nothing is still better than one with no id at all, or a 500 raised by the logging path. The
// fallback is deliberately silent because a missing trace must never be able to fail the write it is
// describing.
export async function currentTraceId(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-trace-id") ?? crypto.randomUUID();
  } catch {
    // headers() throws outside a request scope.
    return crypto.randomUUID();
  }
}
