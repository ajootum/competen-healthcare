import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/audit";
import { intelRange, overviewIntelligence } from "@/lib/practice/intelligence";
import { practiceToday } from "@/lib/practice/practice-time";
import { diagnosisReport } from "@/lib/practice/reports";
import { financialIntelligence } from "@/lib/practice/financial-intelligence";
import { piV2Extras } from "@/lib/practice/pi-v2";
import { metricById } from "@/lib/practice/intelligence-registry";
import { formatMinor } from "@/lib/practice/billing-constants";
import { investigationsOrdered } from "@/lib/practice/report-engine";

// CPR-PI-001 v2 s13 -- ASK PRACTICE, THE GROUNDED FLOW.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// GROUNDED MEANS THE NUMBERS NEVER COME FROM A MODEL. A question becomes an INTERPRETED SCOPE
// (period, condition, location -- shown back before the answer, s13 stage 2), the scope becomes a
// METRIC PLAN, and the plan calls THE SAME ENGINES every screen uses -- overviewIntelligence,
// followUpIntelligence, diagnosisReport, financialIntelligence, piV2Extras. This module computes
// nothing of its own except one registered aggregate (investigations by label), so an answer here
// can never disagree with the screen that owns the number.
//
// A QUESTION THIS PLANNER CANNOT GROUND IS REFUSED, WITH THE LIST OF WHAT IT CAN ANSWER. Guessing is
// the one thing s13 exists to prevent -- and "no record in CompetenPractice" is never phrased as
// "did not occur" (s13's own guardrail, repeated in every evidence footer).
//
// READ-ONLY (s13 stage 10's contract): the only write is the audit row recording user, question,
// interpreted scope, domains and metric versions -- which doubles as the recent-questions history,
// so no new table exists for a feature the audit trail already carries.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AskFigure = { label: string; value: string; of?: string | null; registryId: string };
export type AskEvidenceRow = { label: string; detail: string; href: string | null };
export type AskAnswer = {
  question: string;
  intent: string;
  /** s13 stage 2: the interpreted scope, displayed BEFORE/WITH the answer. */
  scope: { fromDay: string; toDay: string; periodLabel: string; condition: string | null; location: string | null };
  provenance: "Derived" | "Compared";
  answered: boolean;
  /** The concise grounded sentence -- or the refusal, which lists what CAN be asked. */
  sentence: string;
  figures: AskFigure[];
  evidence: { rows: AskEvidenceRow[]; total: number; identified: boolean; note: string; href: string } | null;
  registry: string[];
  /** s13 stage 8: this caller's recent questions, read back from the audit trail. */
  recent: { question: string; askedAt: string }[];
};

const EXAMPLES = [
  "How many patients did I see this month?",
  "Show patients overdue for follow-up",
  "What are my top 5 diagnoses?",
  "Which investigations do I order most?",
  "How much did I receive this month?",
];

/** "last 30 days" / "this month" / "last month" / "this year" -- else the range the page already holds. */
export function parseAskPeriod(question: string, todayDate: string, fallback: { fromDay: string; toDay: string }): {
  fromDay: string; toDay: string; periodLabel: string;
} {
  const q = question.toLowerCase();
  const today = Date.parse(todayDate + "T00:00:00Z");
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const lastN = q.match(/last\s+(\d{1,3})\s+days?/);
  if (lastN) {
    const n = Math.min(366, Math.max(1, Number(lastN[1])));
    return { fromDay: iso(today - n * 86400000), toDay: todayDate, periodLabel: `the last ${n} days` };
  }
  if (/this month/.test(q))
    return { fromDay: todayDate.slice(0, 8) + "01", toDay: todayDate, periodLabel: "this month so far" };
  if (/last month/.test(q)) {
    const first = new Date(Date.UTC(Number(todayDate.slice(0, 4)), Number(todayDate.slice(5, 7)) - 2, 1));
    const last = new Date(Date.UTC(Number(todayDate.slice(0, 4)), Number(todayDate.slice(5, 7)) - 1, 0));
    return { fromDay: first.toISOString().slice(0, 10), toDay: last.toISOString().slice(0, 10), periodLabel: "last month" };
  }
  if (/this year/.test(q))
    return { fromDay: todayDate.slice(0, 4) + "-01-01", toDay: todayDate, periodLabel: "this year so far" };
  return { ...fallback, periodLabel: `${fallback.fromDay} to ${fallback.toDay} (the page's selected period)` };
}

