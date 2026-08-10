import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { currentTraceId } from "@/lib/trace";
import {
  resolveActiveGovernance, recordContextSwitch, HQ_CONTEXT_COOKIE,
} from "@/lib/hq/governance-context";

// PLAT-GOV-MC-001 s11 - POST /governance/context/switch, executing s8's six steps in order:
// validate, activate, recompute grants, recompute data boundary, reload composition, audit.
//
// ⚠ VALIDATION IS NOT "IS THIS A UUID". The submitted id is looked up in the caller's OWN resolved context
// list -- built from their appointments, their statuses and their positions, re-read on this request. An id
// that is well-formed, real, and belongs to somebody else is simply not in that list and is refused. The
// endpoint therefore cannot be used to acquire a context, only to choose between contexts already held.
//
// ⚠ STEPS 3 AND 4 ARE NOT CODE HERE, AND THAT IS CORRECT RATHER THAN MISSING. Nothing in this product
// caches capability grants or data-boundary decisions: resolveHqContext recomputes both from the cookie on
// every request. s12's "context switch invalidates cached authorization for the previous context" is
// satisfied by there being no cache to invalidate. If one is ever added, it must be cleared here.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const submitted = (body as { appointmentId?: unknown } | null)?.appointmentId;
  const appointmentId = typeof submitted === "string" ? submitted : null;
  if (!appointmentId) return NextResponse.json({ error: "appointmentId is required" }, { status: 400 });

  const admin = createAdminClient();
  const cookieStore = await cookies();
  const previousId = cookieStore.get(HQ_CONTEXT_COOKIE)?.value ?? null;

  // Resolved BEFORE the switch so the audit row can name what was left as well as what was entered.
  const before = await resolveActiveGovernance(admin, user.id, previousId);
  const target = before.available.find(c => c.appointmentId === appointmentId);
  if (!target)
    // Names no appointment and no reason. A caller probing ids learns only that this one is not theirs.
    return NextResponse.json({ error: "That is not one of your governance contexts" }, { status: 403 });

  cookieStore.set(HQ_CONTEXT_COOKIE, target.appointmentId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
  await recordContextSwitch(admin, {
    userId: user.id,
    userName: me?.full_name ?? null,
    from: before.active?.appointmentId === target.appointmentId ? null : before.active,
    to: target,
    traceId: await currentTraceId(),
  });

  return NextResponse.json({
    ok: true,
    activeAppointmentId: target.appointmentId,
    position: target.positionCode,
    productLine: target.productLineCode,
    // ⚠ A HARD NAVIGATION, NOT router.push. The composition, navigation and widget set are all computed
    // server-side from the cookie, and a soft push replays payloads rendered under the PREVIOUS context --
    // the same prod-only bounce RoleSwitcher documents for active_role.
    redirect: "/super-admin",
  });
}
