"use client";
// <ReorderList>: drag (touch or mouse, pointer events) plus accessible Move up / Move down buttons and a polite live
// announcement. It only computes the list the editor asked for (src/lib/competency/reorder-ui.ts); the host decides and
// saves the order. A drop counts only inside this list.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  announceMove, dropOf, moveInArray, movePointerDrag, readDropTarget, startPointerDrag, stepTarget, type PointerDrag,
} from "@/lib/assessment/reorder";
import { Btn, focusRing, touchSm } from "./ui";

export interface ReorderListProps<T> {
  items: T[];
  getKey: (item: T) => string;
  /** the name a screen reader hears for an item */
  getLabel: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  onReorder: (next: T[], move: { from: number; to: number }) => void;
  /** names this list, for the grip and group labels, for example "Sections" */
  ariaLabel: string;
  /** distinguishes lists on one page so a drag never drops into another list */
  listKey?: string;
  disabled?: boolean;
  className?: string;
}

export function ReorderList<T>({ items, getKey, getLabel, renderItem, onReorder, ariaLabel, listKey = "list", disabled, className = "" }: ReorderListProps<T>) {
  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const [message, setMessage] = useState("");
  const dragRef = useRef<PointerDrag | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; });
  const pending = useRef<{ key: string; dir: -1 | 1 } | null>(null);
  const root = useRef<HTMLUListElement>(null);

  const apply = useCallback((from: number, to: number) => {
    const cur = itemsRef.current;
    const next = moveInArray(cur, from, to);
    setMessage(announceMove(getLabel(cur[from]), to, cur.length));
    onReorder(next, { from, to });
  }, [getLabel, onReorder]);

  // keep focus on the button that was used, after the row moves
  useEffect(() => {
    const p = pending.current;
    if (!p || !root.current) return;
    pending.current = null;
    const find = (d: string) => Array.from(root.current!.querySelectorAll<HTMLButtonElement>("[data-move]")).find((b) => b.getAttribute("data-move") === `${p.key}:${d}`);
    const el = find(String(p.dir)) ?? find(String(p.dir === 1 ? -1 : 1));
    el?.focus();
  }, [items]);

  const hit = (x: number, y: number) => {
    const el = typeof document !== "undefined" && document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    const row = el?.closest<HTMLElement>("[data-reorder-key]");
    return row ? readDropTarget(row.dataset.reorderKey, row.dataset.reorderIndex) : null;
  };

  const onGripDown = (e: React.PointerEvent, index: number) => {
    if (disabled || e.button > 0) return;
    const start = startPointerDrag(listKey, index, e.clientX, e.clientY);
    dragRef.current = start;
    setDrag(start);
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const n = movePointerDrag(dragRef.current, ev.clientX, ev.clientY, hit(ev.clientX, ev.clientY));
      dragRef.current = n;
      setDrag(n);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      const drop = d ? dropOf(d) : null;
      if (drop) apply(drop.from, drop.to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const step = (index: number, dir: -1 | 1) => {
    const to = stepTarget(index, dir, items.length);
    if (to === null) return;
    pending.current = { key: getKey(items[index]), dir };
    apply(index, to);
  };

  return (
    <div className={className}>
      <ul ref={root} aria-label={ariaLabel} className="flex flex-col gap-2">
        {items.map((it, i) => {
          const key = getKey(it);
          const name = getLabel(it);
          const dragging = drag?.active && drag.index === i;
          const over = drag?.active && drag.over === i && drag.index !== i;
          return (
            <li
              key={key} data-reorder-key={listKey} data-reorder-index={i}
              className={`flex items-stretch gap-2 rounded-lg border bg-[var(--cmp-app-surface)] ${over ? "border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-soft)]" : "border-[var(--cmp-app-border)]"} ${dragging ? "opacity-60" : ""}`}
            >
              {!disabled ? (
                <button
                  type="button" aria-label={`Drag ${name}. Or use Move up and Move down.`} onPointerDown={(e) => onGripDown(e, i)}
                  className={`flex w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-lg bg-[var(--cmp-app-bg)] text-[var(--cmp-app-text-secondary)] pointer-coarse:w-11 ${focusRing}`}
                ><span aria-hidden>::</span></button>
              ) : null}
              <div className="min-w-0 flex-1 py-2">{renderItem(it, i)}</div>
              {!disabled ? (
                <div className="flex shrink-0 items-center gap-1 pr-2">
                  <Btn size="sm" data-move={`${key}:-1`} aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => step(i, -1)} className={touchSm}>Move up</Btn>
                  <Btn size="sm" data-move={`${key}:1`} aria-label={`Move ${name} down`} disabled={i === items.length - 1} onClick={() => step(i, 1)} className={touchSm}>Move down</Btn>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
    </div>
  );
}
