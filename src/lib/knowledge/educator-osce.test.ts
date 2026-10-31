/* eslint-disable @typescript-eslint/no-explicit-any */
// OSCE-AUTHORING-01 (owner, 31 Oct 2026): OSCE practice stations authored in the EXISTING HQ knowledge library (442 kind
// osce_station, widened by 721), through the existing educator review, independent clinical approval (395, 640) and
// publication. Each claim tested by being run: the pure rules, the educator writes against a recording admin, the
// Scholar read path against an in-memory admin that honours its filters, and -- for what only the database decides --
// the exact text of the guard that decides it.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/competency/clinical-review", () => ({
  loadRequiredApprovals: async () => ({ standard: 1, high: 2 }),
  reviewerAppointments: async () => [{ id: "appt-1", scopes: [] }],
}));

import {
  LIBRARY_STATION_LABEL, OSCE_DESIGN_CHECKLIST, OSCE_SOURCE_LABEL, OSCE_STORED_MAX_BYTES, TEMPLATE_CONTENT_STATUS, pgJsonBytes, pgJsonText,
  stationContentOf, stationFieldsOf, stationFromLibrary, validateStationContent,
} from "@/lib/individual/scholar/osce";
import { loadOsceLibraryStations, servableOsceStation } from "@/lib/individual/scholar/library-questions";
import {
  RESOURCE_KINDS, VERSION_STATUS_LABEL, checkedContent, contentOf, createResource, newVersion, publishVersion, resourceReviewQueue, saveDraft,
  servedToLearners, versionStatus, type VersionStatus,
} from "./educator";

const sql = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8").replace(/\r\n/g, "\n");
const M442 = sql("442-ckri-educator-knowledge.sql"), M640 = sql("640-hq-cross-cutting-roles-item-level-sod.sql"), M721 = sql("721-individual-scholar-osce-definition-versions-library.sql");

/** What the HQ editor sends for a full station. */
const form = (o: Record<string, unknown> = {}) => ({
  scenario: "  A simulated adult attends clinic with two days of increasing breathlessness.\r\n\r\nThey are alert.  ",
  candidateInstructions: "Assess the person and say what you would do next.", durationMinutes: "8",
  sections: ["Introduction and consent", "Assessment", ""],
  checklist: Array.from({ length: 10 }, (_, i) => ({ id: `item-${i + 1}`, text: `  Observable   step ${i + 1} `, critical: i < 2, ...(i === 0 ? { outcome: "Performs a systematic respiratory assessment" } : {}) })),
  profession: " Physiotherapy ", programmeCode: "BSC-PT", programmeLabel: "BSc Physiotherapy", topic: "Breathlessness", bodySystem: "Respiratory", difficulty: "intermediate",
  learningOutcomes: ["Performs a systematic respiratory assessment", ""], objectives: ["Practise a structured assessment"], expectedActivities: ["Introduces self", "Gains consent"],
  suggestedResponses: ["I would introduce myself and gain consent"], assessmentGuidance: "A systematic order matters more than speed.",
  references: [{ label: "Course handbook, chapter 4" }, { label: "Local guideline", url: "https://example.org/guideline" }],
  ...o,
});

