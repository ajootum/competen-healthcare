import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { dispatch, CHANNELS } from "@/lib/notifications/dispatch";

// POS-001H — send a test notification to yourself across every channel and
// return the per-channel delivery result. Exercises the dispatch pipeline so an
// operator can see live delivery/skip/fail states. Super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const { deliveries } = await dispatch(
    c.admin as any,
    [c.userId],
    { type: "platform_test", title: "Test notification", body: "Delivery pipeline test from the notifications console.", href: "/super-admin/platform-ops/notifications" },
    CHANNELS,
  );
  return NextResponse.json({ ok: true, deliveries }, { headers: { "Cache-Control": "no-store" } });
}
