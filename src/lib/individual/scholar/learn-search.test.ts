/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PAGE_SIZE, displaySessionTitle, displayTitle, distinguishTitles, learnLanding, leadingTopic, looksLikeFileName, parseSearchParams,
  searchLibrary, sessionTitle, snippet, termScore, topicDetail, topicIndex,
} from "./learn-search";
import { parseScope, resolveScope, scopeText, storedScopeKind } from "./learn";
import type { MaterialRow, SectionRef } from "./store";

// SCH-LEARN-UX-01 (owner GO 2026-10-28). The pure rules (names, extracts, topics, parameters, scopes) and the search
// run end to end over an in-memory database that honours the store's own filters -- so ownership, counts and
// pagination are exercised as the store issues them. A planted control drops the owner filter and must go RED.

// ── an in-memory PostgREST, just the calls the Scholar store makes here ────────────────────────────────────────
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>, opts: { ignoreOwner?: boolean } = {}) {
  const calls: string[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let count = false, range: [number, number] | null = null, lim: number | null = null, single = false;
    let write: { kind: "upsert"; rows: Row[] } | null = null;
    const q: any = {
      select: (_c: string, o?: { count?: string }) => { count = !!o?.count; return q; },
      eq: (k: string, v: unknown) => { if (!(opts.ignoreOwner && k === "user_id")) rows = rows.filter(r => r[k] === v); return q; },
      in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return q; },
      gte: (k: string, v: string) => { rows = rows.filter(r => r[k] >= v); return q; },
      or: (expr: string) => {
        const parts = expr.split(",").map(p => { const [k, , pat] = p.split("."); return { k, needle: pat.replace(/%/g, "").toLowerCase() }; });
        rows = rows.filter(r => parts.some(p => String(r[p.k] ?? "").toLowerCase().includes(p.needle)));
        return q;
      },
      textSearch: (_k: string, tsq: string) => {
        const all = tsq.includes("&"), terms = tsq.split(/[|&]/).map(t => t.trim());
        rows = rows.filter(r => { const c = String(r.content).toLowerCase(); return all ? terms.every(t => c.includes(t)) : terms.some(t => c.includes(t)); });
        return q;
      },
      order: (k: string, o?: { ascending?: boolean }) => { rows.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (o?.ascending === false ? -1 : 1)); return q; },
      limit: (n: number) => { lim = n; return q; },
      range: (a: number, b: number) => { range = [a, b]; return q; },
      maybeSingle: () => { single = true; return q; },
      upsert: (rs: Row[]) => { write = { kind: "upsert", rows: rs }; return q; },
      then: (res: (v: any) => unknown, rej?: (e: unknown) => unknown) => {
        calls.push(table);
        if (write) {
          for (const w of (write as { rows: Row[] }).rows) { const t = (tables[table] ??= []); const i = t.findIndex(r => r.chunk_id === w.chunk_id); if (i >= 0) t[i] = w; else t.push(w); }
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        const total = rows.length;
        let out = range ? rows.slice(range[0], range[1] + 1) : rows;
        if (lim !== null) out = out.slice(0, lim);
        return Promise.resolve(single ? { data: out[0] ?? null, error: null } : { data: out, error: null, count: count ? total : null }).then(res, rej);
      },
    };
    return q;
  };
  return { from, calls, storage: {} };
}

const uid = (n: number, k = "a") => `00000000-0000-4000-8000-${k.repeat(1)}${String(n).padStart(11, "0")}`;
const ME = uid(1, "f"), OTHER = uid(2, "f");
const PDF = "application/pdf";

