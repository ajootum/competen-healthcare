/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR COMPETENCY ADAPTER, PROGRESSION TARGETS (Checklist Studio).
//
// A progression rule set targets one thing, fixed at creation (asmt_definition_guard makes target_kind and target_ref permanent).
// The Studio offers two kinds: a Checklist instrument (target_ref = asmt_instrument.id) and a Competency (target_ref =
// framework_competencies.id). The assessor progression step (src/lib/assessment/assessor/progression.ts) matches a rule set by
// target_ref against the instrument id of the submitted checklist AND the ids its mappings point at (a competency criterion
// mapping carries competency_id in its frozen snapshot), so both kinds are reached. This file is the one place that names the
// competency kind and reads framework_competencies for it.
import type { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

export const TARGET_KIND_INSTRUMENT = "instrument";
export const TARGET_KIND_COMPETENCY = "competency";
export const TARGET_KINDS = [TARGET_KIND_INSTRUMENT, TARGET_KIND_COMPETENCY] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const TARGET_KIND_LABEL: Record<string, string> = { [TARGET_KIND_INSTRUMENT]: "Checklist instrument", [TARGET_KIND_COMPETENCY]: "Competency" };

export interface TargetRef { kind: string; ref: string | null }

/** Does the target exist? Used before a rule set is created with it. */
export async function targetExists(admin: Admin, kind: string, ref: string): Promise<boolean> {
  if (kind === TARGET_KIND_INSTRUMENT) {
    const { data } = await admin.from("asmt_instrument").select("id").eq("id", ref).maybeSingle();
    return Boolean(data);
  }
  if (kind === TARGET_KIND_COMPETENCY) {
    const { data } = await admin.from("framework_competencies").select("id").eq("id", ref).maybeSingle();
    return Boolean(data);
  }
  return false;
}

/** "CODE name" for each target, keyed `${kind}:${ref}`. Unreadable or missing targets are simply absent. */
export async function targetLabels(admin: Admin, targets: TargetRef[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (kind: string) => [...new Set(targets.filter((t) => t.kind === kind && t.ref).map((t) => t.ref as string))];
  const inst = ids(TARGET_KIND_INSTRUMENT);
  const comp = ids(TARGET_KIND_COMPETENCY);
  const [i, c] = await Promise.all([
    inst.length ? admin.from("asmt_instrument").select("id, code, name").in("id", inst) : Promise.resolve({ data: [] as any[] }),
    comp.length ? admin.from("framework_competencies").select("id, code, name").in("id", comp) : Promise.resolve({ data: [] as any[] }),
  ]);
  for (const r of (i.data ?? []) as any[]) out.set(`${TARGET_KIND_INSTRUMENT}:${r.id}`, `${r.name} (${r.code})`);
  for (const r of (c.data ?? []) as any[]) out.set(`${TARGET_KIND_COMPETENCY}:${r.id}`, r.code ? `${r.name} (${r.code})` : String(r.name));
  return out;
}

/** What the lists and the editor show for a target. Pure. */
export function describeTarget(t: TargetRef, labels: Map<string, string>): string {
  if (!t.ref) return "No target (set at creation)";
  const kind = TARGET_KIND_LABEL[t.kind] ?? t.kind.replace(/_/g, " ");
  const label = labels.get(`${t.kind}:${t.ref}`);
  return label ? `${kind}: ${label}` : `${kind}: ${t.ref.slice(0, 8)}`;
}
