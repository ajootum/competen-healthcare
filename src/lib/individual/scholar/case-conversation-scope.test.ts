import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONVERSATION_PRIVACY_NOTE, CONVERSATION_RECORDED_NOTICE } from "@/lib/cases/voice";

// SCHOLAR-CE-2026 CE-04, owner ruling 2 Nov 2026: the D10 exception is NARROW. Simulated-patient turns belong to one
// learner attempt and one stage, are shown in that attempt's debrief and used for feedback on that same attempt, and
// are NEVER Personal AI memory or context for another activity. This is a static scope test: it reads the source, so a
// later change that reads the table from anywhere else, or from a Personal AI / study-session / learn module, goes red.

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p.replace(/\\/g, "/")]; });
}
const SRC = walk("src").filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const IDENT = /individual_scholar_case_conversation|listCaseConversation|insertCaseConversation/;
const users = SRC.filter(f => IDENT.test(read(f)));
// The ONLY non-test files that may touch the table or its store functions: the store (the one Scholar write site), the case
// conversation module (this attempt's turns), and the attempt record builder (copies THIS attempt's turns into its own record).
const ALLOWED = ["src/lib/individual/scholar/store.ts", "src/lib/individual/scholar/case-talk.ts", "src/lib/individual/scholar/case-integrity.ts"];

describe("the D10 exception: who may touch the case conversation records", () => {
  it("only the store, the case conversation module and the attempt record builder reference them", () => {
    expect(users.sort()).toEqual([...ALLOWED].sort());
  });
  it("no Personal AI, assistant, ask, learn, study-session or context module references them, by name or by import", () => {
    const personal = SRC.filter(f => /(^|\/)(ask|assistant|personal-ai|copilot|learn|study-session|session-context|study-context|memory)[^/]*$|\/api\/individual\/(assistant|scholar\/(ask|learn|personal))/i.test(f));
    expect(personal.length).toBeGreaterThan(3); // the filter finds real modules, so an empty match cannot pass this test
    for (const f of personal) {
      const s = read(f);
      expect(IDENT.test(s), f).toBe(false);
      expect(/from "[^"]*(case-talk|case-integrity)"/.test(s), `${f} imports the case conversation module`).toBe(false);
    }
  });
  it("the case conversation module reads turns only for the ONE session it is working on", () => {
    const s = read("src/lib/individual/scholar/case-talk.ts");
    const calls = [...s.matchAll(/listCaseConversation\(([^)]*)\)/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    for (const c of calls) expect(c, c).toMatch(/\b(s|src)\.kind, (s|src)\.sessionId\b|\bkind, sessionId\b/);
    // Turns reach the AI only as the current stage's history and the same session's end-of-case note: never another session's.
    expect(s).toMatch(/const history = turns\.filter\(t => t\.stageId === stageId\)/);
  });
  it("the attempt record builder reads the conversation of the session it is keeping, and nothing else", () => {
    const s = read("src/lib/individual/scholar/case-integrity.ts");
    const calls = [...s.matchAll(/listCaseConversation\(([^)]*)\)/g)].map(m => m[1].trim());
    expect(calls).toEqual(["admin, userId, kind, sessionId"]);
  });
  it("the conversation never feeds an AI call outside case-talk: no other module passes turns to a generator", () => {
    for (const f of SRC) if (f !== "src/lib/individual/scholar/case-talk.ts") expect(/buildVoiceRequest|buildCommunicationNoteRequest/.test(read(f)) && !/src\/lib\/cases\/conversation\.ts$/.test(f) && !/case-talk/.test(f) ? f : null, f).toBeNull();
  });
});

