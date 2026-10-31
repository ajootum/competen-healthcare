/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR-OSCE-01 (owner, 31 Oct 2026), migration 721: the gaps between OSCE Practice V1 and the owner instruction, each
// tested by being run. Pure rules from osce.ts, the governed read path from library-questions.ts against an in-memory
// admin that honours the filters it is given, and the store's autosave and resume writes against a recording admin.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OSCE_GUIDELINES_NOTE, OSCE_PRACTICE_LABEL, OSCE_RECOVERY_NOTE, OSCE_TEMPLATES, OSCE_FEEDBACK_LABEL, TEMPLATE_CONTENT_STATUS, claimsVerification,
  competencyContentStatus, filterStations, libraryContentStatus, marksCompared, osceRecoveryRequest, parseOsceFilter, readDefinition, readSnapshot,
  resultOf, resumeOf, saveAllowed, scoreExplanation, scoreTicks, snapshotOf, stationFacets, stationFromLibrary, stationFromTemplate, validateStationContent,
  type OsceItem, type OsceSnapshot,
} from "./osce";
import { loadOsceLibraryStations, servableOsceStation } from "./library-questions";
import { abandonOsceAttempt, finishOsceAttempt, osceSchema, resetOsceSchema, saveOsceProgress, startOsceAttempt } from "./store";
import { resultExtras, stationView } from "./osce-service";

const item = (id: string, critical = false): OsceItem => ({ id, text: `Item ${id}`, critical });
const station = {
  scenario: "A simulated person needs an assessment from you today.", candidate_instructions: "Assess and say what you would do next.",
  duration_minutes: 8, checklist: [{ id: "a", text: "Gains consent", critical: true }, { id: "b", text: "Explains the plan", critical: false }],
  objectives: ["Practise a systematic assessment"], expected_activities: ["Introduces self"], profession: "Midwifery", topic: "Postnatal check",
  body_system: "Reproductive", difficulty: "intermediate", guidance: { suggested_responses: ["I would introduce myself"], assessment_guidance: "A systematic order" },
  references: [{ label: "Course handbook" }],
};

describe("1. the station definition (profession-agnostic), validated as 721 accepts it", () => {
  it("a governed station's content: every element read, nothing invented", () => {
    const v = validateStationContent(station);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.content.definition).toMatchObject({
      profession: "Midwifery", topic: "Postnatal check", bodySystem: "Reproductive", difficulty: "intermediate", objectives: ["Practise a systematic assessment"],
      expectedActivities: ["Introduces self"], guidance: { suggestedResponses: ["I would introduce myself"], assessmentGuidance: "A systematic order" },
      references: [{ kind: "reference", label: "Course handbook" }], programmeCode: null,
    });
  });
  it("no checklist limit below the structural bound: 1 and 60 items accepted, 0 and 61 refused", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => item(`i${i}`, i === 0));
    expect(validateStationContent({ ...station, checklist: n(1) }).ok).toBe(true);
    expect(validateStationContent({ ...station, checklist: n(60) }).ok).toBe(true);
    expect(validateStationContent({ ...station, checklist: n(0) }).ok).toBe(false);
    expect(validateStationContent({ ...station, checklist: n(61) }).ok).toBe(false);
  });
  it("refuses what the database would refuse, each with a plain reason", () => {
    for (const bad of [
      { ...station, scenario: "short" }, { ...station, duration_minutes: 8.5 }, { ...station, duration_minutes: "8" }, { ...station, duration_minutes: 25 },
      { ...station, checklist: [{ id: "a", text: "x", critical: "yes" }] }, { ...station, sections: [] }, { ...station, difficulty: "expert" },
      { ...station, guidance: "text" }, { ...station, objectives: "text" }, { ...station, references: ["x"] },
      { ...station, checklist: [{ id: "a", text: "  padded ", critical: true }] }, "not an object",
    ]) {
      const v = validateStationContent(bad);
      expect(v.ok, JSON.stringify(bad).slice(0, 80)).toBe(false);
      if (!v.ok) expect(v.reason.length).toBeGreaterThan(5);
    }
  });
  it("the engine assumes no profession: no nursing word outside the template data", () => {
    const src = readFileSync("src/lib/individual/scholar/osce.ts", "utf8");
    const engine = src.slice(0, src.indexOf("export const OSCE_TEMPLATES")) + src.slice(src.indexOf("export const osceTemplate"));
    expect(engine).not.toMatch(/\bnurs(e|es|ing)\b/i);
    expect(OSCE_TEMPLATES.every(t => t.profession === null)).toBe(true);
  });
  it("definitions read defensively from a stored row: unknown fields are null, never guessed", () => {
    expect(readDefinition({})).toMatchObject({ profession: null, topic: null, difficulty: null, objectives: [], guidance: null, references: [], version: 1 });
    expect(readDefinition({ difficulty: "expert", version: 0, source_references: [{ kind: "notes", materialId: "x" }] })).toMatchObject({ difficulty: null, version: 1, references: [] });
  });
});

