export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { fetchAdmin } from "@/lib/admin/admin-suite";
/* eslint-disable @typescript-eslint/no-explicit-any */

// ADM-009 Admin Assistant copilot — wired to the real AI Runtime Gateway (generate()), grounded in the live unit
// administration suite. Calls log to plat_ai_requests (operation "admin_assistant") → AIS-011 / AIS-008.

export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured, provider: s.provider });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, full_name, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["super_admin", "hospital_admin"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the admin assistant." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me an administration briefing: what needs attention across documents, assets, changes and configuration, and the top 3 actions.";

  const isSuper = roles.includes("super_admin");
  const a = await fetchAdmin(admin, profile?.hospital_id ?? null, isSuper);
  const ctx: string[] = [];
  if (!a.provisioned) ctx.push("Administration suite not provisioned.");
  else {
    const now = Date.now();
    const overdueDocs = a.documents.filter((d: any) => d.review_date && new Date(d.review_date).getTime() < now).map((d: any) => `${d.title ?? d.name}${d.review_date ? ` (due ${String(d.review_date).slice(0, 10)})` : ""}`);
    ctx.push(`DOCUMENTS: ${a.documents.length} controlled, ${overdueDocs.length} past review date.` + (overdueDocs.length ? ` Overdue: ${overdueDocs.slice(0, 6).join("; ")}.` : ""));
    const maint = a.assets.filter((x: any) => ["due", "overdue", "maintenance"].includes(String(x.status)) || (x.next_service && new Date(x.next_service).getTime() < now));
    ctx.push(`ASSETS: ${a.assets.length} registered, ${maint.length} needing service/maintenance.`);
    const pendingChg = a.changes.filter((c: any) => ["pending", "proposed", "under_review", "awaiting_approval"].includes(String(c.status)));
    const highRisk = a.changes.filter((c: any) => ["high", "critical"].includes(String(c.risk ?? c.risk_level)));
    ctx.push(`CHANGES: ${a.changes.length} logged, ${pendingChg.length} pending approval, ${highRisk.length} high-risk.`);
    ctx.push(`CONFIG: ${a.config.length} configuration items. RULES: ${a.rules.length} operational rules. FORMS: ${a.forms.length}. AUTOMATIONS: ${a.automations.length}.`);
    const activeDeleg = a.delegations.filter((d: any) => d.status === "active" || (!d.status && (!d.end_date || new Date(d.end_date).getTime() > now)));
    ctx.push(`DELEGATIONS: ${a.delegations.length} on record, ${activeDeleg.length} active. EMERGENCY ACCESS (break-glass): ${a.reused.emergencyAccess.length} grants, ${a.reused.emergencyAccess.filter((g: any) => g.status === "active").length} active.`);
    ctx.push(`CAPACITY: ${a.reused.bedOccupied}/${a.reused.bedTotal} beds occupied. STAFF: ${a.reused.totalUsers} users, ${a.reused.positionFilled}/${a.reused.positionTotal} positions filled.`);
    if (a.aiRecs.length) ctx.push(`EXISTING FLAGGED SIGNALS: ${a.aiRecs.slice(0, 6).map((r: any) => `${r.title}${r.impact ? ` (${r.impact})` : ""}`).join("; ")}.`);
  }

  const system = [
    "You are the Competen Administration Assistant copilot for a healthcare unit's admin & configuration workspace.",
    "Answer ONLY from the administration data provided. Do NOT invent documents, assets, changes, policies or facts.",
    "You provide operational-admin intelligence (governance hygiene, compliance dates, change risk, resource readiness). Reference the underlying numbers and order recommendations by urgency. Config or policy changes require human approval.",
    "Be concise and structured. If the data doesn't support an answer, say so.",
  ].join("\n");

  const result = await generate({ system, user: `Unit administration data (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "admin_assistant" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The assistant declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ actor_id: user.id, actor_name: profile?.full_name ?? null, action: "adm_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
