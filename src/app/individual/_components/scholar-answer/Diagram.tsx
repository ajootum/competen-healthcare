"use client";

// SCHOLAR-COMPANION-01 P2: the diagram blocks of a Scholar answer (flowchart, concept map, timeline). The data was validated
// by answer-format.ts and the coordinates come from diagram-layout.ts (pure, deterministic). Everything drawn is an SVG
// text child or a React text child, so model text can never become markup. The text alternative (a visually hidden
// structured list) carries every word of the diagram and is the source of truth; the picture is a convenience. Shape and
// words carry meaning, colour only reinforces it. Colours are the --cmp-theme-* tokens and the shared grey/semantic palette.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { DiagramBlock, FlowKind } from "@/lib/individual/scholar/answer-format";
import {
  flowOutline, layoutFlow, layoutMap, mapOutline,
  type FlowLayout, type MapLayout, type MapLayoutNode, type Pt,
} from "@/lib/individual/scholar/diagram-layout";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
// A drawing is never scaled below this share of its natural size; narrower containers scroll sideways inside the figure.
const MIN_SCALE = 0.8;
const KIND_WORD: Record<DiagramBlock["type"], string> = { flow: "Flowchart", map: "Concept map", timeline: "Timeline" };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w) setWidth(Math.round(w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(" ");

function Lines({ cx, ys, lines, className }: { cx: number; ys: number[]; lines: string[]; className?: string }) {
  return (
    <text textAnchor="middle" dominantBaseline="central" fontSize="13" className={className ?? "fill-gray-900"}>
      {lines.map((l, i) => <tspan key={i} x={cx} y={ys[i]}>{l}</tspan>)}
    </text>
  );
}

function Frame({ w, h, label, children, markerId }: { w: number; h: number; label: string; children: ReactNode; markerId: string }) {
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${h}`} width={w} height={h}
      style={{ width: "100%", minWidth: Math.round(w * MIN_SCALE), maxWidth: w, height: "auto" }} className="mx-auto block">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0.5L10 5L0 9.5z" className="fill-gray-700" />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

function EdgeLabel({ box, text }: { box: { x: number; y: number; w: number; h: number }; text: string }) {
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={4} className="fill-white stroke-gray-300" strokeWidth={1} />
      <text x={box.x + box.w / 2} y={box.y + box.h / 2} textAnchor="middle" dominantBaseline="central" fontSize="11.5" className="fill-gray-900">{text}</text>
    </g>
  );
}

function FlowShape({ n, kind }: { n: FlowLayout["nodes"][number]; kind: FlowKind }) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  if (kind === "decision") {
    return <polygon points={`${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`} className="fill-amber-50 stroke-amber-700" strokeWidth={1.6} />;
  }
  if (kind === "start" || kind === "end") {
    return <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.h / 2} className="fill-[var(--cmp-theme-soft)] stroke-[var(--cmp-theme-accent)]" strokeWidth={kind === "end" ? 3 : 1.6} />;
  }
  return <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} className="fill-white stroke-gray-600" strokeWidth={1.5} />;
}

const FLOW_KIND_WORD: Record<FlowKind, string> = { start: "Start", step: "Step", decision: "Decision", end: "End" };

function FlowFigure({ data, summary }: { data: Extract<DiagramBlock, { type: "flow" }>; summary: string }) {
  const [ref, width] = useWidth();
  const marker = "arrow" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const down = useMemo(() => layoutFlow(data, "down"), [data]);
  const right = useMemo(() => (data.direction === "right" ? layoutFlow(data, "right") : null), [data]);
  // A "right" flowchart is used only when its drawing fits the container at that scale; otherwise it falls back to "down".
  const L: FlowLayout = right && width !== null && right.width * MIN_SCALE <= width ? right : down;
  const outline = useMemo(() => flowOutline(data), [data]);
  return (
    <>
      <div ref={ref} role="region" aria-label={`${data.title}: scrollable drawing`} tabIndex={0} className={`overflow-x-auto px-2 pb-3 pt-2 ${focusRing}`}>
        <Frame w={L.width} h={L.height} label={`${KIND_WORD.flow}: ${data.title}. ${summary}`} markerId={marker}>
          {L.edges.map((e, i) => <path key={i} d={pathOf(e.points)} fill="none" className="stroke-gray-700" strokeWidth={1.5} markerEnd={`url(#${marker})`} />)}
          {L.nodes.map(n => (
            <g key={n.id}>
              <FlowShape n={n} kind={n.kind} />
              <Lines cx={n.x + n.w / 2} ys={n.lineY} lines={n.lines} className={n.kind === "start" || n.kind === "end" ? "fill-[var(--cmp-theme-ink)] font-semibold" : "fill-gray-900"} />
            </g>
          ))}
          {L.edges.map((e, i) => e.labelBox && e.label ? <EdgeLabel key={i} box={e.labelBox} text={e.label} /> : null)}
        </Frame>
      </div>
      <ol className="sr-only">
        {outline.map(s => (
          <li key={s.n}>
            {FLOW_KIND_WORD[s.kind]} {s.n}: {s.label}.
            {s.goes.length === 0 ? " Ends here." : s.goes.map((g, i) => <span key={i}> {g.label ? `${g.label}: ` : "Next: "}{g.loop ? "back to " : ""}step {g.to}, {g.toLabel}.</span>)}
          </li>
        ))}
      </ol>
    </>
  );
}

const GROUP_STYLE: Record<MapLayoutNode["group"], { shape: string; word: string }> = {
  center: { shape: "fill-[var(--cmp-theme-accent)] stroke-[var(--cmp-theme-strong)]", word: "Central idea" },
  cause: { shape: "fill-amber-50 stroke-amber-700", word: "Cause" },
  feature: { shape: "fill-[var(--cmp-theme-soft)] stroke-[var(--cmp-theme-accent)]", word: "Feature" },
  treatment: { shape: "fill-emerald-50 stroke-emerald-700", word: "Treatment" },
  other: { shape: "fill-white stroke-gray-600", word: "Concept" },
};

function MapFigure({ data, summary }: { data: Extract<DiagramBlock, { type: "map" }>; summary: string }) {
  const marker = "arrow" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const L: MapLayout = useMemo(() => layoutMap(data), [data]);
  const outline = useMemo(() => mapOutline(data), [data]);
  return (
    <>
      <div role="region" aria-label={`${data.title}: scrollable drawing`} tabIndex={0} className={`overflow-x-auto px-2 pb-3 pt-2 ${focusRing}`}>
        <Frame w={L.width} h={L.height} label={`${KIND_WORD.map}: ${data.title}. ${summary}`} markerId={marker}>
          {L.edges.map((e, i) => <path key={i} d={pathOf(e.points)} fill="none" className="stroke-gray-700" strokeWidth={1.5} markerEnd={`url(#${marker})`} />)}
          {L.nodes.map(n => {
            const g = GROUP_STYLE[n.group], cx = n.x + n.w / 2;
            // Shape tells the group too: cause square-cornered, feature rounded, treatment pill, other dashed, centre heavy.
            const rx = n.group === "cause" ? 2 : n.group === "treatment" ? Math.min(n.h / 2, 22) : n.group === "center" ? 10 : 8;
            return (
              <g key={n.id}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={rx} className={g.shape} strokeWidth={n.group === "center" ? 2.5 : 1.5} strokeDasharray={n.group === "other" ? "5 3" : undefined} />
                {n.tag && n.tagY !== undefined && <text x={cx} y={n.tagY} textAnchor="middle" dominantBaseline="central" fontSize="10.5" fontWeight="700" letterSpacing="0.8" className="fill-gray-700">{n.tag.toUpperCase()}</text>}
                <Lines cx={cx} ys={n.lineY} lines={n.lines} className={n.group === "center" ? "fill-[var(--cmp-theme-on-accent)] font-semibold" : "fill-gray-900"} />
              </g>
            );
          })}
          {L.edges.map((e, i) => e.labelBox && e.label ? <EdgeLabel key={i} box={e.labelBox} text={e.label} /> : null)}
        </Frame>
      </div>
      <div className="sr-only">
        <p>Central idea: {outline.center}.</p>
        <ul>
          {outline.groups.map(g => <li key={g.group}>{g.label}: {g.items.join("; ")}.</li>)}
        </ul>
        <ol>
          {outline.relations.map((r, i) => <li key={i}>{r.from} {r.label ? `${r.label} ` : "relates to "}{r.to}.</li>)}
        </ol>
        {outline.alone.length > 0 && <p>Not linked: {outline.alone.join("; ")}.</p>}
      </div>
    </>
  );
}

function TimelineFigure({ data }: { data: Extract<DiagramBlock, { type: "timeline" }> }) {
  // The list is the content: a rail and dots are decoration (aria-hidden) beside real text, so no separate alternative is needed.
  return (
    <ol className="mx-4 mb-4 mt-3 space-y-4 border-l-2 border-[var(--cmp-theme-border)] pl-5">
      {data.events.map((e, i) => (
        <li key={i} className="relative">
          <span aria-hidden="true" className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-[var(--cmp-theme-accent)] bg-white" />
          <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--cmp-theme-ink)]">{e.at}</p>
          <p className="break-words text-[15px] leading-[1.5] text-gray-900">{e.label}</p>
        </li>
      ))}
    </ol>
  );
}

export function Diagram({ block }: { block: DiagramBlock }) {
  const summary = block.type === "flow" ? `${block.nodes.length} steps and ${block.edges.length} connections. A full text description follows.`
    : block.type === "map" ? `${block.nodes.length + 1} concepts and ${block.edges.length} relations. A full text description follows.`
      : `${block.events.length} events in time order.`;
  return (
    <figure className="m-0 min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-300 bg-white">
      <figcaption className="border-b border-gray-200 px-4 py-2.5">
        <span className="block text-[12px] font-bold uppercase tracking-[0.1em] text-gray-700">{KIND_WORD[block.type]}</span>
        <span className="block break-words text-[15px] font-semibold leading-[1.4] text-gray-900">{block.title}</span>
      </figcaption>
      {block.type === "flow" && <FlowFigure data={block} summary={summary} />}
      {block.type === "map" && <MapFigure data={block} summary={summary} />}
      {block.type === "timeline" && <TimelineFigure data={block} />}
    </figure>
  );
}