describe("2. versions and the snapshot a run is marked against", () => {
  const snap: OsceSnapshot = { version: 3, title: "T", scenario: "S", candidateInstructions: "I", durationMinutes: 8, sections: ["A"], checklist: [item("a", true), item("b")],
    guidance: { suggestedResponses: ["R"], assessmentGuidance: null }, expectedActivities: ["X"] };
  it("round-trips exactly, with the version", () => {
    expect(readSnapshot(snapshotOf(snap), { ...snap, version: 9, checklist: [item("z")] })).toEqual(snap);
  });
  it("a run with no snapshot (before 721) is marked against the station, and a broken snapshot falls back too", () => {
    expect(readSnapshot(null, snap)).toBe(snap);
    expect(readSnapshot({ checklist: "x" }, snap)).toBe(snap);
  });
  it("a governed copy carries the library version as its version, and says it is approved", () => {
    const v = validateStationContent(station);
    if (!v.ok) throw new Error(v.reason);
    const d = stationFromLibrary({ resourceId: "11111111-1111-1111-1111-111111111111", versionId: "22222222-2222-2222-2222-222222222222", versionNo: 4, title: "Postnatal check", content: v.content });
    expect(d).toMatchObject({ source: "library", version: 4, contentStatus: libraryContentStatus(4), libraryVersionId: "22222222-2222-2222-2222-222222222222", templateKey: null, model: null });
    expect(d.checklist).toBe(station.checklist);
    expect(d.exact).toEqual({ expected_activities: station.expected_activities, guidance: station.guidance });
    expect(d.references[0]).toEqual({ kind: "library", resourceId: "11111111-1111-1111-1111-111111111111", versionId: "22222222-2222-2222-2222-222222222222", versionNo: 4 });
  });
});

describe("3. the demo template stays labelled not clinically reviewed, never validated", () => {
  it("source template, the exact owner wording, and no library provenance", () => {
    const d = stationFromTemplate(OSCE_TEMPLATES[0]);
    expect(d.contentStatus).toBe("Competen practice template — not clinically reviewed");
    expect(TEMPLATE_CONTENT_STATUS).not.toMatch(/approved|validated/i);
    expect(d).toMatchObject({ source: "template", libraryVersionId: null, libraryResourceId: null, version: 1 });
  });
});

// An in-memory admin that HONOURS eq/in filters, so a draft or unapproved version really is not returned.
function memoryAdmin(tables: Record<string, any[]>, approved: Set<string>) {
  const from = (t: string) => {
    let rows = [...(tables[t] ?? [])];
    let single = false;
    const q: any = {
      select: () => q, limit: () => q, order: () => q,
      eq: (c: string, v: unknown) => { rows = rows.filter(r => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[c])); return q; },
      maybeSingle: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(res, rej),
    };
    return q;
  };
  return { from, rpc: async (_: string, a: { p_version: string }) => ({ data: approved.has(a.p_version), error: null }) };
}

