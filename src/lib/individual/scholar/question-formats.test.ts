import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ADAPTIVE_FORMATS, ANSWER_FORMATS_OF_SHORT, BLIND_FORMATS, LIBRARY_FORMATS, LIBRARY_FORMAT_LABEL, QUESTION_FORMATS, REVISION_FORMATS, REVISION_FORMATS_OFF_BY_DEFAULT,
  REVISION_FORMAT_LABEL, SHORT_STORED_FORMATS, VERIFY_FORMATS, VERIFY_FORMATS_DEFAULT, VERIFY_FORMAT_LABEL, needsImmediateFeedback, onByDefault, storedKindOfFormat,
} from "./question-formats";
import { REVISION_SYSTEM } from "./generation";
import { policyDef, resolvePolicy } from "../policy";
import { storedKind } from "./revision";

// SCHOLAR-CE-2026 CE-05: the format registry is the one place a question format is described. These tests pin that the lists derived
// from it are exactly what the code offered before it existed (so nothing changed), that its defaults ARE the policy's, that its module
// references are real files, and -- a static scan -- that no format used anywhere in src is missing from it.

const SRC = path.resolve(__dirname, "../../..");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const sources = walk(SRC).filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.|\.fixture\./.test(f));
const read = (f: string) => fs.readFileSync(f, "utf8");
const KEYS = QUESTION_FORMATS.map(r => r.key as string);

describe("the registry says what the code offered before it existed", () => {
  it("keys are unique and every row names real module files", () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
    for (const r of QUESTION_FORMATS) for (const m of Object.values(r.modules)) expect(fs.existsSync(path.join(SRC, m)), `${r.key}: ${m}`).toBe(true);
  });
  it("the derived lists are the lists of before CE-05, in their order (plus the scenario in Revision)", () => {
    expect([...REVISION_FORMATS]).toEqual(["mcq", "mrq", "short", "flashcard", "match", "sequence", "structured", "cloze", "true_false", "extended", "scenario"]);
    expect([...VERIFY_FORMATS]).toEqual(["mcq", "case", "mrq", "short", "structured", "match", "sequence", "flashcard", "true_false", "extended"]);
    expect([...VERIFY_FORMATS_DEFAULT]).toEqual(["mcq", "case", "mrq", "short"]);
    expect([...ADAPTIVE_FORMATS]).toEqual(["mcq", "mrq", "short", "match", "sequence", "structured"]);
    expect([...LIBRARY_FORMATS]).toEqual(["mcq", "mrq", "short", "cloze", "true_false", "extended", "flashcard", "match", "sequence", "structured"]);
    expect([...BLIND_FORMATS]).toEqual(["true_false", "match", "sequence", "flashcard", "structured", "extended"]);
    // SCHOLAR-AI-COST-CONFIG-01 (owner 3 Nov 2026): the evolving scenario is chosen deliberately, never by default.
    expect([...REVISION_FORMATS_OFF_BY_DEFAULT].sort()).toEqual(["extended", "scenario"]);
    expect([...SHORT_STORED_FORMATS]).toEqual(["cloze", "true_false", "extended", "scenario"]);
  });
  it("the labels are the labels of before", () => {
    expect(REVISION_FORMAT_LABEL.mcq).toBe("Multiple choice");
    expect(REVISION_FORMAT_LABEL.extended).toBe("Extended response (AI feedback)");
    expect(VERIFY_FORMAT_LABEL.case).toBe("Case questions");
    expect(VERIFY_FORMAT_LABEL.extended).toBe("Extended response");
    expect(LIBRARY_FORMAT_LABEL.mcq).toBe("Single best answer");
    expect(LIBRARY_FORMAT_LABEL.structured).toBe("Structured (parts)");
  });
  it("a short-stored format maps to the short kind and the rest to themselves", () => {
    for (const f of SHORT_STORED_FORMATS) { expect(storedKindOfFormat(f)).toBe("short"); expect(storedKind(f)).toBe("short"); }
    expect(storedKindOfFormat("mrq")).toBe("mrq");
    expect([...ANSWER_FORMATS_OF_SHORT]).toEqual(["cloze", "true_false", "extended", "scenario"]);
  });
  it("only the answered-in-steps formats need feedback after each answer", () => {
    expect(QUESTION_FORMATS.filter(r => needsImmediateFeedback(r.key)).map(r => r.key)).toEqual(["structured", "scenario"]);
  });
});