function library(owner: string, materials: number, sectionsEach: number, k: string) {
  const mats: Row[] = [], chunks: Row[] = [], analysis: Row[] = [];
  for (let m = 0; m < materials; m++) {
    const id = uid(m, k);
    const topic = m % 3 === 0 ? "Sepsis recognition" : m % 3 === 1 ? "Oxygen therapy" : "Fluid balance";
    mats.push({ id, user_id: owner, title: m === 0 ? "recognising-deterioration-notes" : `Week ${m} notes`, file_name: m === 0 ? "recognising-deterioration-notes.pdf" : `week-${m}.pdf`, mime_type: PDF, byte_size: 10, page_count: sectionsEach, chunk_count: sectionsEach, created_at: new Date(Date.UTC(2026, 9, 1) + m * 60_000).toISOString() });
    for (let s = 0; s < sectionsEach; s++) {
      const cid = uid(m * 1000 + s, k === "a" ? "c" : "d");
      chunks.push({ id: cid, user_id: owner, material_id: id, ordinal: s + 1, page_from: s + 1, page_to: s + 1, content: `${topic.toLowerCase()} lecture section ${s}: early warning scores and escalation of care ${owner === OTHER ? "secretother" : ""}` });
      analysis.push({ chunk_id: cid, user_id: owner, material_id: id, concepts: [topic] });
    }
  }
  return { mats, chunks, analysis };
}

function world(opts: { ignoreOwner?: boolean } = {}) {
  const mine = library(ME, 300, 10, "a"), theirs = library(OTHER, 5, 4, "b");
  const sessions = [
    { id: uid(1, "e"), user_id: ME, scope_kind: "document", title: "recognising-deterioration-notes", topic: null, competency_id: null, current_step: 1, status: "active", created_at: "2026-10-20T09:00:00Z", last_active_at: "2026-10-27T09:00:00Z" },
    { id: uid(2, "e"), user_id: ME, scope_kind: "document", title: "recognising-deterioration-notes", topic: null, competency_id: null, current_step: 0, status: "completed", created_at: "2026-10-21T09:00:00Z", last_active_at: "2026-10-26T09:00:00Z" },
    { id: uid(3, "e"), user_id: OTHER, scope_kind: "topic", title: "Sepsis secretother", topic: "Sepsis secretother", competency_id: null, current_step: 0, status: "active", created_at: "2026-10-21T09:00:00Z", last_active_at: "2026-10-28T09:00:00Z" },
  ];
  const steps = [
    { session_id: uid(1, "e"), user_id: ME, step: 0, chunk_id: mine.chunks[0].id, material_id: mine.mats[0].id },
    { session_id: uid(1, "e"), user_id: ME, step: 1, chunk_id: mine.chunks[1].id, material_id: mine.mats[0].id },
  ];
  const db = fakeDb({
    individual_scholar_material: [...mine.mats, ...theirs.mats], individual_scholar_chunk: [...mine.chunks, ...theirs.chunks],
    individual_scholar_chunk_analysis: [...mine.analysis, ...theirs.analysis], individual_scholar_topic_correction: [],
    individual_scholar_collection: [], individual_scholar_learning_session: sessions, individual_scholar_learning_step: steps,
    individual_scholar_competency_map: [], individual_scholar_competency_decision: [], individual_scholar_programme_choice: [],
  }, opts);
  const materials: MaterialRow[] = mine.mats.map(r => ({ id: r.id, title: r.title, fileName: r.file_name, mimeType: r.mime_type, byteSize: 10, pageCount: r.page_count, chunkCount: r.chunk_count, createdAt: r.created_at })).reverse();
  return { db, materials, mine, theirs };
}

/** The isolation check: does anything of the other person's reach this person's results? */
const leaked = (r: any) => { const shown = JSON.stringify(r && typeof r === "object" && "params" in r ? { ...r, params: null, terms: null } : r); return shown.includes("secretother") || shown.includes(uid(0, "b")); };

