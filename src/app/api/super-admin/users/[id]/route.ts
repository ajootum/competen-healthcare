import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { parseAuditPage } from "@/lib/hq/user-detail";
import { loadAuditPage, loadUserDetail } from "@/app/super-admin/users/user-detail-load";

// The profile behind /super-admin/users?user=<id>: everything beyond the directory row, for ONE person.
//
// The same capability as the page it serves (hq.platform.users.view), through the HQ gate. Read-only. The loader lives
// under src/app/super-admin/users/ so the plane-boundary harness walks every table it reads. With ?section=audit&page=N
// only that page of the audit trail is read. The audit read selects names and times, never what changed.
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await hqApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "That is not a person." }, { status: 400 });
  const url = new URL(req.url);

  if (url.searchParams.get("section") === "audit") {
    return NextResponse.json({ audit: await loadAuditPage(ctx.admin, id.toLowerCase(), parseAuditPage(url.searchParams.get("page"))) });
  }
  return NextResponse.json({ detail: await loadUserDetail(ctx.admin, id.toLowerCase()) });
}
