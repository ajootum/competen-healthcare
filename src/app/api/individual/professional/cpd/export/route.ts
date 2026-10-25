import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { cpdCsv } from "@/lib/individual/professional/cpd-requirements";
import { CPD_ACTIVITY_LABEL } from "@/lib/individual/professional/vocabulary";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// GET /api/individual/professional/cpd/export -- the person's own CPD log as CSV (LCPD-01 LCPD-5, "appropriate exports").
// Their own rows only, through the same guard and record reader as the CPD page. Each line says what kind of evidence it
// is, and nothing in it is presented as verified.

export async function GET() {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const [record, cfg] = await Promise.all([loadProfessionalRecord(ctx.admin, ctx.userId), loadLcpdConfig(ctx.admin)]);
  if (record.cpd === null) return NextResponse.json({ error: "Your CPD log could not be read just now." }, { status: 503 });
  const labels = new Map(cfg.activityTypes.map(t => [t.code, t.label]));
  const csv = cpdCsv(record.cpd, c => labels.get(c) ?? CPD_ACTIVITY_LABEL[c] ?? c);
  return new NextResponse(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="cpd-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "no-store",
  } });
}