describe("the registry defaults ARE the policy's", () => {
  it("scholar_revision_formats falls back to exactly the formats the registry says are on", () => {
    const def = policyDef("scholar_revision_formats") as unknown as { fallback: string[] };
    expect(def.fallback).toEqual(REVISION_FORMATS.filter(onByDefault));
    expect(resolvePolicy([]).scholarRevisionFormats).toEqual(REVISION_FORMATS.filter(onByDefault));
  });
  it("extended stays off by default, structured stays on, and the scenario is off by default (SCHOLAR-AI-COST-CONFIG-01: chosen deliberately)", () => {
    expect(onByDefault("extended")).toBe(false);
    expect(onByDefault("structured")).toBe(true);
    expect(onByDefault("scenario")).toBe(false);
  });
  it("the blind-check default is unchanged: the scenario and the other formats added since are not in it", () => {
    const def = policyDef("scholar_verify_formats") as unknown as { fallback: string[] };
    expect(def.fallback).toEqual([...VERIFY_FORMATS_DEFAULT]);
    expect(resolvePolicy([]).scholarVerifyFormats).toEqual(["mcq", "case", "mrq", "short"]);
    expect(VERIFY_FORMATS).not.toContain("scenario" as never);
  });
});

describe("completeness: every format used anywhere is in the registry (a static scan of src)", () => {
  it("every generated format has a prompt, and every prompt is a registry format", () => {
    for (const k of Object.keys(REVISION_SYSTEM)) expect(KEYS, k).toContain(k);
    for (const r of QUESTION_FORMATS) if (r.aiWritten && r.revisionDefault !== null && r.key !== "mcq") expect(Object.keys(REVISION_SYSTEM), r.key).toContain(r.key);
  });
  it("every answer.format value written or tested by the question modules is a registry format", () => {
    // The files that write, mark, store or show a question's format. Other words after `format` here are not question formats.
    const files = sources.filter(f => /lib\/individual\/scholar\/(formats|cloze|scenario|revision|revision-view|library-format|blind-verify|generation|store|question-intel|rubric-snapshot|attempt-snapshot)\.ts$|lib\/knowledge\/question-[a-z]+\.ts$/.test(f.split(path.sep).join("/")));
    expect(files.length).toBeGreaterThan(10);
    const notQuestionFormats = new Set(["deck", "print", "string"]);
    const found = new Set<string>();
    for (const f of files) {
      const s = read(f);
      for (const m of s.matchAll(/(?<![A-Za-z0-9_])format(?:Of\([^)]*\))?\s*(?:===|!==)\s*"([a-z_]+)"/g)) found.add(m[1]);
      for (const m of s.matchAll(/(?<![A-Za-z0-9_])format:\s*"([a-z_]+)"/g)) found.add(m[1]);
    }
    const unknown = [...found].filter(x => !KEYS.includes(x) && !notQuestionFormats.has(x));
    expect(unknown).toEqual([]);
    for (const r of QUESTION_FORMATS) if (r.answerFormat) expect(found.has(r.answerFormat), r.key).toBe(true);
  });
  it("no source file keeps its own list of question formats: an array of four or more format keys lives only in the registry", () => {
    // These hold a different concept (not the set of formats a surface offers) and are named here with the reason.
    const allowed: Record<string, string> = {
      "lib/individual/scholar/passport-items.ts": "which stored kinds count as practice-question evidence for the Passport (an evidence rule)",
      "lib/individual/scholar/scenario.ts": "the kinds a scenario STAGE may take (a subset, by design)",
    };
    const offenders: string[] = [];
    for (const f of sources) {
      const rel = path.relative(SRC, f).replace(/\\/g, "/");
      if (rel === "lib/individual/scholar/question-formats.ts" || allowed[rel]) continue;
      for (const m of read(f).matchAll(/\[([^[\]]*)\]/g)) {
        const hit = new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]).filter(x => KEYS.includes(x)));
        if (hit.size >= 4) offenders.push(`${rel}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("a control: the scan can fail (an unregistered format would be caught)", () => {
    expect(KEYS).not.toContain("essay");
    expect("format === \"essay\"".match(/\bformat\s*(?:===|!==)\s*"([a-z_]+)"/)?.[1]).toBe("essay");
  });
});
