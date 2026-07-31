// Harness for the Data Visualisation & Dashboard Standards (PUI-007).
//
// Charts are where a platform most easily lies: a gap interpolated into a smooth line, a missing reading
// shaded as zero intensity, a KPI silently dropped off the end of a ribbon, an aria-label that says "chart"
// and tells a screen-reader user nothing. Each of those is asserted against here.
//
// The library is hand-drawn SVG with NO charting dependency, so these are source-level checks plus a render
// pass through react-dom/server to prove the components actually emit what they claim.
//   npx --yes tsx scripts/pui-charts-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

async function main() {
  const file = path.join(process.cwd(), "src/components/ui/charts.tsx");
  const src = fs.readFileSync(file, "utf8");
  const C = await import("../src/components/ui/charts");
  const render = (el: any) => renderToStaticMarkup(el);

  // ── 1. No charting dependency, server-safe ──
  check(!src.startsWith('"use client"'), "charts are server-component safe");
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const chartLibs = ["recharts", "chart.js", "d3", "victory", "nivo", "@nivo/core", "apexcharts", "highcharts"];
  const found = chartLibs.filter(l => l in deps);
  check(found.length === 0, "no charting library was added to the project", found.length ? found.join(", ") : "hand-drawn SVG only");
  check(!/#[0-9A-Fa-f]{6}\b/.test(src), "no hard-coded hex — chart colours come from tokens");

  // ── 2. EMPTY IS NOT ZERO ──
  const emptyLine = render(React.createElement(C.LineChart, { series: [{ name: "x", points: [] }], label: "Occupancy" }));
  check(emptyLine.includes("No data"), "an empty line chart says No data");
  check(!emptyLine.includes("<polyline"), "and draws NO line along the axis");
  const emptyBar = render(React.createElement(C.BarChart, { points: [], label: "Admissions" }));
  check(emptyBar.includes("No data"), "an empty bar chart says No data");
  const emptyDonut = render(React.createElement(C.Donut, { segments: [{ name: "a", value: 0 }], label: "Mix" }));
  check(emptyDonut.includes("No data"), "a donut whose segments sum to zero says No data");
  const nullGauge = render(React.createElement(C.Gauge, { value: null, label: "Readiness" }));
  // React emits the literal character, not an HTML entity — match the character.
  check(nullGauge.includes("not measured") && nullGauge.includes("—") && !nullGauge.includes("0%"),
    "a null gauge reads 'not measured' with an em-dash, never 0%");
  check(!/stroke-dasharray/.test(nullGauge.split("not measured")[0].split("<path").slice(2).join("")),
    "and draws no value arc");

  // ── 3. GAPS ARE BREAKS, NOT INTERPOLATIONS ──
  const gapped = render(React.createElement(C.LineChart, {
    label: "PEWS", series: [{ name: "PEWS", points: [
      { label: "a", value: 1 }, { label: "b", value: 2 }, { label: "c", value: null },
      { label: "d", value: 4 }, { label: "e", value: 5 }] }],
  }));
  check((gapped.match(/<polyline/g) ?? []).length === 2,
    "a missing reading BREAKS the line into two segments rather than interpolating across it",
    `${(gapped.match(/<polyline/g) ?? []).length} segments`);
  const sparkGap = render(React.createElement(C.Sparkline, { label: "trend", points: [1, 2, null, 4] }));
  check((sparkGap.match(/<polyline/g) ?? []).length === 2, "the sparkline breaks at a gap too");

  // ── 4. A MISSING CELL IS NOT ZERO INTENSITY ──
  const heat = render(React.createElement(C.HeatMap, {
    label: "Activity", rows: ["Mon"], cols: ["08", "09"],
    cells: [{ row: "Mon", col: "08", value: 5 }, { row: "Mon", col: "09", value: null }],
  }));
  check(heat.includes("dashed"), "a heat-map cell with no data is hatched, not shaded as zero");
  check(heat.includes("no data"), "and its title says no data");

  // ── 5. ACCESSIBILITY: the numbers, not a summary sentence ──
  const line = render(React.createElement(C.LineChart, {
    label: "Occupancy", series: [{ name: "Ward", points: [{ label: "Mon", value: 80 }, { label: "Tue", value: 90 }] }],
  }));
  check(line.includes('role="img"'), "charts are role=img");
  check(line.includes('aria-label='), "charts carry an aria-label");
  check(line.includes("cmp-sr-only") && line.includes("<table"),
    "a line chart emits a visually-hidden DATA TABLE — a screen-reader user gets the actual numbers");
  check(line.includes("<caption>Occupancy</caption>"), "the hidden table is captioned with the chart label");
  check(line.includes(">80<") && line.includes(">90<"), "every value appears in the hidden table");
  const barA11y = render(React.createElement(C.BarChart, {
    label: "Beds", points: [{ label: "ICU", value: 12 }, { label: "Ward", value: null }],
  }));
  check(barA11y.includes("no data"), "the bar chart's accessible text says 'no data' for a null point");
  check(/aria-label="[^"]*ICU: 12/.test(barA11y), "and names each category with its value");

  // ── 6. KPI ribbon: capped at seven, with the overflow STATED ──
  check(C.KPI_RIBBON_MAX === 7, "the ribbon cap is seven (PUI-007 s2)");
  const many = Array.from({ length: 10 }, (_, i) => ({ label: `K${i}`, value: i }));
  const ribbon = render(React.createElement(C.KpiRibbon, { kpis: many }));
  check((ribbon.match(/K\d</g) ?? []).length === 7, "only seven KPIs render");
  check(ribbon.includes("3 more"), "and the overflow is STATED, not silently dropped",
    ribbon.includes("3 more") ? "says '3 more are not in the ribbon'" : "SILENT TRUNCATION");
  const small = render(React.createElement(C.KpiRibbon, { kpis: many.slice(0, 4) }));
  check(!small.includes("more"), "no overflow note when the ribbon fits");

  // ── 7. Provenance (PUI-007 s11 "always show time period, unit and source") ──
  const card = render(React.createElement(C.ChartCard,
    { title: "Occupancy", asOf: "2026-07-31", source: "op_ops_snapshots" },
    React.createElement("div", null, "x")));
  check(card.includes("As of 2026-07-31"), "ChartCard stamps an as-of date");
  check(card.includes("op_ops_snapshots"), "and names the source, so a reader knows what they are looking at");

  // ── 8. Trend direction is not colour-alone (PUI-005) ──
  const primitives = fs.readFileSync(path.join(process.cwd(), "src/components/ui/primitives.tsx"), "utf8");
  check(primitives.includes('trend.direction === "up" ? "increased"'),
    "a trend arrow carries screen-reader text saying increased/decreased");
  const stat = render(React.createElement(C.KpiRibbon, {
    kpis: [{ label: "Occupancy", value: "87%", trend: { direction: "up" as const, value: "+3%", good: false } }],
  }));
  check(stat.includes("increased"), "the rendered trend includes its direction in words");
  check(stat.includes("+3%"), "and the magnitude");

  // ── 9. Percentages are computed, never asserted ──
  const donut = render(React.createElement(C.Donut, {
    label: "Acuity", segments: [{ name: "Stable", value: 3 }, { name: "High", value: 1 }],
  }));
  check(donut.includes("75%") && donut.includes("25%"), "donut percentages are derived from the values");
  const stacked = render(React.createElement(C.StackedBar, {
    label: "Mix", segments: [{ name: "A", value: 1 }, { name: "B", value: 3 }],
  }));
  check(stacked.includes("25%") && stacked.includes("75%"), "stacked-bar proportions are derived too");

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
