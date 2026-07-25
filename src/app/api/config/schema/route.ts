import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { OBJECT_SCHEMAS, schemaFor, validateDefinition } from "@/lib/config/schema";

// Configuration Schema & Object Model (NCP-016) — the canonical contract surface. GET returns the published
// object-model schemas (all, or one via ?type=); POST validates a candidate definition against its type's schema
// (used by testing/migration/AI as a portable pre-flight check). Super-admin, read-oriented — no writes.

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Schema access is platform super-admin only");
  const type = new URL(req.url).searchParams.get("type");
  if (type) {
    const s = schemaFor(type.toUpperCase());
    if (!s) return badRequest(`Unknown object type "${type}"`);
    return NextResponse.json({ schema: s });
  }
  return NextResponse.json({ schemas: OBJECT_SCHEMAS, count: OBJECT_SCHEMAS.length });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Schema validation is platform super-admin only");
  const b = await req.json().catch(() => ({}));
  const object_type = String(b.object_type ?? "").toUpperCase();
  if (!schemaFor(object_type)) return badRequest(`Unknown object type "${object_type}"`);
  let definition = b.definition;
  if (typeof definition === "string") { try { definition = JSON.parse(definition); } catch { return badRequest("definition is not valid JSON"); } }
  const issues = validateDefinition(object_type, definition ?? {});
  const errors = issues.filter(i => i.severity === "error").length;
  return NextResponse.json({ ok: errors === 0, errors, warnings: issues.length - errors, issues });
}
