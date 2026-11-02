import { NextResponse } from "next/server";
import { hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { isAbsent, parseParticipationRequest } from "@/lib/hq/account-participation";
import { currentTraceId } from "@/lib/trace";

// Set a person's participation category (Regular, Pilot, Staff tester) with a reason and an optional cohort and end.
//
// OWNER-ONLY, through the same gate as every other account write on the Users screen. The category is an
// administrative label: it grants and removes no access, and nothing reads it to decide any. Access is changed only on
// the Individual access board. One audit_log row per change records who, when, why, and the before and after.
//
// ⚠ migration 850 may be absent. An absent table answers 503 NOT_SET_UP and writes nothing.
export async function POST(req: Request) {
  const ctx = await hqOwnerApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;

  const parsed = parseParticipationRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.req;
  const admin = ctx.admin;
  const notSetUp = () => NextResponse.json({ error: "Participation categories are not set up in this environment yet.", code: "NOT_SET_UP" }, { status: 503 });

  const { data: person } = await admin.from("profiles").select("id, full_name").eq("id", r.userId).maybeSingle();
  if (!person) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const before = await admin.from("hq_account_participation").select("category, cohort_code, valid_until").eq("user_id", r.userId).maybeSingle();
  if (before.error) return isAbsent(before.error) ? notSetUp() : NextResponse.json({ error: "The current category could not be read." }, { status: 500 });

  const now = new Date().toISOString();
  const { error } = await admin.from("hq_account_participation").upsert({
    user_id: r.userId, category: r.category, cohort_code: r.cohort, valid_until: r.validUntil,
    set_by: ctx.userId, reason: r.reason, updated_at: now,
  }, { onConflict: "user_id" });
  if (error) return isAbsent(error) ? notSetUp() : NextResponse.json({ error: "The category could not be saved." }, { status: 500 });

  const audit = await admin.from("audit_log").insert({
    trace_id: await currentTraceId(),
    actor_id: ctx.userId, actor_name: ctx.fullName,
    action: "hq_account_participation_set", entity_type: "hq_account_participation", entity_id: r.userId, entity_name: person.full_name,
    old_value: before.data ? { category: before.data.category, cohort: before.data.cohort_code, valid_until: before.data.valid_until } : null,
    new_value: { category: r.category, cohort: r.cohort, valid_until: r.validUntil, reason: r.reason },
  });
  // The change is made. A failed audit write is reported rather than hidden.
  return NextResponse.json({
    success: true, category: r.category, cohort: r.cohort, validUntil: r.validUntil,
    ...(audit.error ? { auditWarning: "The change was saved but its audit entry could not be written." } : {}),
  });
}
