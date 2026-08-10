import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolveActiveGovernance, HQ_CONTEXT_COOKIE } from "@/lib/hq/governance-context";

// PLAT-GOV-MC-001 s11 - GET /governance/contexts: "return active appointments available to current identity".
//
// ⚠ SELF-SCOPED, AND THAT IS THE WHOLE GATE. Every row returned is derived from the AUTHENTICATED user's id.
// The request body and query string contribute nothing, so there is no id a caller could pass to read
// somebody else's appointments -- which is why this is correctly authenticated-only rather than
// capability-gated. Requiring an HQ capability here would be worse than useless: a person needs to see
// which contexts they hold in order to enter one, so gating the list behind a context they have not chosen
// yet is a door that locks from the inside.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const selected = (await cookies()).get(HQ_CONTEXT_COOKIE)?.value ?? null;
  const governance = await resolveActiveGovernance(createAdminClient(), user.id, selected);

  return NextResponse.json({
    // s8: "the switcher must show only valid appointments".
    contexts: governance.available.map(c => ({
      appointmentId: c.appointmentId,
      position: c.positionCode,
      positionName: c.positionName,
      productLine: c.productLineCode,
      capabilityCount: c.capabilities.length,
      active: c.appointmentId === governance.active?.appointmentId,
    })),
    activeAppointmentId: governance.active?.appointmentId ?? null,
    defaulted: governance.defaulted,
  });
}
