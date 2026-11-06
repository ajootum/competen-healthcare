import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A CENSUS OF SCHOLAR'S TIMES. docs/design/LOCAL-TIME-ZONES.md.
//
// A converted surface can quietly regain a time that ignores the reader's clock: the file still compiles and the page
// still renders. This counts every direct format call in Scholar's own tree and fails on one that is neither a calendar
// day (which must not move) nor listed here as still to convert. Finishing a slice means emptying a row below.

const ROOT = path.resolve(__dirname, "../app/individual/(app)/[experience]/(scholar)");

const FORMAT = /toLocale(?:Date|Time)?String\(|new Intl\.DateTimeFormat\(/;
// `${day}T00:00:00Z`, `${d.slice(0, 10)}T12:00:00Z` and `${month}-15T12:00:00Z`: built from a calendar day, formatted in UTC.
const CALENDAR_DAY = /T(?:00|12):00:00Z`\)/;

// File, relative to the Scholar tree -> how many direct calls remain, and why. An exact count, so a new call fails.
const STILL_TO_CONVERT: Record<string, { calls: number; why: string }> = {
  "study/_components/saved-library-view.tsx": { calls: 1, why: "slice 2: being edited by the Scholar coordinated release" },
  "study/_components/notebook-view.tsx": { calls: 1, why: "slice 2: being edited by the Scholar coordinated release" },
  "study/_components/apply-parts.tsx": { calls: 1, why: "slice 2: server part, needs the clock passed down" },
  "study/_components/evaluate-parts.tsx": { calls: 2, why: "slice 2: server part, needs the clock passed down" },
  "study/_components/monthly-progress.tsx": { calls: 1, why: "slice 2: server part, needs the clock passed down" },
  "study/_components/progress-view.tsx": { calls: 1, why: "slice 2: server part, needs the clock passed down" },
  "study/_components/library-rows.ts": { calls: 1, why: "slice 2: builds a text row" },
  "study/_components/study-home-model.ts": { calls: 1, why: "slice 2: builds a text line, used on the server and in the browser" },
  "study/revise/flashcards/page.tsx": { calls: 1, why: "stays: ukDate is handed to applyContentReview for a content-review date, which is not about the reader" },
  "my-competencies/assessments/[instanceId]/report/page.tsx": { calls: 1, why: "stays: a report made to print, so it must not change with whoever opens it" },
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function directCalls(file: string): string[] {
  return readFileSync(file, "utf8").split("\n").filter(line => FORMAT.test(line) && !CALENDAR_DAY.test(line));
}

const census = new Map(walk(ROOT).map(file => [path.relative(ROOT, file).replace(/\\/g, "/"), directCalls(file).length] as const).filter(([, n]) => n > 0));

describe("Scholar times go through formatForReader", () => {
  it("no file formats a time directly unless it is listed, with the exact count", () => {
    const found = Object.fromEntries(census);
    const expected = Object.fromEntries(Object.entries(STILL_TO_CONVERT).map(([file, row]) => [file, row.calls]));
    expect(found).toEqual(expected);
  });
  it("the converted screens that show a time of day use the route and name the zone", () => {
    const clockTimes: [string, string][] = [
      ["study/saved/history/page.tsx", '"dateTime"'],
      ["study/saved/searches/page.tsx", '"dateTime"'],
      ["study/evaluate/[id]/page.tsx", '"dateTime"'],
      ["study/_components/learn-client.tsx", '"dayMonthTime"'],
      ["study/_components/osce-client.tsx", '"timeSeconds"'],
      ["study/_components/plan-agenda-rows.tsx", '"time"'],
    ];
    for (const [file, shape] of clockTimes) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      expect(text, file).toContain("formatForReader(");
      expect(text, file).toContain(shape);
      expect(directCalls(path.join(ROOT, file)), file).toEqual([]);
    }
  });
  it("the learner's day stays on its own definition, not the reader's clock", () => {
    const definitions = readFileSync(path.resolve(__dirname, "individual/scholar/learning-definitions.ts"), "utf8");
    expect(definitions).not.toContain("formatForReader");
    expect(definitions).not.toContain("resolveReaderClock");
    expect(definitions).not.toContain("READER_ZONE_COOKIE");
  });
});
