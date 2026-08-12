import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { createAdminClient } from "@/lib/supabase/server";
import {
  addTaxonomyItem, updateTaxonomyItem, setTaxonomyItemActive, setTaxonomyDefault,
} from "@/lib/practice/taxonomy-admin";

// CP-BOOKING-TAXONOMY-001 s4's write endpoint.
//
// ⚠ THE CAPABILITY IS CHECKED TWICE ON PURPOSE: here, so an unauthorised request never reaches an
// engine, and again inside every engine function, because these are also callable from server actions
// and a guard that lives only at the edge protects only the edge.
//
// ⚠ AND THE DIMENSION IS AN ALLOW-LIST, NOT A PASS-THROUGH. It selects a TABLE NAME downstream; a body
// value reaching a table name is how a write endpoint becomes an arbitrary one.

const DIMENSIONS = new Set(["visit_type", "consultation_mode"]);

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const dimension = String(body?.dimension ?? "");
  if (!DIMENSIONS.has(dimension))
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "dimension must be visit_type or consultation_mode" } }, { status: 400 });

  const admin = createAdminClient();
  const dim = dimension as "visit_type" | "consultation_mode";
  const correlationId = auth.caller.traceId;

  let result;
  switch (action) {
    case "add":
      result = await addTaxonomyItem(admin, auth.ctx, {
        dimension: dim, label: String(body.label ?? ""),
        selfBookable: body.selfBookable === true,
        defaultDurationMinutes: body.defaultDurationMinutes ?? null,
        requiresLocation: body.requiresLocation,
        correlationId,
      });
      break;
    case "update":
      result = await updateTaxonomyItem(admin, auth.ctx, {
        dimension: dim, itemId: String(body.itemId ?? ""),
        // `undefined` and `null` are different here: absent means "leave alone", null means "clear it".
        label: body.label === undefined ? undefined : String(body.label),
        selfBookable: body.selfBookable === undefined ? undefined : body.selfBookable === true,
        defaultDurationMinutes: body.defaultDurationMinutes === undefined
          ? undefined
          : (body.defaultDurationMinutes === null ? null : Number(body.defaultDurationMinutes)),
        requiresLocation: body.requiresLocation === undefined ? undefined : body.requiresLocation === true,
        sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
        correlationId,
      });
      break;
    case "set_active":
      result = await setTaxonomyItemActive(admin, auth.ctx, {
        dimension: dim, itemId: String(body.itemId ?? ""), active: body.active === true, correlationId,
      });
      break;
    case "set_default":
      result = await setTaxonomyDefault(admin, auth.ctx, {
        dimension: dim, itemId: String(body.itemId ?? ""), correlationId,
      });
      break;
    default:
      // ⚠ NO DELETE ACTION, and its absence is deliberate rather than an omission -- s4 says deactivate,
      // because appointments already recorded keep pointing at the entry.
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: `unknown action "${action}"` } }, { status: 400 });
  }

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
