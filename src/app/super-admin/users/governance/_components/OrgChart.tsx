"use client";

import { useState } from "react";
import type { GovChange, GovDefinition, GovPositionDef, GovRelationType, GovUnitDef } from "@/lib/hq/governance-studio";
import { POSITION_KIND_LABEL, UNIT_KIND_LABEL } from "@/lib/hq/governance-studio";

/**
 * The organisation chart, drawn from a structure definition (Addendum V1.2). Levels top to bottom, units nested under
 * their parents within a level, shared services beside the levels, and every relationship listed with its type's line
 * style. Used read-only by the history view and editable by the Studio.
 *
 * ⚠ DRAG AND DROP IS A CONVENIENCE, NEVER THE ONLY WAY. Dropping a position on a unit calls the same move the
 * Studio's form offers, and every card is a button that opens its detail panel by keyboard too.
 */

export type ChartSelection = { kind: "unit" | "position"; code: string } | null;
type Props = {
  def: GovDefinition;
  relationTypes: GovRelationType[];
  changes?: GovChange[];
  showRetired?: boolean;
  selection?: ChartSelection;
  onSelect?: (s: ChartSelection) => void;
  onMovePosition?: (position: string, unit: string) => void;
};

const CHANGE_TONE: Record<GovChange["change"], string> = {
  added: "ring-2 ring-green-500", changed: "ring-2 ring-amber-400", moved: "ring-2 ring-indigo-400",
  retired: "ring-2 ring-red-400 opacity-60", restored: "ring-2 ring-green-500",
};
const LINE: Record<string, string> = { solid: "border-solid", dashed: "border-dashed", dotted: "border-dotted" };

export default function OrgChart({ def, relationTypes, changes = [], showRetired = false, selection, onSelect, onMovePosition }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const tone = (kind: GovChange["kind"], code: string) => {
    const c = changes.find(x => x.kind === kind && x.code === code);
    return c ? CHANGE_TONE[c.change] : "";
  };
  const visible = <T extends { retired?: boolean }>(x: T) => showRetired || !x.retired;
  const units = def.units.filter(visible);
  const positionsOf = (u: GovUnitDef) => def.positions.filter(p => p.unit === u.code && visible(p)).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100));
  const unitName = (code: string) => def.units.find(u => u.code === code)?.name ?? code;
  const isSel = (kind: "unit" | "position", code: string) => selection?.kind === kind && selection.code === code;

  const renderPosition = (p: GovPositionDef) => (
    <li key={p.code}>
      <button type="button"
        draggable={!!onMovePosition && !p.retired}
        onDragStart={() => setDragging(p.code)} onDragEnd={() => setDragging(null)}
        onClick={() => onSelect?.({ kind: "position", code: p.code })}
        aria-pressed={isSel("position", p.code)}
        className={`w-full text-left rounded-md border bg-white px-2 py-1.5 min-h-9 pointer-coarse:min-h-11 text-[12px] ${isSel("position", p.code) ? "border-teal-600" : "border-gray-200"} ${tone("position", p.code)} ${p.retired ? "line-through text-gray-400" : "text-gray-900"}`}>
        <span className="font-medium">{p.name}</span>
        <span className="block text-[11px] text-gray-500">{POSITION_KIND_LABEL[p.kind] ?? p.kind}{p.authority_position ? ` · links ${p.authority_position}` : ""}{p.retired ? " · retired" : ""}</span>
      </button>
    </li>
  );

  const renderUnit = (u: GovUnitDef): React.ReactElement => {
    const kids = units.filter(c => c.parent === u.code && (c.level ?? null) === (u.level ?? null));
    const drop = onMovePosition && !u.retired
      ? { onDragOver: (e: React.DragEvent) => { if (dragging) e.preventDefault(); },
          onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragging) onMovePosition(dragging, u.code); setDragging(null); } }
      : {};
    return (
      <section key={u.code} {...drop} aria-label={u.name}
        className={`rounded-xl border bg-white p-3 space-y-2 ${u.kind === "holding_company" || u.kind === "product_lead" ? "border-indigo-300" : "border-gray-200"} ${tone("unit", u.code)} ${dragging ? "outline-dashed outline-1 outline-teal-400" : ""}`}>
        <button type="button" onClick={() => onSelect?.({ kind: "unit", code: u.code })} aria-pressed={isSel("unit", u.code)}
          className={`w-full text-left rounded-md px-1 ${isSel("unit", u.code) ? "bg-teal-50" : ""}`}>
          <span className={`block font-semibold text-sm ${u.retired ? "line-through text-gray-400" : "text-gray-900"}`}>{u.name}</span>
          <span className="block text-[11px] text-gray-500">{UNIT_KIND_LABEL[u.kind] ?? u.kind}{u.retired ? " · retired" : ""}</span>
        </button>
        {positionsOf(u).length > 0 && <ul className="grid gap-1 sm:grid-cols-2">{positionsOf(u).map(renderPosition)}</ul>}
        {kids.length > 0 && <div className="pl-3 border-l-2 border-gray-100 space-y-2">{kids.map(renderUnit)}</div>}
      </section>
    );
  };

  // A unit is drawn under its parent only when the parent sits on the same level, otherwise at the top of its own level.
  const roots = (level: number) => units.filter(u => u.level === level && (!u.parent || units.find(p => p.code === u.parent)?.level !== level));
  const services = units.filter(u => u.level == null);
  const style = (type: string) => relationTypes.find(t => t.code === type);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
        <div className="space-y-4">
          {def.levels.map(l => (
            <section key={l.level} className="space-y-2" aria-label={`Level ${l.level}`}>
              <h3 className="text-[12px] font-bold tracking-wide text-indigo-800 uppercase">Level {l.level} · {l.label}</h3>
              {roots(l.level).length ? roots(l.level).map(renderUnit) : <p className="text-[12px] text-gray-500">No unit on this level.</p>}
            </section>
          ))}
          {units.some(u => u.level != null && !def.levels.some(l => l.level === u.level)) && (
            <p className="text-[12px] text-amber-900">Some units sit on a level this version does not define. Add the level or move them.</p>
          )}
        </div>
        {services.length > 0 && (
          <aside className="space-y-2 rounded-xl bg-gray-50 border border-gray-200 p-3" aria-label="Shared services beside the levels">
            <h3 className="text-[12px] font-bold tracking-wide text-indigo-800 uppercase">Shared services · not a level</h3>
            {services.filter(u => !u.parent || units.find(p => p.code === u.parent)?.level != null).map(renderUnit)}
          </aside>
        )}
      </div>
      {units.length === 0 && <p className="text-sm text-gray-500">This version has no units yet.</p>}
      <section className="space-y-1" aria-label="Relationships">
        <h3 className="text-[12px] font-bold tracking-wide text-indigo-800 uppercase">Relationships</h3>
        <ul className="grid gap-1 md:grid-cols-2">
          {def.relationships.filter(visible).map(r => {
            const t = style(r.type);
            return (
              <li key={r.code} className={`rounded-lg border-2 ${LINE[t?.lineStyle ?? "solid"]} border-gray-300 bg-white px-2 py-1 text-[12px] ${tone("relationship", r.code)} ${r.retired ? "line-through text-gray-400" : ""}`}>
                <span className="text-[11px] font-semibold uppercase text-gray-500">{t?.label ?? r.type}</span>
                <span className="block text-gray-900">{unitName(r.from)} → {unitName(r.to)}</span>
                <span className="block text-gray-600">{r.scope}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
