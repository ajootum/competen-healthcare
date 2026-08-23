import type { AttentionItem, AttentionKind } from "@/lib/practice/operations-home";

// CPR-CORE-001 CORE-12: THE DERIVED BRIEF, WITH SOURCE REFERENCES.
//
// s7's feeder matrix, Today's Brief: "prioritised actionable sentences with source links", key rule
// "Label DERIVED; no unsupported prediction".
// s3: "Derived data is labelled: derived briefs and aggregates must disclose WHEN THEY WERE CALCULATED
//      and WHAT SOURCE RECORDS WERE USED."
// s11's read model: `"brief": {"status":"derived","items":[],"source_refs":[]}`.
// s16: "No AI statement appears without authorised source data and a traceable basis."
//
// ── WHAT WAS MISSING, AND WHY IT MATTERED ───────────────────────────────────────────────────────────
//
// The brief already existed and was already honest: derived from the diary, follow-ups, inbox and
// documents, never written by a model, and badged "Derived" on the page. Three of s3's four requirements
// were met by a word in the JSX.
//
// The fourth was not. A reader could see THAT it was derived and not WHAT FROM. "3 follow-ups are
// overdue" was a sentence you had to take on trust -- and a sentence you cannot check is the same shape
// as a sentence a model invented, which is precisely the distinction s16 exists to keep visible.
//
// ⚠ THE LABEL IS A FIELD, NOT PAGE TEXT. `status: "derived"` travels in the payload, so /api/v1/practice/
// dashboard carries it too and a second surface cannot render the same sentences without it. A badge in
// one component's JSX is a promise only that component keeps.
//
// ⚠ SOURCE REFERENCES ARE STABLE IDENTIFIERS, NEVER NAMES. s13: "patient data must not be returned
// solely by human-readable name; use stable identifiers." A source ref is `table` plus `id` -- enough to
// find the row, and not enough to be a disclosure in itself. The human-readable label stays where it
// already was, on the sample the practitioner clicks.
//
// ⚠ NO PREDICTION, AND THE HARNESS CHECKS THE WORDING. s7's key rule is "no unsupported prediction". A
// brief that said "you will run 20 minutes late" would need a model this service does not have, and
// every sentence here is the length of a list that exists right now.

/** Which table each kind of attention was computed from. Declared, because a source reference that
 *  guesses its own table is not a reference. */
const SOURCE_TABLE: Record<AttentionKind, string> = {
  followup_overdue: "practice_follow_up",
  followup_due_soon: "practice_follow_up",
  encounter_unsigned: "practice_encounter",
  encounter_live: "practice_encounter",
  clinic_remaining: "practice_appointment",
  queue_waiting: "practice_queue_entry",
  document_unissued: "practice_clinical_document",
  consent_not_recorded: "practice_procedure",
  notification_unread: "practice_notification",
  task_overdue: "practice_task",
  task_due: "practice_task",
  task_orphaned: "practice_task",
  incoming_unreviewed: "practice_incoming_document",
  message_unread: "practice_thread",
};

export type SourceRef = { table: string; id: string };

export type BriefItem = {
  key: AttentionKind;
  severity: "critical" | "warning" | "normal";
  /** The actionable sentence, in the practitioner's words. */
  sentence: string;
  href: string;
  count: number;
  /**
   * The rows this sentence was computed from -- as many as the tile sampled, which is not necessarily
   * all of them. `count` is the true total; `sourceRefs` is what can be pointed at.
   */
  sourceRefs: SourceRef[];
  /** True when `count` exceeds the refs listed, so a reader knows the trace is partial rather than whole. */
  refsArePartial: boolean;
};

export type PracticeBrief = {
  /** s11's field. DERIVED means: computed from the rows below, by rules in this file, with no model. */
  status: "derived";
  /** s3: "must disclose WHEN they were calculated." */
  calculatedAt: string;
  items: BriefItem[];
  /** s11's `source_refs`: the union across every item, de-duplicated. */
  sourceRefs: SourceRef[];
  /** Domains the caller may not see. An empty brief that cannot say why is indistinguishable from calm. */
  blindSpots: string[];
  /** How this was produced, in one sentence, carried in the payload rather than written on a page. */
  method: string;
  /** True when nothing could be read at all. */
  unavailable: boolean;
};