describe("the learner is told before the first turn, and warned at the input", () => {
  it("the panel shows the recorded-with-your-attempt notice above the input, and the privacy line at the input", () => {
    expect(CONVERSATION_RECORDED_NOTICE).toBe("This conversation is recorded with your case attempt so you can review it and get feedback. It is not used as Personal AI memory.");
    expect(CONVERSATION_PRIVACY_NOTE).toBe("This is a simulated patient. Do not enter real patient names or identifiers.");
    const s = read("src/app/individual/(app)/[experience]/(scholar)/study/_components/case-talk-client.tsx");
    expect(s.indexOf("{CONVERSATION_RECORDED_NOTICE}")).toBeGreaterThan(0);
    expect(s.indexOf("{CONVERSATION_RECORDED_NOTICE}")).toBeLessThan(s.indexOf('id="talk-q"'));
    expect(s).toMatch(/\{CONVERSATION_PRIVACY_NOTE\}/);
  });
  it("the question is screened for patient identifiers on the server before any AI call", () => {
    const s = read("src/lib/individual/scholar/case-talk.ts");
    expect(s.indexOf("findPatientIdentifiers(q.question)")).toBeGreaterThan(0);
    expect(s.indexOf("findPatientIdentifiers(q.question)")).toBeLessThan(s.indexOf("runner.run("));
  });
});

describe("the debrief shows the saved conversation, and erasure covers it", () => {
  it("a finished case mounts the saved conversation in the debrief", () => {
    const s = read("src/app/individual/(app)/[experience]/(scholar)/study/_components/case-client.tsx");
    expect(s).toMatch(/v\.talk && play\.status !== "active" && <CaseConversation base=\{base\} speaker=\{v\.talk\.speaker\} active=\{false\} \/>/);
  });
  it("the Scholar erase-all calls the conversation erase, and its UI says it, subject to retention", () => {
    expect(read("src/lib/individual/scholar/store.ts")).toMatch(/rpc\("individual_scholar_case_conversation_erase", \{ p_user: userId \}\)[\s\S]*fine\(cvErr\)/);
    expect(read("src/app/individual/(app)/[experience]/(scholar)/study/_components/client.tsx")).toMatch(/practice conversations with simulated patients, subject to applicable retention obligations/);
  });
});

// The migration is authored and untracked until staging verifies it, so a clean checkout does not have it: these run where it is.
const MIG = "supabase/migrations/880-individual-scholar-case-conversation.sql";
describe.skipIf(!existsSync(MIG))("migration 880: attempt, stage, cascade, append-only, erase", () => {
  const sql = existsSync(MIG) ? read(MIG) : "";
  const code = sql.replace(/--.*$/gm, "");
  it("a turn is tied to ONE learner attempt (session, same learner) and one stage that the session has reached", () => {
    expect(code).toMatch(/foreign key \(private_session_id, user_id\)\s+references individual_scholar_case_session\(id, user_id\) on delete cascade/);
    expect(code).toMatch(/library_session_id\s+uuid references case_library_session\(id\) on delete cascade/);
    expect(code).toMatch(/entry_kind = 'turn'\s+and stage_id is not null/);
    expect(code).toMatch(/sess_reached @> to_jsonb\(new\.stage_id\)/);
    expect(code).toMatch(/s\.user_id = new\.user_id/);
  });
  it("deleting the attempt deletes its conversation: both foreign keys cascade and the guard allows the cascade path", () => {
    expect(code).toMatch(/if pg_trigger_depth\(\) > 1 or coalesce\(current_setting\('competen\.case_conversation_erase', true\), ''\) = 'on' then\s+return old;/);
  });
  it("UPDATE is always refused, so a kept transcript is never rewritten", () => {
    expect(code).toMatch(/if tg_op = 'UPDATE' then\s+raise exception/);
    expect(code).toMatch(/before insert or update or delete on individual_scholar_case_conversation/);
  });
  it("the erase function is server-role only", () => {
    expect(code).toMatch(/revoke execute on function public\.individual_scholar_case_conversation_erase\(uuid\) from public, anon, authenticated/);
    expect(code).toMatch(/grant execute on function public\.individual_scholar_case_conversation_erase\(uuid\) to service_role/);
  });
});