describe("naming (owner s7): deterministic, never a raw file name, history not rewritten", () => {
  it("a file-like name becomes a title; a real title is kept", () => {
    expect(looksLikeFileName("recognising-deterioration-notes")).toBe(true);
    expect(displayTitle("recognising-deterioration-notes")).toBe("Recognising Deterioration Notes");
    expect(displayTitle("week_3_cardio.pdf")).toBe("Week 3 Cardio");
    expect(displayTitle("ECG interpretation, week 3")).toBe("ECG interpretation, week 3");
    expect(displayTitle("")).toBe("Untitled material");
  });

  it("the session title is topic, then source -- the owner's example", () => {
    const s = (chunkId: string): SectionRef => ({ chunkId, materialId: "m1", ordinal: 1, pageFrom: 3, pageTo: 3, materialTitle: "recognising-deterioration-notes", unit: "page" });
    const topics = new Map([["c1", ["Recognising clinical deterioration"]], ["c2", ["Recognising clinical deterioration", "NEWS2"]]]);
    expect(sessionTitle({ kind: "document", sections: [s("c1"), s("c2")], topics })).toBe("Recognising clinical deterioration · Source: Recognising Deterioration Notes");
    expect(sessionTitle({ kind: "section", sections: [s("c1")], topics })).toBe("Recognising clinical deterioration · Source: Recognising Deterioration Notes, page 3");
    expect(sessionTitle({ kind: "document", sections: [s("x")], topics: new Map() })).toBe("Recognising Deterioration Notes");
    expect(sessionTitle({ kind: "topic", topic: "oxygen therapy", sections: [s("c1"), { ...s("c3"), materialId: "m2", materialTitle: "Week 2" }], topics })).toBe("Oxygen Therapy · 2 sources");
    expect(sessionTitle({ kind: "document", sections: [s("c1")], topics }).length).toBeLessThanOrEqual(160);
  });

  it("an older session keeps its stored title and is SHOWN safely; same-looking sessions are told apart by when they began", () => {
    expect(displaySessionTitle("recognising-deterioration-notes")).toBe("Recognising Deterioration Notes");
    expect(displaySessionTitle("Sepsis · Source: Week 1")).toBe("Sepsis · Source: Week 1");
    const t = distinguishTitles([{ id: "1", title: "a-b", createdAt: "2026-10-20T09:00:00Z" }, { id: "2", title: "a-b", createdAt: "2026-10-21T10:00:00Z" }, { id: "3", title: "Other", createdAt: "2026-10-21T10:00:00Z" }]);
    expect(t.get("1")).not.toBe(t.get("2"));
    expect(t.get("1")).toMatch(/^A B · started 20 Oct 2026/);
    expect(t.get("3")).toBe("Other");
  });

  it("the leading topic is the one most sections share", () => {
    expect(leadingTopic(["a", "b", "c"], new Map([["a", ["x"]], ["b", ["y", "x"]], ["c", ["y"]]]))).toBe("X");
    expect(leadingTopic(["a"], new Map())).toBeNull();
  });
});

describe("pure search pieces", () => {
  it("extracts are short, around the match, and only the section's own words", () => {
    const text = `${"filler ".repeat(80)}sepsis six bundle within one hour ${"more ".repeat(80)}`;
    const e = snippet(text, ["sepsis"]);
    expect(e).toContain("sepsis six bundle");
    expect(e.length).toBeLessThanOrEqual(222);
    expect(e.startsWith("…") && e.endsWith("…")).toBe(true);
  });

  it("topics are one per name (case- and punctuation-blind) with their sections and documents", () => {
    const idx = topicIndex([{ chunkId: "1", materialId: "m1", topics: ["Sepsis", "AKI"] }, { chunkId: "2", materialId: "m2", topics: ["sepsis."] }]);
    expect(idx[0]).toMatchObject({ key: "sepsis", sections: 2, materialIds: ["m1", "m2"] });
    expect(termScore("Acute kidney injury", ["kidney", "injur"])).toBe(2);
  });

  it("parameters fall back safely", () => {
    expect(parseSearchParams({ q: "  sepsis  ", tab: "evil", page: "-4", type: "exe", subject: "x'); drop" })).toMatchObject({ q: "sepsis", tab: "all", page: 1, sort: "relevance", type: null, subject: null });
    expect(parseSearchParams({ tab: "sessions", page: "3", sort: "oldest" })).toMatchObject({ tab: "sessions", page: 3, sort: "oldest" });
  });
});

