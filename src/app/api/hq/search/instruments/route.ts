import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { hqRecordSource } from "@/lib/hq/record-search/registry";
import { respondRecordSearch } from "@/lib/hq/record-search/read";

// HQ-RECORD-SEARCH-01: instruments, code and title only, platform-owned only. The gate is LITERAL here because hq-scan reads it per verb.
export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.assessment.studio.view"]);
  if (isHqRefusal(ctx)) return ctx;
  return respondRecordSearch(hqRecordSource("instruments"), ctx.admin, req);
}
