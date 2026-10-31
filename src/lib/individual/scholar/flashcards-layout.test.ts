import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// SCHOLAR-FLASHCARDS-QA-01 (staging browser check, 31 Oct): the study screen's layout, asserted on its classes and
// structure. The defects measured: at tablet 768 the content area (517px, after the 236px shell sidebar) was cut into a
// 200px nav column and a 213px card column, leaving a 43px card; on a phone the card and buttons started below the
// fold; on desktop the card stayed at 375px. The fix lays out by the content area's OWN width (container queries) and
// keeps CPR-MOB-001's single md viewport edge. The arithmetic below is the grid's, at the three measured widths.

const STUDY = "src/app/individual/(app)/[experience]/(scholar)/study";
const client = readFileSync(`${STUDY}/_components/flashcards-client.tsx`, "utf8");
const page = readFileSync(`${STUDY}/revise/flashcards/page.tsx`, "utf8");
const nav = readFileSync(`${STUDY}/_components/revise-nav.tsx`, "utf8");
const constant = (name: string) => new RegExp(`export const ${name} = "([^"]+)"`).exec(client)?.[1] ?? "";
const REM = 16;

describe("flashcards layout: by available width, one md viewport edge", () => {
  it("no viewport breakpoint but md in the flashcards screens (sm:, lg:, xl:, 2xl: removed)", () => {
    for (const src of [client, page]) expect(src.match(/(?<![\w@-])(sm|lg|xl|2xl):[\w[]/g) ?? []).toEqual([]);
  });
  it("the page grid sits in an @container and switches on the container's width, not the viewport's", () => {
    expect(page).toMatch(/className="@container"/);
    expect(page).toMatch(/className=\{FLASHCARDS_GRID\}/);
    expect(page).toMatch(/<ReviseNav [^>]*container[^>]*\/>/);
    const grid = constant("FLASHCARDS_GRID");
    expect(grid).toMatch(/^grid grid-cols-1 /);
    expect(grid).toContain("@min-[39rem]:grid-cols-[minmax(22rem,1fr)_minmax(16rem,20rem)]");
    expect(grid).toContain("@min-[56rem]:grid-cols-[11.5rem_minmax(22rem,1fr)_16rem]");
    expect(grid).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    // The Revise nav is a row until the content area has room for its column.
    expect(nav).toContain("@min-[56rem]:flex-col");
  });
  it("the card's width at the three measured content widths: tablet >= 400px, desktop grows toward 640px, phone full width", () => {
    const sectionPad = { phone: 16, md: 24 }; // p-4, md:p-6
    const cardMax = 40 * REM; // max-w-[40rem]
    const cardWidth = (area: number, md: boolean) => {
      const pad = 2 * (md ? sectionPad.md : sectionPad.phone);
      const col = area >= 56 * REM ? area - 11.5 * REM - 16 * REM - 2 * 16 : area >= 39 * REM ? area - 16 * REM - 16 : area;
      return Math.min(cardMax, col - pad);
    };
    expect(cardWidth(517, true)).toBeGreaterThanOrEqual(400); // tablet 768: content area 517 (was 43px)
    expect(cardWidth(1100, true)).toBeGreaterThanOrEqual(560); // desktop 1440: content area about 1100 (was 375px)
    expect(cardWidth(1400, true)).toBe(640);
    expect(cardWidth(343, false)).toBeGreaterThanOrEqual(300); // phone 375
    // Previous and next no longer sit beside the card, taking its width: they are a row under it at every width.
    expect(client).not.toMatch(/aria-label="Previous card" className=\{`hidden/);
    expect(client).toMatch(/aria-label="Previous card" className=\{ghost\}/);
  });
  it("phone focus mode: one-line header in a session; the card and both buttons are one block brought into view, fitting the first screen", () => {
    expect(client).toMatch(/<DeckHeader compact=\{!\(finished \|\| \(allDone && props\.completed\)\)\}/);
    expect(client).toMatch(/data-testid="deck-header-compact" className="flex min-w-0 items-center gap-3"/);
    // One block: card, sensitive note, rate buttons -- scrolled into view on start and previous / next only.
    const block = client.slice(client.indexOf('data-testid="card-focus"'), client.indexOf('aria-label="Previous card"'));
    expect(block).toContain('aria-keyshortcuts="1"');
    expect(block).toContain('aria-keyshortcuts="2"');
    expect(block).toMatch(/scroll-mt-\[4\.5rem\]/);
    expect(client).toMatch(/useEffect\(\(\) => \{ bringIntoView\(\); \}, \[bringIntoView\]\);/);
    expect(client).toMatch(/requestAnimationFrame\(bringIntoView\)/);
    expect(client.match(/bringIntoView\(/g)!.length).toBe(1); // called once at start; otherwise only through go()
    // The budget at 375 x 812: sticky header 56, bottom bar 56. Card 220 + gap 16 + buttons 56 (+ a 44px note when flipped).
    const height = 220 + 16 + 56 + 44;
    expect(height).toBeLessThanOrEqual(812 - 56 - 56);
    expect(block).toMatch(/min-h-\[220px\]/);
    expect(block).toMatch(/min-h-\[56px\]/);
  });
  it("touch targets keep their pointer-coarse minimums", () => {
    expect(client).toMatch(/const ghost = `[^`]*pointer-coarse:min-h-\[var\(--cmp-touch-min\)\]/);
    expect(nav).toMatch(/pointer-coarse:min-h-\[var\(--cmp-touch-min\)\]/);
  });
});
