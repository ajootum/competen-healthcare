import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadRuntimeStatus } from "@/lib/platform/runtime";

// POS-002 standardized runtime APIs. One catch-all serves every /api/runtime/*
// endpoint from the shared runtime service so dashboards consume live data
// without touching the database. Super_admin (landlord) only.
//   /api/runtime/status              full status
//   /api/runtime/region|version|release|uptime
//   /api/runtime/deployments/latest  /api/runtime/backups/latest
//   /api/runtime/database|cache|queues|search[/status]
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const rt = await loadRuntimeStatus(c.admin as any);
  const seg = (await params).path ?? [];
  const head = seg[0] ?? "status";

  const map: Record<string, any> = {
    status: rt,
    region: rt.slices.region,
    version: rt.slices.version,
    release: rt.slices.release,
    uptime: rt.slices.uptime,
    deployments: rt.slices.deployment, // deployments/latest
    backups: rt.slices.backup,         // backups/latest
    database: rt.slices.database,      // database[/status]
    cache: rt.slices.cache,
    queues: rt.slices.queues,
    search: rt.slices.search,
  };

  const body = map[head];
  if (body === undefined) return NextResponse.json({ error: `Unknown runtime metric "${head}"` }, { status: 404 });
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
