import { RELATION_KINDS } from "./shape";
import { must, mustOk, type Admin, type Row } from "./db";

/**
 * Instrument level links. A RELATION joins two instruments (related, adapted from, supersedes, companion). A REFERENCE
 * names a standard, framework or policy by id and label and COPIES NOTHING from it. Criterion level mappings stay on
 * the versions (asmt_mapping), where the Studio owns them.
 */
export type RelatedInstrument = { direction: "out" | "in"; relation: string; instrumentId: string; code: string; name: string; note: string | null };
export type InstrumentReference = { id: string; kind: string; kindLabel: string; refTable: string | null; refId: string | null; refCode: string | null; refLabel: string; refVersion: string | null };

export async function loadRelations(admin: Admin, instrumentId: string): Promise<RelatedInstrument[]> {
  const [o, i] = await Promise.all([
    admin.from("asmt_instrument_relation").select("instrument_id, related_instrument_id, relation, note").eq("instrument_id", instrumentId),
    admin.from("asmt_instrument_relation").select("instrument_id, related_instrument_id, relation, note").eq("related_instrument_id", instrumentId),
  ]);
  const outRows = (must(o as { data: Row[] | null; error: { message: string } | null }, "relations") ?? []) as Row[];
  const inRows = (must(i as { data: Row[] | null; error: { message: string } | null }, "relations") ?? []) as Row[];
  const ids = [...new Set([...outRows.map(r => r.related_instrument_id), ...inRows.map(r => r.instrument_id)])];
  if (!ids.length) return [];
  const names = (must(await admin.from("asmt_instrument").select("id, code, name").in("id", ids), "related instruments") ?? []) as Row[];
  const by = new Map(names.map(n => [n.id as string, n]));
  const shape = (direction: "out" | "in", r: Row): RelatedInstrument => {
    const other = by.get(direction === "out" ? r.related_instrument_id : r.instrument_id);
    return { direction, relation: r.relation, instrumentId: other?.id ?? "", code: other?.code ?? "", name: other?.name ?? "", note: r.note ?? null };
  };
  return [...outRows.map(r => shape("out", r)), ...inRows.map(r => shape("in", r))].filter(r => r.instrumentId);
}

export async function setRelation(admin: Admin, actor: string, instrumentId: string, relatedId: string, relation: string, note: string | null, remove: boolean): Promise<void> {
  if (!(RELATION_KINDS as readonly string[]).includes(relation)) throw new Error("Choose related, adapted from, supersedes or companion");
  mustOk(await admin.rpc("asmt_catalogue_set_relation", {
    p_instrument: instrumentId, p_related: relatedId, p_relation: relation, p_note: note, p_remove: remove, p_actor: actor,
  }) as { error: { message: string } | null }, "relation");
}

export async function loadReferences(admin: Admin, instrumentId: string): Promise<InstrumentReference[]> {
  const [r, k] = await Promise.all([
    admin.from("asmt_instrument_reference").select("id, instrument_id, kind, ref_table, ref_id, ref_code, ref_label, ref_version").eq("instrument_id", instrumentId).order("ref_label"),
    admin.from("asmt_mapping_kind").select("code, label"),
  ]);
  const rows = (must(r as { data: Row[] | null; error: { message: string } | null }, "references") ?? []) as Row[];
  const kinds = new Map(((must(k as { data: Row[] | null; error: { message: string } | null }, "reference kinds") ?? []) as Row[]).map(x => [x.code as string, x.label as string]));
  return rows.map(x => ({
    id: x.id, kind: x.kind, kindLabel: kinds.get(x.kind) ?? x.kind, refTable: x.ref_table ?? null, refId: x.ref_id ?? null,
    refCode: x.ref_code ?? null, refLabel: x.ref_label, refVersion: x.ref_version ?? null,
  }));
}

/** The kinds a reference can have (the 890 mapping kind registry). */
export async function loadReferenceKinds(admin: Admin): Promise<{ code: string; label: string }[]> {
  const rows = (must(await admin.from("asmt_mapping_kind").select("code, label").order("label"), "reference kinds") ?? []) as Row[];
  return rows.map(x => ({ code: x.code, label: x.label }));
}

export type ReferenceInput = { kind: string; refTable?: string | null; refId?: string | null; refCode?: string | null; refLabel: string; refVersion?: string | null };

export async function addReference(admin: Admin, actor: string, instrumentId: string, input: ReferenceInput): Promise<string> {
  const res = await admin.rpc("asmt_catalogue_reference_add", {
    p_instrument: instrumentId, p_kind: input.kind, p_ref_table: input.refTable ?? null, p_ref_id: input.refId ?? null,
    p_ref_code: input.refCode ?? null, p_ref_label: input.refLabel, p_ref_version: input.refVersion ?? null, p_actor: actor,
  });
  return must(res as { data: string | null; error: { message: string } | null }, "reference") ?? "";
}

export async function removeReference(admin: Admin, actor: string, referenceId: string): Promise<void> {
  mustOk(await admin.rpc("asmt_catalogue_reference_remove", { p_reference: referenceId, p_actor: actor }) as { error: { message: string } | null }, "reference");
}
