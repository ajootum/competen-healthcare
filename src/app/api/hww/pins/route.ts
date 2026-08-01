import { NextResponse } from "next/server";
import { getCaller, isResponse, badRequest } from "@/lib/api-auth";
import { HWW_NAV_CATALOGUE } from "@/lib/hww/navigation";

// Pinned modules / favourites (HWW-UI-005 s19, migration 185).
//   GET    -> this person's pins for the workspace
//   POST   -> pin a module key
//   DELETE -> unpin
//
// Every write is scoped to the CALLER's own row -- user_id comes from the session, never the body. Taking
// it from the request would let anyone rearrange anyone else's sidebar, which is a small harm with a very
// large surface.
//
// The module key is validated against the catalogue, so a pin can only ever name a module that exists.
// Storing an arbitrary string would let a stale or hand-crafted key sit in the table forever, resolving to
// nothing and looking like a bug in the sidebar.
/* eslint-disable @typescript-eslint/no-explicit-any */

const WORKSPACE = "healthcare-worker";
const MAX_PINS = 8;   // a favourites bar longer than this is just the sidebar again

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? ""))
    ? NextResponse.json({ error: "Run migration 185 to enable favourites" }, { status: 409 })
    : null;

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { data, error } = await c.admin.from("user_pinned_modules")
    .select("module_key, sort_order").eq("user_id", c.userId).eq("workspace", WORKSPACE)
    .order("sort_order", { ascending: true }).limit(MAX_PINS);
  const gate = error && migrationGate(error);
  if (gate) return gate;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ pins: (data ?? []).map((r: any) => r.module_key) });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { module_key } = await req.json().catch(() => ({}));
  if (typeof module_key !== "string" || !module_key) return badRequest("module_key required");
  if (!HWW_NAV_CATALOGUE.some(r => r.key === module_key)) return badRequest("Unknown module");

  const { count } = await c.admin.from("user_pinned_modules")
    .select("id", { count: "exact", head: true }).eq("user_id", c.userId).eq("workspace", WORKSPACE);
  if ((count ?? 0) >= MAX_PINS) return NextResponse.json({ error: `You can pin up to ${MAX_PINS} modules.` }, { status: 409 });

  // upsert on the unique index: pinning twice is a no-op rather than an error the UI has to explain.
  const { error } = await c.admin.from("user_pinned_modules")
    .upsert({ user_id: c.userId, workspace: WORKSPACE, module_key, sort_order: count ?? 0 },
      { onConflict: "user_id,workspace,module_key", ignoreDuplicates: true });
  const gate = error && migrationGate(error);
  if (gate) return gate;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const key = new URL(req.url).searchParams.get("module_key");
  if (!key) return badRequest("module_key required");
  const { error } = await c.admin.from("user_pinned_modules")
    .delete().eq("user_id", c.userId).eq("workspace", WORKSPACE).eq("module_key", key);
  const gate = error && migrationGate(error);
  if (gate) return gate;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
