// LIFEOS-API-001 sections 2 and 5. Types shared across the engine. No imports from outside LifeOS.

export type Row = Record<string, unknown>;

/**
 * Who is asking. `session` is a signed-in person and holds every scope. `delegated_token` is reserved for
 * step 9 (user-delegated third-party access), and narrows what can be done through `scopes`.
 * There is no master key principal, and there will not be one.
 */
export type Principal = {
  kind: "session" | "delegated_token";
  individualId: string;
  scopes: "*" | readonly string[];
  clientId: string | null;
  /** The one workspace a delegated token was approved for. Null for a person signed in. */
  boundWorkspaceId: string | null;
};

export type ActorKind = "user" | "ai" | "integration" | "system";
export type ProvenanceSource = "user" | "ai_suggestion" | "integration" | "import" | "system";
export type Provenance = { source: ProvenanceSource; ref: string | null };

export type Op =
  | { t: string; op: "insert"; values: Row }
  | { t: string; op: "update"; id: string; workspace_id?: string; expected_version?: number; values: Row };

export type MutateArgs = {
  actor: string | null;
  actorKind: ActorKind;
  idempotencyKey: string | null;
  requestHash: string | null;
  traceId: string | null;
  ops: Op[];
};

export type Ref = { t: string; id: string };
export type MutateResult = { replayed: boolean; refs: Ref[]; rows: Row[] };

export type ListQuery = {
  workspaceId: string;
  filters?: Record<string, string>;
  /** Inclusive date bounds on one column. */
  range?: { column: string; from?: string; to?: string } | null;
  /** Raw visibility disjunction, built only by core/access.ts from validated ids. */
  visibility?: string | null;
  hasArchive: boolean;
  includeArchived?: boolean;
  orderColumn: "created_at" | "seq";
  cursor?: { at: string; id: string } | { seq: number } | null;
  limit: number;
};

/**
 * The only port between the engine and storage. `mutate` is the only method that writes, and the Supabase
 * adapter sends it to lifeos_mutate, which runs the whole batch in one transaction.
 */
export interface LifeosStore {
  flagEnabled(flag: string): Promise<boolean>;
  rateTake(subject: string, bucket: string, max: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }>;
  mutate(args: MutateArgs): Promise<MutateResult>;
  peekIdempotency(actor: string, key: string): Promise<{ requestHash: string; refs: Ref[] } | null>;
  get(table: string, id: string): Promise<Row | null>;
  where(table: string, eq: Record<string, string>, opts?: { limit?: number; order?: string }): Promise<Row[]>;
  list(table: string, q: ListQuery): Promise<Row[]>;
  liveGrants(workspaceId: string, granteeId: string): Promise<Row[]>;
}
