import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { hqRecordSource } from "@/lib/hq/record-search/registry";
import { respondRecordSearch } from "@/lib/hq/record-search/read";
import { currentTraceId } from "@/lib/trace";

// HQ-RECORD-SEARCH-01: HQ staff by name and position title ONLY (see the registry entry). The gate is the same capability as the
// appointments page. A staff search is a sensitive administrative search: it is recorded in audit_log (who, the source, the number of
// results) and NEVER the query text, because the query may be a person's name. If it cannot be recorded, nothing is returned.
export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;
  return respondRecordSearch(hqRecordSource("staff"), ctx.admin, req, async resultCount => {
    try {
      const { error } = await ctx.admin.from("audit_log").insert({
        trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
        action: "hq_staff_directory_search", entity_type: "hq_record_search", entity_name: "staff", hospital_id: null,
        new_value: { source: "staff", result_count: resultCount },
      });
      return !error;
    } catch { return false; }
  });
}
