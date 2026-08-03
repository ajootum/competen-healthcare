import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { searchPatients } from "@/lib/practice/patients";
import { logAccess } from "@/lib/practice/privacy";

// CPR-350 SEARCH AND GLOBAL RETRIEVAL.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SEARCH IS THE EASIEST PLACE IN A PRODUCT TO ACCIDENTALLY GRANT ACCESS, and this file is written
// around that. Three rules, in order of how badly they bite:
//
// 1. THE CAPABILITY FILTER RUNS BEFORE THE QUERY, NOT AFTER IT. A domain the caller cannot see is never
//    queried at all -- not queried and then filtered, not queried and then hidden behind a "3 more
//    results" affordance. Filtering after the fact is how a total count leaks the existence of records
//    somebody may not know about, which for a clinical record is the whole game: "2 results hidden" for
//    a public figure's name is a disclosure on its own.
//
// 2. EVERY RESULT CARRIES THE WORKSPACE FILTER ITSELF. Not inherited, not assumed from an earlier join.
//    Nine queries, nine explicit workspace filters.
//
// 3. WHAT WAS NOT SEARCHED IS REPORTED. Same doctrine as the operations home: "no results" and "no
//    results in the half of the product you can see" are different sentences, and a search box that
//    conflates them tells somebody a patient has no letters when it simply could not look.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// THERE IS NO CROSS-DOMAIN RELEVANCE SCORE, AND THAT IS DELIBERATE. Ranking a patient against a task
// against a SOAP segment requires weights, and there is no basis for those weights -- any number chosen
// would be somebody's guess presented as an ordering. So results are GROUPED BY WHAT THEY ARE, each
// group ordered by a rule that makes sense for that group alone: patients by the identity ranking
// migration 193 already built, everything else by recency. A blended list would look more sophisticated
// and would be less honest.
//
// PATIENTS ARE SEARCHED THROUGH patients.ts, NOT HERE. That module ranks identifier-exact above
// phone-exact above name, which is identity semantics rather than text relevance. Reimplementing it
// with a tsvector would give two answers to "find this person" and the wrong one would win.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SearchDomain =
  | "patients" | "encounters" | "notes" | "diagnoses" | "problems"
  | "treatments" | "procedures" | "documents" | "followUps" | "tasks"
  | "threads" | "contacts" | "incoming";

export type SearchHit = {
  id: string;
  label: string;
  detail?: string | null;
  href: string;
  when?: string | null;
  patientId?: string | null;
};

export type SearchGroup = {
  domain: SearchDomain;
  title: string;
  /** What this group holds, in the words a practitioner would use. */
  note: string;
  hits: SearchHit[];
  /** True when the group was cut at the limit, so "12 of many" is never rendered as "12". */
  truncated: boolean;
};

/**
 * Turn user input into a tsquery, safely.
 *
 * EVERYTHING THAT IS NOT A LETTER, DIGIT OR SPACE IS DISCARDED. tsquery has its own operators (& | ! : *)
 * and a raw string reaching to_tsquery is both a syntax error waiting to happen and a place to try
 * something clever. Sanitising to an allowlist is the only version of this that stays safe when
 * somebody pastes a sentence with an apostrophe in it.
 *
 * Each term gets `:*` so typing "diab" finds "diabetes" -- a search box that only matches whole words
 * feels broken long before anyone works out why.
 */
export function toTsQuery(raw: string): string | null {
  const terms = raw
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(t => t.length > 0)
    .slice(0, 8); // A query with fifty terms is a paste accident, not a search.
  if (terms.length === 0) return null;
  return terms.map(t => `${t}:*`).join(" & ");
}

const TRUNCATE_AT = 10;

/**
 * Search everything the caller may see.
 *
 * Returns groups in a fixed order (clinical before operational) plus `notSearched`, which names the
 * domains that were skipped for want of a capability. `total` counts only what was actually returned;
 * there is no hidden count, because a hidden count is a disclosure.
 */