type Intent = "financial" | "overdue_followups" | "top_conditions" | "investigations" | "patients_seen" | "consultations" | "unknown";

export function parseAskIntent(question: string): Intent {
  const q = question.toLowerCase();
  // Money first: "how many invoices were paid" must not fall through to the consultation counter.
  if (/(charge|charged|collect|received|revenue|invoice|paid|owe|owed|money|settle)/.test(q)) return "financial";
  if (/(overdue|not\s+(yet\s+)?returned|missed).*(follow|review)|follow.?up.*(overdue|not\s+returned|missed)/.test(q)) return "overdue_followups";
  if (/(top|most\s+common|commonest|frequent).*(diagnos|condition)|diagnos(es|is)\b.*top/.test(q)) return "top_conditions";
  if (/investigation|(test|lab)s?\s+(do\s+)?i\s+order|order\s+most/.test(q)) return "investigations";
  if (/how\s+many\s+patients|patients\s+did\s+i\s+see|patients\s+seen/.test(q)) return "patients_seen";
  if (/how\s+many\s+(consultation|encounter|visit)|consultations?\s+did/.test(q)) return "consultations";
  return "unknown";
}

export async function askPractice(admin: any, ctx: WorkspaceContext, args: {
  question: string; fromDay: string; toDay: string; todayDate: string;
  actorId: string; correlationId: string;
}): Promise<AskAnswer> {
  const question = args.question.trim().slice(0, 300);
  const period = parseAskPeriod(question, args.todayDate, { fromDay: args.fromDay, toDay: args.toDay });
  const intent = parseAskIntent(question);

  // Location and condition scope: matched against what the practice actually has, never guessed.
  const { data: locs } = await admin.from("practice_location")
    .select("id, name").eq("workspace_id", ctx.workspaceId);
  const qLower = question.toLowerCase();
  const location = ((locs ?? []) as any[]).find(l => qLower.includes(String(l.name).toLowerCase())) ?? null;

  const range = await intelRange(admin, ctx.workspaceId, { fromDay: period.fromDay, toDay: period.toDay });
  const diagnoses = await diagnosisReport(admin, ctx, range.period);
  const condition = diagnoses.rows.find(r => qLower.includes(String(r.label).toLowerCase()))?.label ?? null;

  const scope = {
    fromDay: period.fromDay, toDay: period.toDay, periodLabel: period.periodLabel,
    condition, location: location ? String(location.name) : null,
  };

  let sentence = "";
  let answered = true;
  let figures: AskFigure[] = [];
  let evidence: AskAnswer["evidence"] = null;
  let registry: string[] = [];
  const domains: string[] = [];

  if (intent === "financial") {
    domains.push("billing");
    const fin = await financialIntelligence(admin, ctx, { fromDay: period.fromDay, toDay: period.toDay });
    if (!fin.available || !fin.data) {
      answered = false;
      sentence = fin.unavailableReason ?? "The financial figures could not be read.";
    } else if (fin.data.byCurrency.length === 0) {
      sentence = `No billing records exist for ${period.periodLabel}. The read succeeded -- this is a genuinely empty money picture, not a failure.`;
    } else {
      registry = ["fin.charged", "fin.collected", "fin.received"];
      const parts = fin.data.byCurrency.map(c =>
        `${formatMinor(c.charged.minor, c.currency)} charged, ${formatMinor(c.collected.minor, c.currency)} collected, ${formatMinor(c.received.minor, c.currency)} actually received by you`);
      sentence = `For ${period.periodLabel}: ${parts.join("; ")}. Collected is not received -- facility-collected money joins your figure only through a settlement.`;
      figures = fin.data.byCurrency.flatMap(c => [
        { label: `Charged (${c.currency})`, value: formatMinor(c.charged.minor, c.currency), of: `${c.charged.count} charges`, registryId: "fin.charged" },
        { label: `Received by you (${c.currency})`, value: formatMinor(c.received.minor, c.currency), of: `${formatMinor(c.received.directMinor, c.currency)} direct + ${formatMinor(c.received.settledMinor, c.currency)} settled`, registryId: "fin.received" },
      ]);
      evidence = { rows: [], total: 0, identified: false, note: "Money detail lives in Payments, which enforces its own permissions.", href: "/practice/payments" };
    }
  } else if (intent === "overdue_followups") {
    domains.push("follow_up");
    // pi.overdue_now -- THE SAME PREDICATE followUpIntelligence USES, verbatim, because two spellings
    // of "overdue" is the disagreeing-numbers bug (calling that module wholesale would drag in the
    // completion cohort and outcome reads this question never asked for).
    const practiceNow = practiceToday(range.timezone);
    const overdueRead = await admin.from("practice_follow_up")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"]).lt("due_on", practiceNow);
    // ⚠ null-count is not zero: PostgREST answers a missing table with error null, count null.
    if (overdueRead.error || overdueRead.count === null) {
      answered = false;
      sentence = "The follow-up record could not be read, so no overdue count can be given. That is not a zero.";
    } else {
      const overdueCount: number = overdueRead.count;
      registry = ["pi.overdue_now"];
      sentence = `${overdueCount} follow-up${overdueCount === 1 ? " is" : "s are"} overdue as at today, across all periods -- an overdue promise does not expire with the period that made it.`;
      figures = [{ label: "Overdue now", value: String(overdueCount), of: "all open follow-ups past their date", registryId: "pi.overdue_now" }];
      // Evidence, permitted rows only: names need patient.view; without it the rows are de-identified.
      const identified = hasCapability(ctx, "patient.view");
      const { data: rows } = await admin.from("practice_follow_up")
        .select("id, patient_id, due_on, reason")
        .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"])
        .lt("due_on", practiceNow).order("due_on").limit(11);
      const list = ((rows ?? []) as any[]).slice(0, 10);
      let nameOf = new Map<string, string>();
      if (identified && list.length > 0) {
        const { data: pats } = await admin.from("practice_patient")
          .select("id, display_name").in("id", list.map(r => r.patient_id));
        nameOf = new Map(((pats ?? []) as any[]).map(p => [p.id, p.display_name]));
      }
      evidence = {
        rows: list.map(r => ({
          label: identified ? (nameOf.get(r.patient_id) ?? "(name unavailable)") : "A patient (name needs patient.view)",
          detail: `due ${r.due_on} -- ${String(r.reason ?? "").slice(0, 60)}`,
          href: identified ? `/practice/patients/${r.patient_id}` : null,
        })),
        total: overdueCount, identified,
        note: "No subsequent record in CompetenPractice -- never a claim that care did not occur.",
        href: "/practice/follow-ups?filter=overdue",
      };
    }
  } else if (intent === "top_conditions") {
    domains.push("diagnosis");
    registry = ["pi.top_conditions_by_patients", "pi.top_conditions_by_encounters"];
    const top = (condition ? diagnoses.rows.filter(r => r.label === condition) : diagnoses.rows).slice(0, 5);
    if (top.length === 0) {
      sentence = `No diagnoses are recorded for ${period.periodLabel}. The read succeeded; the period is genuinely empty of recorded diagnoses.`;
    } else {
      sentence = `Top recorded condition${top.length === 1 ? "" : "s"} for ${period.periodLabel}: ${top.map(r => `${r.label} (${r.patients} patient${r.patients === 1 ? "" : "s"})`).join(", ")}. Counted as typed -- newly RECORDED here is not a claim of onset.`;
      figures = top.map(r => ({
        label: r.label, value: `${r.patients} patients`, of: `${r.total} records`, registryId: "pi.top_conditions_by_patients",
      }));
      evidence = {
        rows: [], total: diagnoses.total, identified: false,
        note: `${diagnoses.total} diagnosis records across ${diagnoses.distinctLabels} labels in the period.`,
        href: "/practice/intelligence?tab=clinical",
      };
    }
  } else if (intent === "investigations") {
    domains.push("investigation");
    registry = ["ask.investigations_ordered"];
    // The SAME aggregate the Investigations report uses (report-engine owns it) -- two group-bys of
    // one table is how an answer here and a report there come to disagree by one row.
    const inv = await investigationsOrdered(admin, ctx, range.period);
    if (!inv.ok) {
      answered = false;
      sentence = `The investigation record could not be read: ${inv.detail}. That is not "no investigations".`;
    } else {
      const top = inv.rows.slice(0, 5);
      sentence = top.length === 0
        ? `No investigations were recorded as requested in ${period.periodLabel}.`
        : `Most requested in ${period.periodLabel}: ${top.map(r => `${r.label} (${r.total} of ${inv.total})`).join(", ")}. These are what you recorded asking for -- nothing here left this product.`;
      figures = top.map(r => ({ label: r.label, value: String(r.total), of: `${inv.total} requests`, registryId: "ask.investigations_ordered" }));
      evidence = { rows: [], total: inv.total, identified: false, note: "Requested is not resulted; result linking lives on the encounter.", href: "/practice/encounters" };
    }
  } else if (intent === "patients_seen" || intent === "consultations") {
    domains.push("encounter");
    const o = await overviewIntelligence(admin, ctx, range);
    const metrics: any = o.available ? (o.data as any).metrics?.metrics : null;
    const m = intent === "patients_seen" ? metrics?.patients_seen : metrics?.completed;
    if (!o.available || !m || m.value === null) {
      answered = false;
      sentence = "That count could not be read. This is not a zero.";
    } else {
      const figureRegistryId = intent === "patients_seen" ? "pi.avg_visits_per_patient" : "pi.consultations_trend";
      registry = [figureRegistryId];
      // ⚠ THE RATIO IS ITS OWN FIGURE, NEVER FUSED INTO THE SENTENCE. The metric counts
      // COMPLETED/SIGNED/AMENDED consultations; the visits-per-patient ratio counts all launched
      // encounters. Splicing the two into one sentence produced "You saw 0 patients (2 visits over
      // 2 patients)" against an open-encounter fixture -- two universes wearing one claim. Each
      // figure now carries its own definition, and the sentence speaks only the metric's.
      sentence = intent === "patients_seen"
        ? `You saw ${m.value} distinct patient${m.value === 1 ? "" : "s"} in ${period.periodLabel}, counting completed consultations only.`
        : `${m.value} consultation${m.value === 1 ? "" : "s"} completed in ${period.periodLabel}.`;
      figures = [{ label: m.label ?? intent, value: String(m.value), of: m.formula ?? null, registryId: figureRegistryId }];
      const extras = await piV2Extras(admin, ctx, { fromDay: period.fromDay, toDay: period.toDay, todayDate: args.todayDate });
      if (extras.available && extras.data && extras.data.avgVisitsPerPatient.patients > 0) {
        if (!registry.includes("pi.avg_visits_per_patient")) registry.push("pi.avg_visits_per_patient");
        figures.push({
          label: "Visits per patient",
          value: `${extras.data.avgVisitsPerPatient.encounters} visits / ${extras.data.avgVisitsPerPatient.patients} patients`,
          of: "all launched encounters in the period, whatever their status", registryId: "pi.avg_visits_per_patient",
        });
      }
      evidence = { rows: [], total: m.value, identified: false, note: m.formula ?? "", href: "/practice/encounters" };
    }
  } else {
    answered = false;
    sentence = `That question cannot be grounded in this practice's records yet, so it is not answered rather than guessed. Try: ${EXAMPLES.map(e => `"${e}"`).join(", ")}.`;
  }

  // s13 stage 10: the audit row IS the history store -- user, question, scope, domains, metric versions.
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.ask_practice",
    payload: {
      question, intent, scope, domains,
      metrics: registry.map(id => ({ id, version: metricById(id)?.version ?? null })),
      answered,
    },
    correlationId: args.correlationId,
  });

  // Recent questions: this caller's own asks, read back from the trail (stage 8, no new table).
  const { data: recentRows } = await admin.from("practice_audit_event")
    .select("payload, occurred_at").eq("workspace_id", ctx.workspaceId)
    .eq("event_type", "practice.ask_practice").eq("actor_id", args.actorId)
    .order("occurred_at", { ascending: false }).limit(6);
  const recent = ((recentRows ?? []) as any[])
    .map(r => ({ question: String(r.payload?.question ?? ""), askedAt: String(r.occurred_at).slice(0, 16).replace("T", " ") }))
    .filter(r => r.question && r.question !== question)
    .slice(0, 5);

  return { question, intent, scope, provenance: "Derived", answered, sentence, figures, evidence, registry, recent };
}
