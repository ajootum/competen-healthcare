/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { importDraftPackage, previewAppend } from "@/lib/competency/authoring";
import { parseFrameworkSheet, templateCsv } from "@/lib/competency/framework-sheet";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// FRAMEWORK-DESIGN-STUDIO-02 S1 (G9): spreadsheet entry into an existing DRAFT framework, through the append import.
//
//   GET                                         the CSV template (header + two example rows), as a download
//   POST { csv, frameworkCode, dryRun: true }   the preview: what would be added, row-numbered errors, nothing written
//   POST { csv, frameworkCode, dryRun: false }  the append import (authoring.ts importDraftPackage mode "append")
//
// ⚠ GATED BY hqApiGate(["hq.quality.competency.author"]), exactly as the authoring route. It approves and publishes
// nothing: an append is a draft edit with the same authorship rows as any import.

const MAX_CSV = 2_000_000;
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

async function activeComponents(admin: any): Promise<Record<string, string> | null> {
  const { data, error } = await admin.from("competency_assessment_component").select("code, label, is_active, sort_order").order("sort_order");
  if (error) return null;
  return Object.fromEntries((data ?? []).filter((r: any) => r.is_active !== false).map((r: any) => [r.code, r.label]));
}

export async function GET() {
  const ctx = await hqApiGate(["hq.quality.competency.author"]);
  if (isHqRefusal(ctx)) return ctx;
  const components = await activeComponents(ctx.admin);
  return new NextResponse(templateCsv(Object.keys(components ?? {})), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="framework-append-template.csv"', "cache-control": "no-store" },
  });
}

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.quality.competency.author"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.csv !== "string" || !body.csv.trim()) return refuse(400, "Paste or upload the sheet as CSV.");
  if (body.csv.length > MAX_CSV) return refuse(413, "The sheet is larger than 2 MB. Split it into smaller sheets.");
  if (typeof body?.frameworkCode !== "string" || !body.frameworkCode.trim()) return refuse(400, "Choose the draft framework to add to.");
  const components = await activeComponents(ctx.admin);
  if (!components) return refuse(503, "The assessment components could not be read just now. Nothing has changed.");
  const sheet = parseFrameworkSheet(body.csv, { frameworkCode: body.frameworkCode, components });
  const dryRun = body.dryRun !== false;
  if (!sheet.package) return dryRun ? NextResponse.json(previewOf(null, sheet)) : NextResponse.json({ errors: sheet.errors }, { status: 422 });
  if (dryRun) {
    const plan = await previewAppend(ctx.admin, sheet.package);
    if ("ok" in plan) return refuse(plan.status, plan.error);
    return NextResponse.json(previewOf(plan, sheet));
  }
  const actor = { userId: ctx.userId, name: ctx.fullName ?? null };
  const r = await importDraftPackage(ctx.admin, actor, sheet.package, { mode: "append" });
  return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error);
}

/** The preview S2 renders. errors: the sheet's (row-numbered) and the environment's (row of the competency named). */
function previewOf(plan: Awaited<ReturnType<typeof previewAppend>> | null, sheet: ReturnType<typeof parseFrameworkSheet>) {
  const p = plan && !("ok" in plan) ? plan : null;
  const rowOf = new Map(sheet.competencies.map(c => [c.code, c.row]));
  const byComponent: Record<string, number> = {};
  for (const c of sheet.competencies) for (const [k, n] of Object.entries(c.criteria)) byComponent[k] = (byComponent[k] ?? 0) + n;
  const newDomains = new Set(p?.newDomains ?? []);
  return {
    framework: p ? p.framework : null,
    adds: {
      competencies: sheet.competencies.map(c => ({ ...c, newDomain: p ? newDomains.has(c.domain) : null })),
      criteria: { byComponent, total: Object.values(byComponent).reduce((a, b) => a + b, 0) },
      domains: p?.newDomains ?? [],
    },
    unchanged: p?.unchanged ?? null,
    errors: [...sheet.errors, ...(p?.problems ?? []).map(x => ({ row: x.code ? rowOf.get(x.code) ?? null : null, column: x.code ? "competency_code" : null, message: x.message }))],
  };
}