describe("1. one validator: what HQ saves is exactly what Scholar accepts", () => {
  it("the editor's fields become stored content that Scholar's own validateStationContent accepts, tidied, never cut", () => {
    const c = stationContentOf(form());
    const v = validateStationContent(c);
    expect(v.ok).toBe(true);
    expect(c).toMatchObject({ scenario: "A simulated adult attends clinic with two days of increasing breathlessness.\n\nThey are alert.", duration_minutes: 8, profession: "Physiotherapy",
      sections: ["Introduction and consent", "Assessment"], learning_outcomes: ["Performs a systematic respiratory assessment"], references: [{ kind: "reference", label: "Course handbook, chapter 4" }, { kind: "reference", label: "Local guideline", url: "https://example.org/guideline" }],
      guidance: { suggested_responses: ["I would introduce myself and gain consent"], assessment_guidance: "A systematic order matters more than speed." } });
    expect((c.checklist as any[])[0]).toEqual({ id: "item-1", text: "Observable step 1", critical: true, outcome: "Performs a systematic respiratory assessment" });
    // HQ's checkedContent is that same function, on the server.
    expect(checkedContent("osce_station", form())).toEqual({ ok: true, content: c });
    expect(contentOf("osce_station", form())).toEqual(c);
  });
  it("an empty optional field is omitted, never stored as JSON null (the database would refuse a null)", () => {
    const c = stationContentOf(form({ profession: "", sections: [], objectives: [], suggestedResponses: [], assessmentGuidance: "", references: [], difficulty: "" }));
    for (const k of ["profession", "sections", "objectives", "guidance", "references", "difficulty"]) expect(k in c).toBe(false);
    expect(validateStationContent(c).ok).toBe(true);
    for (const k of ["sections", "guidance", "difficulty", "objectives", "references", "profession"]) expect(validateStationContent({ ...c, [k]: null }).ok, k).toBe(false);
  });
  it("no fixed item cap below the structural bound: 1 and 60 accepted, 0 and 61 refused; 8 to 12 is guidance only", () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `item-${i + 1}`, text: `Step ${i + 1}`, critical: false }));
    expect(checkedContent("osce_station", form({ checklist: items(1) })).ok).toBe(true);
    expect(checkedContent("osce_station", form({ checklist: items(3) })).ok).toBe(true);
    expect(checkedContent("osce_station", form({ checklist: items(60) })).ok).toBe(true);
    expect(checkedContent("osce_station", form({ checklist: items(0) }))).toMatchObject({ ok: false, error: expect.stringMatching(/1 to 60/) });
    expect(checkedContent("osce_station", form({ checklist: items(61) })).ok).toBe(false);
    expect(OSCE_DESIGN_CHECKLIST).toEqual({ min: 8, max: 12 });
  });
  it("refuses what the database or the learner's copy would refuse, each with a plain reason", () => {
    const bad: Record<string, unknown>[] = [
      { scenario: "too short" }, { candidateInstructions: "short" }, { durationMinutes: "8.5" }, { durationMinutes: 25 }, { durationMinutes: "" },
      { checklist: [{ id: "item-1", text: "", critical: true }] }, { checklist: [{ id: "a", text: "x", critical: false }, { id: "a", text: "y", critical: false }] },
      { checklist: [{ id: "item-1", text: "x".repeat(301), critical: false }] }, { difficulty: "expert" }, { sections: Array.from({ length: 7 }, (_, i) => `S${i}`) },
      { objectives: Array.from({ length: 31 }, (_, i) => `O${i}`) }, { references: [{ label: "x", url: "http://insecure" }] }, { profession: "p".repeat(81) },
      { suggestedResponses: Array.from({ length: 31 }, (_, i) => `R${i}`) },
    ];
    for (const b of bad) {
      const r = checkedContent("osce_station", form(b));
      expect(r.ok, JSON.stringify(b).slice(0, 80)).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });
  it("measures bytes as Postgres prints jsonb, and refuses a station over the 442 32000-byte version bound", () => {
    expect(pgJsonText({ a: 1, b: [true, "x"], c: { d: null } })).toBe('{"a": 1, "b": [true, "x"], "c": {"d": null}}');
    expect(pgJsonBytes({ t: "é" })).toBe(new TextEncoder().encode('{"t": "é"}').length);
    const big = form({ checklist: Array.from({ length: 60 }, (_, i) => ({ id: `item-${i + 1}`, text: `${i} ${"x".repeat(290)}`, critical: false })), suggestedResponses: Array.from({ length: 4 }, () => "y".repeat(3900)) });
    const r = checkedContent("osce_station", big);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/too long to store/) });
    expect(pgJsonBytes(stationContentOf(big))).toBeGreaterThan(OSCE_STORED_MAX_BYTES.content);
  });
  it("the editor round-trips stored content (a draft or a new version copied from the published one)", () => {
    const c = stationContentOf(form());
    expect(stationContentOf(stationFieldsOf(c) as unknown as Record<string, unknown>)).toEqual(c);
  });
  it("the other three kinds are unchanged", () => {
    expect(RESOURCE_KINDS).toEqual(["explanation", "revision_question", "targeted_resource", "osce_station"]);
    expect(checkedContent("explanation", { body: "  A body of text long enough.  " })).toEqual({ ok: true, content: { body: "A body of text long enough." } });
    expect(contentOf("revision_question", { stem: "Q", options: ["a", "b", "c", "d"], correctIndex: 2, rationale: "R" })).toEqual({ stem: "Q", options: ["a", "b", "c", "d"], correct_index: 2, rationale: "R" });
  });
});

