import { NextResponse } from "next/server";
import { hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";

// Request-time only: it reads the release gate and the session.
export const dynamic = "force-dynamic";

// GET /api/super-admin/users/invite-options -- what the Add User dialog may offer. Owner gate, as the POST it
// serves. It reports only whether the Competen Individual release gate is on (the default choice of the dialog),
// never a person or a count. The server enforces the gate again on the invitation itself (404 while off).
export async function GET() {
  const ctx = await hqOwnerApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;
  return NextResponse.json({ individualEnabled: await individualAppEnabled(ctx.admin) });
}
