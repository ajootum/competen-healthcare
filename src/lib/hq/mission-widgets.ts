// PLAT-GOV-MC-001 - widget data sources.
//
// ⚠ EVERY SOURCE RE-ASKS FOR ITS CAPABILITY. Section 10: "widgets must independently enforce authorization,
// hiding a widget is not a security control". resolveMissionProfile already filtered the list, and that
// filter is presentation. This is the control. A widget invoked with a viewer who does not hold its
// capability returns `forbidden` and reads nothing.
//
// ⚠ AND A FAILED READ IS NEVER A ZERO. Each source has three outcomes - a value, an honest empty, or
// `unavailable`. "0 practices" and "we could not ask" are different sentences and a dashboard that renders
// them identically is lying about the second one.
//
// ⚠ ONLY SOURCES THAT EXIST ARE HERE. Migration 281 deliberately seeds no operator-licence widget: the door
// exists (migration 273) and no engine reads it. A widget with no source is a promise on a screen.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type WidgetValue =
  | { kind: "count"; value: number; caption: string }
  | { kind: "list"; rows: { label: string; detail: string | null }[]; caption: string }
  | { kind: "flags"; rows: { label: string; on: boolean }[]; caption: string };

export type WidgetResult =
  | { state: "ok"; value: WidgetValue }
  | { state: "empty"; caption: string }
  | { state: "unavailable"; reason: string }
  | { state: "forbidden" };

type Ctx = { admin: any; isOwner: boolean; capabilities: string[] };

const holds = (ctx: Ctx, capability: string) => ctx.isOwner || ctx.capabilities.includes(capability);

// ⚠ NOT head:true. A head+count read returns NO ERROR for a table that does not exist -- the trap this
// codebase has hit before -- so the count comes back null and a caller that defaults it to 0 renders a
// missing table as "none". Selecting a row alongside the count makes a missing table a real error.
async function countOf(admin: any, table: string, apply?: (q: any) => any): Promise<WidgetResult> {
  try {
    let q = admin.from(table).select("id", { count: "exact" }).limit(1);
    if (apply) q = apply(q);
    const { count, error } = await q;
    if (error) return { state: "unavailable", reason: error.message };
    if (count == null) return { state: "unavailable", reason: "the store returned no count" };
    return { state: "ok", value: { kind: "count", value: count, caption: "" } };
  } catch (e: any) {
    return { state: "unavailable", reason: e?.message ?? "read threw" };
  }
}

export const WIDGET_SOURCES: Record<string, { capability: string; run: (ctx: Ctx) => Promise<WidgetResult> }> = {
  // Every practice provisioned on the platform.
  "practice.workspaces.total": {
    capability: "hq.practice.operations.view",
    run: async ctx => {
      if (!holds(ctx, "hq.practice.operations.view")) return { state: "forbidden" };
      const r = await countOf(ctx.admin, "practice_workspace");
      if (r.state !== "ok" || r.value.kind !== "count") return r;
      return { state: "ok", value: { ...r.value, caption: r.value.value === 1 ? "practice provisioned" : "practices provisioned" } };
    },
  },

  // Provisioning requests that have not completed. An operator queue, not a metric.
  "practice.provisioning.pending": {
    capability: "hq.practice.operations.view",
    run: async ctx => {
      if (!holds(ctx, "hq.practice.operations.view")) return { state: "forbidden" };
      try {
        const { data, error } = await ctx.admin
          .from("provisioning_request")
          .select("id, request_type, status, error_code, created_at")
          /**
           * ⚠ THE VOCABULARY IS UPPERCASE, AND THIS FILTER WAS LOWERCASE (2026-08-17).
           *
           * Migration 191 constrains provisioning_request.status to REQUESTED / IDENTITY_PENDING /
           * PROVISIONING / ONBOARDING / ACTIVE / EXPIRED / FAILED / COMPLETED. This read excluded
           * "(succeeded,completed)" -- lowercase, and `succeeded` is not one of the eight at all.
           * Postgres string comparison is case-sensitive, so 'COMPLETED' NOT IN ('succeeded',
           * 'completed') is TRUE and every finished request came back as pending. The owner's own
           * Mission Control showed four rows reading COMPLETED under a queue captioned "4 waiting".
           *
           * ⚠ FAILED IS DELIBERATELY STILL LISTED. It is not waiting, but it is not finished either --
           * it is the state that needs somebody, and the gate ledger already tells them to resume or
           * clear it. Each row renders its own status, so a FAILED request reads as FAILED rather than
           * being quietly counted as pending. Only the two states that need nobody are excluded.
           */
          .not("status", "in", "(COMPLETED,EXPIRED)")
          .order("created_at", { ascending: false })
          .limit(25);
        if (error) return { state: "unavailable", reason: error.message };
        const rows = (data ?? []) as any[];
        if (!rows.length) return { state: "empty", caption: "No provisioning request is waiting" };
        return {
          state: "ok",
          value: {
            kind: "list",
            caption: rows.length === 25 ? "showing the 25 most recent" : `${rows.length} waiting`,
            rows: rows.map(r => ({
              label: r.request_type ?? "request",
              detail: r.error_code ? `${r.status} - ${r.error_code}` : (r.status ?? null),
            })),
          },
        };
      } catch (e: any) {
        return { state: "unavailable", reason: e?.message ?? "read threw" };
      }
    },
  },

  // The launch gates. These are the switches an operator actually reasons about.
  "practice.flags": {
    capability: "hq.practice.operations.view",
    run: async ctx => {
      if (!holds(ctx, "hq.practice.operations.view")) return { state: "forbidden" };
      try {
        const { data, error } = await ctx.admin
          .from("practice_platform_flags").select("flag, enabled").limit(50);
        if (error) return { state: "unavailable", reason: error.message };
        const rows = (data ?? []) as any[];
        if (!rows.length) return { state: "empty", caption: "No launch flag is configured" };
        return {
          state: "ok",
          value: {
            kind: "flags",
            // ⚠ NAMES THE GATE IT CANNOT SEE. Supabase Auth's own signup switch is a THIRD gate above these
            // and is invisible from this database, so a panel showing only these two would imply signup is
            // open when it is not.
            caption: "Supabase Auth signup is a further gate this panel cannot read",
            rows: rows.map(r => ({ label: r.flag, on: !!r.enabled })),
          },
        };
      } catch (e: any) {
        return { state: "unavailable", reason: e?.message ?? "read threw" };
      }
    },
  },
};

/** Run one widget's source. An unregistered source is `unavailable`, never silently empty. */
export async function runWidget(dataSource: string, ctx: Ctx): Promise<WidgetResult> {
  const src = WIDGET_SOURCES[dataSource];
  if (!src) return { state: "unavailable", reason: `no data source registered for ${dataSource}` };
  return src.run(ctx);
}

export const REGISTERED_SOURCES = Object.keys(WIDGET_SOURCES);
