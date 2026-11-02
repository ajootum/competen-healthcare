// ── THE PATIENT VOICE, AS A CASE AUTHOR WRITES IT ── SCHOLAR-CE-2026 CE-04 ─────────────────────────────────────────
//
// Types and the validator only. No import of the blueprint, so blueprint.ts can validate a voice without a cycle.
// What the voice may SAY at a moment is conversation.ts (permittedKnowledge); this file is only its shape.

export const CONVERSATION_SCHEMA_LIMITS = { persona: 600, style: 400, statement: 300, statements: 30, keyQuestions: 12, terms: 10, notKnown: 200 } as const;

/** Who the voice is. */
export type VoiceSpeaker = "patient" | "caregiver";
/** A thing the persona knows that is not a governed finding (how they feel, home life), from "start" or a stage once reached. */
export type VoiceStatement = { id: string; text: string; from: string };
/** A question a good history asks. `terms`: the words that show it was asked. Server-side only. */
export type KeyQuestion = { id: string; label: string; terms: string[] };
/** The persona the AI voices, defined by the case author and approved with the exact version. */
export type PatientVoice = {
  speaker: VoiceSpeaker;
  persona: string;             // who they are, in the author's words
  style: string;               // how they speak
  knowsFactIds: string[];      // the governed findings they can speak to, once the learner has been shown them
  knowsStatements: VoiceStatement[];
  keyQuestions: KeyQuestion[];
  notKnownReply?: string | null;
};

const ID = /^[a-z][a-z0-9_-]{0,30}$/;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Pure: problems with a voice as an author wrote it. Empty when sound. `factIds` and `stageIds` are the blueprint's. */
export function voiceProblems(v: unknown, factIds: ReadonlySet<string>, stageIds: ReadonlySet<string>): string[] {
  const p: string[] = [];
  const o = v as PatientVoice | null | undefined;
  if (!o || typeof o !== "object") return ["voice: the persona is required"];
  const L = CONVERSATION_SCHEMA_LIMITS;
  if (o.speaker !== "patient" && o.speaker !== "caregiver") p.push("voice: the speaker is the patient or a caregiver");
  if (!text(o.persona, L.persona)) p.push(`voice: a persona (up to ${L.persona} characters)`);
  if (!text(o.style, L.style)) p.push(`voice: a speaking style (up to ${L.style} characters)`);
  const kf = Array.isArray(o.knowsFactIds) ? o.knowsFactIds : [];
  if (!Array.isArray(o.knowsFactIds) && o.knowsFactIds !== undefined) p.push("voice: knowsFactIds is a list");
  for (const f of kf) if (!factIds.has(f)) p.push(`voice: knows unknown fact ${f}`);
  const ks = Array.isArray(o.knowsStatements) ? o.knowsStatements : [];
  if (ks.length > L.statements) p.push(`voice: at most ${L.statements} statements`);
  const seen = new Set<string>();
  for (const s of ks) {
    if (!s || !ID.test(s.id ?? "") || seen.has(s.id)) p.push("voice: every statement needs its own id");
    else seen.add(s.id);
    if (!text(s?.text, L.statement)) p.push(`voice: statement ${s?.id ?? "?"} needs its text (up to ${L.statement} characters)`);
    if (s?.from !== "start" && !stageIds.has(s?.from)) p.push(`voice: statement ${s?.id ?? "?"} is known from "start" or a known stage`);
  }
  const kq = Array.isArray(o.keyQuestions) ? o.keyQuestions : [];
  if (kq.length > L.keyQuestions) p.push(`voice: at most ${L.keyQuestions} key questions`);
  const kseen = new Set<string>();
  for (const q of kq) {
    if (!q || !ID.test(q.id ?? "") || kseen.has(q.id)) p.push("voice: every key question needs its own id");
    else kseen.add(q.id);
    if (!text(q?.label, 160)) p.push(`voice: key question ${q?.id ?? "?"} needs a label`);
    if (!Array.isArray(q?.terms) || !q.terms.length || q.terms.length > L.terms || !q.terms.every((t: unknown) => text(t, 60))) p.push(`voice: key question ${q?.id ?? "?"} needs 1 to ${L.terms} short terms`);
  }
  if (o.notKnownReply != null && !text(o.notKnownReply, L.notKnown)) p.push(`voice: the "I don't know" reply, when given, up to ${L.notKnown} characters`);
  return p;
}

/** Said to the learner BEFORE the first question (owner ruling 2 Nov 2026, CE-04 condition 7). Shown in the panel as a header line. */
export const CONVERSATION_RECORDED_NOTICE = "This conversation is recorded with your case attempt so you can review it and get feedback. It is not used as Personal AI memory.";
/** One line at the input (condition 9). The question is also screened for patient identifiers on the server before it is sent anywhere. */
export const CONVERSATION_PRIVACY_NOTE = "This is a simulated patient. Do not enter real patient names or identifiers.";