export async function searchPractice(admin: any, ctx: WorkspaceContext, rawQuery: string, opts: {
  domains?: SearchDomain[];
} = {}) {
  const query = toTsQuery(rawQuery);
  const trimmed = rawQuery.trim();
  if (!query) {
    return { query: trimmed, groups: [] as SearchGroup[], notSearched: [] as string[], total: 0, ran: false };
  }

  const can = (c: string) => hasCapability(ctx, c);
  const wanted = (d: SearchDomain) => !opts.domains || opts.domains.includes(d);

  // RULE 1: the gate is evaluated here, and a domain that fails it is never queried.
  const allowed: Record<SearchDomain, boolean> = {
    patients: can("patient.list"),
    encounters: can("encounter.list"),
    notes: can("encounter.list"),
    diagnoses: can("encounter.list"),
    problems: can("encounter.list"),
    treatments: can("encounter.list"),
    procedures: can("encounter.list"),
    documents: can("document.view"),
    followUps: can("followup.view"),
    tasks: can("task.view"),
    threads: can("message.use"),
    // The contact log is a patient-facing record, so it rides on the patient gate; the incoming
    // register rides on the capability that lets somebody work it.
    contacts: can("patient.list"),
    incoming: can("inbox.record"),
  };

  const ws = ctx.workspaceId;
  const text = (table: string, columns: string, order: string) =>
    admin.from(table).select(columns)
      .eq("workspace_id", ws)                       // RULE 2: every query, explicitly.
      .textSearch("search_vector", query)
      .order(order, { ascending: false })
      .limit(TRUNCATE_AT + 1);                      // One over, so truncation is knowable.

  const run = <T,>(domain: SearchDomain, fn: () => Promise<T>): Promise<T | null> =>
    allowed[domain] && wanted(domain) ? fn() : Promise.resolve(null);

  const [patients, encounters, notes, diagnoses, problems, treatments, procedures, documents, followUps, tasks, threads, contacts, incoming] =
    await Promise.all([
      run("patients", () => searchPatients(admin, ws, trimmed, TRUNCATE_AT + 1)),
      run("encounters", () => text("practice_encounter", "id, patient_id, reason_for_visit, status, started_at", "started_at")),
      run("notes", () => text("practice_encounter_note", "id, encounter_id, note_type, body, updated_at", "updated_at")),
      run("diagnoses", () => text("practice_diagnosis", "id, encounter_id, patient_id, label, code, certainty, created_at", "created_at")),
      run("problems", () => text("practice_problem", "id, patient_id, label, status, created_at", "created_at")),
      run("treatments", () => text("practice_treatment", "id, encounter_id, patient_id, label, treatment_type, created_at", "created_at")),
      run("procedures", () => text("practice_procedure", "id, encounter_id, patient_id, label, site, laterality, performed_at", "performed_at")),
      run("documents", () => text("practice_clinical_document", "id, patient_id, title, doc_type, status, created_at", "created_at")),
      run("followUps", () => text("practice_follow_up", "id, patient_id, reason, status, due_on, created_at", "created_at")),
      run("tasks", () => text("practice_task", "id, title, detail, status, due_on, patient_id, created_at", "created_at")),
      // Threads are one group fed by two queries: the key word is sometimes only in the subject line
      // and sometimes only in a message body, and a search that reads just one of them misses half the
      // conversations it should find.
      run("threads", async () => {
        const [bySubject, byBody] = await Promise.all([
          text("practice_thread", "id, subject, patient_id, last_message_at", "last_message_at"),
          text("practice_thread_message", "id, thread_id, body, created_at", "created_at"),
        ]);
        return { subjects: (bySubject as any).data ?? [], messages: (byBody as any).data ?? [] };
      }),
      run("contacts", () => text("practice_contact_log", "id, patient_id, channel, direction, outcome, summary, occurred_at", "occurred_at")),
      run("incoming", () => text("practice_incoming_document", "id, patient_id, doc_type, source, title, status, received_on, created_at", "created_at")),
    ]);

  // Three shapes arrive here: a PostgREST response ({data}), the patient engine's own ({results}), and
  // null for "not searched". Normalised once rather than at every call site.
  const rowsOf = (r: any): any[] => {
    if (r === null || r === undefined) return [];
    if (Array.isArray(r)) return r;
    return r.data ?? r.results ?? [];
  };
  const groups: SearchGroup[] = [];

  const push = (domain: SearchDomain, title: string, note: string, raw: any, map: (r: any) => SearchHit) => {
    if (raw === null) return;                       // Not searched. Absent, not empty.
    const rows = rowsOf(raw);
    if (rows.length === 0) return;
    const truncated = rows.length > TRUNCATE_AT;
    groups.push({ domain, title, note, hits: rows.slice(0, TRUNCATE_AT).map(map), truncated });
  };

  // Names for every patient referenced by a clinical hit, in one query rather than one per row.
  const referenced = [
    ...rowsOf(encounters).map(r => r.patient_id), ...rowsOf(diagnoses).map(r => r.patient_id),
    ...rowsOf(problems).map(r => r.patient_id), ...rowsOf(treatments).map(r => r.patient_id),
    ...rowsOf(procedures).map(r => r.patient_id), ...rowsOf(documents).map(r => r.patient_id),
    ...rowsOf(followUps).map(r => r.patient_id), ...rowsOf(tasks).map(r => r.patient_id),
    ...rowsOf(contacts).map(r => r.patient_id), ...rowsOf(incoming).map(r => r.patient_id),
  ].filter(Boolean);
  const { data: names } = referenced.length
    ? await admin.from("practice_patient").select("id, display_name").eq("workspace_id", ws).in("id", [...new Set(referenced)])
    : { data: [] };
  const nameOf = (id: string | null) =>
    id ? (((names ?? []) as any[]).find(p => p.id === id)?.display_name ?? "Unknown patient") : null;

  // A NOTE'S PATIENT NEEDS ITS ENCOUNTER. Resolved rather than dropped: a matching SOAP segment with no
  // name beside it is a result nobody can act on.
  const noteEncounterIds = [...new Set(rowsOf(notes).map(r => r.encounter_id))];
  const { data: noteEncounters } = noteEncounterIds.length
    ? await admin.from("practice_encounter").select("id, patient_id, started_at").eq("workspace_id", ws).in("id", noteEncounterIds)
    : { data: [] };
  const noteEnc = new Map(((noteEncounters ?? []) as any[]).map(e => [e.id, e]));
  const noteNames = [...new Set(((noteEncounters ?? []) as any[]).map(e => e.patient_id))];
  const { data: notePatients } = noteNames.length
    ? await admin.from("practice_patient").select("id, display_name").eq("workspace_id", ws).in("id", noteNames)
    : { data: [] };
  const notePatientName = (encounterId: string) => {
    const enc = noteEnc.get(encounterId);
    return enc ? (((notePatients ?? []) as any[]).find(p => p.id === enc.patient_id)?.display_name ?? "Unknown patient") : "Unknown patient";
  };

  // The patient engine returns its own camelCase shape and its own `matchedBy`, which is the ranking
  // reason -- worth showing, because "matched on identifier" and "matched on part of a name" are
  // different degrees of certainty about whether this is the right person.
  push("patients", "Patients", "Matched by identifier, phone or name, in that order of confidence.",
    patients, (p: any) => ({
      id: p.id, label: p.displayName,
      detail: [p.matchedBy, p.practiceId, p.birthDate].filter(Boolean).join(" · ") || null,
      href: `/practice/patients/${p.id}`, when: null, patientId: p.id,
    }));

  push("notes", "Consultation notes", "Matched inside a SOAP segment.",
    notes, (n: any) => ({
      id: n.id, label: notePatientName(n.encounter_id),
      detail: `${n.note_type}: ${excerpt(n.body)}`,
      href: `/practice/encounters/${n.encounter_id}`, when: n.updated_at,
    }));

  push("diagnoses", "Diagnoses", "Recorded at a consultation.",
    diagnoses, (d: any) => ({
      id: d.id, label: d.label,
      detail: `${nameOf(d.patient_id)} · ${d.certainty}${d.code ? ` · ${d.code}` : ""}`,
      href: `/practice/encounters/${d.encounter_id}`, when: d.created_at, patientId: d.patient_id,
    }));

  push("problems", "Problem list", "Longitudinal problems, which span visits.",
    problems, (p: any) => ({
      id: p.id, label: p.label, detail: `${nameOf(p.patient_id)} · ${p.status}`,
      href: `/practice/patients/${p.patient_id}`, when: p.created_at, patientId: p.patient_id,
    }));

  push("encounters", "Consultations", "Matched on the reason for the visit.",
    encounters, (e: any) => ({
      id: e.id, label: nameOf(e.patient_id) ?? "Unknown patient",
      detail: `${e.reason_for_visit ?? ""} · ${e.status}`,
      href: `/practice/encounters/${e.id}`, when: e.started_at, patientId: e.patient_id,
    }));

  push("treatments", "Treatment and plans", "What was prescribed or planned, not what was done.",
    treatments, (t: any) => ({
      id: t.id, label: t.label, detail: `${nameOf(t.patient_id)} · ${t.treatment_type}`,
      href: `/practice/encounters/${t.encounter_id}`, when: t.created_at, patientId: t.patient_id,
    }));

  push("procedures", "Procedures performed", "What was actually done.",
    procedures, (p: any) => ({
      id: p.id, label: p.label,
      detail: [nameOf(p.patient_id), p.site, p.laterality !== "not_applicable" ? p.laterality : null].filter(Boolean).join(" · "),
      href: `/practice/encounters/${p.encounter_id}`, when: p.performed_at, patientId: p.patient_id,
    }));

  push("documents", "Documents", "Letters, certificates and summaries.",
    documents, (d: any) => ({
      id: d.id, label: d.title, detail: `${nameOf(d.patient_id)} · ${d.status.toLowerCase()}`,
      href: `/practice/documents/${d.id}`, when: d.created_at, patientId: d.patient_id,
    }));

  push("followUps", "Follow-ups", "Commitments to see somebody again.",
    followUps, (f: any) => ({
      id: f.id, label: f.reason, detail: `${nameOf(f.patient_id)} · due ${f.due_on} · ${f.status.toLowerCase()}`,
      href: "/practice/follow-ups", when: f.created_at, patientId: f.patient_id,
    }));

  push("tasks", "Tasks", "Operational work.",
    tasks, (t: any) => ({
      id: t.id, label: t.title,
      detail: [t.detail ? excerpt(t.detail) : null, nameOf(t.patient_id), t.status.toLowerCase()].filter(Boolean).join(" · "),
      href: "/practice/tasks", when: t.created_at, patientId: t.patient_id,
    }));

  // Threads: merge the subject hits and the message hits into ONE row per conversation. Two entries for
  // the same thread -- one saying the subject matched, one saying a message did -- reads as two
  // conversations, and the person searching wants the conversation, not the mechanics of the match.
  if (threads !== null) {
    const t = threads as any;
    const messageThreadIds = [...new Set((t.messages as any[]).map(m => m.thread_id))];
    const missing = messageThreadIds.filter(id => !(t.subjects as any[]).some(s => s.id === id));
    const { data: extraThreads } = missing.length
      ? await admin.from("practice_thread").select("id, subject, patient_id, last_message_at").eq("workspace_id", ws).in("id", missing)
      : { data: [] };
    const allThreads = new Map<string, any>(
      [...(t.subjects as any[]), ...((extraThreads ?? []) as any[])].map(row => [row.id, row]),
    );
    const bodyByThread = new Map<string, string>();
    for (const m of t.messages as any[]) if (!bodyByThread.has(m.thread_id)) bodyByThread.set(m.thread_id, m.body);

    const rows = [...allThreads.values()]
      .sort((x, y) => String(y.last_message_at).localeCompare(String(x.last_message_at)));
    if (rows.length > 0) {
      groups.push({
        domain: "threads", title: "Messages", note: "Conversations inside this practice. Nothing here was sent outside it.",
        hits: rows.slice(0, TRUNCATE_AT).map(row => ({
          id: row.id, label: row.subject,
          detail: bodyByThread.has(row.id) ? excerpt(bodyByThread.get(row.id)!) : "subject matched",
          href: `/practice/messages/${row.id}`, when: row.last_message_at, patientId: row.patient_id ?? null,
        })),
        truncated: rows.length > TRUNCATE_AT,
      });
    }
  }

  push("contacts", "Patient contacts", "Calls and conversations that happened in the world, recorded here.",
    contacts, (c: any) => ({
      id: c.id, label: nameOf(c.patient_id) ?? "Unknown patient",
      detail: `${c.channel.replace(/_/g, " ")} · ${c.outcome.replace(/_/g, " ")} · ${excerpt(c.summary, 100)}`,
      href: `/practice/patients/${c.patient_id}`, when: c.occurred_at, patientId: c.patient_id,
    }));

  push("incoming", "Received documents", "What arrived at the practice, and whether anybody has looked.",
    incoming, (d: any) => ({
      id: d.id, label: d.title,
      detail: [nameOf(d.patient_id), d.source, d.status.toLowerCase()].filter(Boolean).join(" · "),
      href: "/practice/inbox", when: d.created_at, patientId: d.patient_id,
    }));

  // CPR-370. A SEARCH IS A READ ACROSS THE WHOLE PRACTICE, and the term itself is the interesting part:
  // "who searched for this surname" is exactly the question an access review needs to answer. Logged
  // once per search that actually ran, never for an empty query.
  await logAccess(admin, {
    workspaceId: ws, actorId: ctx.userId, subjectKind: "search", action: "search",
    route: "/practice/search", detail: trimmed,
  });

  // RULE 3: name what was skipped, so an empty page can say why it is empty.
  const LABELS: Record<string, string> = {
    patients: "patients", encounters: "consultations and everything in them",
    documents: "documents", followUps: "follow-ups", tasks: "tasks",
  };
  const notSearched: string[] = [];
  if (!allowed.patients) notSearched.push(LABELS.patients);
  if (!allowed.encounters) notSearched.push(LABELS.encounters);
  if (!allowed.documents) notSearched.push(LABELS.documents);
  if (!allowed.followUps) notSearched.push(LABELS.followUps);
  if (!allowed.tasks) notSearched.push(LABELS.tasks);
  if (!allowed.threads) notSearched.push("messages");
  if (!allowed.contacts) notSearched.push("the patient contact log");
  if (!allowed.incoming) notSearched.push("received documents");

  return {
    query: trimmed,
    groups,
    notSearched,
    total: groups.reduce((n, g) => n + g.hits.length, 0),
    ran: true,
  };
}

