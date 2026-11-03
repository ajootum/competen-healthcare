// Assessor workspace: the audit row for a state change. Never carries answers, notes or names, only ids and classes.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { currentTraceId } from "@/lib/trace";
import type { HqContext } from "@/lib/hq/context";

export async function auditAssessor(ctx: Pick<HqContext, "admin" | "userId" | "fullName">, action: string, entityType: string, entityId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await (ctx.admin as any).from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: `checklist_assessment_${action}`, entity_type: entityType, entity_id: entityId, new_value: detail,
  }).then((r: unknown) => r, () => {});
}