const METHOD =
  "Counted from the practice's own diary, follow-ups, encounters, tasks, documents and incoming register " +
  "at the time shown. Rules only -- no model, no prediction, and no comparison against any other practice.";

/**
 * Turn the attention list into s11's brief.
 *
 * A PURE FUNCTION OVER ROWS ALREADY READ. It issues no query of its own: every sentence here is a
 * restatement of something `operationsHome` counted, so the brief cannot disagree with the tiles beside
 * it. A briefing service with its own reads would be a second answer to the same question, which is what
 * s16 forbids -- and it would drift only under load, which is the worst time to find out.
 */
export function practiceBrief(
  input: { attention: AttentionItem[]; blindSpots: string[]; allClear?: boolean; unreadable?: string[] },
  at: Date = new Date(),
): PracticeBrief {
  // ⚠ AN UNAVAILABLE CATEGORY IS NOT A BRIEF ITEM, AND IS NOT DROPPED EITHER. CPR-CC-MOB-001 s4 gave
  // an attention item a `status`, so a category whose read failed now arrives here with count null
  // instead of being absent. It must not become a brief sentence: the brief is a statement of what is
  // OWED, every item carries a count and source references, and "we could not look" has neither. It is
  // carried on `unreadable` instead -- the field this function already takes for exactly that idea, and
  // which the caller already populates by name.
  //
  // Filtering on status rather than on `count !== null` because the two say different things: one is
  // "this category could not be read", the other is a shape check that would also swallow a genuine
  // future bug where a ready item lost its number.
  const items: BriefItem[] = input.attention
    .filter(a => a.status === "ready" && typeof a.count === "number")
    .map(a => {
      const table = SOURCE_TABLE[a.kind] ?? "unknown";
      const sourceRefs = a.sample.map(s => ({ table, id: s.id }));
      const count = a.count as number;
      return {
        key: a.kind,
        severity: a.severity,
        // The tile's own title and detail, joined. NOT a new sentence: rewording it here would give the
        // brief and the tile two ways of saying one thing, and only one of them would get updated.
        sentence: a.detail ? `${a.title}. ${a.detail}` : a.title,
        href: a.href,
        count,
        sourceRefs,
        refsArePartial: count > sourceRefs.length,
      };
    });

  // De-duplicated across items: one overdue follow-up can be the reason for two sentences, and listing
  // its row twice would make the trace look longer than the evidence.
  const seen = new Set<string>();
  const sourceRefs: SourceRef[] = [];
  for (const i of items) {
    for (const r of i.sourceRefs) {
      const k = `${r.table}:${r.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      sourceRefs.push(r);
    }
  }

  return {
    status: "derived",
    calculatedAt: at.toISOString(),
    items,
    sourceRefs,
    blindSpots: input.blindSpots,
    method: METHOD,
    // THREE WAYS TO BE EMPTY, AND ONLY ONE OF THEM IS CALM. Nothing waiting is calm. Nothing VISIBLE is
    // a permissions answer. Nothing READ is a failure -- and reporting the third as the first tells a
    // practitioner their practice is quiet because a query timed out.
    unavailable: (input.unreadable?.length ?? 0) > 0 || (items.length === 0 && input.blindSpots.length > 0),
  };
}

/**
 * Words a derived brief may not use.
 *
 * ⚠ THIS IS A LIST OF CLAIMS, NOT A STYLE GUIDE. Each one needs a model, a baseline or a forecast that
 * this service does not have: s7 says "no unsupported prediction", s8 says "no comparison until a valid
 * baseline exists", and s16 says no statement without "a traceable basis". A sentence counting rows can
 * say what IS. The moment it says what WILL BE, or what is BETTER, it has stopped being derived.
 */
export const FORBIDDEN_IN_BRIEF = [
  "predict", "forecast", "expected to", "will likely", "likely to", "on track",
  "trend", "trending", "improving", "worsening", "better than", "worse than",
  "compared to", "benchmark", "average practice", "recommend", "suggests",
];
