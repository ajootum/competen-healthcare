import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit, readBody, refuse, todayUtc } from "@/lib/individual/professional/api";
import { isUuid } from "@/lib/individual/professional/validate";
import { PERIODS, PROGRESS_VIEWS } from "@/lib/individual/professional/progress-policy";
import { buckets, timeline } from "@/lib/individual/professional/progress-intel";
import { loadProgressInput } from "@/lib/individual/professional/progress-sources";
import { decideStep, deleteView, savePreference, saveSnapshot, saveView } from "@/lib/individual/professional/progress-store";
import { currentConfigVersion } from "@/lib/individual/professional/evaluation-store";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/progress -- COMPETEN-PROFESSIONAL-PROGRESS-01 s3, what My Professional Progress stores.
//
// POST { action: "decide", key, decision: accepted|deferred|dismissed, deferredUntil? }: a decision on a next step. It
//   opens nothing and creates nothing: the step's link goes to its owning module.
// POST { action: "preference", period, view } | { action: "view", name, view, period } | { action: "snapshot", period }.
// DELETE ?view=<id>: remove a saved view. A snapshot is the record keys and counts the period shows, recomputed here.

const VIEW_CODES = PROGRESS_VIEWS.map(([v]) => v) as string[];
const PERIOD_CODES = PERIODS.map(([p]) => p) as string[];

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const today = todayUtc();
  switch (fields.action) {
    case "decide": {
      const key = typeof fields.key === "string" ? fields.key : "";
      if (!/^[a-z0-9][a-z0-9:_.-]{0,159}$/.test(key)) return refuse("Choose a next step.");
      const decision = fields.decision;
      if (decision !== "accepted" && decision !== "deferred" && decision !== "dismissed") return refuse("Choose accept, defer or dismiss.");
      const until = typeof fields.deferredUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fields.deferredUntil) && fields.deferredUntil >= today ? fields.deferredUntil : null;
      const out = await decideStep(ctx.admin, ctx.userId, key, decision, decision === "deferred" ? until : null);
      if (!out.ok) return refuse(out.error, out.status);
      await audit(ctx, "individual_professional_progress_decide", "individual_professional_progress_decision", out.id, { decision });
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    case "preference": {
      if (!PERIOD_CODES.includes(String(fields.period)) || !VIEW_CODES.includes(String(fields.view))) return refuse("Choose a view and a period.");
      const out = await savePreference(ctx.admin, ctx.userId, { period: String(fields.period), view: String(fields.view) });
      return out.ok ? NextResponse.json({ ok: true }) : refuse(out.error, out.status);
    }
    case "view": {
      const name = typeof fields.name === "string" ? fields.name.trim() : "";
      if (name.length < 1 || name.length > 120) return refuse("Name the view (up to 120 characters).");
      if (!PERIOD_CODES.includes(String(fields.period)) || !VIEW_CODES.includes(String(fields.view))) return refuse("Choose a view and a period.");
      const out = await saveView(ctx.admin, ctx.userId, { name, view: String(fields.view), period: String(fields.period), filters: {} });
      return out.ok ? NextResponse.json({ ok: true, id: out.id }, { status: 201 }) : refuse(out.error, out.status);
    }
    case "snapshot": {
      const policy = (await loadIndividualPolicy(ctx.admin)).professionalProgress;
      const period = PERIOD_CODES.includes(String(fields.period)) ? String(fields.period) as (typeof PERIODS)[number][0] : policy.defaultPeriod;
      const { input, extra } = await loadProgressInput(ctx.admin, ctx.userId, today);
      const events = timeline(input, extra, policy);
      const bs = buckets(events, period, extra.context);
      const summary = { period, buckets: bs.slice(0, 40).map(b => ({ key: b.key, label: b.label, counts: b.events.reduce<Record<string, number>>((t, e) => ({ ...t, [e.kind]: (t[e.kind] ?? 0) + 1 }), {}), refs: b.events.map(e => e.key).slice(0, 200) })) };
      const out = await saveSnapshot(ctx.admin, ctx.userId, { period, from: bs[bs.length - 1]?.from ?? null, to: today, summary, configVersion: await currentConfigVersion(ctx.admin) });
      if (!out.ok) return refuse(out.error, out.status);
      await audit(ctx, "individual_professional_progress_snapshot", "individual_professional_progress_snapshot", out.id, { period, events: events.length });
      return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
    }
    default: return refuse("Unknown action.");
  }
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("view");
  if (!isUuid(id)) return refuse("Choose a saved view.");
  const out = await deleteView(ctx.admin, ctx.userId, id);
  return out.ok ? NextResponse.json({ ok: true }) : refuse(out.error, out.status);
}