describe("Teach me using selected sources (owner s4, s5)", () => {
  const A = "00000000-0000-4000-8000-0000000000a1", C = "00000000-0000-4000-8000-0000000000c1";
  it("sources parse with caps; a typed topic alone stays a topic session; nothing chosen is refused", () => {
    expect(parseScope({ scope: { kind: "sources", materialIds: [A, "bad"], chunkIds: [C], topics: ["Sepsis"], topic: "septic shock" } }))
      .toEqual({ kind: "sources", materialIds: [A], chunkIds: [C], topics: ["Sepsis"], topic: "septic shock" });
    expect(parseScope({ scope: { kind: "sources", topic: "oxygen" } })).toEqual({ kind: "topic", topic: "oxygen" });
    expect(parseScope({ scope: { kind: "sources" } })).toBe("Choose at least one source.");
    expect(scopeText({ kind: "sources", materialIds: [], chunkIds: [], topics: ["NEWS2"], topic: "Mr Smith" })).toBe("Mr Smith NEWS2");
  });

  it("stored as 414 allows: a named topic as a topic session, otherwise by what it covers", () => {
    const sec = (m: string) => ({ chunkId: "c", materialId: m, ordinal: 1, pageFrom: null, pageTo: null, materialTitle: "x", unit: "section" as const });
    expect(storedScopeKind({ kind: "sources", materialIds: [], chunkIds: [C], topics: [], topic: "x" }, [sec("a")])).toBe("topic");
    expect(storedScopeKind({ kind: "sources", materialIds: [A, A], chunkIds: [], topics: [] }, [sec("a")])).toBe("documents");
    expect(storedScopeKind({ kind: "sources", materialIds: [], chunkIds: [C], topics: [] }, [sec("a")])).toBe("section");
    expect(storedScopeKind({ kind: "sources", materialIds: [], chunkIds: [C, A], topics: [] }, [sec("a"), sec("b")])).toBe("documents");
  });

  it("several documents, a section and a topic resolve into one session of the student's own sections only", async () => {
    const { db, mine, theirs } = world();
    const r = await resolveScope(db, ME, { kind: "sources", materialIds: [mine.mats[1].id, theirs.mats[0].id], chunkIds: [mine.chunks[25].id, theirs.chunks[0].id], topics: ["sepsis recognition"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = new Set(r.sections.map(s => s.materialId));
    expect(ids.has(mine.mats[1].id) && ids.has(mine.mats[2].id)).toBe(true);
    expect(r.sections.some(s => theirs.mats.some(m => m.id === s.materialId))).toBe(false);
    expect(r.topic).toBe("Sepsis recognition");
  });
});

describe("the search over a large library (owner s4, s5, s10, s11)", () => {
  it("finds topics, documents and sections across many documents, with exact counts and one page each, no AI", async () => {
    const { db, materials } = world();
    const r = await searchLibrary(db, ME, parseSearchParams({ q: "sepsis" }), materials);
    expect(r.counts.topics).toBe(1);
    expect(r.counts.documents).toBe(100);
    expect(r.counts.sections).toBe(1000);
    expect(r.topics!.items[0]).toMatchObject({ name: "Sepsis recognition", documents: 100, sections: 1000 });
    expect(r.documents!.items).toHaveLength(3);
    expect(r.sections!.items).toHaveLength(3);
    expect(r.sections!.items[0].location).toMatch(/^page \d+$/);
    expect(new Set(r.sections!.items.map(s => s.materialId)).size).toBeGreaterThanOrEqual(1);
    expect(db.calls.some(t => /ai|plat_ai|usage/.test(t))).toBe(false);
  });

  it("paginates documents and sessions; never more than a page reaches the page", async () => {
    const { db, materials } = world();
    const p2 = await searchLibrary(db, ME, parseSearchParams({ tab: "documents", page: "2", sort: "title" }), materials);
    expect(p2.documents!.total).toBe(300);
    expect(p2.documents!.items).toHaveLength(PAGE_SIZE);
    const p1 = await searchLibrary(db, ME, parseSearchParams({ tab: "documents", page: "1", sort: "title" }), materials);
    expect(p1.documents!.items.map(d => d.id)).not.toEqual(p2.documents!.items.map(d => d.id));
    const last = await searchLibrary(db, ME, parseSearchParams({ tab: "documents", page: "30" }), materials);
    expect(last.documents!.items).toHaveLength(10);
    const sec = await searchLibrary(db, ME, parseSearchParams({ q: "oxygen escalation", tab: "sections", page: "4" }), materials);
    expect(sec.sections!.items).toHaveLength(PAGE_SIZE);
    const s = await searchLibrary(db, ME, parseSearchParams({ tab: "sessions" }), materials);
    expect(s.sessions).toMatchObject({ total: 2 });
    expect(s.sessions!.items[0].title).not.toBe(s.sessions!.items[1].title);
    expect(s.sessions!.items[0]).toMatchObject({ status: "active", steps: 2, currentStep: 1, sources: ["Recognising Deterioration Notes"] });
  });

  it("the landing: three sessions, topics by subject, recently added with a real status", async () => {
    const { db, materials } = world();
    const l = await learnLanding(db, ME, materials);
    expect(l.sessions).toHaveLength(2);
    expect(l.topicTotal).toBe(3);
    expect(l.recent).toHaveLength(4);
    expect(l.recent![0].status).toBe("Ready");
    const t = await topicDetail(db, ME, "oxygen therapy", 2, materials);
    expect(t && t !== "unreadable" && t.sections.length).toBe(PAGE_SIZE);
  });

  it("ISOLATION: nothing of another person's reaches the search, the landing or a topic", async () => {
    const { db, materials } = world();
    for (const q of [{ q: "secretother" }, { q: "sepsis" }, { tab: "sessions" }, { tab: "documents" }, { q: "sepsis", tab: "sections" }]) {
      expect(leaked(await searchLibrary(db, ME, parseSearchParams(q), materials))).toBe(false);
    }
    expect(leaked(await learnLanding(db, ME, materials))).toBe(false);
    expect(leaked(await topicDetail(db, ME, "sepsis recognition", 1, materials))).toBe(false);
  });

  it("PLANTED CONTROL: drop the owner filter and the isolation check goes RED", async () => {
    const { db, materials } = world({ ignoreOwner: true });
    expect(leaked(await searchLibrary(db, ME, parseSearchParams({ q: "secretother" }), materials))).toBe(true);
    expect(leaked(await searchLibrary(db, ME, parseSearchParams({ tab: "sessions" }), materials))).toBe(true);
  });
});

describe("no AI on the search path (owner s8)", () => {
  const files = ["src/lib/individual/scholar/learn-search.ts", "src/app/individual/(app)/[experience]/(scholar)/study/_components/learn-landing.tsx", "src/app/individual/(app)/[experience]/(scholar)/study/_components/learn-search-client.tsx"];
  const AI = /from "[^"]*(\/generation|\/ai-runner|metered|\/lib\/ai\/|exam-research|learn-research)[^"]*"|\bgenerate\(|runMeteredAi|aiPreflight|scholarAiRunner/;
  it("the search, landing and selection code import no AI path", () => {
    for (const f of files) expect(AI.test(readFileSync(f, "utf8")), f).toBe(false);
  });
  it("planted: an AI import is caught", () => {
    expect(AI.test(`import { generate } from "@/lib/ai/gateway";`)).toBe(true);
  });
});
