import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// SQIE-CLOSE-2026-11 WS-H (owner directive SQIE-CLOSE-2026-11 §7, SALE-2026-11): "Do not convert a single MCQ score directly into a
// Benner/DACUM competence stage." Question results may contribute LEARNING EVIDENCE; a stage (0-6, Novice .. Expert) comes only
// from an authorised assessment through the published stage mapping. Today no Scholar question, attempt or study module reaches a
// stage computation at all. This static pin keeps it that way: a Scholar module that imports one of the stage computations fails
// here, and the change must then be decided (a stage is never set by practice scoring).
//
// The stage computations: the Benner bands (`lib/benner.ts`), the published stage mapping (`lib/competency/stage-mapping.ts`
// stageFor), the Checklist Studio rating-to-stage bands (`lib/assessment/adapters/scholar/stage-mapping.ts`) and the programme
// projection that applies stageFor to target levels (`lib/individual/programme-framework.ts`). Showing a stage an ASSESSOR set
// (assessment progression reads) is not a computation and is not forbidden.

const SRC = path.resolve(__dirname, "../../..");
const SCOPES = [
  "lib/individual/scholar",
  "app/api/individual/scholar",
  "app/individual/(app)/[experience]/(scholar)",
];
const FORBIDDEN = /(?:^|\/)(?:benner|competency\/stage-mapping|adapters\/scholar\/stage-mapping|programme-framework)$/;

const walk = (d: string): string[] => fs.existsSync(d)
  ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  : [];

/** Pure. The forbidden imports of one source text (module specifiers of import/export-from/dynamic import/require). */
function stageImports(text: string): string[] {
  const specs = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map(m => m[1]);
  return specs.filter(s => FORBIDDEN.test(s.replace(/\.(ts|tsx|js)$/, "")));
}

describe("no Scholar question or study module computes a competence stage", () => {
  it("the scan catches a planted import (a control that can fail)", () => {
    expect(stageImports(`import { stageFor } from "@/lib/competency/stage-mapping";`)).toEqual(["@/lib/competency/stage-mapping"]);
    expect(stageImports(`export { bennerStage } from "../../benner";`)).toEqual(["../../benner"]);
    expect(stageImports(`const m = await import("@/lib/assessment/adapters/scholar/stage-mapping");`)).toHaveLength(1);
    expect(stageImports(`import x from "@/lib/individual/programme-framework";`)).toHaveLength(1);
    expect(stageImports(`import { masteryOf } from "./mastery";\nimport { compareBands } from "@/lib/assessment/adapters/scholar/compare";`)).toEqual([]);
  });

  it("every Scholar source under the three scopes is free of them", () => {
    const files = SCOPES.flatMap(s => walk(path.join(SRC, s))).filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(100); // the scopes exist: an empty scan proves nothing
    const hits = files.flatMap(f => stageImports(fs.readFileSync(f, "utf8")).map(s => `${path.relative(SRC, f)} -> ${s}`));
    expect(hits).toEqual([]);
  });
});
