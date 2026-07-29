import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadCampaigns, createCampaign, launchCampaign, closeCampaign } from "@/lib/delivery/campaigns";

// CDP-008 — campaign manager API. GET lists campaigns + live compliance; POST {action:create|launch|close}.
// Super-admin only. Launch materialises a cmo_assignments row + emits campaign.launched.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Campaign manager is super-admin only");
  return NextResponse.json(await loadCampaigns(c.admin, c.hospitalId, isSuper(c)));
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Campaign manager is super-admin only");
  const b = await req.json().catch(() => ({}));
  const me = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const actor = { id: c.userId, name: me.data?.full_name ?? null };

  let r;
  if (b.action === "launch") r = await launchCampaign(c.admin, String(b.id ?? ""), actor);
  else if (b.action === "close") r = await closeCampaign(c.admin, String(b.id ?? ""), actor);
  else r = await createCampaign(c.admin, {
    name: b.name, description: b.description, competency_id: b.competency_id || null, competency_name: b.competency_name,
    target_type: b.target_type, target_role: b.target_role || null, target_label: b.target_label, mandatory: !!b.mandatory,
    due_on: b.due_on || null, hospital_id: c.hospitalId ?? null,
  }, actor);

  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ...r, list: await loadCampaigns(c.admin, c.hospitalId, isSuper(c)) });
}