/** A window of the matching text. Not highlighted -- see the note in the search page. */
function excerpt(body: string | null, length = 140): string {
  const flat = String(body ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= length ? flat : `${flat.slice(0, length)}...`;
}

/**
 * What this practitioner touched most recently, for the empty state of the search page.
 *
 * GLOBAL RETRIEVAL IS NOT ONLY SEARCH. The commonest reason to open a search box is to get back to
 * something you had five minutes ago, and typing its name is the slow way to do that.
 */
export async function recentlyTouched(admin: any, ctx: WorkspaceContext, limit = 6) {
  const ws = ctx.workspaceId;
  const [{ data: encounters }, { data: patients }] = await Promise.all([
    hasCapability(ctx, "encounter.list")
      ? admin.from("practice_encounter").select("id, patient_id, reason_for_visit, status, started_at")
        .eq("workspace_id", ws).order("started_at", { ascending: false }).limit(limit)
      : Promise.resolve({ data: [] }),
    hasCapability(ctx, "patient.list")
      ? admin.from("practice_patient").select("id, display_name, created_at")
        .eq("workspace_id", ws).eq("status", "active").order("created_at", { ascending: false }).limit(limit)
      : Promise.resolve({ data: [] }),
  ]);

  const ids = [...new Set(((encounters ?? []) as any[]).map(e => e.patient_id))];
  const { data: names } = ids.length
    ? await admin.from("practice_patient").select("id, display_name").eq("workspace_id", ws).in("id", ids)
    : { data: [] };

  return {
    encounters: ((encounters ?? []) as any[]).map(e => ({
      ...e, patient_name: ((names ?? []) as any[]).find(p => p.id === e.patient_id)?.display_name ?? "Unknown patient",
    })),
    patients: (patients ?? []) as any[],
  };
}
