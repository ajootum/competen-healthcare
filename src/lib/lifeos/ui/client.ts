// LIFEOS-API-001 step 5. The interface talks to LifeOS only through the versioned API, the same door any other client
// would use. It has no database access of its own, so it proves the API is enough.

const BASE = "/api/lifeos/v1";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = { data: T; meta?: { nextCursor?: string | null; replayed?: boolean } };

async function request<T>(method: string, path: string, body?: unknown, key?: string): Promise<Envelope<T>> {
  const write = method !== "GET";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: write ? { "Content-Type": "application/json", "Idempotency-Key": key ?? crypto.randomUUID() } : undefined,
      ...(write ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    throw new ApiError(0, "offline", "LifeOS could not be reached. Check your connection and try again.");
  }
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!res.ok) {
    const e = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "unavailable", e?.message ?? "LifeOS could not complete that just now.", e?.details);
  }
  return parsed as Envelope<T>;
}

export const get = async <T>(path: string) => (await request<T>("GET", path)).data;
export const post = async <T>(path: string, body?: unknown, key?: string) => (await request<T>("POST", path, body, key)).data;
export const patch = async <T>(path: string, body: unknown, key?: string) => (await request<T>("PATCH", path, body, key)).data;

/** Every page of a list. */
export async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined = null;
  const join = path.includes("?") ? "&" : "?";
  do {
    const page: Envelope<T[]> = await request<T[]>("GET", `${path}${join}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...page.data);
    cursor = page.meta?.nextCursor;
  } while (cursor);
  return out;
}

export type Stamped = { id: string; version: number; workspaceId: string; ownerIndividualId: string; status: string; provenanceSource: string };

export type Individual = { id: string; displayName: string; timezone: string; version: number };
export type Workspace = { id: string; name: string; kind: "personal" | "organisation"; tenantId: string | null };
export type World = Stamped & { title: string; context: string | null; purpose: string | null; position: number };
export type Commitment = Stamped & {
  worldId: string | null; title: string; notes: string | null; important: boolean | null; urgent: boolean | null;
  quadrant: "q1" | "q2" | "q3" | "q4" | null; dueOn: string | null; scheduledOn: string | null; scheduledTime: string | null;
  estimatedMinutes: number | null; completedAt: string | null; accessScope: "private" | "workspace";
};
export type Delegation = Stamped & { commitmentId: string; delegateeLabel: string | null; followUpOn: string };
export type ProtectedBlock = Stamped & { commitmentId: string | null; worldId: string | null; label: string; startsAt: string; endsAt: string };
export type WeeklyPlan = Stamped & { weekStart: string; intention: string | null };
export type BigRock = Stamped & { weeklyPlanId: string; commitmentId: string };
export type WeeklyReview = Stamped & { weekStart: string; reflection: string | null; nextWeekFocus: string | null; snapshot: Record<string, number | string> | null };
export type Suggestion = Stamped & { kind: string; materiality: "informational" | "material"; title: string; rationale: string | null; generator: string };
export type Entitlement = { id: string; version: number; source: string };
export type Me = { individual: Individual; entitlements: Entitlement[]; workspaces: Workspace[] };