/** Records every write; answers reads from `rows`. */
function recorder(rows: Record<string, any> = {}) {
  const writes: { table: string; op: string; value: any }[] = [];
  const from = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, in: () => q,
      insert: (value: any) => { writes.push({ table, op: "insert", value }); return q; },
      update: (value: any) => { writes.push({ table, op: "update", value }); return q; },
      single: async () => ({ data: { id: `${table}-new` }, error: null }),
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return q;
  };
  const rpcs: { fn: string; args: any }[] = [];
  return { admin: { from, rpc: async (fn: string, args: any) => { rpcs.push({ fn, args }); return { data: null, error: null }; } }, writes, rpcs };
}

describe("2. governance reused: the existing educator, clinical approval and publication path", () => {
  it("a station draft is created only when Scholar's validator accepts it, as kind osce_station, origin educator", async () => {
    const bad = recorder();
    expect(await createResource(bad.admin, "me", { code: "breathless-1", kind: "osce_station", title: "Breathlessness station", needId: null, fields: form({ scenario: "x" }) })).toMatchObject({ ok: false });
    expect(bad.writes).toEqual([]); // nothing written, not even the resource
    const good = recorder();
    expect(await createResource(good.admin, "me", { code: "breathless-1", kind: "osce_station", title: "Breathlessness station", needId: null, fields: form() })).toMatchObject({ ok: true });
    expect(good.writes[0]).toMatchObject({ table: "ckri_knowledge_resource", op: "insert", value: { kind: "osce_station", created_by: "me" } });
    expect(good.writes[1]).toMatchObject({ table: "ckri_knowledge_version", op: "insert", value: { version_no: 1, origin: "educator", authored_by: ["me"], content: stationContentOf(form()) } });
  });
  it("only a draft is edited, and an invalid edit writes nothing", async () => {
    const pub = recorder({ ckri_knowledge_version: { id: "v1", state: "published", authored_by: ["a"], ckri_knowledge_resource: { kind: "osce_station" } } });
    expect(await saveDraft(pub.admin, "me", "00000000-0000-4000-8000-000000000001", form())).toMatchObject({ ok: false, error: expect.stringMatching(/new version/) });
    const draft = recorder({ ckri_knowledge_version: { id: "v1", state: "draft", authored_by: ["a"], ckri_knowledge_resource: { kind: "osce_station" } } });
    expect(await saveDraft(draft.admin, "me", "00000000-0000-4000-8000-000000000001", form({ durationMinutes: 99 }))).toMatchObject({ ok: false });
    expect(draft.writes).toEqual([]);
    expect(await saveDraft(draft.admin, "me", "00000000-0000-4000-8000-000000000001", form())).toEqual({ ok: true });
    expect(draft.writes).toEqual([{ table: "ckri_knowledge_version", op: "update", value: { content: stationContentOf(form()), authored_by: ["a", "me"] } }]);
  });
  it("editing a published station starts ONE new draft version copied from it; the published one is not touched", async () => {
    const content = stationContentOf(form());
    const r = recorder({ ckri_knowledge_version: { id: "v2", version_no: 2, content, state: "published" } });
    expect(await newVersion(r.admin, "me", "00000000-0000-4000-8000-000000000001")).toMatchObject({ ok: true });
    expect(r.writes).toEqual([{ table: "ckri_knowledge_version", op: "insert", value: { resource_id: "00000000-0000-4000-8000-000000000001", version_no: 3, content, origin: "educator", authored_by: ["me"], parent_version_id: "v2" } }]);
    const open = recorder({ ckri_knowledge_version: { id: "v3", version_no: 3, content, state: "draft" } });
    expect(await newVersion(open.admin, "me", "00000000-0000-4000-8000-000000000001")).toMatchObject({ ok: false, error: expect.stringMatching(/still a draft/) });
    expect(open.writes).toEqual([]);
  });
  it("publication is the 442 function, with the publisher the server knows: it needs approval of the exact version and supersedes the earlier published one", async () => {
    const r = recorder();
    await publishVersion(r.admin, "publisher-1", "v3");
    expect(r.rpcs).toEqual([{ fn: "ckri_knowledge_publish", args: { p_version: "v3", p_publisher: "publisher-1" } }]);
    expect(M442).toMatch(/if not ckri_knowledge_approved\(v\.id\) then raise exception 'ckri_knowledge_publish: this exact version is not clinically approved'/);
    expect(M442).toMatch(/update ckri_knowledge_version set state = 'superseded', superseded_at = now\(\) where resource_id = v\.resource_id and state = 'published' and id <> v\.id;/);
    // 640: an author, editor, submitter or reviewing educator never publishes their own version.
    expect(M640).toMatch(/new\.published_by = any\(new\.authored_by\) or new\.published_by is not distinct from new\.submitted_by/);
    expect(M640).toMatch(/create trigger ckri_knowledge_version_sod_publication/);
  });
  it("an author cannot approve their own station: the queue never offers it, and 442 + 640 refuse the decision", async () => {
    const tables: Record<string, any[]> = {
      clinical_content_version: [
        { id: "ccv-own", content_kind: "resource", knowledge_version_id: "kv-own", content_hash: "h1", content_snapshot: {}, authored_by: ["rev"], submitted_by: "rev", required_approvals: 1, created_at: "2026-10-31" },
        { id: "ccv-sub", content_kind: "resource", knowledge_version_id: "kv-sub", content_hash: "h2", content_snapshot: {}, authored_by: ["a"], submitted_by: "rev", required_approvals: 1, created_at: "2026-10-31" },
        { id: "ccv-ok", content_kind: "resource", knowledge_version_id: "kv-ok", content_hash: "h3", content_snapshot: stationContentOf(form()), authored_by: ["a"], submitted_by: "a", required_approvals: 1, created_at: "2026-10-31" },
      ],
      ckri_knowledge_version: [
        { id: "kv-ok", content_hash: "h3", state: "submitted", origin: "educator", ckri_knowledge_resource: { kind: "osce_station", title: "Breathlessness station" } },
      ],
      clinical_review_decision: [], ckri_knowledge_version_competency: [{ version_id: "kv-ok", competency_id: "c1" }],
    };
    const q = await resourceReviewQueue(memoryAdmin(tables, new Set()), "rev");
    expect(q?.items.map(i => i.versionId)).toEqual(["ccv-ok"]);
    expect(q?.items[0]).toMatchObject({ kind: "osce_station", required: 1, approvals: 0 });
    expect(M442).toMatch(/if new\.reviewer_id = v_version\.submitted_by or new\.reviewer_id = any\(v_version\.authored_by\) then\s+raise exception 'clinical_review_decision: not independent/);
    expect(M640).toMatch(/v\.content_kind = 'resource' then\s+v_conflict := exists \(select 1 from ckri_knowledge_version kv[\s\S]*?new\.reviewer_id is not distinct from kv\.educator_reviewed_by/);
  });
});

/** An in-memory admin that HONOURS eq/in filters (as osce-721.test.ts), so a draft or unapproved version really is not returned. */
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

describe("3. the learner library: only exact, clinically approved and published versions", () => {
  const R = "b0000000-0000-4000-8000-000000000001";
  const V = (n: number) => `c0000000-0000-4000-8000-00000000000${n}`;
  const content = stationContentOf(form());
  const tables = {
    ckri_knowledge_resource: [{ id: R, kind: "osce_station", title: "Breathlessness station", status: "active" }],
    ckri_knowledge_version: [
      { id: V(1), resource_id: R, version_no: 1, content, state: "superseded", published_at: "2026-10-20" },
      { id: V(2), resource_id: R, version_no: 2, content, state: "published", published_at: "2026-10-30" },
      { id: V(3), resource_id: R, version_no: 3, content, state: "submitted", published_at: null },
      { id: V(4), resource_id: R, version_no: 4, content, state: "draft", published_at: null },
    ],
    ckri_knowledge_version_competency: [{ version_id: V(2), competency_id: "c1" }],
  };
  it("a draft is not servable", async () => {
    expect(await servableOsceStation(memoryAdmin(tables, new Set([V(2), V(4)])), V(4))).toBeNull();
  });
  it("an approved but unpublished version is not servable", async () => {
    expect(await servableOsceStation(memoryAdmin(tables, new Set([V(2), V(3)])), V(3))).toBeNull();
  });
  it("a superseded version, or a published one whose approval no longer holds, is not servable", async () => {
    expect(await servableOsceStation(memoryAdmin(tables, new Set([V(1), V(2)])), V(1))).toBeNull();
    expect(await servableOsceStation(memoryAdmin(tables, new Set()), V(2))).toBeNull();
  });
  it("the published, approved version is servable, and the learner's copy is its stored content exactly", async () => {
    const admin = memoryAdmin(tables, new Set([V(2), V(3)]));
    const lib = await servableOsceStation(admin, V(2));
    expect(lib).toMatchObject({ versionId: V(2), versionNo: 2, competencyIds: ["c1"] });
    expect((await loadOsceLibraryStations(admin)).map(s => s.versionId)).toEqual([V(2)]);
    const copy = stationFromLibrary({ resourceId: R, versionId: V(2), versionNo: 2, title: lib!.title, content: lib!.content });
    // The fields the 721 guard compares, exactly the published content.
    expect(copy.scenario).toBe(content.scenario);
    expect(copy.candidateInstructions).toBe(content.candidate_instructions);
    expect(copy.durationMinutes).toBe(content.duration_minutes);
    expect(copy.checklist).toBe(content.checklist);
    expect(copy.exact).toEqual({ expected_activities: content.expected_activities, guidance: content.guidance });
    expect(copy).toMatchObject({ version: 2, source: "library", libraryVersionId: V(2) });
  });
  it("an edited copy is refused by the database: the 721 guard compares every governed field with the published, approved content", () => {
    for (const f of ["new.scenario is distinct from (v.content ->> 'scenario')", "new.checklist is distinct from (v.content -> 'checklist')",
      "new.guidance is distinct from (v.content -> 'guidance')", "new.expected_activities is distinct from (v.content -> 'expected_activities')",
      "new.version is distinct from v.version_no", "raise exception 'individual_scholar_osce_station: a governed station is stored exactly as published'",
      "if not ckri_knowledge_approved(new.library_version_id) then", "if v.kind <> 'osce_station' or v.status <> 'active' or v.state <> 'published' then"])
      expect(M721).toContain(f);
    // An edited checklist differs from the published one on a compared field, so the guard refuses it.
    const edited = [...(content.checklist as any[])]; edited[0] = { ...edited[0], critical: false };
    expect(JSON.stringify(edited)).not.toBe(JSON.stringify(content.checklist));
  });
});

describe("4. draft and unreviewed templates are told apart from approved stations", () => {
  it("HQ: one distinct status per version, served only when published and approved", () => {
    const cases: [string, "draft" | "in_review" | "approved" | "rejected", VersionStatus][] = [
      ["draft", "draft", "draft"], ["submitted", "in_review", "in_review"], ["submitted", "approved", "approved"], ["submitted", "rejected", "rejected"],
      ["published", "approved", "published"], ["superseded", "approved", "superseded"], ["retired", "approved", "retired"],
    ];
    for (const [state, clinical, want] of cases) expect(versionStatus(state, clinical)).toBe(want);
    expect(new Set(Object.values(VERSION_STATUS_LABEL)).size).toBe(7);
    expect(VERSION_STATUS_LABEL).toMatchObject({ draft: "Draft", in_review: "In clinical review", approved: "Approved", published: "Published", superseded: "Superseded" });
    expect(servedToLearners({ state: "published", clinical: "approved" })).toBe(true);
    for (const [state, clinical] of [["submitted", "approved"], ["draft", "draft"], ["superseded", "approved"], ["published", "rejected"]] as const) expect(servedToLearners({ state, clinical })).toBe(false);
  });
  it("HQ pages render the status chip and the station as a station", () => {
    const educator = readFileSync("src/app/super-admin/research/educator/page.tsx", "utf8");
    expect(educator).toMatch(/<StatusChip status=\{v\.status\} \/>/);
    expect(educator).toMatch(/servedToLearners/);
    expect(readFileSync("src/app/super-admin/research/knowledge-publication/page.tsx", "utf8")).toMatch(/<StatusChip status=\{v\.status\} \/>/);
    expect(readFileSync("src/app/super-admin/research/knowledge-review/page.tsx", "utf8")).toMatch(/i\.kind === "osce_station" \? <div className="mt-2"><StationPreview/);
  });
  it("Scholar: a library station says it is clinically reviewed; the demo template keeps 'not clinically reviewed'", () => {
    expect(LIBRARY_STATION_LABEL).toBe("From the Competen library (clinically reviewed)");
    expect(OSCE_SOURCE_LABEL.library).toBe(LIBRARY_STATION_LABEL);
    expect(TEMPLATE_CONTENT_STATUS).toBe("Competen practice template — not clinically reviewed");
    expect(OSCE_SOURCE_LABEL.template).not.toMatch(/reviewed|approved/i);
  });
});
