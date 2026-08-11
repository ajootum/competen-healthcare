import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  previewPatientImport, commitPatientImport, listImportRuns, importRunRows, MAX_IMPORT_BYTES,
} from "@/lib/practice/patient-import";

// CPR-IMP-001 -- bulk patient import.
//
// GET  /api/v1/practice/patient-import            -- recent import runs (the reconciliation ledger)
// GET  /api/v1/practice/patient-import?runId=...  -- the per-row report of one run
// POST /api/v1/practice/patient-import            -- { csv, fileName?, mode: "preview" | "commit" }
//
// ⚠ PREVIEW AND COMMIT ARE ONE ROUTE AND ONE ENGINE so they cannot judge a row differently: the same
// parse, the same screenRegistration, the same location and timezone resolution. The only difference
// commit adds is the writes -- through register() and bookAppointment(), the registration screen's own
// engines, never a raw insert.
//
// Gate: patient.create -- the same capability the New patient screen requires. The engines re-check
// capabilities themselves (patient.edit for guardians, appointment.manage inside booking), so a caller
// missing one gets that part reported as dropped rather than silently written.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;

  const runId = new URL(req.url).searchParams.get("runId");
  const result = runId
    ? await importRunRows(auth.caller.admin, auth.ctx, runId)
    : await listImportRuns(auth.caller.admin, auth.ctx);
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ [runId ? "rows" : "runs"]: result.data, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv) return NextResponse.json({ error: "csv is required" }, { status: 400 });
  if (csv.length > MAX_IMPORT_BYTES)
    return NextResponse.json({ error: `the file is over ${MAX_IMPORT_BYTES} bytes` }, { status: 413 });
  const mode = body.mode === "commit" ? "commit" : body.mode === "preview" ? "preview" : null;
  if (!mode) return NextResponse.json({ error: 'mode must be "preview" or "commit"' }, { status: 400 });

  const result = mode === "preview"
    ? await previewPatientImport(auth.caller.admin, auth.ctx, csv)
    : await commitPatientImport(auth.caller.admin, auth.ctx, {
        csvText: csv, fileName: typeof body.fileName === "string" ? body.fileName : undefined,
      });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: mode === "commit" ? 201 : 200 });
}