describe("3. the governed station read path: published and clinically approved only", () => {
  const R = "r0000000-0000-4000-8000-000000000001", R2 = "r0000000-0000-4000-8000-000000000002", RQ = "r0000000-0000-4000-8000-000000000003";
  const V = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
  const tables = {
    ckri_knowledge_resource: [
      { id: R, kind: "osce_station", title: "Postnatal check station", status: "active" },
      { id: R2, kind: "osce_station", title: "Retired station", status: "retired" },
      { id: RQ, kind: "revision_question", title: "A question", status: "active" },
    ],
    ckri_knowledge_version: [
      { id: V(1), resource_id: R, version_no: 2, content: station, state: "published", published_at: "2026-10-30" },
      { id: V(2), resource_id: R, version_no: 3, content: station, state: "draft", published_at: null },
      { id: V(3), resource_id: R, version_no: 1, content: station, state: "superseded", published_at: "2026-10-01" },
      { id: V(4), resource_id: R2, version_no: 1, content: station, state: "published", published_at: "2026-10-29" },
      { id: V(5), resource_id: RQ, version_no: 1, content: station, state: "published", published_at: "2026-10-29" },
    ],
    ckri_knowledge_version_competency: [{ version_id: V(1), competency_id: "c1" }],
  };
  it("offers only the published version of an active osce_station resource whose exact content is approved", async () => {
    const all = await loadOsceLibraryStations(memoryAdmin(tables, new Set([V(1), V(2), V(3), V(4), V(5)])));
    expect(all.map(s => s.versionId)).toEqual([V(1)]);
    expect(all[0]).toMatchObject({ versionNo: 2, title: "Postnatal check station", competencyIds: ["c1"] });
  });
  it("an unapproved published version is not offered, and an unreadable library offers nothing", async () => {
    expect(await loadOsceLibraryStations(memoryAdmin(tables, new Set()))).toEqual([]);
    expect(await loadOsceLibraryStations({ from: () => { throw new Error("down"); } })).toEqual([]);
  });
  it("a copy is made only from a servable version: never a draft, superseded, retired, other-kind or unapproved one", async () => {
    const admin = memoryAdmin(tables, new Set([V(1), V(2), V(3), V(4), V(5)]));
    expect(await servableOsceStation(admin, V(1))).toMatchObject({ versionId: V(1) });
    for (const id of [V(2), V(3), V(4), V(5), "not-a-uuid"]) expect(await servableOsceStation(admin, id)).toBeNull();
    expect(await servableOsceStation(memoryAdmin(tables, new Set()), V(1))).toBeNull();
  });
  it("the read path writes nothing and reads no private or learner station", () => {
    const src = readFileSync("src/lib/individual/scholar/library-questions.ts", "utf8");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).not.toMatch(/from\("individual_scholar_osce_station"\)/);
  });
});

