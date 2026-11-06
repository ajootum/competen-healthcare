import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDatabaseError } from "../core/errors";
import type { LifeosStore, ListQuery, MutateArgs, MutateResult, Ref, Row } from "../core/types";

// LIFEOS-API-001 section 2. The storage adapter. Takes a client, imports nothing from the rest of Competen, and so
// moves unchanged in a carve-out. It reads lifeos_ tables only, and writes only through lifeos_mutate.

const assertLifeosTable = (table: string) => {
  if (!/^lifeos_[a-z_]+$/.test(table)) throw new Error("lifeos: refused a table outside the seal");
};

export function supabaseStore(admin: SupabaseClient): LifeosStore {
  return {
    async flagEnabled(flag) {
      const { data, error } = await admin.from("lifeos_flag").select("enabled").eq("flag", flag).maybeSingle();
      if (error) return false;
      return data?.enabled === true;
    },

    async rateTake(subject, bucket, max, windowSeconds) {
      const { data, error } = await admin.rpc("lifeos_rate_take", { p_subject: subject, p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
      if (error) throw fromDatabaseError(error);
      const r = data as { allowed: boolean; retry_after: number };
      return { allowed: r.allowed, retryAfter: r.retry_after };
    },

    async mutate(a: MutateArgs): Promise<MutateResult> {
      const { data, error } = await admin.rpc("lifeos_mutate", {
        p_actor: a.actor, p_actor_kind: a.actorKind, p_idempotency_key: a.idempotencyKey,
        p_request_hash: a.requestHash, p_trace_id: a.traceId, p_ops: a.ops,
      });
      if (error) throw fromDatabaseError(error);
      return data as MutateResult;
    },

    async peekIdempotency(actor, key) {
      const { data, error } = await admin.from("lifeos_live_idempotency")
        .select("request_hash, result").eq("actor_individual_id", actor).eq("idempotency_key", key).maybeSingle();
      if (error) throw fromDatabaseError(error);
      if (!data) return null;
      return { requestHash: data.request_hash as string, refs: (data.result ?? []) as Ref[] };
    },

    async get(table, id) {
      assertLifeosTable(table);
      const { data, error } = await admin.from(table).select("*").eq("id", id).maybeSingle();
      if (error) throw fromDatabaseError(error);
      return (data as Row | null) ?? null;
    },

    async where(table, eq, opts) {
      assertLifeosTable(table);
      let q = admin.from(table).select("*");
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      const { data, error } = await q.order("created_at", { ascending: true }).limit(opts?.limit ?? 1000);
      if (error) throw fromDatabaseError(error);
      return (data ?? []) as Row[];
    },

    async list(table, l: ListQuery) {
      assertLifeosTable(table);
      let q = admin.from(table).select("*").eq("workspace_id", l.workspaceId);
      for (const [k, v] of Object.entries(l.filters ?? {})) q = q.eq(k, v);
      if (l.hasArchive && !l.includeArchived) q = q.is("archived_at", null);
      if (l.visibility) q = q.or(l.visibility);
      if (l.orderColumn === "seq") {
        if (l.cursor && "seq" in l.cursor) q = q.gt("seq", l.cursor.seq);
        q = q.order("seq", { ascending: true });
      } else {
        if (l.cursor && "at" in l.cursor) {
          q = q.or(`created_at.gt."${l.cursor.at}",and(created_at.eq."${l.cursor.at}",id.gt.${l.cursor.id})`);
        }
        q = q.order("created_at", { ascending: true }).order("id", { ascending: true });
      }
      const { data, error } = await q.limit(l.limit);
      if (error) throw fromDatabaseError(error);
      return (data ?? []) as Row[];
    },

    async liveGrants(workspaceId, granteeId) {
      const { data, error } = await admin.from("lifeos_live_grant").select("*")
        .eq("workspace_id", workspaceId).eq("grantee_individual_id", granteeId).limit(500);
      if (error) throw fromDatabaseError(error);
      return (data ?? []) as Row[];
    },
  };
}
