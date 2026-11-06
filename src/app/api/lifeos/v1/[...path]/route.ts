import { dispatch } from "@/lib/lifeos/api/dispatch";
import { lifeosStore, lifeosTraceId, requireLifeosPrincipal, requireLifeosSession } from "@/lib/lifeos/adapters/competen/guard";

// LIFEOS-API-001 section 2. The one door to LifeOS. Every endpoint is served from the route table through dispatch,
// which checks the gate first, then requireLifeosPrincipal. See ADR-018.

// Request-time only: it reads the session and the gate, and must never be prerendered at build.
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: Context) {
  const { path } = await params;
  const store = lifeosStore();
  return dispatch(req, path, {
    store,
    authenticate: () => (store ? requireLifeosPrincipal(store) : Promise.reject(new Error("unreachable"))),
    session: () => requireLifeosSession(),
    traceId: await lifeosTraceId(),
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