describe("4. notes too thin: the evidence-recovery workflow is offered, sources kept", () => {
  it("the recovery request names the material and section, never a guessed topic", () => {
    expect(osceRecoveryRequest({ materialId: "m1", title: "  Respiratory   notes ", chunkId: "c1" }, "too_few_items"))
      .toEqual({ question: "Respiratory notes", materialId: "m1", sectionId: "c1", withheldReason: "osce_too_few_items" });
    expect(osceRecoveryRequest({ materialId: "m1", title: "x", chunkId: null }, "malformed")).toBeNull();
    expect(OSCE_RECOVERY_NOTE).toMatch(/learning resources/);
  });
  it("the route offers it on a withheld or thin station, the create form shows RecoveryFlow, and an AI station keeps its passages", () => {
    const route = readFileSync("src/app/api/individual/scholar/osce/stations/route.ts", "utf8");
    expect(route).toMatch(/recovery: recover\("thin_notes"\)/);
    expect(route).toMatch(/recovery: recover\(check\.reason\)/);
    expect(route).toMatch(/references: passages\.map\(p => \(\{ kind: "notes" as const/);
    const client = readFileSync("src/app/individual/(app)/[experience]/(scholar)/study/_components/osce-client.tsx", "utf8");
    expect(client).toMatch(/<RecoveryFlow key=\{recovery\.key\} request=\{recovery\.body\}/);
  });
});

describe("5. a competency's content status is shown, never assumed approved", () => {
  it("the competency status is said as recorded, and the station is never called reviewed", () => {
    expect(competencyContentStatus("Clinically approved")).toBe("Competency content: Clinically approved · station not clinically reviewed");
    expect(competencyContentStatus("")).toBe("Competency content: Not clinically reviewed · station not clinically reviewed");
  });
});

describe("6. station selection: filter and browse", () => {
  const S = (o: Partial<any>) => ({ title: "Station", topic: null, bodySystem: null, competencyId: null, programmeCode: null, difficulty: null, source: "template", ...o });
  const list = [
    S({ title: "Chest", topic: "Respiratory assessment", bodySystem: "Respiratory", difficulty: "introductory", programmeCode: "BSC-N", competencyId: "c1" }),
    S({ title: "Postnatal", topic: "Postnatal check", bodySystem: "Reproductive", difficulty: "advanced", programmeCode: "BSC-M", source: "library" }),
    S({ title: "Cardiac", topic: "Chest pain", bodySystem: "Cardiovascular", difficulty: "intermediate", source: "ai" }),
  ];
  it("by topic or body system, competency, programme, difficulty and source", () => {
    expect(filterStations(list, parseOsceFilter({ q: "respiratory" })).map(s => s.title)).toEqual(["Chest"]);
    expect(filterStations(list, parseOsceFilter({ q: "cardiovascular" })).map(s => s.title)).toEqual(["Cardiac"]);
    expect(filterStations(list, parseOsceFilter({ competency: "c1" })).map(s => s.title)).toEqual(["Chest"]);
    expect(filterStations(list, parseOsceFilter({ programme: "BSC-M" })).map(s => s.title)).toEqual(["Postnatal"]);
    expect(filterStations(list, parseOsceFilter({ difficulty: "intermediate" })).map(s => s.title)).toEqual(["Cardiac"]);
    expect(filterStations(list, parseOsceFilter({ source: "library" })).map(s => s.title)).toEqual(["Postnatal"]);
    expect(filterStations(list, parseOsceFilter({ difficulty: "expert", source: "bogus" }))).toHaveLength(3);
  });
  it("offers only choices some station has", () => {
    const f = stationFacets(list);
    expect(f.difficulties).toEqual(["introductory", "intermediate", "advanced"]);
    expect(f.sources).toEqual(["library", "template", "ai"]);
    expect(f.programmes).toEqual(["BSC-M", "BSC-N"]);
    expect(f.topics).toContain("Cardiovascular");
  });
});

// A recording admin: every write and every filter is kept, so the store's guards are seen, not assumed.
function recorder(reply: any = { data: [{ id: "x", started_at: "2026-10-31T10:00:00Z" }], error: null }) {
  const calls: any[] = [];
  const from = (table: string) => {
    const c: any = { table, filters: [] as any[] };
    calls.push(c);
    const q: any = {};
    for (const m of ["select", "limit", "order", "maybeSingle", "single"]) q[m] = () => q;
    for (const m of ["eq", "is", "not"]) q[m] = (...a: any[]) => { c.filters.push([m, ...a]); return q; };
    q.insert = (v: any) => { c.insert = v; return q; };
    q.update = (v: any) => { c.update = v; return q; };
    q.then = (res: any, rej: any) => Promise.resolve(c.insert && reply.data?.[0] ? { data: reply.data[0], error: null } : reply).then(res, rej);
    return q;
  };
  return { admin: { from }, calls };
}

describe("7. interruption recovery: autosave, resume on the server clock, nothing lost", () => {
  const t0 = Date.parse("2026-10-31T10:00:00Z");
  it("an open run resumes with the server's remaining time, or is time up -- the clock never restarts", () => {
    expect(resumeOf(t0, 8, t0 + 200_000)).toEqual({ state: "running", remainingSeconds: 280 });
    expect(resumeOf(t0, 8, t0 + 480_000)).toEqual({ state: "time_up" });
  });
  it("an autosave at the bell is kept within a short grace, never after", () => {
    expect(saveAllowed(t0, 8, t0 + 480_000 + 15_000)).toBe(true);
    expect(saveAllowed(t0, 8, t0 + 480_000 + 25_000)).toBe(false);
  });
  it("autosave writes only an open run, finish and abandon only an open run, and a start keeps version and snapshot", async () => {
    const r = recorder();
    await saveOsceProgress(r.admin, "u1", "a1", { Assessment: "draft" });
    expect(r.calls[0].update).toMatchObject({ responses: { Assessment: "draft" } });
    expect(r.calls[0].update.last_saved_at).toBeTruthy();
    expect(r.calls[0].filters).toEqual(expect.arrayContaining([["eq", "user_id", "u1"], ["eq", "status", "in_progress"], ["is", "finished_at", null]]));
    await finishOsceAttempt(r.admin, "u1", "a1", { responses: {}, finishedAt: "2026-10-31T10:08:00Z", durationSeconds: 480, timeUp: true });
    expect(r.calls[1].update).toMatchObject({ status: "finished", time_up: true });
    expect(r.calls[1].filters).toEqual(expect.arrayContaining([["eq", "status", "in_progress"]]));
    await abandonOsceAttempt(r.admin, "u1", "a1");
    expect(r.calls[2].update).toEqual({ status: "abandoned" });
    await startOsceAttempt(r.admin, "u1", "s1", { version: 2, snapshot: { version: 2 } });
    expect(r.calls[3].insert).toEqual({ user_id: "u1", station_id: "s1", station_version: 2, station_snapshot: { version: 2 } });
  });
  it("the start route resumes an open run before it would start a new one, and the client autosaves and resumes", () => {
    const route = readFileSync("src/app/api/individual/scholar/osce/attempts/route.ts", "utf8");
    expect(route.indexOf("openOsceAttempt(")).toBeLessThan(route.indexOf("startOsceAttempt(ctx"));
    const client = readFileSync("src/app/individual/(app)/[experience]/(scholar)/study/_components/osce-client.tsx", "utf8");
    expect(client).toMatch(/action: "save"/);
    expect(client).toMatch(/OSCE_AUTOSAVE\.debounceMs/);
    expect(client).toMatch(/pagehide/);
    expect(client).toMatch(/hasOpenRun && !pending/);
  });
});

describe("721 absent: OSCE practice is unavailable, as when 720 is absent", () => {
  beforeEach(() => resetOsceSchema());
  it("a missing 721 column is remembered as not installed", async () => {
    const admin = { from: () => { const q: any = {}; for (const m of ["select", "eq", "limit"]) q[m] = () => q; q.then = (res: any) => Promise.resolve({ data: null, error: { code: "42703" } }).then(res); return q; } };
    expect(await osceSchema(admin, "u1")).toBe(false);
  });
});

describe("8 to 10. feedback, the score explained, critical misses shown apart, the result", () => {
  const list = [item("a", true), item("b", true), ...Array.from({ length: 18 }, (_, i) => item(`n${i}`))];
  const ticks = list.map(i => ({ itemId: i.id, mark: i.id === "a" ? "missed" : i.id === "b" ? "partly" : "done" }));
  it("a 93% practice score still lists its missed critical item first and apart", () => {
    const s = scoreTicks(list, ticks);
    if (!s.ok) throw new Error(s.reason);
    expect(Math.round(s.score * 100)).toBe(93);
    const r = resultOf(list, s.ticks);
    expect(r.criticalMissed.map(g => g.itemId)).toEqual(["a"]);
    expect(r.criticalPartly.map(g => g.itemId)).toEqual(["b"]);
    expect(r.gaps.map(g => g.itemId)).toEqual(["a", "b"]);
    expect(r.strengths).toHaveLength(18);
  });
  it("the explanation says how the score is made, and that a high score does not cancel a critical miss", () => {
    const e = scoreExplanation({ points: 18.5, outOf: 20, criticalMissed: 1, criticalPartly: 1, criticalTotal: 2 }).join(" ");
    expect(e).toMatch(/one point if marked done, half a point if partly, and nothing if missed/);
    expect(e).toMatch(/18\.5 of 20 points, which is 93%/);
    expect(e).toMatch(/1 of 2 critical items missed and 1 partly done/);
    expect(e).toMatch(/does not cancel a missed critical item/);
    expect(claimsVerification(e)).toBe(false);
  });
  it("the learner's own marks and the AI's suggestions are kept apart, item by item", () => {
    const m = marksCompared([item("a", true), item("b")], [{ itemId: "a", mark: "missed" }, { itemId: "b", mark: "done" }], [{ itemId: "a", mark: "partly" }]);
    expect(m).toEqual([
      { itemId: "a", text: "Item a", critical: true, yours: "missed", suggested: "partly" },
      { itemId: "b", text: "Item b", critical: false, yours: "done", suggested: null },
    ]);
  });
  it("guidance and expected activities reach the browser only after a run, never in the brief", () => {
    const row: any = { id: "s", title: "T", scenario: "S", candidateInstructions: "I", durationMinutes: 8, sections: ["A"], source: "template", contentStatus: "x", version: 1,
      profession: null, programmeLabel: null, topic: null, bodySystem: null, difficulty: null, objectives: [], checklist: [item("a")],
      guidance: { suggestedResponses: ["R"], assessmentGuidance: "G" }, expectedActivities: ["E"] };
    const v = stationView(row) as Record<string, unknown>;
    expect(v.guidance).toBeUndefined();
    expect(v.expectedActivities).toBeUndefined();
    expect(resultExtras({ ...row, checklist: row.checklist })).toMatchObject({ guidance: row.guidance, expectedActivities: ["E"], guidelinesNote: OSCE_GUIDELINES_NOTE });
    expect(OSCE_GUIDELINES_NOTE).toMatch(/course materials and current local clinical guidelines/);
  });
  it("the mark route records the gaps and revision suggestions on the attempt and scores against the snapshot", () => {
    const route = readFileSync("src/app/api/individual/scholar/osce/attempts/[id]/route.ts", "utf8");
    expect(route).toMatch(/gaps: result\.gaps, revisionSuggestions: remedies/);
    expect(route).toMatch(/scoreTicks\(snap\.checklist, body\?\.ticks\)/);
  });
});

describe("11 and 12. wording, boundaries and accessibility", () => {
  const UI = [
    "src/app/individual/(app)/[experience]/(scholar)/study/apply/osce/page.tsx",
    "src/app/individual/(app)/[experience]/(scholar)/study/apply/osce/[stationId]/page.tsx",
    "src/app/individual/(app)/[experience]/(scholar)/study/_components/osce-client.tsx",
  ];
  const visible = (src: string) => [...src.matchAll(/"([^"\n]{12,})"|>([^<>{}\n]{12,})</g)].map(m => m[1] ?? m[2]).filter(s => !/^[a-z_/.@:-]+$/i.test(s) && !/[{}]|className|aria-|pointer-coarse|focus-visible|md:/.test(s));
  it("the label says simulated practice, not an observed clinical skills assessment", () => {
    expect(OSCE_PRACTICE_LABEL).toMatch(/^Simulated practice — not an observed clinical skills assessment/);
  });
  it("no internal AI governance terms on the learner's screens", () => {
    for (const f of UI) {
      const bad = visible(readFileSync(f, "utf8")).filter(s => /\b(grounding|grounded|holdings|prompt|evaluator|metering|attribution|activity `|guardrail|governance|ckri|policy key|model)\b/i.test(s));
      expect(bad, f).toEqual([]);
    }
  });
  it("no OSCE string or screen claims verification, a pass or competence, and none touches an assessment table", () => {
    const strings = [OSCE_GUIDELINES_NOTE, OSCE_RECOVERY_NOTE, ...Object.values(OSCE_FEEDBACK_LABEL), libraryContentStatus(3), competencyContentStatus("Clinically approved")];
    expect(strings.filter(claimsVerification)).toEqual([]);
    for (const f of [...UI, "src/app/api/individual/scholar/osce/attempts/route.ts", "src/app/api/individual/scholar/osce/attempts/[id]/route.ts", "src/lib/individual/scholar/library-questions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(visible(src).filter(claimsVerification), f).toEqual([]);
      expect(src, f).not.toMatch(/from\("(assessments|competency_verification_[a-z_]+|osce_[a-z_]+|clinical_cases|passport_[a-z_]+|credential[a-z_]*)"\)/);
    }
  });
  it("one md breakpoint, and critical items carry a word and a symbol, not colour alone", () => {
    for (const f of UI) expect(readFileSync(f, "utf8"), f).not.toMatch(/\b(sm|lg|xl|2xl):/);
    const client = readFileSync(UI[2], "utf8");
    expect(client).toMatch(/<span aria-hidden="true">▲<\/span>Critical/);
  });
});
